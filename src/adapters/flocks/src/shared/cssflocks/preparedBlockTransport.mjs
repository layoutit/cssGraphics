// SPDX-License-Identifier: GPL-2.0-or-later
import { formatMatrix3dValues } from "@layoutit/polycss";
import { mapReallySlickHueToPreparedHex } from "../../../../shared/reallyslickPalette.mjs";
import { shadeFlocksPreparedHex } from "./bugLighting.mjs";
import { buildFlocksBugMatrix, flocksHueToHex } from "./bugTransform.mjs";

export const CSSFLOCKS_BLOCK_ENCODING = "gzip-flocks-checkpoint-delta@2";
export const CSSFLOCKS_PLAYBACK_SCHEMA = "cssflocks-prepared-dom-playback@1";
export const CSSFLOCKS_BLOCK_SCHEMA = "cssflocks-prepared-stream-block@1";

export const CSSFLOCKS_TRANSPORT_LIMITS = deepFreeze({
  checkpoint: {
    positionOrigin: { storage: "int16", scale: 1, minimum: -32_768, maximum: 32_767 },
    positionRelative: { storage: "int16", scale: 1 / 32, minimum: -1_024, maximum: 1_023.96875 },
    velocity: { storage: "int16", scale: 1 / 128, minimum: -256, maximum: 255.9921875 },
    hue: { storage: "uint16", scale: 1 / 65_535, minimum: 0, maximum: 1 },
  },
  delta: {
    positionResidual: { storage: "int8", scale: 1 / 4_096, minimum: -0.03125, maximum: 0.031005859375 },
    velocity: { storage: "int16", scale: 1 / 128, minimum: -256, maximum: 255.9921875 },
    hueCircular: { storage: "int8", scale: 1 / 32_768, minimum: -0.00390625, maximum: 0.003875732421875 },
  },
});

const MAGIC = "CFLK";
const VERSION = 2;
const HEADER_BYTES = 40;
const CHECKPOINT_BYTES_PER_BUG = 14;
const DELTA_BYTES_PER_BUG = 10;
const POSITION_CHECKPOINT_DENOMINATOR = 32;
const VELOCITY_CHECKPOINT_DENOMINATOR = 128;
const POSITION_RESIDUAL_DENOMINATOR = 4_096;
const VELOCITY_DELTA_DENOMINATOR = 128;
const HUE_CHECKPOINT_DENOMINATOR = 65_535;
const HUE_DELTA_DENOMINATOR = 32_768;

