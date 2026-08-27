// SPDX-License-Identifier: MIT

const MAGIC = "CSCHAO12";
const HEADER_BYTE_LENGTH = 64;
const VERSION = 12;
const AXIS_DIRECTORY_BYTE_LENGTH = 12;
const REVEAL_INDEX_BITS = 11;
export const CSSCHAOS_TRANSPORT_ENCODING =
  "axis-split-zigzag-varint-second-difference-u16-plus-sorted-phase-ranks-packed-reveal@1";
export const COORDINATE_SCALE = 10;
export const VIEWPORT_DEPTH = 600;
export const PERSPECTIVE_DISTANCE = 900;
export const PREPARED_POSITION_BIAS = 120;
export const PREPARED_DEPTH_BIAS = 500;

export function encodeChaosTrajectoryAsset({ descriptor, coordinates, leafPhaseIndices,
  leafRevealOrder, handoffControlCoordinates }) {
  validatePreparedValues({ descriptor, coordinates, leafPhaseIndices, leafRevealOrder,
    handoffControlCoordinates });
  const trajectory = encodeAxisSecondDifferences(coordinates, descriptor.sampleCount);
  const phaseRanks = encodeSortedPhaseRanks(leafPhaseIndices, leafRevealOrder);
  const revealOrder = packRevealOrder(leafRevealOrder);
  const handoffControls = encodeAxisSecondDifferences(
    handoffControlCoordinates, descriptor.handoffControlPointCount);
  const trajectoryOffset = HEADER_BYTE_LENGTH;
  const phaseRankOffset = trajectoryOffset + trajectory.byteLength;
  const revealOrderOffset = phaseRankOffset + phaseRanks.byteLength;
  const handoffControlOffset = revealOrderOffset + revealOrder.byteLength;
  const byteLength = handoffControlOffset + handoffControls.byteLength;
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) output[index] = MAGIC.charCodeAt(index);
  view.setUint16(8, HEADER_BYTE_LENGTH, true);
  view.setUint16(10, VERSION, true);
  view.setUint16(12, descriptor.systemIndex, true);
  view.setUint16(14, descriptor.sampleCount, true);
  view.setUint16(16, COORDINATE_SCALE, true);
  view.setUint16(18, 800, true);
  view.setUint16(20, 600, true);
  view.setUint16(22, descriptor.starCount, true);
  view.setUint32(24, trajectoryOffset, true);
  view.setUint32(28, trajectory.byteLength, true);
  view.setUint32(32, phaseRankOffset, true);
  view.setUint32(36, phaseRanks.byteLength, true);
  view.setUint32(40, revealOrderOffset, true);
  view.setUint32(44, revealOrder.byteLength, true);
  view.setUint32(48, handoffControlOffset, true);
  view.setUint32(52, handoffControls.byteLength, true);
  view.setUint16(56, descriptor.handoffControlPointCount, true);
  view.setUint16(58, REVEAL_INDEX_BITS, true);
  view.setUint32(60, byteLength, true);
  output.set(trajectory, trajectoryOffset);
  output.set(phaseRanks, phaseRankOffset);
  output.set(revealOrder, revealOrderOffset);
  output.set(handoffControls, handoffControlOffset);
  return output;
}

