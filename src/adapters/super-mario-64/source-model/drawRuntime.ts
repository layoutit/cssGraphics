import {
  TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA,
  TITLE_HEAD_DEFORMATION_SNAPSHOT_SCHEMA,
  type TitleHeadDeformationRuntime,
  type TitleHeadDeformationSnapshot,
} from "./deformationRuntime.js";
import {
  gdIdentityMatrix,
  gdInverseMatrix,
  gdMultiplyMatrices,
  gdTranslateMatrix,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import { fail } from "./contract.js";

export const TITLE_HEAD_DRAW_RUNTIME_SCHEMA = "cssgraphics.title-head-draw-runtime.v1" as const;
export const TITLE_HEAD_DRAW_SNAPSHOT_SCHEMA = "cssgraphics.title-head-draw-snapshot.v1" as const;

interface RigidDisplayBinding {
  readonly shapeId: string;
  readonly shapeStateIndex: number;
  readonly objectId: string;
  readonly objectStateIndex: number;
  readonly vertexCount: number;
}

export interface TitleHeadDrawRuntime {
  readonly schema: typeof TITLE_HEAD_DRAW_RUNTIME_SCHEMA;
  readonly rootObjectId: string;
  readonly rootObjectStateIndex: number;
  readonly rigidDisplayBindings: readonly RigidDisplayBinding[];
  readonly rigidDisplayByShapeStateIndex: readonly (RigidDisplayBinding | null)[];
  readonly identityMatrix: GoddardMat4;
  readonly shapeTransformWritesPerTick: number;
  readonly transformedVerticesPerTick: 0;
}

export interface TitleHeadDrawSnapshot {
  readonly schema: typeof TITLE_HEAD_DRAW_SNAPSHOT_SCHEMA;
  readonly tick: number;
  readonly modelMatrix: GoddardMat4;
  readonly shapes: readonly {
    readonly id: string;
    readonly positions: readonly GoddardVec3[];
    readonly normals: readonly GoddardVec3[];
  }[];
  readonly shapeMatrices: readonly GoddardMat4[];
  readonly shapeTransformWrites: number;
  readonly transformedVertices: 0;
}

export interface TitleHeadDrawStep {
  readonly rigidWorldOffsets?: Readonly<Record<string, readonly number[]>>;
}

function worldOffset(value: readonly number[], label: string): GoddardVec3 {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    fail(`${label} must contain three finite values.`);
  }
  return Object.freeze([
    Math.fround(value[0]),
    Math.fround(value[1]),
    Math.fround(value[2]),
  ]);
}

/**
 * Compiles the prepared net/shape identities into numeric hot-path lookups.
 * Type-3 display nets retain undeformed local vertices; all other regular-head
 * shapes are already emitted in root-model space by move_nets.
 */
export function createTitleHeadDrawRuntime(
  deformation: TitleHeadDeformationRuntime,
): TitleHeadDrawRuntime {
  if (deformation?.schema !== TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA) {
    fail("The draw runtime requires the prepared deformation runtime.");
  }
  const rootObjectStateIndex = deformation.objectOrder.indexOf(deformation.rootNetId);
  if (rootObjectStateIndex < 0) fail(`Root net ${deformation.rootNetId} has no object-state row.`);
  const objectStateIndexById = new Map(deformation.objectOrder.map((id, index) => [id, index]));
  const shapeStateIndexById = new Map(deformation.shapes.map((shape, index) => [shape.id, index]));
  const occupiedShapes = new Set<string>();
  const rigidDisplayBindings: RigidDisplayBinding[] = [];

  for (const net of deformation.nets) {
    if (net.objectType !== 3 || net.displayShapeId === null) continue;
    const shapeStateIndex = shapeStateIndexById.get(net.displayShapeId);
    const objectStateIndex = objectStateIndexById.get(net.id);
    if (shapeStateIndex === undefined || objectStateIndex === undefined) {
      fail(`${net.id} has no prepared shape/object draw binding.`);
    }
    if (occupiedShapes.has(net.displayShapeId)) {
      fail(`${net.displayShapeId} has multiple type-3 display nets.`);
    }
    occupiedShapes.add(net.displayShapeId);
    rigidDisplayBindings.push(Object.freeze({
      shapeId: net.displayShapeId,
      shapeStateIndex,
      objectId: net.id,
      objectStateIndex,
      vertexCount: deformation.shapes[shapeStateIndex].vertices.length,
    }));
  }
  rigidDisplayBindings.sort((left, right) => left.shapeStateIndex - right.shapeStateIndex);
  const rigidDisplayByShapeStateIndex: (RigidDisplayBinding | null)[] = new Array(deformation.shapes.length).fill(null);
  for (const binding of rigidDisplayBindings) rigidDisplayByShapeStateIndex[binding.shapeStateIndex] = binding;

  return Object.freeze({
    schema: TITLE_HEAD_DRAW_RUNTIME_SCHEMA,
    rootObjectId: deformation.rootNetId,
    rootObjectStateIndex,
    rigidDisplayBindings: Object.freeze(rigidDisplayBindings),
    rigidDisplayByShapeStateIndex: Object.freeze(rigidDisplayByShapeStateIndex),
    identityMatrix: gdIdentityMatrix(),
    shapeTransformWritesPerTick: rigidDisplayBindings.length,
    transformedVerticesPerTick: 0 as const,
  });
}