export function encodeFlocksPreparedBlock({ frames, bugCount, framesPerSecond }) {
  validateEncodeInputs(frames, bugCount, framesPerSecond);
  const byteLength = expectedByteLength(frames.length, bugCount);
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  const positionOrigins = buildPositionOrigins(frames[0].bugs);
  writeHeader(bytes, view, { bugCount, frameCount: frames.length, framesPerSecond, positionOrigins });

  const previousPositions = new Float64Array(bugCount * 3);
  const previousVelocities = new Float64Array(bugCount * 3);
  const previousHues = new Float64Array(bugCount);
  let offset = HEADER_BYTES;
  for (let bugIndex = 0; bugIndex < bugCount; bugIndex += 1) {
    const bug = frames[0].bugs[bugIndex];
    const base = bugIndex * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const encoded = quantizeSigned(bug.position[axis] - positionOrigins[axis], POSITION_CHECKPOINT_DENOMINATOR, -0x8000, 0x7fff, `checkpoint position ${bugIndex}:${axis}`);
      view.setInt16(offset, encoded, true); offset += 2;
      previousPositions[base + axis] = positionOrigins[axis] + encoded / POSITION_CHECKPOINT_DENOMINATOR;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const encoded = quantizeSigned(bug.velocity[axis], VELOCITY_CHECKPOINT_DENOMINATOR, -0x8000, 0x7fff, `checkpoint velocity ${bugIndex}:${axis}`);
      view.setInt16(offset, encoded, true); offset += 2;
      previousVelocities[base + axis] = encoded / VELOCITY_CHECKPOINT_DENOMINATOR;
    }
    const encodedHue = quantizeHue(bug.hue);
    view.setUint16(offset, encodedHue, true); offset += 2;
    previousHues[bugIndex] = encodedHue / HUE_CHECKPOINT_DENOMINATOR;
  }

  const deltaSeconds = 1 / framesPerSecond;
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
    for (let bugIndex = 0; bugIndex < bugCount; bugIndex += 1) {
      const bug = frames[frameIndex].bugs[bugIndex];
      const base = bugIndex * 3;
      const nextVelocities = new Float64Array(3);
      for (let axis = 0; axis < 3; axis += 1) {
        const delta = bug.velocity[axis] - previousVelocities[base + axis];
        const encoded = quantizeSigned(delta, VELOCITY_DELTA_DENOMINATOR, -0x8000, 0x7fff, `velocity delta ${frameIndex}:${bugIndex}:${axis}`);
        view.setInt16(offset, encoded, true); offset += 2;
        nextVelocities[axis] = previousVelocities[base + axis] + encoded / VELOCITY_DELTA_DENOMINATOR;
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const prediction = previousPositions[base + axis] + nextVelocities[axis] * deltaSeconds;
        const residual = bug.position[axis] - prediction;
        const encoded = quantizeSigned(residual, POSITION_RESIDUAL_DENOMINATOR, -0x80, 0x7f, `position residual ${frameIndex}:${bugIndex}:${axis}`);
        view.setInt8(offset, encoded); offset += 1;
        previousPositions[base + axis] = prediction + encoded / POSITION_RESIDUAL_DENOMINATOR;
        previousVelocities[base + axis] = nextVelocities[axis];
      }
      const hueDelta = circularHueDelta(bug.hue, previousHues[bugIndex]);
      const encodedHueDelta = quantizeSigned(hueDelta, HUE_DELTA_DENOMINATOR, -0x80, 0x7f, `hue delta ${frameIndex}:${bugIndex}`);
      view.setInt8(offset, encodedHueDelta); offset += 1;
      previousHues[bugIndex] = wrapHue(previousHues[bugIndex] + encodedHueDelta / HUE_DELTA_DENOMINATOR);
    }
  }
  if (offset !== bytes.byteLength) throw new Error("Prepared Flocks block byte count drifted");
  view.setUint32(28, transportCrc32(bytes), true);
  return bytes;
}

export function decodeFlocksPreparedSourceValues(bytes, descriptor, catalog) {
  const values = new Float64Array(descriptor.frameCount * catalog.bugCount * 7);
  decodeRecords(bytes, descriptor, catalog, (frameIndex, bugIndex, position, velocity, hue) => {
    const offset = (frameIndex * catalog.bugCount + bugIndex) * 7;
    values.set(position, offset);
    values.set(velocity, offset + 3);
    values[offset + 6] = hue;
  });
  return values;
}

export function decodeFlocksPreparedBlock(bytes, descriptor, catalog, {
  paletteVariantId = null,
} = {}) {
  const transforms = new Array(descriptor.frameCount * catalog.bugCount);
  const colors = new Array(descriptor.frameCount * catalog.bugCount);
  decodeRecords(bytes, descriptor, catalog, (frameIndex, bugIndex, position, velocity, hue) => {
    const outputIndex = frameIndex * catalog.bugCount + bugIndex;
    const transform = buildFlocksBugMatrix(position, velocity);
    transforms[outputIndex] = `matrix3d(${formatMatrix3dValues(transform.matrix, 6)})`;
    const baseColor = paletteVariantId === null
      ? flocksHueToHex(hue)
      : mapReallySlickHueToPreparedHex(hue, paletteVariantId);
    colors[outputIndex] = shadeFlocksPreparedHex(baseColor, transform.matrix);
  });
  const preparedCssStringByteLength = [...transforms, ...colors]
    .reduce((total, value) => total + value.length * 2, 0);
  return Object.freeze({
    schema: CSSFLOCKS_BLOCK_SCHEMA,
    index: descriptor.index,
    startFrameIndex: descriptor.startFrameIndex,
    playback: Object.freeze({
      schema: CSSFLOCKS_PLAYBACK_SCHEMA,
      streamId: catalog.streamId,
      modelId: catalog.modelId,
      paletteVariantId,
      bugCount: catalog.bugCount,
      leafCount: catalog.leafCount,
      framesPerSecond: catalog.framesPerSecond,
      frameMilliseconds: catalog.frameMilliseconds,
      frameCount: descriptor.frameCount,
      durationMilliseconds: descriptor.frameCount / catalog.framesPerSecond * 1_000,
      transforms: Object.freeze(transforms),
      colors: Object.freeze(colors),
    }),
    preparedMatrixExpansionCount: transforms.length,
    preparedColorExpansionCount: colors.length,
    preparedCssStringByteLength,
  });
}

