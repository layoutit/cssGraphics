import {
  computeSolidTrianglePlanFromCssPoints,
  type Polygon,
  type SolidTriangleComputeOptions,
  type SolidTrianglePlanOptions,
} from "@layoutit/polycss";
import {
  createHeadModelPolyCssRoot,
  sourceMatrixToPolyCssTransform,
  type HeadModelPolyCssRoot,
} from "../runtime/polycssRoot.js";
import type { MarioSparsePublication } from "./interaction.js";
import {
  MARIO_FRAME_COUNT,
  MARIO_LEAF_COUNT,
  type MarioLighting,
  type MarioLightingFace,
  type MarioPlan,
} from "./model.js";

const CAMERA = Object.freeze({
  sourceWidth: 320,
  sourceHeight: 240,
  perspective: 120 / Math.tan(Math.PI / 8),
  worldY: 200,
  worldZ: 2000,
  near: 30,
  far: 5000,
  zoom: 50,
});

export interface MarioScene {
  readonly root: HeadModelPolyCssRoot;
  readonly shapeElements: readonly HTMLElement[];
  readonly leafElements: readonly HTMLElement[];
  readonly sceneElement: HTMLElement;
  readonly currentFrame: number;
  readonly hiddenLeaves: number;
  setAppearance(
    viewportWidth: number,
    viewportHeight: number,
    sourceScale: number,
    appearance: readonly [id: string, scale: number, translateY: number],
  ): void;
  writeModelTransform(transform: string): void;
  writeShape(index: number, transform: string, visible: boolean): void;
  writeLeafTransform(index: number, transform: string): void;
  applySurfaceFrame(sourceFrame: number, sparse?: boolean): void;
  forceVisible(indices: Uint16Array): void;
  applyInteraction(publications: readonly MarioSparsePublication[]): void;
  destroy(): void;
}

interface LightingState {
  readonly faces: readonly (MarioLightingFace & {
    readonly sourceFrames: Uint16Array;
  })[];
  readonly positions: readonly string[];
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialFaces: Uint16Array;
  readonly sequentialStates: Uint16Array;
  readonly jumps: ReadonlyMap<string, Readonly<{
    readonly faces: Uint16Array;
    readonly states: Uint16Array;
  }>>;
}

interface VisibilityState {
  readonly rows: readonly Uint8Array[];
  readonly sequentialOffsets: Uint32Array;
  readonly sequentialFaces: Uint16Array;
  readonly jumps: ReadonlyMap<string, Uint16Array>;
}

function bytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function uint16(value: string): Uint16Array {
  const source = bytes(value);
  if (source.byteLength % 2 !== 0) throw new TypeError("Mario uint16 data is truncated.");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Uint16Array.from(
    { length: source.byteLength / 2 },
    (_, index) => view.getUint16(index * 2, true),
  );
}

function uint32(value: string): Uint32Array {
  const source = bytes(value);
  if (source.byteLength % 4 !== 0) throw new TypeError("Mario uint32 data is truncated.");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Uint32Array.from(
    { length: source.byteLength / 4 },
    (_, index) => view.getUint32(index * 4, true),
  );
}

function bitset(value: string, count: number): Uint8Array {
  const packed = bytes(value);
  if (packed.length !== Math.ceil(count / 8)) {
    throw new TypeError("Mario visibility data is truncated.");
  }
  return Uint8Array.from(
    { length: count },
    (_, index) => (packed[index >> 3]! >> (index & 7)) & 1,
  );
}

function toggle(row: Uint8Array, indices: Uint16Array): void {
  for (const index of indices) row[index] ^= 1;
}

