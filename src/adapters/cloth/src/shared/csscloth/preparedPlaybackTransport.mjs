import { formatMatrix3dValues } from "@layoutit/polycss";

export const CSSCLOTH_PLAYBACK_SCHEMA = "csscloth-prepared-playback@6";
export const CSSCLOTH_PLAYBACK_ENCODING =
  "gzip-third-order-zigzag-varint-fixed4-affine12-sparse-u16-lighting-shadow@6";

const MAGIC = "CCLT";
const VERSION = 6;
const HEADER_BYTES = 36;
const PREDICTION_ORDER = 3;
const MATRIX_DECIMALS = 4;
const MATRIX_SCALE = 10 ** MATRIX_DECIMALS;
const MATRIX_COMPONENTS = Object.freeze([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);

export function encodeClothPreparedPlayback(playback) {
  validatePlayback(playback);
  const matrixBytes = [];
  const transformCount = playback.triangleCount + playback.shadowTriangleCount;
  for (const matrixIndex of MATRIX_COMPONENTS) {
    for (let transformIndex = 0; transformIndex < transformCount; transformIndex += 1) {
      let value = 0;
      let firstDifference = 0;
      let secondDifference = 0;
      for (const frame of playback.frames) {
        const matrix = transformIndex < playback.triangleCount
          ? frame.matrices[transformIndex]
          : frame.shadowMatrices[transformIndex - playback.triangleCount];
        const nextValue = Math.round(matrix[matrixIndex] * MATRIX_SCALE);
        const nextFirstDifference = nextValue - value;
        const nextSecondDifference = nextFirstDifference - firstDifference;
        const residual = nextSecondDifference - secondDifference;
        appendSignedVarint(matrixBytes, residual);
        value = nextValue;
        firstDifference = nextFirstDifference;
        secondDifference = nextSecondDifference;
      }
    }
  }
  const lightingSchedule = buildSparseLightingSchedule(playback);
  const lightingByteLength = lightingSchedule.offsets.byteLength +
    lightingSchedule.indices.byteLength + lightingSchedule.slots.byteLength;
  const shadowVisibilityByteLength = playback.frameCount * playback.shadowTriangleCount;
  const bytes = new Uint8Array(
    HEADER_BYTES + matrixBytes.length + lightingByteLength + shadowVisibilityByteLength,
  );
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = VERSION;
  bytes[5] = PREDICTION_ORDER;
  bytes[6] = MATRIX_COMPONENTS.length;
  bytes[7] = MATRIX_DECIMALS;
  view.setUint16(8, playback.frameCount, true);
  view.setUint16(10, playback.triangleCount, true);
  view.setFloat64(12, playback.frameMilliseconds, true);
  view.setUint32(20, matrixBytes.length, true);
  view.setUint32(24, lightingByteLength, true);
  view.setUint16(28, playback.shadowTriangleCount, true);
  view.setUint32(30, lightingSchedule.indices.length, true);
  view.setUint16(34, 0, true);
  bytes.set(matrixBytes, HEADER_BYTES);
  let offset = HEADER_BYTES + matrixBytes.length;
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
      bytes[6] !== MATRIX_COMPONENTS.length || bytes[7] !== MATRIX_DECIMALS) {
    throw new Error("Prepared Cloth playback header drifted");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint16(8, true);
  const triangleCount = view.getUint16(10, true);
  const shadowTriangleCount = view.getUint16(28, true);
  const frameMilliseconds = view.getFloat64(12, true);
  const matrixByteLength = view.getUint32(20, true);
  const lightingByteLength = view.getUint32(24, true);
  const lightingAssignmentCount = view.getUint32(30, true);
  const shadowVisibilityByteLength = frameCount * shadowTriangleCount;
  const expectedLightingByteLength = (frameCount + 1) * Uint32Array.BYTES_PER_ELEMENT +
    lightingAssignmentCount * Uint16Array.BYTES_PER_ELEMENT * 2;
  if (view.getUint16(34, true) !== 0 || frameCount !== descriptor.frameCount ||
      triangleCount !== descriptor.triangleCount ||
      shadowTriangleCount !== descriptor.shadowTriangleCount ||
      frameMilliseconds !== descriptor.frameMilliseconds ||
      lightingByteLength !== expectedLightingByteLength ||
      HEADER_BYTES + matrixByteLength + lightingByteLength + shadowVisibilityByteLength !==
        bytes.byteLength) {
    throw new Error("Prepared Cloth playback counts drifted");
  }
  const transformCount = triangleCount + shadowTriangleCount;
  const quantized = new Float64Array(frameCount * transformCount * MATRIX_COMPONENTS.length);
  const stream = { offset: HEADER_BYTES, end: HEADER_BYTES + matrixByteLength };
  for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
    for (let transformIndex = 0; transformIndex < transformCount; transformIndex += 1) {
      let value = 0;
      let firstDifference = 0;
      let secondDifference = 0;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const residual = readSignedVarint(bytes, stream);
        secondDifference += residual;
        firstDifference += secondDifference;
        value += firstDifference;
        if (!Number.isSafeInteger(value)) {
          throw new Error("Prepared Cloth matrix value overflowed");
        }
        quantized[(frameIndex * transformCount + transformIndex) * MATRIX_COMPONENTS.length + componentIndex] = value;
      }
    }
  }
  if (stream.offset !== stream.end) throw new Error("Prepared Cloth matrix stream has trailing bytes");
  const lightingStart = stream.end;
  const shadowVisibilityStart = lightingStart + lightingByteLength;
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
  const shadowSchedule = buildSparseShadowSchedule(
    quantized,
    bytes.subarray(shadowVisibilityStart),
    frameCount,
    triangleCount,
    shadowTriangleCount,
  );
  if (lightingOffset !== shadowVisibilityStart) {
    throw new Error("Prepared Cloth lighting schedule has trailing bytes");
  }
  return Object.freeze({
    playback: Object.freeze({
      schema: CSSCLOTH_PLAYBACK_SCHEMA,
      frameCount,
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
    quantized,
    transformCount,
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
  if (!(materialization?.quantized instanceof Float64Array) ||
      !Number.isSafeInteger(materialization.transformCount) || materialization.transformCount < 1 ||
      !Number.isSafeInteger(count) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end > count || sourceIndices === undefined) {
    throw new TypeError("Prepared Cloth matrix materialization range is invalid");
  }
  const playback = materialization.playback;
  const output = new Array(end - start);
  const matrix = new Array(16).fill(0);
  matrix[15] = 1;
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const matrixIndex = kind === "cloth"
      ? clothCombinedTransformIndex(
        start + outputIndex,
        playback.triangleCount,
        materialization.transformCount,
      )
      : sourceIndices[start + outputIndex];
    const valueOffset = matrixIndex * MATRIX_COMPONENTS.length;
    for (let componentIndex = 0; componentIndex < MATRIX_COMPONENTS.length; componentIndex += 1) {
      matrix[MATRIX_COMPONENTS[componentIndex]] =
        materialization.quantized[valueOffset + componentIndex] / MATRIX_SCALE;
    }
    output[outputIndex] = `matrix3d(${formatMatrix3dValues(matrix, MATRIX_DECIMALS)})`;
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

function clothCombinedTransformIndex(clothTransformIndex, triangleCount, transformCount) {
  const frameIndex = Math.floor(clothTransformIndex / triangleCount);
  return frameIndex * transformCount + clothTransformIndex % triangleCount;
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

function buildSparseShadowSchedule(
  quantized,
  visibility,
  frameCount,
  triangleCount,
  shadowTriangleCount,
) {
  const transformOffsets = new Uint32Array(frameCount + 1);
  const transformIndices = [];
  const transformSourceIndices = [];
  const visibilityOffsets = new Uint32Array(frameCount + 1);
  const visibilityIndices = [];
  const visibilityValues = [];
  const transformCount = triangleCount + shadowTriangleCount;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    transformOffsets[frameIndex] = transformIndices.length;
    visibilityOffsets[frameIndex] = visibilityIndices.length;
    const visibilityOffset = frameIndex * shadowTriangleCount;
    const previousVisibilityOffset = (frameIndex - 1) * shadowTriangleCount;
    const transformOffset = frameIndex * transformCount + triangleCount;
    const previousTransformOffset = (frameIndex - 1) * transformCount + triangleCount;
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
      !Number.isSafeInteger(playback.triangleCount) || playback.triangleCount < 1 ||
      !Number.isSafeInteger(playback.shadowTriangleCount) || playback.shadowTriangleCount < 3 ||
      !Number.isFinite(playback.frameMilliseconds) || playback.frameMilliseconds <= 0 ||
      !Array.isArray(playback.frames) || playback.frames.length !== playback.frameCount ||
      playback.frames.some((frame) => !Array.isArray(frame?.matrices) ||
        frame.matrices.length !== playback.triangleCount ||
        frame.matrices.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 ||
          matrix.some((value) => !Number.isFinite(value))) ||
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

function appendSignedVarint(target, value) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Prepared Cloth matrix residual is unsafe");
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
    if (stream.offset >= stream.end) throw new Error("Prepared Cloth matrix varint is truncated");
    const byte = bytes[stream.offset];
    stream.offset += 1;
    encoded += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2;
    multiplier *= 0x80;
  }
  throw new Error("Prepared Cloth matrix varint exceeds the safe range");
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
