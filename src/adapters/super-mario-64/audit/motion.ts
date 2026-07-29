import {
  computeSolidTrianglePlanFromCssPoints,
} from "@layoutit/polycss";

export const TITLE_HEAD_AUDIT_MOTION_MAGIC = "CSMOTN01" as const;

const HEADER_BYTES = 176;
const FRAME_COUNT = 820;
const FACE_COUNT = 1213;

interface PreparedContract {
  readonly contentHash?: unknown;
}

interface TriangleLeaf {
  readonly sourceOrder: number;
  readonly polycss: Readonly<{
    basis: Readonly<{ a: number; b: number; c: number }>;
    color?: string;
    vertices: [number, number, number][];
    update: Readonly<{
      canonicalSize: number;
      matrixDecimals: number;
      seamEdgeMask: number;
      shapeStateIndex: number;
      vertexIndices: readonly number[];
    }>;
  }>;
}

interface FootprintTrianglePlan {
  readonly contentHash?: unknown;
  readonly leaves: readonly TriangleLeaf[];
  readonly mount: Readonly<{
    seamRepair: Readonly<{
      fallbackAmount: number;
      sharedEdgeAmount: number;
    }>;
  }>;
}

function fail(message: string): never {
  throw new TypeError(`Prepare-audit motion is invalid: ${message}`);
}

function uint(view: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    fail(`${label} is outside the header.`);
  }
  return view.getUint32(offset, true);
}

function contractHash(value: unknown, label: string): string {
  const hash = (value as PreparedContract | null)?.contentHash;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash)) {
    fail(`${label} has no content hash.`);
  }
  return hash;
}

