import {
  buildClothMobileSourceFrames,
  buildClothSourceFramesFromCheckpoint,
  clothShadowTriangleMatrix,
  CSSCLOTH_PARTICLE_COUNT,
  CSSCLOTH_SHADOW_LIGHT_DIRECTION,
  projectClothShadowPoint,
} from "../../prepare/csscloth/sourceModel.mjs";
import { preparePolyMorphParametricShadowFrames } from "../../prepare/csscloth/morphShadowPatch.mjs";
import {
  buildClothTriangleSeamEdges,
  buildClothTriangleTopology,
  clothTriangleMatrixFromWorldPoints,
} from "./clothTriangleTransform.mjs";

export const CSSCLOTH_PLAYBACK_SCHEMA = "csscloth-prepared-playback@8";
export const CSSCLOTH_PLAYBACK_ENCODING =
  "gzip-float64-simulation-checkpoint-sparse-u16-lighting-worker-derived-cloth-shadow@8";

const MAGIC = "CCLT";
const VERSION = 8;
const HEADER_BYTES = 56;
const CHECKPOINT_COMPONENT_COUNT = 6;
const MATRIX_DECIMALS = 4;
const MATRIX_SCALE = 10 ** MATRIX_DECIMALS;
const MATRIX_COMPONENTS = Object.freeze([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
const PROFILES = Object.freeze(["desktop", "mobile"]);
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function encodeClothPreparedPlayback(playback) {
  validatePlayback(playback);
  const checkpointByteLength = playback.checkpoint.positions.length *
    CHECKPOINT_COMPONENT_COUNT * Float64Array.BYTES_PER_ELEMENT;
  const lightingSchedule = buildSparseLightingSchedule(playback);
  const lightingByteLength = lightingSchedule.offsets.byteLength +
    lightingSchedule.indices.byteLength + lightingSchedule.slots.byteLength;
  const bytes = new Uint8Array(HEADER_BYTES + checkpointByteLength + lightingByteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = VERSION;
  bytes[5] = PROFILES.indexOf(playback.profile);
  view.setUint16(6, 0, true);
  view.setUint16(8, playback.frameCount, true);
  view.setUint16(10, playback.triangleCount, true);
  view.setFloat64(12, playback.frameMilliseconds, true);
  view.setUint32(20, checkpointByteLength, true);
  view.setUint32(24, lightingByteLength, true);
  view.setUint32(28, lightingSchedule.indices.length, true);
  view.setUint16(32, playback.particleCount, true);
  view.setUint16(34, playback.checkpoint.positions.length, true);
  view.setUint16(36, playback.shadowTriangleCount, true);
  view.setUint16(38, 0, true);
  view.setUint32(40, playback.streamFrameOffset, true);
  view.setFloat64(44, playback.checkpoint.windPhaseMilliseconds, true);
  view.setUint32(52, playback.checkpoint.nextSimulationStepIndex, true);
  let offset = HEADER_BYTES;
  for (let particleIndex = 0; particleIndex < playback.checkpoint.positions.length; particleIndex += 1) {
    for (const value of [
      ...playback.checkpoint.positions[particleIndex],
      ...playback.checkpoint.previousPositions[particleIndex],
    ]) {
      view.setFloat64(offset, value, true);
      offset += Float64Array.BYTES_PER_ELEMENT;
    }
  }
  for (const value of lightingSchedule.offsets) {
    view.setUint32(offset, value, true);
    offset += Uint32Array.BYTES_PER_ELEMENT;
  }
  for (const value of lightingSchedule.indices) {
    view.setUint16(offset, value, true);
    offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  for (const value of lightingSchedule.slots) {
    view.setUint16(offset, value, true);
    offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  return bytes;
}

export function decodeClothPreparedPlayback(bytes, descriptor) {
  const materialization = createClothPreparedPlaybackMaterialization(bytes, descriptor);
  return completeClothPreparedPlaybackMaterialization(
    materialization.playback,
    materializeClothPreparedMatrixRange(
      materialization,
      "cloth",
      0,
      materialization.clothTransformCount,
    ),
    materializeClothPreparedMatrixRange(
      materialization,
      "shadow",
      0,
      materialization.shadowTransformValueCount,
    ),
    true,
  );
}

export function createClothPreparedPlaybackMaterialization(bytes, descriptor) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES ||
      descriptor?.schema !== CSSCLOTH_PLAYBACK_SCHEMA ||
      descriptor?.encoding !== CSSCLOTH_PLAYBACK_ENCODING ||
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== MAGIC ||
      bytes[4] !== VERSION || !PROFILES.includes(PROFILES[bytes[5]])) {
    throw new Error("Prepared Cloth checkpoint header drifted");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const profile = PROFILES[bytes[5]];
  const frameCount = view.getUint16(8, true);
  const triangleCount = view.getUint16(10, true);
  const frameMilliseconds = view.getFloat64(12, true);
  const checkpointByteLength = view.getUint32(20, true);
  const lightingByteLength = view.getUint32(24, true);
  const lightingAssignmentCount = view.getUint32(28, true);
  const particleCount = view.getUint16(32, true);
  const simulationParticleCount = view.getUint16(34, true);
  const shadowTriangleCount = view.getUint16(36, true);
  const streamFrameOffset = view.getUint32(40, true);
  const windPhaseMilliseconds = view.getFloat64(44, true);
  const nextSimulationStepIndex = view.getUint32(52, true);
  const expectedLightingByteLength = (frameCount + 1) * Uint32Array.BYTES_PER_ELEMENT +
    lightingAssignmentCount * Uint16Array.BYTES_PER_ELEMENT * 2;
  if (view.getUint16(6, true) !== 0 || view.getUint16(38, true) !== 0 ||
      frameCount !== descriptor.frameCount || triangleCount !== descriptor.triangleCount ||
      particleCount !== descriptor.particleCount ||
      simulationParticleCount !== CSSCLOTH_PARTICLE_COUNT ||
      shadowTriangleCount !== descriptor.shadowTriangleCount ||
      frameMilliseconds !== descriptor.frameMilliseconds || profile !== descriptor.profile ||
      streamFrameOffset !== descriptor.streamFrameOffset ||
      checkpointByteLength !== simulationParticleCount * CHECKPOINT_COMPONENT_COUNT *
        Float64Array.BYTES_PER_ELEMENT ||
      lightingByteLength !== expectedLightingByteLength ||
      HEADER_BYTES + checkpointByteLength + lightingByteLength !== bytes.byteLength) {
    throw new Error("Prepared Cloth checkpoint counts drifted");
  }
  let offset = HEADER_BYTES;
  const positions = [];
  const previousPositions = [];
  for (let particleIndex = 0; particleIndex < simulationParticleCount; particleIndex += 1) {
    const values = [];
    for (let componentIndex = 0; componentIndex < CHECKPOINT_COMPONENT_COUNT; componentIndex += 1) {
      values.push(view.getFloat64(offset, true));
      offset += Float64Array.BYTES_PER_ELEMENT;
    }
    positions.push(values.slice(0, 3));
    previousPositions.push(values.slice(3));
  }
  const lightingOffsets = new Uint32Array(frameCount + 1);
  for (let index = 0; index < lightingOffsets.length; index += 1) {
    lightingOffsets[index] = view.getUint32(offset, true);
    offset += Uint32Array.BYTES_PER_ELEMENT;
  }
  const lightingIndices = new Uint16Array(lightingAssignmentCount);
  for (let index = 0; index < lightingIndices.length; index += 1) {
    lightingIndices[index] = view.getUint16(offset, true);
    offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  const lightingSlots = new Uint16Array(lightingAssignmentCount);
  for (let index = 0; index < lightingSlots.length; index += 1) {
    lightingSlots[index] = view.getUint16(offset, true);
    offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  if (offset !== bytes.byteLength || lightingOffsets[0] !== 0 ||
      lightingOffsets[1] !== triangleCount ||
      lightingOffsets[frameCount] !== lightingAssignmentCount ||
      lightingOffsets.some((value, index) => index > 0 && value < lightingOffsets[index - 1]) ||
      lightingIndices.some((value) => value >= triangleCount)) {
    throw new Error("Prepared Cloth checkpoint lighting schedule drifted");
  }
  const checkpoint = Object.freeze({
    schema: "csscloth-simulation-checkpoint@1",
    streamFrameOffset,
    windPhaseMilliseconds,
    nextSimulationStepIndex,
    positions: Object.freeze(positions.map(Object.freeze)),
    previousPositions: Object.freeze(previousPositions.map(Object.freeze)),
  });
  const desktopSource = buildClothSourceFramesFromCheckpoint(checkpoint, frameCount);
  const source = profile === "mobile"
    ? buildClothMobileSourceFrames(desktopSource)
    : desktopSource;
  if (source.frames[0].particlePositions.length !== particleCount ||
      source.triangles.length !== triangleCount) {
    throw new Error("Prepared Cloth checkpoint profile drifted");
  }
  const shadow = preparePolyMorphParametricShadowFrames({
    frames: source.frames,
    worldTriangles: (frame) => frame.triangles.map((triangle) => triangle.positions),
    lightDirection: CSSCLOTH_SHADOW_LIGHT_DIRECTION,
    projectPoint: projectClothShadowPoint,
    triangleMatrix: clothShadowTriangleMatrix,
    definition: profile === "mobile" ? 16 : 32,
  });
  if (shadow.leafCount > shadowTriangleCount) {
    throw new Error("Prepared Cloth checkpoint shadow topology drifted");
  }
  const particlePositions = new Float64Array(frameCount * particleCount * 3);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      particlePositions.set(
        source.frames[frameIndex].particlePositions[particleIndex],
        (frameIndex * particleCount + particleIndex) * 3,
      );
    }
  }
  const shadowQuantized = new Int32Array(
    frameCount * shadowTriangleCount * MATRIX_COMPONENTS.length,
  );
  const shadowVisibility = new Uint8Array(frameCount * shadowTriangleCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let shadowIndex = 0; shadowIndex < shadowTriangleCount; shadowIndex += 1) {
      const matrix = shadow.shadowFrames[frameIndex].matrices[shadowIndex] ?? IDENTITY;
      const matrixOffset = (frameIndex * shadowTriangleCount + shadowIndex) *
        MATRIX_COMPONENTS.length;
      for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
        shadowQuantized[matrixOffset + componentIndex] =
          Math.round(matrix[MATRIX_COMPONENTS[componentIndex]] * MATRIX_SCALE);
      }
      shadowVisibility[frameIndex * shadowTriangleCount + shadowIndex] =
        shadow.shadowFrames[frameIndex].visibility[shadowIndex] ?? 0;
    }
  }
  const shadowSchedule = buildSparseShadowSchedule(
    shadowQuantized,
    shadowVisibility,
    frameCount,
    shadowTriangleCount,
  );
  const triangleTopology = buildClothTriangleTopology(particleCount);
  if (triangleTopology.length !== triangleCount) {
    throw new Error("Prepared Cloth checkpoint particle topology drifted");
  }
  return Object.freeze({
    playback: Object.freeze({
      schema: CSSCLOTH_PLAYBACK_SCHEMA,
      frameCount,
      particleCount,
      triangleCount,
      shadowTriangleCount,
      frameMilliseconds,
      durationMilliseconds: frameCount * frameMilliseconds,
      transforms: null,
      lightingOffsets,
      lightingIndices,
      lightingSlots,
      shadowTransformOffsets: shadowSchedule.transformOffsets,
      shadowTransformIndices: shadowSchedule.transformIndices,
      shadowTransformValues: null,
      shadowVisibilityOffsets: shadowSchedule.visibilityOffsets,
      shadowVisibilityIndices: shadowSchedule.visibilityIndices,
      shadowVisibilityValues: shadowSchedule.visibilityValues,
      decodedByteLength: bytes.byteLength,
    }),
    particlePositions,
    shadowQuantized,
    triangleTopology,
    triangleSeamEdges: buildClothTriangleSeamEdges(triangleTopology),
    clothTransformCount: frameCount * triangleCount,
    shadowTransformSourceIndices: shadowSchedule.transformSourceIndices,
    shadowTransformValueCount: shadowSchedule.transformSourceIndices.length,
  });
}

export function materializeClothPreparedMatrixRange(materialization, kind, start, end) {
  const sourceIndices = kind === "cloth"
    ? null
    : kind === "shadow"
    ? materialization?.shadowTransformSourceIndices
    : undefined;
  const count = kind === "cloth"
    ? materialization?.clothTransformCount
    : sourceIndices?.length;
  if (!(materialization?.particlePositions instanceof Float64Array) ||
      !(materialization?.shadowQuantized instanceof Int32Array) ||
      !Array.isArray(materialization.triangleTopology) ||
      !Array.isArray(materialization.triangleSeamEdges) ||
      !Number.isSafeInteger(count) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end > count || sourceIndices === undefined) {
    throw new TypeError("Prepared Cloth checkpoint matrix range is invalid");
  }
  const playback = materialization.playback;
  const output = new Array(end - start);
  const matrix = new Array(16).fill(0);
  matrix[15] = 1;
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    if (kind === "cloth") {
      const transformIndex = start + outputIndex;
      const frameIndex = Math.floor(transformIndex / playback.triangleCount);
      const triangleIndex = transformIndex % playback.triangleCount;
      const points = materialization.triangleTopology[triangleIndex].map((particleIndex) => {
        const pointOffset = (frameIndex * playback.particleCount + particleIndex) * 3;
        return [
          materialization.particlePositions[pointOffset],
          materialization.particlePositions[pointOffset + 1],
          materialization.particlePositions[pointOffset + 2],
        ];
      });
      output[outputIndex] = `matrix3d(${formatFixed4Matrix(clothTriangleMatrixFromWorldPoints(
        points,
        triangleIndex,
        materialization.triangleSeamEdges,
      ))})`;
      continue;
    }
    const matrixIndex = sourceIndices[start + outputIndex];
    const valueOffset = matrixIndex * MATRIX_COMPONENTS.length;
    for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
      matrix[MATRIX_COMPONENTS[componentIndex]] =
        materialization.shadowQuantized[valueOffset + componentIndex] / MATRIX_SCALE;
    }
    output[outputIndex] = `matrix3d(${formatFixed4Matrix(matrix)})`;
  }
  return output;
}