export function decodeChaosTrajectoryAsset(bytes, descriptor) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < HEADER_BYTE_LENGTH) throw new Error("Chaos trajectory asset is truncated");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const magic = String.fromCharCode(...source.subarray(0, MAGIC.length));
  const trajectoryOffset = view.getUint32(24, true);
  const trajectoryByteLength = view.getUint32(28, true);
  const phaseRankOffset = view.getUint32(32, true);
  const phaseRankByteLength = view.getUint32(36, true);
  const revealOrderOffset = view.getUint32(40, true);
  const revealOrderByteLength = view.getUint32(44, true);
  const handoffControlOffset = view.getUint32(48, true);
  const handoffControlByteLength = view.getUint32(52, true);
  const expectedMaterializedByteLength = descriptor.sampleCount * 3 * 2 +
    descriptor.starCount * 2 * 2 + descriptor.handoffControlPointCount * 3 * 2;
  if (magic !== MAGIC || view.getUint16(8, true) !== HEADER_BYTE_LENGTH ||
      view.getUint16(10, true) !== VERSION || view.getUint16(12, true) !== descriptor.systemIndex ||
      view.getUint16(14, true) !== descriptor.sampleCount ||
      view.getUint16(16, true) !== COORDINATE_SCALE ||
      view.getUint16(18, true) !== 800 || view.getUint16(20, true) !== 600 ||
      view.getUint16(22, true) !== descriptor.starCount ||
      view.getUint16(56, true) !== descriptor.handoffControlPointCount ||
      view.getUint16(58, true) !== REVEAL_INDEX_BITS || view.getUint32(60, true) !== source.byteLength ||
      trajectoryOffset !== HEADER_BYTE_LENGTH || trajectoryByteLength < AXIS_DIRECTORY_BYTE_LENGTH ||
      phaseRankOffset !== trajectoryOffset + trajectoryByteLength || phaseRankByteLength < 1 ||
      revealOrderOffset !== phaseRankOffset + phaseRankByteLength ||
      revealOrderByteLength !== Math.ceil(descriptor.starCount * REVEAL_INDEX_BITS / 8) ||
      handoffControlOffset !== revealOrderOffset + revealOrderByteLength ||
      handoffControlByteLength < AXIS_DIRECTORY_BYTE_LENGTH ||
      handoffControlOffset + handoffControlByteLength !== source.byteLength ||
      source.byteLength !== descriptor.decodedByteLength ||
      descriptor.materializedByteLength !== expectedMaterializedByteLength ||
      descriptor.contentEncoding !== "br" ||
      descriptor.transportEncoding !== CSSCHAOS_TRANSPORT_ENCODING) {
    throw new Error(`Chaos trajectory ${descriptor.name} binary contract drifted`);
  }
  const materialized = new ArrayBuffer(expectedMaterializedByteLength);
  const coordinateByteLength = descriptor.sampleCount * 3 * 2;
  const phaseByteLength = descriptor.starCount * 2;
  const coordinates = new Uint16Array(materialized, 0, descriptor.sampleCount * 3);
  const leafPhaseIndices = new Uint16Array(
    materialized, coordinateByteLength, descriptor.starCount);
  const leafRevealOrder = new Uint16Array(
    materialized, coordinateByteLength + phaseByteLength, descriptor.starCount);
  const handoffControlCoordinates = new Uint16Array(
    materialized, coordinateByteLength + phaseByteLength * 2,
    descriptor.handoffControlPointCount * 3);
  decodeAxisSecondDifferences(
    source, trajectoryOffset, trajectoryByteLength, descriptor.sampleCount, coordinates);
  unpackRevealOrder(
    source, revealOrderOffset, revealOrderByteLength, descriptor.starCount, leafRevealOrder);
  decodeSortedPhaseRanks(source, phaseRankOffset, phaseRankByteLength,
    descriptor.sampleCount, leafRevealOrder, leafPhaseIndices);
  decodeAxisSecondDifferences(source, handoffControlOffset, handoffControlByteLength,
    descriptor.handoffControlPointCount, handoffControlCoordinates);
  return Object.freeze({ coordinates, leafPhaseIndices, leafRevealOrder,
    handoffControlCoordinates });
}