export function evaluateTitleHeadDrawRuntime(
  runtime: TitleHeadDrawRuntime,
  deformation: TitleHeadDeformationSnapshot,
  step: TitleHeadDrawStep = Object.freeze({}),
): TitleHeadDrawSnapshot {
  if (runtime?.schema !== TITLE_HEAD_DRAW_RUNTIME_SCHEMA) fail("Unexpected draw runtime schema.");
  if (deformation?.schema !== TITLE_HEAD_DEFORMATION_SNAPSHOT_SCHEMA) {
    fail("The draw runtime requires a deformation snapshot.");
  }
  if (deformation.shapes.length !== runtime.rigidDisplayByShapeStateIndex.length) {
    fail("The deformation snapshot no longer matches the prepared draw bindings.");
  }
  const root = deformation.objects[runtime.rootObjectStateIndex];
  if (!root || root.id !== runtime.rootObjectId) fail("The root draw-matrix row is stale.");
  const rigidWorldOffsets: Readonly<Record<string, readonly number[]>> = (
    step.rigidWorldOffsets ?? Object.freeze({})
  );
  const rigidObjectIds = new Set(runtime.rigidDisplayBindings.map(({ objectId }) => objectId));
  for (const objectId of Object.keys(rigidWorldOffsets)) {
    if (!rigidObjectIds.has(objectId)) {
      fail(`Rigid world offset ${objectId} has no prepared display binding.`);
    }
  }
  const rootInverse = Object.keys(rigidWorldOffsets).length === 0
    ? null
    : gdInverseMatrix(root.rotationMatrix);

  const shapeMatrices = deformation.shapes.map((shape, shapeStateIndex) => {
    const binding = runtime.rigidDisplayByShapeStateIndex[shapeStateIndex];
    if (binding === null) return runtime.identityMatrix;
    if (shape.id !== binding.shapeId || shape.positions.length !== binding.vertexCount) {
      fail(`${binding.shapeId} no longer matches its prepared rigid display row.`);
    }
    const object = deformation.objects[binding.objectStateIndex];
    if (!object || object.id !== binding.objectId) {
      fail(`${binding.objectId} no longer matches its prepared object-state row.`);
    }
    const inputOffset = rigidWorldOffsets[binding.objectId];
    if (inputOffset !== undefined) {
      const offset = worldOffset(inputOffset, `rigidWorldOffsets.${binding.objectId}`);
      if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
        // eye_joint_update_func adds its cursor offset to the already-composed
        // net rotation matrix. Factor that final source matrix back through
        // the retained root model transform for the PolyCSS packet split.
        return gdMultiplyMatrices(
          gdTranslateMatrix(object.rotationMatrix, offset),
          rootInverse as GoddardMat4,
        );
      }
    }
    return object.worldMatrix;
  });
  return Object.freeze({
    schema: TITLE_HEAD_DRAW_SNAPSHOT_SCHEMA,
    tick: deformation.tick,
    modelMatrix: root.rotationMatrix,
    shapes: deformation.shapes,
    shapeMatrices: Object.freeze(shapeMatrices),
    shapeTransformWrites: runtime.shapeTransformWritesPerTick,
    transformedVertices: 0 as const,
  });
}