function decodeRecords(bytes, descriptor, catalog, visit) {
  const viewBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  validateHeader(viewBytes, descriptor, catalog);
  const view = new DataView(viewBytes.buffer, viewBytes.byteOffset, viewBytes.byteLength);
  const previousPositions = new Float64Array(catalog.bugCount * 3);
  const previousVelocities = new Float64Array(catalog.bugCount * 3);
  const previousHues = new Float64Array(catalog.bugCount);
  const positionOrigins = [view.getInt16(32, true), view.getInt16(34, true), view.getInt16(36, true)];
  let offset = HEADER_BYTES;
  for (let bugIndex = 0; bugIndex < catalog.bugCount; bugIndex += 1) {
    const base = bugIndex * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      previousPositions[base + axis] = positionOrigins[axis] + view.getInt16(offset, true) / POSITION_CHECKPOINT_DENOMINATOR; offset += 2;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      previousVelocities[base + axis] = view.getInt16(offset, true) / VELOCITY_CHECKPOINT_DENOMINATOR; offset += 2;
    }
    previousHues[bugIndex] = view.getUint16(offset, true) / HUE_CHECKPOINT_DENOMINATOR; offset += 2;
    visit(0, bugIndex, readVector(previousPositions, base), readVector(previousVelocities, base), previousHues[bugIndex]);
  }
  const deltaSeconds = 1 / catalog.framesPerSecond;
  for (let frameIndex = 1; frameIndex < descriptor.frameCount; frameIndex += 1) {
    for (let bugIndex = 0; bugIndex < catalog.bugCount; bugIndex += 1) {
      const base = bugIndex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        previousVelocities[base + axis] += view.getInt16(offset, true) / VELOCITY_DELTA_DENOMINATOR; offset += 2;
      }
      for (let axis = 0; axis < 3; axis += 1) {
        previousPositions[base + axis] += previousVelocities[base + axis] * deltaSeconds + view.getInt8(offset) / POSITION_RESIDUAL_DENOMINATOR; offset += 1;
      }
      previousHues[bugIndex] = wrapHue(previousHues[bugIndex] + view.getInt8(offset) / HUE_DELTA_DENOMINATOR); offset += 1;
      visit(frameIndex, bugIndex, readVector(previousPositions, base), readVector(previousVelocities, base), previousHues[bugIndex]);
    }
  }
  if (offset !== viewBytes.byteLength) throw new Error(`Prepared Flocks block ${descriptor.index} payload drifted`);
}

function writeHeader(bytes, view, { bugCount, frameCount, framesPerSecond, positionOrigins }) {
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = VERSION;
  bytes[5] = HEADER_BYTES;
  view.setUint16(6, bugCount, true);
  view.setUint16(8, frameCount, true);
  bytes[10] = CHECKPOINT_BYTES_PER_BUG;
  bytes[11] = DELTA_BYTES_PER_BUG;
  view.setUint16(12, POSITION_CHECKPOINT_DENOMINATOR, true);
  view.setUint16(14, VELOCITY_CHECKPOINT_DENOMINATOR, true);
  view.setUint16(16, POSITION_RESIDUAL_DENOMINATOR, true);
  view.setUint16(18, VELOCITY_DELTA_DENOMINATOR, true);
  view.setUint16(20, HUE_CHECKPOINT_DENOMINATOR, true);
  view.setUint16(22, HUE_DELTA_DENOMINATOR, true);
  view.setUint16(24, framesPerSecond, true);
  view.setUint16(26, 0, true);
  view.setUint32(28, 0, true);
  for (let axis = 0; axis < 3; axis += 1) view.setInt16(32 + axis * 2, positionOrigins[axis], true);
  view.setUint16(38, 0, true);
}

