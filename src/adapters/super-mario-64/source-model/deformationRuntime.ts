import {
  gdIdentityMatrix,
  gdInverseMatrix,
  gdMultiplyMatrices,
  gdRotateMatrixEuler,
  gdScaleMatrix,
  gdTransformPoint,
  gdTranslateMatrix,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import {
  array,
  fail,
  finite,
  integer,
  matrix,
  record,
  string,
  vec3,
} from "./contract.js";

export const TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA = "cssgraphics.title-head-deformation-runtime.v1" as const;
export const TITLE_HEAD_DEFORMATION_SNAPSHOT_SCHEMA = "cssgraphics.title-head-deformation-snapshot.v1" as const;

export interface TitleHeadShapeInput {
  readonly id: string;
  readonly vertices: readonly (readonly number[])[];
  readonly normals: readonly (readonly number[])[];
}

export interface TitleHeadNetInput {
  readonly id: string;
  readonly objectType: 2 | 3 | 4;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly displayShapeId: string | null;
  readonly skinShapeId: string | null;
  readonly jointIds: readonly string[];
  readonly localMatrix: readonly number[];
  readonly scale?: readonly number[];
  readonly sourceCommandIndex?: number;
}

export interface TitleHeadWeightInput {
  readonly id: string;
  readonly vertexIndex: number;
  readonly scalar: number;
  readonly sourceOrder?: number;
}

export interface TitleHeadJointInput {
  readonly id: string;
  readonly parentId: string;
  readonly childIds: readonly string[];
  readonly skinNetId: string;
  readonly weights: readonly TitleHeadWeightInput[];
  readonly localMatrix: readonly number[];
  readonly scale?: readonly number[];
  readonly sourceCommandIndex?: number;
}

export interface TitleHeadDeformationInput {
  readonly rootNetId: string;
  readonly shapes: readonly TitleHeadShapeInput[];
  readonly nets: readonly TitleHeadNetInput[];
  readonly joints: readonly TitleHeadJointInput[];
}

interface NormalizedShape {
  readonly id: string;
  readonly vertices: readonly GoddardVec3[];
  readonly normals: readonly GoddardVec3[];
}

interface NormalizedObject {
  readonly id: string;
  readonly kind: "net" | "joint";
  readonly objectType: number;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly localMatrix: GoddardMat4;
  readonly scale: GoddardVec3;
  readonly sourceCommandIndex: number | null;
}

interface NormalizedNet extends NormalizedObject {
  readonly kind: "net";
  readonly objectType: 2 | 3 | 4;
  readonly displayShapeId: string | null;
  readonly skinShapeId: string | null;
  readonly jointIds: readonly string[];
}

interface NormalizedWeight {
  readonly id: string;
  readonly vertexIndex: number;
  readonly scalar: number;
  readonly sourceOrder: number;
  readonly bindLocal: GoddardVec3;
}

interface NormalizedJoint extends NormalizedObject {
  readonly kind: "joint";
  readonly objectType: 3;
  readonly parentId: string;
  readonly skinNetId: string;
  readonly weights: readonly NormalizedWeight[];
}

interface ObjectMatrices {
  readonly worldMatrix: GoddardMat4;
  readonly rotationMatrix: GoddardMat4;
}

export interface TitleHeadDeformationRuntime {
  readonly schema: typeof TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA;
  readonly rootNetId: string;
  readonly shapes: readonly NormalizedShape[];
  readonly nets: readonly NormalizedNet[];
  readonly joints: readonly NormalizedJoint[];
  readonly objectOrder: readonly string[];
  readonly residualScaleByShape: Readonly<Record<string, readonly number[]>>;
}

export interface TitleHeadDeformationSnapshot {
  readonly schema: typeof TITLE_HEAD_DEFORMATION_SNAPSHOT_SCHEMA;
  readonly tick: number;
  readonly objectOrder: readonly string[];
  readonly objects: readonly {
    readonly id: string;
    readonly kind: "net" | "joint";
    readonly worldMatrix: GoddardMat4;
    readonly rotationMatrix: GoddardMat4;
  }[];
  readonly shapes: readonly {
    readonly id: string;
    readonly positions: readonly GoddardVec3[];
    readonly normals: readonly GoddardVec3[];
  }[];
  readonly totals: Readonly<{
    objects: number;
    shapes: number;
    vertices: number;
  }>;
}

export interface TitleHeadDeformationStep {
  readonly tick?: number;
  readonly localMatrixOverrides?: Readonly<Record<string, readonly number[]>>;
  readonly worldMatrixOffsets?: Readonly<Record<string, readonly number[]>>;
}

const f32 = Math.fround;

function scale(value: readonly number[] | undefined, label: string): GoddardVec3 {
  return value === undefined ? Object.freeze([1, 1, 1]) : vec3(value, label);
}

function immutableVec(value: GoddardVec3): GoddardVec3 {
  return Object.freeze([f32(value[0]), f32(value[1]), f32(value[2])]);
}

function multiplyScalar(value: number, scalar: number): number {
  return f32(f32(value) * f32(scalar));
}

function addWeighted(value: number, contribution: number, weight: number): number {
  return f32(f32(value) + multiplyScalar(contribution, weight));
}

function normalizeShape(input: TitleHeadShapeInput, index: number): NormalizedShape {
  const id = string(input.id, `shapes[${index}].id`);
  if (!Array.isArray(input.vertices) || input.vertices.length === 0) {
    fail(`${id} must contain vertices.`);
  }
  if (!Array.isArray(input.normals) || input.normals.length !== input.vertices.length) {
    fail(`${id} must contain one normal per vertex.`);
  }
  return Object.freeze({
    id,
    vertices: Object.freeze(input.vertices.map((value, vertexIndex) => vec3(value, `${id}.vertices[${vertexIndex}]`))),
    normals: Object.freeze(input.normals.map((value, normalIndex) => vec3(value, `${id}.normals[${normalIndex}]`))),
  });
}

function normalizeNet(input: TitleHeadNetInput, index: number): NormalizedNet {
  const id = string(input.id, `nets[${index}].id`);
  if (input.objectType !== 2 && input.objectType !== 3 && input.objectType !== 4) {
    fail(`${id} has unsupported net type ${String(input.objectType)}.`);
  }
  return Object.freeze({
    id,
    kind: "net" as const,
    objectType: input.objectType,
    parentId: input.parentId === null ? null : string(input.parentId, `${id}.parentId`),
    childIds: Object.freeze(input.childIds.map((childId, childIndex) => string(childId, `${id}.childIds[${childIndex}]`))),
    displayShapeId: input.displayShapeId === null ? null : string(input.displayShapeId, `${id}.displayShapeId`),
    skinShapeId: input.skinShapeId === null ? null : string(input.skinShapeId, `${id}.skinShapeId`),
    jointIds: Object.freeze(input.jointIds.map((jointId, jointIndex) => string(jointId, `${id}.jointIds[${jointIndex}]`))),
    localMatrix: matrix(input.localMatrix, `${id}.localMatrix`),
    scale: scale(input.scale, `${id}.scale`),
    sourceCommandIndex: input.sourceCommandIndex === undefined
      ? null
      : integer(input.sourceCommandIndex, `${id}.sourceCommandIndex`),
  });
}

interface JointWithoutBind extends Omit<NormalizedJoint, "weights"> {
  readonly weights: readonly Omit<NormalizedWeight, "bindLocal">[];
}

function normalizeJoint(input: TitleHeadJointInput, index: number): JointWithoutBind {
  const id = string(input.id, `joints[${index}].id`);
  return Object.freeze({
    id,
    kind: "joint" as const,
    objectType: 3 as const,
    parentId: string(input.parentId, `${id}.parentId`),
    childIds: Object.freeze(input.childIds.map((childId, childIndex) => string(childId, `${id}.childIds[${childIndex}]`))),
    skinNetId: string(input.skinNetId, `${id}.skinNetId`),
    localMatrix: matrix(input.localMatrix, `${id}.localMatrix`),
    scale: scale(input.scale, `${id}.scale`),
    sourceCommandIndex: input.sourceCommandIndex === undefined
      ? null
      : integer(input.sourceCommandIndex, `${id}.sourceCommandIndex`),
    weights: Object.freeze(input.weights.map((weight, weightIndex) => {
      const scalar = finite(weight.scalar, `${id}.weights[${weightIndex}].scalar`);
      if (scalar <= 0 || scalar > 1) {
        fail(`${id}.weights[${weightIndex}] must be in (0, 1].`);
      }
      const vertexIndex = integer(weight.vertexIndex, `${id}.weights[${weightIndex}].vertexIndex`);
      if (vertexIndex < 0) fail(`${id} has a negative vertex index.`);
      return Object.freeze({
        id: string(weight.id, `${id}.weights[${weightIndex}].id`),
        vertexIndex,
        scalar,
        sourceOrder: weight.sourceOrder === undefined
          ? weightIndex
          : integer(weight.sourceOrder, `${id}.weights[${weightIndex}].sourceOrder`),
      });
    })),
  });
}

function objectMatrices(
  objects: readonly NormalizedObject[],
  rootNetId: string,
  overrides: Readonly<Record<string, readonly number[]>> = Object.freeze({}),
): ReadonlyMap<string, ObjectMatrices> {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const matrices = new Map<string, ObjectMatrices>();
  const visiting = new Set<string>();
  const overrideIds = Object.keys(overrides);
  for (const id of overrideIds) {
    if (!objectById.has(id)) fail(`Matrix override ${id} is not a prepared object.`);
  }

  const visit = (id: string): ObjectMatrices => {
    const cached = matrices.get(id);
    if (cached) return cached;
    const object = objectById.get(id);
    if (!object) fail(`Object ${id} is absent from the deformation graph.`);
    if (visiting.has(id)) fail(`Object parent cycle reaches ${id}.`);
    visiting.add(id);
    const local = overrides[id] === undefined
      ? object.localMatrix
      : matrix(overrides[id], `localMatrixOverrides.${id}`);
    let worldMatrix: GoddardMat4;
    let rotationMatrix: GoddardMat4;
    if (id === rootNetId) {
      if (object.parentId !== null) fail(`${rootNetId} must not have a parent.`);
      worldMatrix = gdIdentityMatrix();
      rotationMatrix = gdScaleMatrix(local, object.scale);
    } else {
      if (object.parentId === null) fail(`${id} has no parent.`);
      const parent = visit(object.parentId);
      worldMatrix = gdMultiplyMatrices(local, parent.worldMatrix);
      rotationMatrix = gdScaleMatrix(gdMultiplyMatrices(local, parent.rotationMatrix), object.scale);
    }
    const result = Object.freeze({ worldMatrix, rotationMatrix });
    matrices.set(id, result);
    visiting.delete(id);
    return result;
  };

  visit(rootNetId);
  for (const object of objects) visit(object.id);
  return matrices;
}

function offsetWorldMatrices(
  source: ReadonlyMap<string, ObjectMatrices>,
  offsets: Readonly<Record<string, readonly number[]>> = Object.freeze({}),
): ReadonlyMap<string, ObjectMatrices> {
  if (Object.keys(offsets).length === 0) return source;
  const matrices = new Map(source);
  for (const [id, rawOffset] of Object.entries(offsets)) {
    const current = matrices.get(id);
    if (!current) {
      fail(`World matrix offset ${id} is not a prepared object.`);
    }
    const offset = vec3(rawOffset, `worldMatrixOffsets.${id}`);
    const worldMatrix = [...current.worldMatrix];
    worldMatrix[12] = f32(f32(worldMatrix[12]) + offset[0]);
    worldMatrix[13] = f32(f32(worldMatrix[13]) + offset[1]);
    worldMatrix[14] = f32(f32(worldMatrix[14]) + offset[2]);
    matrices.set(id, Object.freeze({
      worldMatrix: Object.freeze(worldMatrix),
      rotationMatrix: current.rotationMatrix,
    }));
  }
  return matrices;
}

function validateHierarchy(
  nets: readonly NormalizedNet[],
  joints: readonly JointWithoutBind[],
  rootNetId: string,
): readonly NormalizedObject[] {
  const objects: readonly NormalizedObject[] = Object.freeze([...nets, ...joints]);
  const objectById = new Map<string, NormalizedObject>();
  for (const object of objects) {
    if (objectById.has(object.id)) fail(`Object id ${object.id} is duplicated.`);
    objectById.set(object.id, object);
  }
  const root = objectById.get(rootNetId);
  if (!root || root.kind !== "net") fail(`Root net ${rootNetId} is absent.`);
  for (const object of objects) {
    if (object.id !== rootNetId && object.parentId === null) {
      fail(`${object.id} has no parent.`);
    }
    if (object.parentId !== null && !objectById.has(object.parentId)) {
      fail(`${object.id} references missing parent ${object.parentId}.`);
    }
    const uniqueChildren = new Set(object.childIds);
    if (uniqueChildren.size !== object.childIds.length) fail(`${object.id} repeats a child.`);
    for (const childId of object.childIds) {
      const child = objectById.get(childId);
      if (!child) fail(`${object.id} references missing child ${childId}.`);
      if (child.parentId !== object.id) fail(`${object.id} and ${childId} disagree on ancestry.`);
    }
  }
  objectMatrices(objects, rootNetId);
  return objects;
}

export function createTitleHeadDeformationRuntime(
  input: TitleHeadDeformationInput,
): TitleHeadDeformationRuntime {
  const rootNetId = string(input.rootNetId, "rootNetId");
  const shapes = Object.freeze(input.shapes.map(normalizeShape));
  const shapeById = new Map<string, NormalizedShape>();
  for (const shape of shapes) {
    if (shapeById.has(shape.id)) fail(`Shape id ${shape.id} is duplicated.`);
    shapeById.set(shape.id, shape);
  }
  const nets = Object.freeze(input.nets.map(normalizeNet));
  const jointsWithoutBind = Object.freeze(input.joints.map(normalizeJoint));
  const objects = validateHierarchy(nets, jointsWithoutBind, rootNetId);
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const jointById = new Map(jointsWithoutBind.map((joint) => [joint.id, joint]));

  for (const net of nets) {
    if (net.displayShapeId !== null && !shapeById.has(net.displayShapeId)) {
      fail(`${net.id} references missing display shape ${net.displayShapeId}.`);
    }
    if (net.skinShapeId !== null && !shapeById.has(net.skinShapeId)) {
      fail(`${net.id} references missing skin shape ${net.skinShapeId}.`);
    }
    if (net.objectType === 4 && net.skinShapeId === null) {
      fail(`${net.id} is a skin net without a skin shape.`);
    }
    for (const jointId of net.jointIds) {
      const joint = jointById.get(jointId);
      if (!joint || joint.skinNetId !== net.id) fail(`${net.id} has invalid joint ${jointId}.`);
    }
  }
  for (const joint of jointsWithoutBind) {
    const skinNet = objectById.get(joint.skinNetId);
    if (!skinNet || skinNet.kind !== "net" || skinNet.objectType !== 4) {
      fail(`${joint.id} references invalid skin net ${joint.skinNetId}.`);
    }
  }

  const neutralMatrices = objectMatrices(objects, rootNetId);
  const residualMutable = new Map<string, number[]>();
  for (const shape of shapes) residualMutable.set(shape.id, new Array(shape.vertices.length).fill(1));
  const resetPositions = new Map(shapes.map((shape) => [
    shape.id,
    shape.vertices.map((position) => immutableVec(position)),
  ]));
  const boundWeights = new Map<string, readonly NormalizedWeight[]>();

  // func_80193848 visits skin nets in source group order. dSetSkinShape stores
  // only net->skinGrp; it does not set net->shapePtr. Therefore the guarded
  // scale_verts(net->shapePtr->vtxGroup) call in func_801922FC is skipped for
  // these regular-head skin nets and every weight captures the same source
  // position before subtracting its contribution from scaleFactor.
  for (const net of nets) {
    if (net.objectType !== 4 || net.skinShapeId === null) continue;
    const shape = shapeById.get(net.skinShapeId) as NormalizedShape;
    const residual = residualMutable.get(shape.id) as number[];
    if (net.displayShapeId !== null) {
      const displayedShape = shapeById.get(net.displayShapeId) as NormalizedShape;
      const displayedResidual = residualMutable.get(displayedShape.id) as number[];
      resetPositions.set(displayedShape.id, displayedShape.vertices.map((position, vertexIndex) => immutableVec([
        multiplyScalar(position[0], displayedResidual[vertexIndex]),
        multiplyScalar(position[1], displayedResidual[vertexIndex]),
        multiplyScalar(position[2], displayedResidual[vertexIndex]),
      ])));
    }
    const skinPositions = resetPositions.get(shape.id) as readonly GoddardVec3[];
    for (const jointId of net.jointIds) {
      const joint = jointById.get(jointId) as JointWithoutBind;
      const inverse = gdInverseMatrix((neutralMatrices.get(joint.id) as ObjectMatrices).worldMatrix);
      const weights = joint.weights.map((weight) => {
        if (weight.vertexIndex >= shape.vertices.length) {
          fail(`${weight.id} is outside shape ${shape.id}.`);
        }
        const bindLocal = gdTransformPoint(skinPositions[weight.vertexIndex], inverse);
        residual[weight.vertexIndex] = f32(f32(residual[weight.vertexIndex]) - weight.scalar);
        return Object.freeze({ ...weight, bindLocal });
      });
      boundWeights.set(joint.id, Object.freeze(weights));
    }
  }

  const joints: readonly NormalizedJoint[] = Object.freeze(jointsWithoutBind.map((joint) => Object.freeze({
    ...joint,
    weights: boundWeights.get(joint.id) ?? Object.freeze([]),
  })));
  const residualScaleByShape = Object.freeze(Object.fromEntries(
    shapes.map((shape) => [shape.id, Object.freeze((residualMutable.get(shape.id) as number[]).map(f32))]),
  ));
  const objectOrder = Object.freeze(
    [...nets, ...joints]
      .sort((left, right) => {
        if (left.sourceCommandIndex === null && right.sourceCommandIndex === null) return left.id.localeCompare(right.id);
        if (left.sourceCommandIndex === null) return 1;
        if (right.sourceCommandIndex === null) return -1;
        return left.sourceCommandIndex - right.sourceCommandIndex;
      })
      .map((object) => object.id),
  );

  return Object.freeze({
    schema: TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA,
    rootNetId,
    shapes,
    nets,
    joints,
    objectOrder,
    residualScaleByShape,
  });
}

function preparedTransform(
  value: unknown,
  kind: "net" | "joint",
  label: string,
): Readonly<{ localMatrix: GoddardMat4; scale: GoddardVec3 }> {
  const transform = record(value, `${label}.transform`);
  const sourceScale = vec3(array(transform.scale, `${label}.transform.scale`) as readonly number[], `${label}.transform.scale`);
  const rotation = vec3(array(transform.rotationDegrees, `${label}.transform.rotationDegrees`) as readonly number[], `${label}.transform.rotationDegrees`);
  const offset = vec3(array(transform.attachOffset, `${label}.transform.attachOffset`) as readonly number[], `${label}.transform.attachOffset`);
  let local = gdIdentityMatrix();
  if (kind === "joint") local = gdScaleMatrix(local, sourceScale);
  local = gdRotateMatrixEuler(local, rotation);
  local = gdTranslateMatrix(local, offset);
  return Object.freeze({ localMatrix: local, scale: sourceScale });
}

export function createPreparedTitleHeadDeformationRuntime({
  geometry,
  deformation,
  materials,
}: {
  readonly geometry: unknown;
  readonly deformation: unknown;
  readonly materials: unknown;
}): TitleHeadDeformationRuntime {
  const geometryRecord = record(geometry, "geometry");
  const deformationRecord = record(deformation, "deformation");
  const materialsRecord = record(materials, "materials");
  if (geometryRecord.schema !== "cssgraphics-title-head-geometry@1") fail("Unexpected geometry schema.");
  if (deformationRecord.schema !== "cssgraphics-title-head-deformation@1") fail("Unexpected deformation schema.");
  if (materialsRecord.schema !== "cssgraphics-title-head-materials@1") fail("Unexpected materials schema.");
  if (deformationRecord.geometryHash !== geometryRecord.contentHash) {
    fail("The deformation graph is not bound to this geometry payload.");
  }
  const provenance = record(materialsRecord.provenance, "materials.provenance");
  if (provenance.geometryContentHash !== geometryRecord.contentHash) {
    fail("The material normals are not bound to this geometry payload.");
  }

  const normalSets = array(materialsRecord.normals, "materials.normals").map((entry, index) => {
    const normalSet = record(entry, `materials.normals[${index}]`);
    return {
      shapeId: string(normalSet.shapeId, `materials.normals[${index}].shapeId`),
      normals: array(normalSet.vertexNormals, `materials.normals[${index}].vertexNormals`) as readonly (readonly number[])[],
    };
  });
  const normalByShape = new Map(normalSets.map((normalSet) => [normalSet.shapeId, normalSet.normals]));
  const shapes: TitleHeadShapeInput[] = array(geometryRecord.shapes, "geometry.shapes").map((entry, index) => {
    const shape = record(entry, `geometry.shapes[${index}]`);
    const id = string(shape.id, `geometry.shapes[${index}].id`);
    const normals = normalByShape.get(id);
    if (!normals) fail(`Prepared shape ${id} has no source normal set.`);
    return {
      id,
      vertices: array(shape.vertices, `${id}.vertices`) as readonly (readonly number[])[],
      normals,
    };
  });
  if (normalByShape.size !== shapes.length) fail("Prepared normal and geometry shape counts differ.");

  const nets: TitleHeadNetInput[] = array(deformationRecord.nets, "deformation.nets").map((entry, index) => {
    const net = record(entry, `deformation.nets[${index}]`);
    const id = string(net.id, `deformation.nets[${index}].id`);
    const objectType = integer(net.objectType, `${id}.objectType`);
    if (objectType !== 2 && objectType !== 3 && objectType !== 4) {
      fail(`${id} has unsupported net type ${objectType}.`);
    }
    const transform = preparedTransform(net.transform, "net", id);
    return {
      id,
      objectType,
      parentId: net.parentId === null ? null : string(net.parentId, `${id}.parentId`),
      childIds: array(net.childIds, `${id}.childIds`) as readonly string[],
      displayShapeId: net.displayShapeId === null ? null : string(net.displayShapeId, `${id}.displayShapeId`),
      skinShapeId: net.skinShapeId === null ? null : string(net.skinShapeId, `${id}.skinShapeId`),
      jointIds: array(net.jointIds, `${id}.jointIds`) as readonly string[],
      localMatrix: transform.localMatrix,
      scale: transform.scale,
      sourceCommandIndex: integer(net.sourceCommandIndex, `${id}.sourceCommandIndex`),
    };
  });
  const joints: TitleHeadJointInput[] = array(deformationRecord.joints, "deformation.joints").map((entry, index) => {
    const joint = record(entry, `deformation.joints[${index}]`);
    const id = string(joint.id, `deformation.joints[${index}].id`);
    const transform = preparedTransform(joint.transform, "joint", id);
    return {
      id,
      parentId: string(joint.parentId, `${id}.parentId`),
      childIds: array(joint.childIds, `${id}.childIds`) as readonly string[],
      skinNetId: string(joint.skinNetId, `${id}.skinNetId`),
      weights: array(joint.weights, `${id}.weights`).map((weightEntry, weightIndex) => {
        const weight = record(weightEntry, `${id}.weights[${weightIndex}]`);
        return {
          id: string(weight.id, `${id}.weights[${weightIndex}].id`),
          vertexIndex: integer(weight.vertexIndex, `${id}.weights[${weightIndex}].vertexIndex`),
          scalar: finite(weight.scalar, `${id}.weights[${weightIndex}].scalar`),
          sourceOrder: integer(weight.sourceOrder, `${id}.weights[${weightIndex}].sourceOrder`),
        };
      }),
      localMatrix: transform.localMatrix,
      scale: transform.scale,
      sourceCommandIndex: integer(joint.sourceCommandIndex, `${id}.sourceCommandIndex`),
    };
  });
  const rootNetId = string(deformationRecord.rootNetId, "deformation.rootNetId");
  return createTitleHeadDeformationRuntime({ rootNetId, shapes, nets, joints });
}

export function evaluateTitleHeadDeformation(
  runtime: TitleHeadDeformationRuntime,
  step: TitleHeadDeformationStep = Object.freeze({}),
): TitleHeadDeformationSnapshot {
  if (runtime.schema !== TITLE_HEAD_DEFORMATION_RUNTIME_SCHEMA) fail("Unexpected deformation runtime schema.");
  const tick = step.tick === undefined ? 0 : integer(step.tick, "tick");
  if (tick < 0) fail("tick must be non-negative.");
  const objects: readonly NormalizedObject[] = Object.freeze([...runtime.nets, ...runtime.joints]);
  const matrices = offsetWorldMatrices(
    objectMatrices(objects, runtime.rootNetId, step.localMatrixOverrides),
    step.worldMatrixOffsets,
  );
  const shapeById = new Map(runtime.shapes.map((shape) => [shape.id, shape]));
  const jointById = new Map(runtime.joints.map((joint) => [joint.id, joint]));
  const positions = new Map(runtime.shapes.map((shape) => [
    shape.id,
    shape.vertices.map((position) => [position[0], position[1], position[2]] as [number, number, number]),
  ]));

  // move_nets visits source nets in order: type 2 publishes residual/base
  // vertices, type 4 adds weighted joint contributions, and type 3 only runs
  // joint callbacks. Source normals are emitted separately and remain stable.
  for (const net of runtime.nets) {
    if (net.objectType === 2 && net.displayShapeId !== null) {
      const shape = shapeById.get(net.displayShapeId) as NormalizedShape;
      const current = positions.get(shape.id) as [number, number, number][];
      const residual = runtime.residualScaleByShape[shape.id];
      for (let vertexIndex = 0; vertexIndex < shape.vertices.length; vertexIndex += 1) {
        current[vertexIndex][0] = multiplyScalar(shape.vertices[vertexIndex][0], residual[vertexIndex]);
        current[vertexIndex][1] = multiplyScalar(shape.vertices[vertexIndex][1], residual[vertexIndex]);
        current[vertexIndex][2] = multiplyScalar(shape.vertices[vertexIndex][2], residual[vertexIndex]);
      }
    } else if (net.objectType === 4 && net.skinShapeId !== null) {
      const shape = shapeById.get(net.skinShapeId) as NormalizedShape;
      const current = positions.get(shape.id) as [number, number, number][];
      for (const jointId of net.jointIds) {
        const joint = jointById.get(jointId) as NormalizedJoint;
        const world = (matrices.get(joint.id) as ObjectMatrices).worldMatrix;
        for (const weight of joint.weights) {
          const contribution = gdTransformPoint(weight.bindLocal, world);
          const position = current[weight.vertexIndex];
          position[0] = addWeighted(position[0], contribution[0], weight.scalar);
          position[1] = addWeighted(position[1], contribution[1], weight.scalar);
          position[2] = addWeighted(position[2], contribution[2], weight.scalar);
        }
      }
    }
  }

  const objectSnapshots = Object.freeze(runtime.objectOrder.map((id) => {
    const object = objects.find((candidate) => candidate.id === id) as NormalizedObject;
    const value = matrices.get(id) as ObjectMatrices;
    return Object.freeze({
      id,
      kind: object.kind,
      worldMatrix: value.worldMatrix,
      rotationMatrix: value.rotationMatrix,
    });
  }));
  const shapeSnapshots = Object.freeze(runtime.shapes.map((shape) => Object.freeze({
    id: shape.id,
    positions: Object.freeze((positions.get(shape.id) as [number, number, number][]).map((position) => immutableVec(position))),
    normals: shape.normals,
  })));
  return Object.freeze({
    schema: TITLE_HEAD_DEFORMATION_SNAPSHOT_SCHEMA,
    tick,
    objectOrder: runtime.objectOrder,
    objects: objectSnapshots,
    shapes: shapeSnapshots,
    totals: Object.freeze({
      objects: objectSnapshots.length,
      shapes: shapeSnapshots.length,
      vertices: shapeSnapshots.reduce((total, shape) => total + shape.positions.length, 0),
    }),
  });
}
