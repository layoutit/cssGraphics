import {
  buildClothTriangleSeamEdges,
  buildClothTriangleTopology,
  clothTriangleMatrixFromWorldPoints,
} from "./clothTriangleTransform.mjs";

export const CSSCLOTH_PLAYBACK_SCHEMA = "csscloth-prepared-playback@7";
export const CSSCLOTH_PLAYBACK_ENCODING =
  "gzip-third-order-zigzag-varint-fixed7-particles-corrected-fixed4-shadow-affine12-sparse-u16-lighting-shadow@7";

const MAGIC = "CCLT";
const VERSION = 7;
const HEADER_BYTES = 52;
const PREDICTION_ORDER = 3;
const PARTICLE_COMPONENT_COUNT = 3;
const PARTICLE_DECIMALS = 7;
const PARTICLE_SCALE = 10 ** PARTICLE_DECIMALS;
const MATRIX_DECIMALS = 4;
const MATRIX_SCALE = 10 ** MATRIX_DECIMALS;
const MATRIX_COMPONENTS = Object.freeze([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);

export function encodeClothPreparedPlayback(playback) {
  validatePlayback(playback);
  const particleBytes = [];
  for (let componentIndex = 0; componentIndex < PARTICLE_COMPONENT_COUNT; componentIndex += 1) {
    for (let particleIndex = 0; particleIndex < playback.particleCount; particleIndex += 1) {
      appendPredictedValues(particleBytes, playback.frames, (frame) =>
        Math.round(frame.particlePositions[particleIndex][componentIndex] * PARTICLE_SCALE));
    }
  }
  const shadowMatrixBytes = [];
  for (const matrixIndex of MATRIX_COMPONENTS) {
    for (let shadowIndex = 0; shadowIndex < playback.shadowTriangleCount; shadowIndex += 1) {
      appendPredictedValues(shadowMatrixBytes, playback.frames, (frame) =>
        Math.round(frame.shadowMatrices[shadowIndex][matrixIndex] * MATRIX_SCALE));
    }
  }
  const lightingSchedule = buildSparseLightingSchedule(playback);
  const particleMatrixCorrections = buildParticleMatrixCorrections(playback);
  const lightingByteLength = lightingSchedule.offsets.byteLength +
    lightingSchedule.indices.byteLength + lightingSchedule.slots.byteLength;
  const correctionByteLength = particleMatrixCorrections.length * 9;
  const shadowVisibilityByteLength = playback.frameCount * playback.shadowTriangleCount;
  const bytes = new Uint8Array(
    HEADER_BYTES + particleBytes.length + shadowMatrixBytes.length +
      lightingByteLength + correctionByteLength + shadowVisibilityByteLength,
  );
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = VERSION;
  bytes[5] = PREDICTION_ORDER;
  bytes[6] = PARTICLE_COMPONENT_COUNT;
  bytes[7] = PARTICLE_DECIMALS;
  view.setUint16(8, playback.frameCount, true);
  view.setUint16(10, playback.triangleCount, true);
  view.setFloat64(12, playback.frameMilliseconds, true);
  view.setUint32(20, particleBytes.length, true);
  view.setUint32(24, shadowMatrixBytes.length, true);
  view.setUint32(28, lightingByteLength, true);
  view.setUint16(32, playback.particleCount, true);
  view.setUint16(34, playback.shadowTriangleCount, true);
  view.setUint32(36, lightingSchedule.indices.length, true);
  bytes[40] = MATRIX_COMPONENTS.length;
  bytes[41] = MATRIX_DECIMALS;
  view.setUint16(42, 0, true);
  view.setUint32(44, correctionByteLength, true);
  view.setUint32(48, particleMatrixCorrections.length, true);
  bytes.set(particleBytes, HEADER_BYTES);
  bytes.set(shadowMatrixBytes, HEADER_BYTES + particleBytes.length);
  let offset = HEADER_BYTES + particleBytes.length + shadowMatrixBytes.length;
  for (const value of lightingSchedule.offsets) {
    view.setUint32(offset, value, true);
    offset += 4;
  }
  for (const value of lightingSchedule.indices) {
    view.setUint16(offset, value, true);
    offset += 2;
  }
  for (const value of lightingSchedule.slots) {
    view.setUint16(offset, value, true);
    offset += 2;
  }
  for (const correction of particleMatrixCorrections) {
    view.setUint32(offset, correction.transformIndex, true);
    bytes[offset + 4] = correction.componentIndex;
    view.setInt32(offset + 5, correction.value, true);
    offset += 9;
  }
  for (const frame of playback.frames) {
    bytes.set(frame.shadowVisibility, offset);
    offset += playback.shadowTriangleCount;
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
      bytes[4] !== VERSION || bytes[5] !== PREDICTION_ORDER ||
      bytes[6] !== PARTICLE_COMPONENT_COUNT || bytes[7] !== PARTICLE_DECIMALS ||
      bytes[40] !== MATRIX_COMPONENTS.length || bytes[41] !== MATRIX_DECIMALS) {
    throw new Error("Prepared Cloth playback header drifted");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint16(8, true);
  const triangleCount = view.getUint16(10, true);
  const particleCount = view.getUint16(32, true);
  const shadowTriangleCount = view.getUint16(34, true);
  const frameMilliseconds = view.getFloat64(12, true);
  const particleByteLength = view.getUint32(20, true);
  const shadowMatrixByteLength = view.getUint32(24, true);
  const lightingByteLength = view.getUint32(28, true);
  const lightingAssignmentCount = view.getUint32(36, true);
  const correctionByteLength = view.getUint32(44, true);
  const correctionAssignmentCount = view.getUint32(48, true);
  const shadowVisibilityByteLength = frameCount * shadowTriangleCount;
  const expectedLightingByteLength = (frameCount + 1) * Uint32Array.BYTES_PER_ELEMENT +
    lightingAssignmentCount * Uint16Array.BYTES_PER_ELEMENT * 2;
  if (view.getUint16(42, true) !== 0 || frameCount !== descriptor.frameCount ||
      triangleCount !== descriptor.triangleCount ||
      particleCount !== descriptor.particleCount ||
      shadowTriangleCount !== descriptor.shadowTriangleCount ||
      frameMilliseconds !== descriptor.frameMilliseconds ||
      lightingByteLength !== expectedLightingByteLength ||
      correctionByteLength !== correctionAssignmentCount * 9 ||
      HEADER_BYTES + particleByteLength + shadowMatrixByteLength +
        lightingByteLength + correctionByteLength + shadowVisibilityByteLength !==
        bytes.byteLength) {
    throw new Error("Prepared Cloth playback counts drifted");
  }
  const particleQuantized = new Float64Array(
    frameCount * particleCount * PARTICLE_COMPONENT_COUNT,
  );
  const particleStream = { offset: HEADER_BYTES, end: HEADER_BYTES + particleByteLength };
  decodePredictedValues(
    bytes,
    particleStream,
    PARTICLE_COMPONENT_COUNT,
    particleCount,
    frameCount,
    particleQuantized,
    PARTICLE_COMPONENT_COUNT,
    "particle",
  );
  if (particleStream.offset !== particleStream.end) {
    throw new Error("Prepared Cloth particle stream has trailing bytes");
  }
  const shadowQuantized = new Float64Array(
    frameCount * shadowTriangleCount * MATRIX_COMPONENTS.length,
  );
  const shadowStream = {
    offset: particleStream.end,
    end: particleStream.end + shadowMatrixByteLength,
  };
  decodePredictedValues(
    bytes,
    shadowStream,
    MATRIX_COMPONENTS.length,
    shadowTriangleCount,
    frameCount,
    shadowQuantized,
    MATRIX_COMPONENTS.length,
    "shadow matrix",
  );
  if (shadowStream.offset !== shadowStream.end) {
    throw new Error("Prepared Cloth shadow matrix stream has trailing bytes");
  }
  const lightingStart = shadowStream.end;
  const correctionStart = lightingStart + lightingByteLength;
  const shadowVisibilityStart = correctionStart + correctionByteLength;
  const lightingOffsets = new Uint32Array(frameCount + 1);
  let lightingOffset = lightingStart;
  for (let index = 0; index < lightingOffsets.length; index += 1) {
    lightingOffsets[index] = view.getUint32(lightingOffset, true);
    lightingOffset += 4;
  }
  if (lightingOffsets[0] !== 0 || lightingOffsets[1] !== triangleCount ||
      lightingOffsets[frameCount] !== lightingAssignmentCount ||
      lightingOffsets.some((value, index) => index > 0 && value < lightingOffsets[index - 1])) {
    throw new Error("Prepared Cloth lighting schedule drifted");
  }
  const lightingIndices = new Uint16Array(lightingAssignmentCount);
  for (let index = 0; index < lightingIndices.length; index += 1) {
    lightingIndices[index] = view.getUint16(lightingOffset, true);
    lightingOffset += 2;
  }
  if (lightingIndices.some((value) => value >= triangleCount)) {
    throw new Error("Prepared Cloth lighting schedule addresses an invalid triangle");
  }
  const lightingSlots = new Uint16Array(lightingAssignmentCount);
  for (let index = 0; index < lightingSlots.length; index += 1) {
    lightingSlots[index] = view.getUint16(lightingOffset, true);
    lightingOffset += 2;
  }
  const particleMatrixCorrections = new Map();
  let correctionOffset = correctionStart;
  for (let index = 0; index < correctionAssignmentCount; index += 1) {
    const transformIndex = view.getUint32(correctionOffset, true);
    const componentIndex = bytes[correctionOffset + 4];
    const value = view.getInt32(correctionOffset + 5, true);
    if (transformIndex >= frameCount * triangleCount ||
        componentIndex >= MATRIX_COMPONENTS.length) {
      throw new Error("Prepared Cloth particle matrix correction drifted");
    }
    const corrections = particleMatrixCorrections.get(transformIndex) ?? [];
    corrections.push(componentIndex, value);
    particleMatrixCorrections.set(transformIndex, corrections);
    correctionOffset += 9;
  }
  const shadowSchedule = buildSparseShadowSchedule(
    shadowQuantized,
    bytes.subarray(shadowVisibilityStart),
    frameCount,
    shadowTriangleCount,
  );
  if (lightingOffset !== correctionStart || correctionOffset !== shadowVisibilityStart) {
    throw new Error("Prepared Cloth lighting schedule has trailing bytes");
  }
  const triangleTopology = buildClothTriangleTopology(particleCount);
  if (triangleTopology.length !== triangleCount) {
    throw new Error("Prepared Cloth particle topology drifted");
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
    particleQuantized,
    shadowQuantized,
    triangleTopology,
    triangleSeamEdges: buildClothTriangleSeamEdges(triangleTopology),
    particleMatrixCorrections,
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
  if (!(materialization?.particleQuantized instanceof Float64Array) ||
      !(materialization?.shadowQuantized instanceof Float64Array) ||
      !Array.isArray(materialization.triangleTopology) ||
      !Array.isArray(materialization.triangleSeamEdges) ||
      !(materialization.particleMatrixCorrections instanceof Map) ||
      !Number.isSafeInteger(count) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end > count || sourceIndices === undefined) {
    throw new TypeError("Prepared Cloth matrix materialization range is invalid");
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
        const offset = (frameIndex * playback.particleCount + particleIndex) *
          PARTICLE_COMPONENT_COUNT;
        return [
          materialization.particleQuantized[offset] / PARTICLE_SCALE,
          materialization.particleQuantized[offset + 1] / PARTICLE_SCALE,
          materialization.particleQuantized[offset + 2] / PARTICLE_SCALE,
        ];
      });
      const values = clothTriangleMatrixFromWorldPoints(
        points,
        triangleIndex,
        materialization.triangleSeamEdges,
      );
      const corrections = materialization.particleMatrixCorrections.get(transformIndex);
      if (corrections) {
        for (let correctionIndex = 0; correctionIndex < corrections.length; correctionIndex += 2) {
          values[MATRIX_COMPONENTS[corrections[correctionIndex]]] =
            corrections[correctionIndex + 1] / MATRIX_SCALE;
        }
      }
      output[outputIndex] = `matrix3d(${formatFixed4Matrix(values)})`;
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

function formatFixed4Matrix(values) {
  let output = "";
  for (let index = 0; index < values.length; index += 1) {
    const rounded = Math.round(values[index] * MATRIX_SCALE) / MATRIX_SCALE;
    output += `${index === 0 ? "" : ","}${Object.is(rounded, -0) ? 0 : rounded}`;
  }
  return output;
}

export function completeClothPreparedPlaybackMaterialization(
  playback,
  transforms,
  shadowTransformValues,
  freezeTransformArrays = false,
) {
  if (playback?.schema !== CSSCLOTH_PLAYBACK_SCHEMA ||
      playback.transforms !== null || playback.shadowTransformValues !== null ||
      !Array.isArray(transforms) ||
      transforms.length !== playback.frameCount * playback.triangleCount ||
      !Array.isArray(shadowTransformValues) ||
      shadowTransformValues.length !== playback.shadowTransformIndices.length ||
      !transforms[0]?.startsWith("matrix3d(") ||
      !transforms.at(-1)?.startsWith("matrix3d(") ||
      !shadowTransformValues[0]?.startsWith("matrix3d(") ||
      !shadowTransformValues.at(-1)?.startsWith("matrix3d(")) {
    throw new Error("Prepared Cloth matrix materialization drifted");
  }
  return Object.freeze({
    ...playback,
    transforms: freezeTransformArrays ? Object.freeze(transforms) : transforms,
    shadowTransformValues: freezeTransformArrays
      ? Object.freeze(shadowTransformValues)
      : shadowTransformValues,
  });
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
  return {
    offsets,
    indices: Uint16Array.from(indices),
    slots: Uint16Array.from(slots),
  };
}

function buildParticleMatrixCorrections(playback) {
  const topology = buildClothTriangleTopology(playback.particleCount);
  const seamEdges = buildClothTriangleSeamEdges(topology);
  const corrections = [];
  for (let frameIndex = 0; frameIndex < playback.frameCount; frameIndex += 1) {
    const frame = playback.frames[frameIndex];
    for (let triangleIndex = 0; triangleIndex < playback.triangleCount; triangleIndex += 1) {
      const points = topology[triangleIndex].map((particleIndex) =>
        frame.particlePositions[particleIndex]);
      const reconstructedPoints = points.map((point) => point.map((value) =>
        Math.round(value * PARTICLE_SCALE) / PARTICLE_SCALE));
      const expected = clothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges);
      const reconstructed = clothTriangleMatrixFromWorldPoints(
        reconstructedPoints,
        triangleIndex,
        seamEdges,
      );
      const transformIndex = frameIndex * playback.triangleCount + triangleIndex;
      for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
        const matrixIndex = MATRIX_COMPONENTS[componentIndex];
        const expectedValue = Math.round(expected[matrixIndex] * MATRIX_SCALE);
        const reconstructedValue = Math.round(reconstructed[matrixIndex] * MATRIX_SCALE);
        if (expectedValue === reconstructedValue) continue;
        if (expectedValue < -0x8000_0000 || expectedValue > 0x7fff_ffff) {
          throw new RangeError("Prepared Cloth particle matrix correction overflowed");
        }
        corrections.push(Object.freeze({ transformIndex, componentIndex, value: expectedValue }));
      }
    }
  }
  return Object.freeze(corrections);
}

function buildSparseShadowSchedule(
  quantized,
  visibility,
  frameCount,
  shadowTriangleCount,
) {
  const transformOffsets = new Uint32Array(frameCount + 1);
  const transformIndices = [];
  const transformSourceIndices = [];
  const visibilityOffsets = new Uint32Array(frameCount + 1);
  const visibilityIndices = [];
  const visibilityValues = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    transformOffsets[frameIndex] = transformIndices.length;
    visibilityOffsets[frameIndex] = visibilityIndices.length;
    const visibilityOffset = frameIndex * shadowTriangleCount;
    const previousVisibilityOffset = (frameIndex - 1) * shadowTriangleCount;
    const transformOffset = frameIndex * shadowTriangleCount;
    const previousTransformOffset = (frameIndex - 1) * shadowTriangleCount;
    for (let triangleIndex = 0; triangleIndex < shadowTriangleCount; triangleIndex += 1) {
      const sourceTransformIndex = transformOffset + triangleIndex;
      if (frameIndex === 0 || !sameQuantizedMatrix(
        quantized,
        sourceTransformIndex,
        previousTransformOffset + triangleIndex,
      )) {
        transformIndices.push(triangleIndex);
        transformSourceIndices.push(sourceTransformIndex);
      }
      if (frameIndex === 0 || visibility[visibilityOffset + triangleIndex] !==
          visibility[previousVisibilityOffset + triangleIndex]) {
        visibilityIndices.push(triangleIndex);
        visibilityValues.push(visibility[visibilityOffset + triangleIndex]);
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

export async function loadClothPreparedPlayback(descriptor) {
  const bytes = await loadClothPreparedPlaybackBytes(descriptor);
  return decodeClothPreparedPlayback(bytes, descriptor);
}

export async function loadClothPreparedPlaybackBytes(descriptor) {
  if (descriptor?.schema !== CSSCLOTH_PLAYBACK_SCHEMA ||
      descriptor?.encoding !== CSSCLOTH_PLAYBACK_ENCODING ||
      typeof descriptor.path !== "string" || !descriptor.path.startsWith("/csscloth/") ||
      !Number.isSafeInteger(descriptor.particleCount) || descriptor.particleCount < 4 ||
      !Number.isSafeInteger(descriptor.shadowTriangleCount) || descriptor.shadowTriangleCount < 3 ||
      !/^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? "") ||
      !/^[a-f0-9]{64}$/u.test(descriptor.uncompressedSha256 ?? "")) {
    throw new Error("Prepared Cloth playback descriptor drifted");
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

function validatePlayback(playback) {
  if (!playback || !Number.isSafeInteger(playback.frameCount) || playback.frameCount < 2 ||
      !Number.isSafeInteger(playback.particleCount) || playback.particleCount < 4 ||
      !Number.isSafeInteger(playback.triangleCount) || playback.triangleCount < 1 ||
      !Number.isSafeInteger(playback.shadowTriangleCount) || playback.shadowTriangleCount < 3 ||
      !Number.isFinite(playback.frameMilliseconds) || playback.frameMilliseconds <= 0 ||
      !Array.isArray(playback.frames) || playback.frames.length !== playback.frameCount ||
      playback.frames.some((frame) => !Array.isArray(frame?.particlePositions) ||
        frame.particlePositions.length !== playback.particleCount ||
        frame.particlePositions.some((position) => !Array.isArray(position) ||
          position.length !== PARTICLE_COMPONENT_COUNT ||
          position.some((value) => !Number.isFinite(value))) ||
        !Array.isArray(frame?.shadowMatrices) ||
        frame.shadowMatrices.length !== playback.shadowTriangleCount ||
        frame.shadowMatrices.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 ||
          matrix.some((value) => !Number.isFinite(value))) ||
        !Array.isArray(frame?.lightingRows) || frame.lightingRows.length !== playback.triangleCount ||
        frame.lightingRows.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffff) ||
        !Array.isArray(frame?.shadowVisibility) ||
        frame.shadowVisibility.length !== playback.shadowTriangleCount ||
        frame.shadowVisibility.some((value) => value !== 0 && value !== 1))) {
    throw new TypeError("Complete prepared Cloth playback is required");
  }
  if (!Array.isArray(playback.atlasStateSlots) ||
      playback.atlasStateSlots.length !== playback.triangleCount ||
      playback.atlasStateSlots.some((slots) => !Array.isArray(slots) || slots.length < 1 ||
        slots.length > 0x10000 || slots.some((slot) => !Number.isSafeInteger(slot) || slot < 0 || slot > 0xffff)) ||
      playback.atlasStateSlots.reduce((sum, slots) => sum + slots.length, 0) > 0xffff ||
      playback.frames.some((frame) => frame.lightingRows.some((row, triangleIndex) =>
        row >= playback.atlasStateSlots[triangleIndex].length))) {
    throw new TypeError("Complete prepared Cloth atlas mapping is required");
  }
}

function appendPredictedValues(target, frames, resolveValue) {
  let value = 0;
  let firstDifference = 0;
  let secondDifference = 0;
  for (const frame of frames) {
    const nextValue = resolveValue(frame);
    const nextFirstDifference = nextValue - value;
    const nextSecondDifference = nextFirstDifference - firstDifference;
    appendSignedVarint(target, nextSecondDifference - secondDifference);
    value = nextValue;
    firstDifference = nextFirstDifference;
    secondDifference = nextSecondDifference;
  }
}

function decodePredictedValues(
  bytes,
  stream,
  componentCount,
  itemCount,
  frameCount,
  output,
  outputStride,
  label,
) {
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      let value = 0;
      let firstDifference = 0;
      let secondDifference = 0;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        secondDifference += readSignedVarint(bytes, stream);
        firstDifference += secondDifference;
        value += firstDifference;
        if (!Number.isSafeInteger(value)) {
          throw new Error(`Prepared Cloth ${label} value overflowed`);
        }
        output[(frameIndex * itemCount + itemIndex) * outputStride + componentIndex] = value;
      }
    }
  }
}

function appendSignedVarint(target, value) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Prepared Cloth residual is unsafe");
  }
  let encoded = value >= 0 ? value * 2 : -value * 2 - 1;
  while (encoded >= 0x80) {
    target.push((encoded & 0x7f) | 0x80);
    encoded = Math.floor(encoded / 0x80);
  }
  target.push(encoded);
}

function readSignedVarint(bytes, stream) {
  let encoded = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
    if (stream.offset >= stream.end) throw new Error("Prepared Cloth varint is truncated");
    const byte = bytes[stream.offset];
    stream.offset += 1;
    encoded += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2;
    multiplier *= 0x80;
  }
  throw new Error("Prepared Cloth varint exceeds the safe range");
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