function lightingState(lighting: MarioLighting, plan: MarioPlan): LightingState {
  const packing = lighting.surface.statePacking;
  const sourceFrames = uint16(packing.sourceFramesBase64);
  if (
    sourceFrames.length !== packing.stateCount
    || packing.backgroundPositionYs.length !== packing.stateCount
  ) {
    throw new TypeError("Mario lighting states are incomplete.");
  }
  const faces = lighting.surface.faces.map((face, index) => {
    const leaf = plan.leaves[index];
    if (
      face.sourceOrder !== index
      || face.faceId !== leaf?.faceId
      || face.stateOffset + face.stateCount > sourceFrames.length
    ) {
      throw new TypeError("Mario lighting no longer matches its leaves.");
    }
    return Object.freeze({
      ...face,
      sourceFrames: sourceFrames.subarray(
        face.stateOffset,
        face.stateOffset + face.stateCount,
      ),
    });
  });
  const sequential = lighting.transitions.sequential;
  const jumps = new Map(lighting.transitions.nonInteractiveJumps.map((jump) => [
    `${jump.fromFrame}>${jump.toFrame}`,
    Object.freeze({
      faces: uint16(jump.faceIndicesBase64),
      states: uint16(jump.stateIndicesBase64),
    }),
  ]));
  return Object.freeze({
    faces: Object.freeze(faces),
    positions: packing.backgroundPositionYs,
    sequentialOffsets: uint32(sequential.offsetsBase64),
    sequentialFaces: uint16(sequential.faceIndicesBase64),
    sequentialStates: uint16(sequential.stateIndicesBase64),
    jumps,
  });
}

function visibilityState(lighting: MarioLighting): VisibilityState {
  const schedule = lighting.visibilityCulling;
  const initial = bitset(schedule.initialVisibleBitsBase64, MARIO_LEAF_COUNT);
  const sequentialOffsets = uint32(schedule.sequential.offsetsBase64);
  const sequentialFaces = uint16(schedule.sequential.faceIndicesBase64);
  if (sequentialOffsets.length !== MARIO_FRAME_COUNT + 1) {
    throw new TypeError("Mario visibility offsets are incomplete.");
  }
  const current = initial.slice();
  const rows: Uint8Array[] = [current.slice()];
  for (let targetFrame = 2; targetFrame <= MARIO_FRAME_COUNT; targetFrame += 1) {
    const transition = targetFrame - 1;
    toggle(
      current,
      sequentialFaces.subarray(
        sequentialOffsets[transition],
        sequentialOffsets[transition + 1],
      ),
    );
    rows.push(current.slice());
  }
  const jumps = new Map(schedule.nonInteractiveJumps.map((jump) => [
    `${jump.fromFrame}>${jump.toFrame}`,
    uint16(jump.faceIndicesBase64),
  ]));
  return Object.freeze({
    rows: Object.freeze(rows),
    sequentialOffsets,
    sequentialFaces,
    jumps,
  });
}

function fittedTransform(
  transform: string,
  canonicalSize: number,
  width: number,
  height: number,
  decimals: number,
): string {
  if (width === canonicalSize && height === canonicalSize) return transform;
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) throw new TypeError("Mario leaf transform is not affine.");
  const values = match[1]!.split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Mario leaf transform is invalid.");
  }
  const xScale = canonicalSize / width;
  const yScale = canonicalSize / height;
  for (const index of [0, 1, 2]) values[index] *= xScale;
  for (const index of [4, 5, 6]) values[index] *= yScale;
  const factor = 10 ** Math.max(6, Math.min(12, decimals));
  return `matrix3d(${values.map((value) => {
    const rounded = Math.round(value * factor) / factor;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }).join(",")})`;
}

function domShapeId(sourceId: string): string {
  return sourceId.startsWith("mario-") ? sourceId.slice(6) : sourceId;
}

function triangleOptions(
  fallbackAmount: number,
  sharedEdgeAmount: number,
): readonly SolidTrianglePlanOptions[] {
  return Object.freeze(Array.from({ length: 8 }, (_, mask) => {
    const seamEdges = new Set<number>();
    for (let edge = 0; edge < 3; edge += 1) {
      if ((mask & (1 << edge)) !== 0) seamEdges.add(edge);
    }
    return Object.freeze({
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: mask === 0 ? fallbackAmount : sharedEdgeAmount,
      ...(mask === 0 ? {} : { seamEdges }),
    });
  }));
}