export function completeClothPreparedPlaybackMaterialization(
  playback,
  transforms,
  shadowTransformValues,
  freezeTransformArrays = false,
) {
  if (playback?.schema !== CSSCLOTH_PLAYBACK_SCHEMA || playback.transforms !== null ||
      playback.shadowTransformValues !== null || !Array.isArray(transforms) ||
      transforms.length !== playback.frameCount * playback.triangleCount ||
      !Array.isArray(shadowTransformValues) ||
      shadowTransformValues.length !== playback.shadowTransformIndices.length ||
      !transforms[0]?.startsWith("matrix3d(") || !transforms.at(-1)?.startsWith("matrix3d(") ||
      !shadowTransformValues[0]?.startsWith("matrix3d(") ||
      !shadowTransformValues.at(-1)?.startsWith("matrix3d(")) {
    throw new Error("Prepared Cloth checkpoint matrix materialization drifted");
  }
  return Object.freeze({
    ...playback,
    transforms: freezeTransformArrays ? Object.freeze(transforms) : transforms,
    shadowTransformValues: freezeTransformArrays
      ? Object.freeze(shadowTransformValues)
      : shadowTransformValues,
  });
}

export async function loadClothPreparedPlayback(descriptor) {
  const bytes = await loadClothPreparedPlaybackBytes(descriptor);
  return decodeClothPreparedPlayback(bytes, descriptor);
}