function validatePreparedValues({ descriptor, coordinates, leafPhaseIndices,
  leafRevealOrder, handoffControlCoordinates }) {
  if (!Number.isSafeInteger(descriptor?.systemIndex) || descriptor.systemIndex < 0 ||
      !Number.isSafeInteger(descriptor?.sampleCount) || descriptor.sampleCount < 2 ||
      !Number.isSafeInteger(descriptor?.starCount) || descriptor.starCount < 1 ||
      descriptor.starCount > 2 ** REVEAL_INDEX_BITS ||
      !Number.isSafeInteger(descriptor?.handoffControlPointCount) ||
      descriptor.handoffControlPointCount < 2 ||
      !(coordinates instanceof Uint16Array) || coordinates.length !== descriptor.sampleCount * 3 ||
      !(leafPhaseIndices instanceof Uint16Array) ||
      leafPhaseIndices.length !== descriptor.starCount ||
      !(leafRevealOrder instanceof Uint16Array) ||
      leafRevealOrder.length !== descriptor.starCount ||
      !(handoffControlCoordinates instanceof Uint16Array) ||
      handoffControlCoordinates.length !== descriptor.handoffControlPointCount * 3) {
    throw new TypeError("Complete prepared Chaos trajectory values are required");
  }
}

function encodeAxisSecondDifferences(values, count) {
  const axes = Array.from({ length: 3 }, (_, axis) => {
    const encoded = [];
    pushVarUint(encoded, values[axis]);
    let previousValue = values[axis];
    let previousDelta = values[3 + axis] - previousValue;
    pushVarUint(encoded, zigZag(previousDelta));
    previousValue = values[3 + axis];
    for (let index = 2; index < count; index += 1) {
      const value = values[index * 3 + axis];
      const delta = value - previousValue;
      pushVarUint(encoded, zigZag(delta - previousDelta));
      previousValue = value;
      previousDelta = delta;
    }
    return Uint8Array.from(encoded);
  });
  const output = new Uint8Array(
    AXIS_DIRECTORY_BYTE_LENGTH + axes.reduce((sum, axis) => sum + axis.byteLength, 0));
  const view = new DataView(output.buffer);
  let offset = AXIS_DIRECTORY_BYTE_LENGTH;
  for (let axis = 0; axis < axes.length; axis += 1) {
    view.setUint32(axis * 4, axes[axis].byteLength, true);
    output.set(axes[axis], offset);
    offset += axes[axis].byteLength;
  }
  return output;
}

function decodeAxisSecondDifferences(source, offset, byteLength, count, target) {
  const section = source.subarray(offset, offset + byteLength);
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  let axisOffset = AXIS_DIRECTORY_BYTE_LENGTH;
  for (let axis = 0; axis < 3; axis += 1) {
    const axisByteLength = view.getUint32(axis * 4, true);
    const axisEnd = axisOffset + axisByteLength;
    if (axisByteLength < 2 || axisEnd > section.byteLength) {
      throw new Error("Chaos coordinate axis directory drifted");
    }
    const cursor = { offset: axisOffset };
    let value = readVarUint(section, cursor, axisEnd);
    if (value > 0xffff) throw new Error("Chaos coordinate exceeded Uint16 range");
    target[axis] = value;
    let previousDelta = unZigZag(readVarUint(section, cursor, axisEnd));
    value += previousDelta;
    if (value < 0 || value > 0xffff) throw new Error("Chaos coordinate exceeded Uint16 range");
    target[3 + axis] = value;
    for (let index = 2; index < count; index += 1) {
      const secondDifference = unZigZag(readVarUint(section, cursor, axisEnd));
      previousDelta += secondDifference;
      value += previousDelta;
      if (value < 0 || value > 0xffff) throw new Error("Chaos coordinate exceeded Uint16 range");
      target[index * 3 + axis] = value;
    }
    if (cursor.offset !== axisEnd) throw new Error("Chaos coordinate axis has trailing bytes");
    axisOffset = axisEnd;
  }
  if (axisOffset !== section.byteLength) throw new Error("Chaos coordinate section drifted");
}

function encodeSortedPhaseRanks(leafPhaseIndices, leafRevealOrder) {
  const output = [];
  let previous = -1;
  for (let rank = 0; rank < leafRevealOrder.length; rank += 1) {
    const phase = leafPhaseIndices[leafRevealOrder[rank]];
    if (phase <= previous) throw new Error("Chaos prepared source phases are not strictly ranked");
    pushVarUint(output, rank === 0 ? phase : phase - previous);
    previous = phase;
  }
  return Uint8Array.from(output);
}