function validateHeader(bytes, descriptor, catalog) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES ||
      descriptor?.encoding !== CSSFLOCKS_BLOCK_ENCODING ||
      catalog?.playbackSchema !== CSSFLOCKS_PLAYBACK_SCHEMA ||
      !Number.isSafeInteger(descriptor?.frameCount) || descriptor.frameCount < 1 || descriptor.frameCount > 0xffff ||
      !Number.isSafeInteger(catalog?.bugCount) || catalog.bugCount < 1 || catalog.bugCount > 0xffff ||
      !Number.isSafeInteger(catalog?.framesPerSecond) || catalog.framesPerSecond < 1 || catalog.framesPerSecond > 0xffff) {
    throw new TypeError("Prepared Flocks block binding is incomplete");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedBytes = expectedByteLength(descriptor.frameCount, catalog.bugCount);
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic !== MAGIC || bytes[4] !== VERSION || bytes[5] !== HEADER_BYTES ||
      view.getUint16(6, true) !== catalog.bugCount || view.getUint16(8, true) !== descriptor.frameCount ||
      bytes[10] !== CHECKPOINT_BYTES_PER_BUG || bytes[11] !== DELTA_BYTES_PER_BUG ||
      view.getUint16(12, true) !== POSITION_CHECKPOINT_DENOMINATOR ||
      view.getUint16(14, true) !== VELOCITY_CHECKPOINT_DENOMINATOR ||
      view.getUint16(16, true) !== POSITION_RESIDUAL_DENOMINATOR ||
      view.getUint16(18, true) !== VELOCITY_DELTA_DENOMINATOR ||
      view.getUint16(20, true) !== HUE_CHECKPOINT_DENOMINATOR ||
      view.getUint16(22, true) !== HUE_DELTA_DENOMINATOR ||
      view.getUint16(24, true) !== catalog.framesPerSecond || view.getUint16(26, true) !== 0 || view.getUint16(38, true) !== 0 ||
      bytes.byteLength !== expectedBytes || descriptor.decodedByteLength !== expectedBytes) {
    throw new Error(`Prepared Flocks block ${descriptor.index} header drifted`);
  }
  if (view.getUint32(28, true) !== transportCrc32(bytes)) {
    throw new Error(`Prepared Flocks block ${descriptor.index} checksum drifted`);
  }
}

function validateEncodeInputs(frames, bugCount, framesPerSecond) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 0xffff ||
      !Number.isSafeInteger(bugCount) || bugCount < 1 || bugCount > 0xffff ||
      !Number.isSafeInteger(framesPerSecond) || framesPerSecond < 1 || framesPerSecond > 0xffff ||
      frames.some((frame) => !Array.isArray(frame?.bugs) || frame.bugs.length !== bugCount ||
        frame.bugs.some((bug) => !validBug(bug)))) {
    throw new TypeError("Complete bounded prepared Flocks source-state block inputs are required");
  }
}

function validBug(bug) {
  return Array.isArray(bug?.position) && bug.position.length === 3 && bug.position.every(Number.isFinite) &&
    Array.isArray(bug?.velocity) && bug.velocity.length === 3 && bug.velocity.every(Number.isFinite) &&
    Number.isFinite(bug?.hue) && bug.hue >= 0 && bug.hue <= 1;
}

function expectedByteLength(frameCount, bugCount) {
  return HEADER_BYTES + bugCount * (CHECKPOINT_BYTES_PER_BUG + (frameCount - 1) * DELTA_BYTES_PER_BUG);
}

function buildPositionOrigins(bugs) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const bug of bugs) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], bug.position[axis]);
      maximum[axis] = Math.max(maximum[axis], bug.position[axis]);
    }
  }
  return minimum.map((value, axis) => {
    const origin = Math.round((value + maximum[axis]) / 2);
    if (!Number.isSafeInteger(origin) || origin < -0x8000 || origin > 0x7fff) {
      throw new RangeError(`Prepared Flocks checkpoint position origin ${axis} is outside the encoded range`);
    }
    return origin;
  });
}

function quantizeSigned(value, denominator, minimum, maximum, label) {
  const encoded = Math.round(value * denominator);
  if (!Number.isSafeInteger(encoded) || encoded < minimum || encoded > maximum) {
    throw new RangeError(`Prepared Flocks ${label} is outside the encoded range`);
  }
  return encoded;
}

function quantizeHue(value) {
  const encoded = Math.round(value * HUE_CHECKPOINT_DENOMINATOR);
  if (!Number.isSafeInteger(encoded) || encoded < 0 || encoded > 0xffff) {
    throw new RangeError("Prepared Flocks checkpoint hue is outside [0, 1]");
  }
  return encoded;
}

function circularHueDelta(target, previous) {
  let delta = target - previous;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function wrapHue(value) {
  let result = value;
  if (result > 1) result -= 1;
  if (result < 0) result += 1;
  return result;
}

function readVector(values, offset) {
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function transportCrc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    if (index >= 28 && index < 32) continue;
    const byte = bytes[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