function stateAt(face: LightingState["faces"][number], frameIndex: number): number {
  let lower = 0;
  let upper = face.sourceFrames.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (face.sourceFrames[middle]! <= frameIndex) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

export function mountMarioScene(
  host: HTMLElement,
  plan: MarioPlan,
  lighting: MarioLighting,
  texelsUrl: string,
): MarioScene {
  const light = lightingState(lighting, plan);
  const visibility = visibilityState(lighting);
  const visible = visibility.rows[0]!.slice();
  const forced = new Uint8Array(MARIO_LEAF_COUNT);
  const degenerate = new Uint8Array(MARIO_LEAF_COUNT);
  const appliedStates = new Uint16Array(MARIO_LEAF_COUNT);
  const sparseCoordinates = Array.from(
    { length: MARIO_LEAF_COUNT },
    () => new Float64Array(9),
  );
  const sparseCoordinatesReady = new Uint8Array(MARIO_LEAF_COUNT);
  const options = triangleOptions(
    plan.mount.seamRepair.fallbackAmount,
    plan.mount.seamRepair.sharedEdgeAmount,
  );
  const computeOptions = plan.leaves.map((leaf): SolidTriangleComputeOptions => (
    Object.freeze({
      basis: leaf.polycss.basis,
      matrixDecimals: leaf.polycss.update.matrixDecimals,
      primitive: "corner-bevel",
      includeColor: false,
    })
  ));

  host.replaceChildren();
  const root = createHeadModelPolyCssRoot(host);
  const targetDepth = (CAMERA.worldZ - CAMERA.perspective) / CAMERA.zoom;
  root.camera.update({
    target: [0, targetDepth, CAMERA.worldY / CAMERA.zoom],
    rotX: 90,
    rotY: 90,
    zoom: CAMERA.zoom,
    distance: 0,
  });
  root.updateProjection({
    perspectivePx: CAMERA.perspective,
    originX: CAMERA.sourceWidth / 2,
    originY: CAMERA.sourceHeight / 2,
    screenRollDegrees: 0,
    near: CAMERA.near,
    far: CAMERA.far,
  });

  const shapes = plan.topology.shapes.map((shape) => {
    const element = host.ownerDocument.createElement("div");
    element.dataset.shape = domShapeId(shape.id);
    root.sceneElement.appendChild(element);
    return element;
  });
  const shapeIndex = new Map(
    plan.topology.shapes.map((shape, index) => [shape.id, index]),
  );
  const leaves = plan.leaves.map((leaf, index) => {
    const owner = shapes[shapeIndex.get(leaf.shapeId) ?? -1];
    const face = light.faces[index];
    if (!owner || !face || face.faceId !== leaf.faceId) {
      throw new TypeError(`Mario leaf ${leaf.faceId} has no retained owner.`);
    }
    const element = host.ownerDocument.createElement("u");
    element.style.transform = fittedTransform(
      leaf.polycss.transform,
      leaf.polycss.update.canonicalSize,
      face.leafWidth,
      face.leafHeight,
      leaf.polycss.update.matrixDecimals,
    );
    element.style.visibility = visible[index] === 1 ? "visible" : "hidden";
    element.style.backgroundImage = `url("${texelsUrl}")`;
    owner.appendChild(element);
    return element;
  });
  let hiddenLeaves = visible.reduce(
    (count, value) => count + Number(value === 0),
    0,
  );
  let currentFrame = 1;
  let currentForced = new Uint16Array(0);
  let destroyed = false;

  const writeVisibility = (index: number): void => {
    const shouldShow =
      degenerate[index] === 0
      && (visible[index] === 1 || forced[index] === 1);
    leaves[index]!.style.visibility = shouldShow ? "visible" : "hidden";
  };
  const applyVisibility = (sourceFrame: number, sparse: boolean): void => {
    if (sourceFrame === currentFrame) return;
    const sequential = sourceFrame === (currentFrame === MARIO_FRAME_COUNT ? 1 : currentFrame + 1);
    let changed = sequential
      ? visibility.sequentialFaces.subarray(
        visibility.sequentialOffsets[sourceFrame - 1],
        visibility.sequentialOffsets[sourceFrame],
      )
      : visibility.jumps.get(`${currentFrame}>${sourceFrame}`);
    if (!changed) {
      const target = visibility.rows[sourceFrame - 1]!;
      const indices: number[] = [];
      for (let index = 0; index < target.length; index += 1) {
        if (target[index] !== visible[index]) indices.push(index);
      }
      changed = Uint16Array.from(indices);
    }
    for (const index of changed) {
      const wasCulled = visible[index] === 0 && forced[index] === 0;
      visible[index] ^= 1;
      hiddenLeaves += visible[index] === 0 ? 1 : -1;
      if (!sparse) {
        writeVisibility(index);
        continue;
      }
      const isCulled = visible[index] === 0 && forced[index] === 0;
      if (isCulled) {
        leaves[index]!.style.visibility = "hidden";
      } else if (wasCulled) {
        sparseCoordinatesReady[index] = 0;
      }
    }
  };
  const applyLighting = (sourceFrame: number): void => {
    if (sourceFrame === currentFrame) return;
    const sequential = sourceFrame === (currentFrame === MARIO_FRAME_COUNT ? 1 : currentFrame + 1);
    const jump = sequential ? undefined : light.jumps.get(`${currentFrame}>${sourceFrame}`);
    let faceIndices: Uint16Array;
    let stateIndices: Uint16Array;
    let start = 0;
    let end: number;
    if (sequential) {
      faceIndices = light.sequentialFaces;
      stateIndices = light.sequentialStates;
      start = light.sequentialOffsets[sourceFrame - 1]!;
      end = light.sequentialOffsets[sourceFrame]!;
    } else if (jump) {
      faceIndices = jump.faces;
      stateIndices = jump.states;
      end = faceIndices.length;
    } else {
      const changedFaces: number[] = [];
      const changedStates: number[] = [];
      const frameIndex = sourceFrame - 1;
      for (let index = 0; index < light.faces.length; index += 1) {
        if (visible[index] !== 1) continue;
        const state = stateAt(light.faces[index]!, frameIndex);
        if (appliedStates[index] === state) continue;
        changedFaces.push(index);
        changedStates.push(state);
      }
      faceIndices = Uint16Array.from(changedFaces);
      stateIndices = Uint16Array.from(changedStates);
      end = faceIndices.length;
    }
    for (let cursor = start; cursor < end; cursor += 1) {
      const index = faceIndices[cursor]!;
      if (visible[index] !== 1) continue;
      const face = light.faces[index]!;
      const state = stateIndices[cursor]!;
      leaves[index]!.style.backgroundPositionY =
        light.positions[face.stateOffset + state]!;
      appliedStates[index] = state;
    }
  };

  return Object.freeze({
    root,
    shapeElements: Object.freeze(shapes),
    leafElements: Object.freeze(leaves),
    sceneElement: root.sceneElement,
    get currentFrame(): number { return currentFrame; },
    get hiddenLeaves(): number { return hiddenLeaves; },
    setAppearance(
      viewportWidth: number,
      viewportHeight: number,
      sourceScale: number,
      appearance: readonly [id: string, scale: number, translateY: number],
    ): void {
      root.updateViewportComposition({
        viewportWidth,
        viewportHeight,
        sourceWidth: CAMERA.sourceWidth,
        sourceHeight: CAMERA.sourceHeight,
        sourceScale,
        appearanceScale: appearance[1],
        translateYSourcePx: appearance[2],
        appearanceId: appearance[0],
      });
    },
    writeModelTransform(transform: string): void {
      root.updatePreparedModelTransform(transform);
    },
    writeShape(index: number, transform: string, isVisible: boolean): void {
      const element = shapes[index];
      if (!element) throw new RangeError(`Mario shape ${index} is not mounted.`);
      if (element.style.transform !== transform) element.style.transform = transform;
      const next = isVisible ? "visible" : "hidden";
      if (element.style.visibility !== next) element.style.visibility = next;
    },
    writeLeafTransform(index: number, transform: string): void {
      const element = leaves[index];
      if (!element) throw new RangeError(`Mario leaf ${index} is not mounted.`);
      if (element.style.transform !== transform) element.style.transform = transform;
    },
    applySurfaceFrame(sourceFrame: number, sparse = false): void {
      if (
        !Number.isSafeInteger(sourceFrame)
        || sourceFrame < 1
        || sourceFrame > MARIO_FRAME_COUNT
      ) {
        throw new RangeError(`Mario frame ${sourceFrame} is outside the prepared loop.`);
      }
      applyVisibility(sourceFrame, sparse);
      applyLighting(sourceFrame);
      currentFrame = sourceFrame;
    },
    forceVisible(indices: Uint16Array): void {
      const next = new Uint8Array(MARIO_LEAF_COUNT);
      for (const index of indices) next[index] = 1;
      const changed = new Set<number>([...currentForced, ...indices]);
      for (const index of changed) {
        const wasCulled = visible[index] === 0 && forced[index] === 0;
        forced[index] = next[index]!;
        const isCulled = visible[index] === 0 && forced[index] === 0;
        if (isCulled) {
          leaves[index]!.style.visibility = "hidden";
        } else if (wasCulled) {
          sparseCoordinatesReady[index] = 0;
        }
      }
      currentForced = Uint16Array.from(indices);
    },
    applyInteraction(publications: readonly MarioSparsePublication[]): void {
      for (const publication of publications) {
        for (const shape of publication.shapeMatrices) {
          const element = shapes[shape.shapeIndex];
          if (!element) {
            throw new RangeError(
              `${publication.controlId} shape ${shape.shapeIndex} is not mounted.`,
            );
          }
          const transform = sourceMatrixToPolyCssTransform(shape.matrix);
          if (element.style.transform !== transform) {
            element.style.transform = transform;
          }
        }
        const rows = publication.closure.leafRows;
        for (let offset = 0; offset < rows.length; offset += 10) {
          const faceIndex = rows[offset]!;
          const leaf = plan.leaves[faceIndex];
          const face = light.faces[faceIndex];
          const p0 = publication.vertices[rows[offset + 2]!]?.position;
          const p1 = publication.vertices[rows[offset + 3]!]?.position;
          const p2 = publication.vertices[rows[offset + 4]!]?.position;
          if (!leaf || !face || !p0 || !p1 || !p2) {
            throw new TypeError(
              `${publication.controlId} escaped its prepared leaf closure.`,
            );
          }
          const coordinates = sparseCoordinates[faceIndex]!;
          const changed = sparseCoordinatesReady[faceIndex] === 0
            || coordinates[0] !== p0[0]
            || coordinates[1] !== p0[1]
            || coordinates[2] !== p0[2]
            || coordinates[3] !== p1[0]
            || coordinates[4] !== p1[1]
            || coordinates[5] !== p1[2]
            || coordinates[6] !== p2[0]
            || coordinates[7] !== p2[1]
            || coordinates[8] !== p2[2];
          if (!changed) continue;
          coordinates[0] = p0[0];
          coordinates[1] = p0[1];
          coordinates[2] = p0[2];
          coordinates[3] = p1[0];
          coordinates[4] = p1[1];
          coordinates[5] = p1[2];
          coordinates[6] = p2[0];
          coordinates[7] = p2[1];
          coordinates[8] = p2[2];
          sparseCoordinatesReady[faceIndex] = 1;
          const affine = computeSolidTrianglePlanFromCssPoints(
            leaf.polycss as unknown as Polygon,
            faceIndex,
            options[leaf.polycss.update.seamEdgeMask]!,
            computeOptions[faceIndex]!,
            p0[2], p0[0], p0[1],
            p1[2], p1[0], p1[1],
            p2[2], p2[0], p2[1],
          );
          degenerate[faceIndex] = affine ? 0 : 1;
          writeVisibility(faceIndex);
          if (affine) {
            const transform = fittedTransform(
              affine.transformText,
              leaf.polycss.update.canonicalSize,
              face.leafWidth,
              face.leafHeight,
              leaf.polycss.update.matrixDecimals,
            );
            if (leaves[faceIndex]!.style.transform !== transform) {
              leaves[faceIndex]!.style.transform = transform;
            }
          }
        }
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      root.destroy();
    },
  });
}