function encodedHash(bytes: Uint8Array, offset: number): string {
  return Array.from(
    bytes.subarray(offset, offset + 32),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

function triangleOptions(
  repair: FootprintTrianglePlan["mount"]["seamRepair"],
) {
  return Object.freeze(Array.from({ length: 8 }, (_, mask) => {
    const seamEdges = new Set<number>();
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      if ((mask & (1 << edgeIndex)) !== 0) seamEdges.add(edgeIndex);
    }
    return Object.freeze({
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: mask === 0
        ? repair.fallbackAmount
        : repair.sharedEdgeAmount,
      ...(mask === 0 ? {} : { seamEdges }),
    });
  }));
}

export function parseTitleHeadAuditMotion(
  input: Uint8Array,
  contracts: Readonly<{
    animation: unknown;
    deformation: unknown;
    footprintTrianglePlan: FootprintTrianglePlan;
    rasterSizes: readonly Readonly<{
      leafWidth: number;
      leafHeight: number;
    }>[];
    fitRaster: boolean;
  }>,
) {
  const bytes = input.byteOffset % 4 === 0 ? input : input.slice();
  if (
    new TextDecoder("ascii").decode(bytes.subarray(0, 8))
      !== TITLE_HEAD_AUDIT_MOTION_MAGIC
  ) {
    fail("magic does not match.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerBytes = uint(view, 8, "headerBytes");
  const frameCount = uint(view, 12, "frameCount");
  const profileCount = uint(view, 16, "profileCount");
  const shapeCount = uint(view, 20, "shapeCount");
  const vertexCount = uint(view, 24, "vertexCount");
  const faceCount = uint(view, 28, "faceCount");
  const channelCount = uint(view, 32, "channelCount");
  const floatsPerProfile = uint(view, 36, "floatsPerProfile");
  const dirtyIndexCount = uint(view, 40, "dirtyIndexCount");
  const shapeVertexCountsOffset = uint(view, 44, "shapeVertexCountsOffset");
  const dirtyOffsetsOffset = uint(view, 48, "dirtyOffsetsOffset");
  const shapeMasksOffset = uint(view, 56, "shapeMasksOffset");
  const dirtyFacesOffset = uint(view, 60, "dirtyFacesOffset");
  const frameFloatsOffset = uint(view, 64, "frameFloatsOffset");
  const fileBytes = uint(view, 68, "fileBytes");
  if (headerBytes !== HEADER_BYTES || frameCount !== FRAME_COUNT
    || profileCount !== FRAME_COUNT + 1 || faceCount !== FACE_COUNT
    || channelCount < 1 || channelCount > 32
    || fileBytes !== bytes.byteLength
    || floatsPerProfile !== (1 + shapeCount) * 16 + vertexCount * 3
    || contracts.footprintTrianglePlan.leaves.length !== FACE_COUNT) {
    fail("header or topology closure drifted.");
  }
  if (encodedHash(bytes, 80) !== contractHash(contracts.animation, "animation")
    || encodedHash(bytes, 112)
      !== contractHash(contracts.deformation, "deformation")
    || encodedHash(bytes, 144)
      !== contractHash(
        contracts.footprintTrianglePlan,
        "footprint triangle plan",
      )) {
    fail("source contract binding drifted.");
  }

  const shapeVertexCounts = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset + shapeVertexCountsOffset,
    shapeCount,
  );
  if (
    [...shapeVertexCounts].reduce((total, count) => total + count, 0)
      !== vertexCount
  ) {
    fail("shape vertex counts do not close.");
  }
  const dirtyOffsets = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset + dirtyOffsetsOffset,
    profileCount + 1,
  );
  const shapeMasks = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset + shapeMasksOffset,
    profileCount,
  );
  const dirtyFaces = new Uint16Array(
    bytes.buffer,
    bytes.byteOffset + dirtyFacesOffset,
    dirtyIndexCount,
  );
  const values = new Float32Array(
    bytes.buffer,
    bytes.byteOffset + frameFloatsOffset,
    profileCount * floatsPerProfile,
  );
  if (dirtyOffsets[0] !== 0
    || dirtyOffsets[profileCount] !== dirtyIndexCount) {
    fail("indexed sections do not close.");
  }

  const shapeVertexOffsets: number[] = [];
  let vertexOffset = 0;
  for (const count of shapeVertexCounts) {
    shapeVertexOffsets.push(vertexOffset);
    vertexOffset += count;
  }
  const optionsByEdgeMask = triangleOptions(
    contracts.footprintTrianglePlan.mount.seamRepair,
  );
  const zeroStateIndices = new Uint16Array(FACE_COUNT);
  const allFaceIndices = Uint16Array.from(
    { length: FACE_COUNT },
    (_, faceIndex) => faceIndex,
  );
  let activeProfileIndex = -1;
  const affineStates = Object.freeze({
    faceCount: FACE_COUNT,
    stateCount: FACE_COUNT,
    leafSizing: "prepared-raster" as const,
    transform(faceIndex: number, _stateIndex: number): string {
      if (activeProfileIndex < 0) fail("no active motion profile.");
      const leaf = contracts.footprintTrianglePlan.leaves[faceIndex];
      if (!leaf || leaf.sourceOrder !== faceIndex) {
        fail(`face ${faceIndex} is outside source order.`);
      }
      const update = leaf.polycss.update;
      const positionsOffset = activeProfileIndex * floatsPerProfile
        + (1 + shapeCount) * 16;
      const shapeOffset = shapeVertexOffsets[update.shapeStateIndex];
      const offsets = update.vertexIndices.map((index) => (
        positionsOffset + (shapeOffset + index) * 3
      ));
      const [p0, p1, p2] = offsets;
      const affine = computeSolidTrianglePlanFromCssPoints(
        leaf.polycss,
        leaf.sourceOrder,
        optionsByEdgeMask[update.seamEdgeMask],
        Object.freeze({
          basis: leaf.polycss.basis,
          matrixDecimals: update.matrixDecimals,
          primitive: "corner-bevel",
          includeColor: false,
        }),
        values[p0 + 2], values[p0], values[p0 + 1],
        values[p1 + 2], values[p1], values[p1 + 1],
        values[p2 + 2], values[p2], values[p2 + 1],
      );
      if (affine === null || !contracts.fitRaster) {
        return affine?.transformText ?? "";
      }
      const raster = contracts.rasterSizes[faceIndex];
      if (!raster
        || !Number.isSafeInteger(raster.leafWidth)
        || raster.leafWidth < 1
        || !Number.isSafeInteger(raster.leafHeight)
        || raster.leafHeight < 1) {
        fail(`face ${faceIndex} has no prepared raster sizing`);
      }
      const match = /^matrix3d\(([^)]+)\)$/u.exec(affine.transformText);
      if (match === null) fail(`face ${faceIndex} has no affine matrix`);
      const matrix = match[1].split(",").map(Number);
      const canonicalSize = update.canonicalSize;
      const xScale = canonicalSize / raster.leafWidth;
      const yScale = canonicalSize / raster.leafHeight;
      for (const index of [0, 1, 2]) matrix[index] *= xScale;
      for (const index of [4, 5, 6]) matrix[index] *= yScale;
      const decimals = Math.max(6, Math.min(12, update.matrixDecimals));
      const factor = 10 ** decimals;
      return `matrix3d(${matrix.map((value) => {
        const rounded = Math.round(value * factor) / factor;
        return String(Object.is(rounded, -0) ? 0 : rounded);
      }).join(",")})`;
    },
  });

  return Object.freeze({
    frameCount,
    profile(sampledFrame: number, previousSampledFrame = sampledFrame - 1) {
      if (!Number.isSafeInteger(sampledFrame)
        || sampledFrame < 1 || sampledFrame > frameCount) {
        fail(`sampled frame ${String(sampledFrame)} is outside 1..820.`);
      }
      const profileIndex = sampledFrame - 1;
      activeProfileIndex = profileIndex;
      const dirtyStart = dirtyOffsets[profileIndex];
      const dirtyEnd = dirtyOffsets[profileIndex + 1];
      const sequential = previousSampledFrame === sampledFrame - 1;
      const dirtyFaceIndices = sequential
        ? dirtyFaces.subarray(dirtyStart, dirtyEnd)
        : allFaceIndices;
      return Object.freeze({
        profileIndex,
        dirtyFromProfileIndex: sequential && profileIndex > 0
          ? profileIndex - 1
          : previousSampledFrame - 1,
        sampledFrame,
        changedShapeMask: shapeMasks[profileIndex],
        dirtyFaceIndices,
        transformStateIndices: zeroStateIndices.subarray(
          0,
          dirtyFaceIndices.length,
        ),
        faceTransformStateIndices: zeroStateIndices,
        affineStates,
        values,
        modelMatrixOffset: profileIndex * floatsPerProfile,
        shapeMatricesOffset: profileIndex * floatsPerProfile + 16,
      });
    },
  });
}