function decodeSortedPhaseRanks(source, offset, byteLength, sampleCount,
  leafRevealOrder, leafPhaseIndices) {
  const cursor = { offset };
  const end = offset + byteLength;
  let phase = -1;
  for (let rank = 0; rank < leafRevealOrder.length; rank += 1) {
    const encoded = readVarUint(source, cursor, end);
    phase = rank === 0 ? encoded : phase + encoded;
    if (phase < 0 || phase >= sampleCount || (rank > 0 && encoded === 0)) {
      throw new Error("Chaos prepared source phase rank drifted");
    }
    leafPhaseIndices[leafRevealOrder[rank]] = phase;
  }
  if (cursor.offset !== end) throw new Error("Chaos prepared source phases have trailing bytes");
}

function packRevealOrder(values) {
  const output = new Uint8Array(Math.ceil(values.length * REVEAL_INDEX_BITS / 8));
  let accumulator = 0;
  let availableBits = 0;
  let outputIndex = 0;
  const seen = new Uint8Array(values.length);
  for (const value of values) {
    if (value >= values.length || seen[value]) throw new Error("Chaos reveal order is not a permutation");
    seen[value] = 1;
    accumulator += value * 2 ** availableBits;
    availableBits += REVEAL_INDEX_BITS;
    while (availableBits >= 8) {
      output[outputIndex++] = accumulator % 256;
      accumulator = Math.floor(accumulator / 256);
      availableBits -= 8;
    }
  }
  if (availableBits > 0) output[outputIndex] = accumulator;
  return output;
}

function unpackRevealOrder(source, offset, byteLength, count, target) {
  const end = offset + byteLength;
  let inputIndex = offset;
  let accumulator = 0;
  let availableBits = 0;
  const mask = 2 ** REVEAL_INDEX_BITS;
  const seen = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    while (availableBits < REVEAL_INDEX_BITS) {
      if (inputIndex >= end) throw new Error("Chaos reveal order ended early");
      accumulator += source[inputIndex++] * 2 ** availableBits;
      availableBits += 8;
    }
    const value = accumulator % mask;
    accumulator = Math.floor(accumulator / mask);
    availableBits -= REVEAL_INDEX_BITS;
    if (value >= count || seen[value]) throw new Error("Chaos reveal order is not a permutation");
    seen[value] = 1;
    target[index] = value;
  }
  while (inputIndex < end) {
    accumulator += source[inputIndex++] * 2 ** availableBits;
    availableBits += 8;
  }
  if (accumulator !== 0) throw new Error("Chaos reveal order padding drifted");
}

function zigZag(value) {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function unZigZag(value) {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function pushVarUint(output, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Chaos varint value drifted");
  let remaining = value;
  while (remaining >= 0x80) {
    output.push(remaining % 0x80 | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
}

function readVarUint(bytes, cursor, end) {
  let value = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
    if (cursor.offset >= end) throw new Error("Chaos varint ended early");
    const byte = bytes[cursor.offset++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
  }
  throw new Error("Chaos varint exceeded its bound");
}

export function formatChaosTransform(x, y, z) {
  const centeredZ = (z - PREPARED_DEPTH_BIAS * COORDINATE_SCALE) / COORDINATE_SCALE;
  const depthScale = PERSPECTIVE_DISTANCE / (PERSPECTIVE_DISTANCE - centeredZ);
  const encodedPositionBias = PREPARED_POSITION_BIAS * COORDINATE_SCALE;
  const translation = `translate(${formatCoordinate(x - encodedPositionBias)}px,` +
    `${formatCoordinate(y - encodedPositionBias)}px)`;
  const formattedScale = formatScale(depthScale);
  return formattedScale === "1" ? translation : `${translation} scale(${formattedScale})`;
}

function formatCoordinate(value) {
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude / COORDINATE_SCALE);
  const decimal = magnitude % COORDINATE_SCALE;
  return decimal === 0 ? `${sign}${whole}` : `${sign}${whole}.${decimal}`;
}

function formatScale(value) {
  return String(Math.round(value * 10_000) / 10_000);
}