export async function loadClothPreparedPlaybackBytes(descriptor) {
  if (descriptor?.schema !== CSSCLOTH_PLAYBACK_SCHEMA ||
      descriptor?.encoding !== CSSCLOTH_PLAYBACK_ENCODING ||
      typeof descriptor.path !== "string" || !descriptor.path.startsWith("/csscloth/") ||
      !PROFILES.includes(descriptor.profile) ||
      !Number.isSafeInteger(descriptor.streamFrameOffset) || descriptor.streamFrameOffset < 0 ||
      !Number.isSafeInteger(descriptor.particleCount) || descriptor.particleCount < 4 ||
      !Number.isSafeInteger(descriptor.shadowTriangleCount) || descriptor.shadowTriangleCount < 3 ||
      !/^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? "") ||
      !/^[a-f0-9]{64}$/u.test(descriptor.uncompressedSha256 ?? "")) {
    throw new Error("Prepared Cloth checkpoint descriptor drifted");
  }
  const response = await fetch(descriptor.path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Cloth playback failed: ${response.status} ${response.url}`);
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  let bytes;
  if (String.fromCharCode(responseBytes[0], responseBytes[1], responseBytes[2], responseBytes[3]) === MAGIC) {
    bytes = responseBytes;
  } else {
    const actualSha256 = await sha256(responseBytes);
    if (responseBytes.byteLength !== descriptor.compressedByteLength || actualSha256 !== descriptor.sha256) {
      throw new Error("Prepared Cloth playback compressed identity drifted");
    }
    bytes = await gunzip(responseBytes);
  }
  const actualUncompressedSha256 = await sha256(bytes);
  if (bytes.byteLength !== descriptor.uncompressedByteLength ||
      actualUncompressedSha256 !== descriptor.uncompressedSha256) {
    throw new Error("Prepared Cloth playback decoded identity drifted");
  }
  return bytes;
}

function buildSparseLightingSchedule(playback) {
  const offsets = new Uint32Array(playback.frameCount + 1);
  const indices = [];
  const slots = [];
  const previousSlots = new Uint32Array(playback.triangleCount);
  previousSlots.fill(0xffff_ffff);
  for (let frameIndex = 0; frameIndex < playback.frameCount; frameIndex += 1) {
    offsets[frameIndex] = indices.length;
    const frame = playback.frames[frameIndex];
    for (let triangleIndex = 0; triangleIndex < playback.triangleCount; triangleIndex += 1) {
      const slot = playback.atlasStateSlots[triangleIndex][frame.lightingRows[triangleIndex]];
      if (frameIndex !== 0 && previousSlots[triangleIndex] === slot) continue;
      indices.push(triangleIndex);
      slots.push(slot);
      previousSlots[triangleIndex] = slot;
    }
  }
  offsets[playback.frameCount] = indices.length;
  return { offsets, indices: Uint16Array.from(indices), slots: Uint16Array.from(slots) };
}

function buildSparseShadowSchedule(quantized, visibility, frameCount, shadowTriangleCount) {
  const transformOffsets = new Uint32Array(frameCount + 1);
  const transformIndices = [];
  const transformSourceIndices = [];
  const visibilityOffsets = new Uint32Array(frameCount + 1);
  const visibilityIndices = [];
  const visibilityValues = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    transformOffsets[frameIndex] = transformIndices.length;
    visibilityOffsets[frameIndex] = visibilityIndices.length;
    const frameOffset = frameIndex * shadowTriangleCount;
    const previousFrameOffset = (frameIndex - 1) * shadowTriangleCount;
    for (let triangleIndex = 0; triangleIndex < shadowTriangleCount; triangleIndex += 1) {
      const sourceTransformIndex = frameOffset + triangleIndex;
      if (frameIndex === 0 || !sameQuantizedMatrix(
        quantized,
        sourceTransformIndex,
        previousFrameOffset + triangleIndex,
      )) {
        transformIndices.push(triangleIndex);
        transformSourceIndices.push(sourceTransformIndex);
      }
      if (frameIndex === 0 || visibility[frameOffset + triangleIndex] !==
          visibility[previousFrameOffset + triangleIndex]) {
        visibilityIndices.push(triangleIndex);
        visibilityValues.push(visibility[frameOffset + triangleIndex]);
      }
    }
  }
  transformOffsets[frameCount] = transformIndices.length;
  visibilityOffsets[frameCount] = visibilityIndices.length;
  return {
    transformOffsets,
    transformIndices: Uint16Array.from(transformIndices),
    transformSourceIndices: Uint32Array.from(transformSourceIndices),
    visibilityOffsets,
    visibilityIndices: Uint16Array.from(visibilityIndices),
    visibilityValues: Uint8Array.from(visibilityValues),
  };
}

function sameQuantizedMatrix(quantized, leftMatrixIndex, rightMatrixIndex) {
  const leftOffset = leftMatrixIndex * MATRIX_COMPONENTS.length;
  const rightOffset = rightMatrixIndex * MATRIX_COMPONENTS.length;
  for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
    if (quantized[leftOffset + componentIndex] !== quantized[rightOffset + componentIndex]) return false;
  }
  return true;
}

function formatFixed4Matrix(values) {
  let output = "";
  for (let index = 0; index < values.length; index += 1) {
    const rounded = Math.round(values[index] * MATRIX_SCALE) / MATRIX_SCALE;
    output += `${index === 0 ? "" : ","}${Object.is(rounded, -0) ? 0 : rounded}`;
  }
  return output;
}

function validatePlayback(playback) {
  if (!playback || !PROFILES.includes(playback.profile) ||
      !Number.isSafeInteger(playback.streamFrameOffset) || playback.streamFrameOffset < 0 ||
      !Number.isSafeInteger(playback.frameCount) || playback.frameCount < 2 ||
      !Number.isSafeInteger(playback.particleCount) || playback.particleCount < 4 ||
      !Number.isSafeInteger(playback.triangleCount) || playback.triangleCount < 1 ||
      !Number.isSafeInteger(playback.shadowTriangleCount) || playback.shadowTriangleCount < 3 ||
      !Number.isFinite(playback.frameMilliseconds) || playback.frameMilliseconds <= 0 ||
      !Array.isArray(playback.frames) || playback.frames.length !== playback.frameCount ||
      playback.checkpoint?.schema !== "csscloth-simulation-checkpoint@1" ||
      playback.checkpoint.streamFrameOffset !== playback.streamFrameOffset ||
      !Number.isFinite(playback.checkpoint.windPhaseMilliseconds) ||
      !Number.isSafeInteger(playback.checkpoint.nextSimulationStepIndex) ||
      playback.checkpoint.nextSimulationStepIndex < 1 ||
      playback.checkpoint.nextSimulationStepIndex > 0xffffffff ||
      !Array.isArray(playback.checkpoint.positions) ||
      playback.checkpoint.positions.length !== CSSCLOTH_PARTICLE_COUNT ||
      !Array.isArray(playback.checkpoint.previousPositions) ||
      playback.checkpoint.previousPositions.length !== CSSCLOTH_PARTICLE_COUNT ||
      [...playback.checkpoint.positions, ...playback.checkpoint.previousPositions].some((point) =>
        !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value))) ||
      playback.frames.some((frame) => !Array.isArray(frame?.lightingRows) ||
        frame.lightingRows.length !== playback.triangleCount ||
        frame.lightingRows.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffff))) {
    throw new TypeError("Complete prepared Cloth checkpoint playback is required");
  }
  if (!Array.isArray(playback.atlasStateSlots) ||
      playback.atlasStateSlots.length !== playback.triangleCount ||
      playback.atlasStateSlots.some((slots) => !Array.isArray(slots) || slots.length < 1 ||
        slots.length > 0x10000 || slots.some((slot) =>
          !Number.isSafeInteger(slot) || slot < 0 || slot > 0xffff)) ||
      playback.frames.some((frame) => frame.lightingRows.some((row, triangleIndex) =>
        row >= playback.atlasStateSlots[triangleIndex].length))) {
    throw new TypeError("Complete prepared Cloth checkpoint atlas mapping is required");
  }
}

async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || typeof DecompressionStream !== "function") {
    throw new Error("Prepared Cloth gzip decoding is unavailable");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
