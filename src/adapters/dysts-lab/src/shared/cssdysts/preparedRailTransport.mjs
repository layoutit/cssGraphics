// SPDX-License-Identifier: MIT

const MAGIC = "CSCHAO11";
const HEADER_BYTE_LENGTH = 32;
const VERSION = 11;
export const COORDINATE_SCALE = 10;
export const VIEWPORT_DEPTH = 600;
export const PERSPECTIVE_DISTANCE = 900;
export const PREPARED_POSITION_BIAS = 120;
export const PREPARED_DEPTH_BIAS = 500;

export function encodeChaosTrajectoryAsset({ descriptor, coordinates, leafPhaseIndices,
  leafRevealOrder, handoffControlCoordinates }) {
  if (!Number.isSafeInteger(descriptor?.systemIndex) || descriptor.systemIndex < 0 ||
      !Number.isSafeInteger(descriptor?.sampleCount) || descriptor.sampleCount < 1 ||
      !(coordinates instanceof Uint16Array) || coordinates.length !== descriptor.sampleCount * 3 ||
      !(leafPhaseIndices instanceof Uint16Array) ||
      leafPhaseIndices.length !== descriptor.starCount ||
      !(leafRevealOrder instanceof Uint16Array) ||
      leafRevealOrder.length !== descriptor.starCount ||
      !(handoffControlCoordinates instanceof Uint16Array) ||
      handoffControlCoordinates.length !== descriptor.handoffControlPointCount * 3) {
    throw new TypeError("Complete prepared Chaos trajectory values are required");
  }
  const output = new Uint8Array(
    HEADER_BYTE_LENGTH + coordinates.byteLength + leafPhaseIndices.byteLength +
      leafRevealOrder.byteLength + handoffControlCoordinates.byteLength);
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
  view.setUint32(24, HEADER_BYTE_LENGTH, true);
  view.setUint32(28, coordinates.byteLength, true);
  output.set(new Uint8Array(coordinates.buffer, coordinates.byteOffset, coordinates.byteLength),
    HEADER_BYTE_LENGTH);
  output.set(new Uint8Array(leafPhaseIndices.buffer, leafPhaseIndices.byteOffset,
    leafPhaseIndices.byteLength), HEADER_BYTE_LENGTH + coordinates.byteLength);
  output.set(new Uint8Array(leafRevealOrder.buffer, leafRevealOrder.byteOffset,
    leafRevealOrder.byteLength), HEADER_BYTE_LENGTH + coordinates.byteLength +
      leafPhaseIndices.byteLength);
  output.set(new Uint8Array(handoffControlCoordinates.buffer,
    handoffControlCoordinates.byteOffset, handoffControlCoordinates.byteLength),
  HEADER_BYTE_LENGTH + coordinates.byteLength +
      leafPhaseIndices.byteLength + leafRevealOrder.byteLength);
  return output;
}

export function decodeChaosTrajectoryAsset(bytes, descriptor) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < HEADER_BYTE_LENGTH) throw new Error("Chaos trajectory asset is truncated");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const magic = String.fromCharCode(...source.subarray(0, MAGIC.length));
  const coordinateOffset = view.getUint32(24, true);
  const coordinateByteLength = view.getUint32(28, true);
  if (magic !== MAGIC || view.getUint16(8, true) !== HEADER_BYTE_LENGTH ||
      view.getUint16(10, true) !== VERSION || view.getUint16(12, true) !== descriptor.systemIndex ||
      view.getUint16(14, true) !== descriptor.sampleCount ||
      view.getUint16(16, true) !== COORDINATE_SCALE ||
      view.getUint16(18, true) !== 800 || view.getUint16(20, true) !== 600 ||
      view.getUint16(22, true) !== descriptor.starCount || coordinateOffset !== HEADER_BYTE_LENGTH ||
      coordinateByteLength !== descriptor.sampleCount * 3 * Uint16Array.BYTES_PER_ELEMENT ||
      coordinateOffset + coordinateByteLength +
        descriptor.starCount * Uint16Array.BYTES_PER_ELEMENT * 2 +
        descriptor.handoffControlPointCount * 3 * Uint16Array.BYTES_PER_ELEMENT !==
          source.byteLength ||
      source.byteLength !== descriptor.decodedByteLength) {
    throw new Error(`Chaos trajectory ${descriptor.name} binary contract drifted`);
  }
  return Object.freeze({
    coordinates: new Uint16Array(source.buffer, source.byteOffset + coordinateOffset,
      coordinateByteLength / Uint16Array.BYTES_PER_ELEMENT),
    leafPhaseIndices: new Uint16Array(source.buffer,
      source.byteOffset + coordinateOffset + coordinateByteLength, descriptor.starCount),
    leafRevealOrder: new Uint16Array(source.buffer,
      source.byteOffset + coordinateOffset + coordinateByteLength +
        descriptor.starCount * Uint16Array.BYTES_PER_ELEMENT, descriptor.starCount),
    handoffControlCoordinates: new Uint16Array(source.buffer,
      source.byteOffset + coordinateOffset + coordinateByteLength +
        descriptor.starCount * Uint16Array.BYTES_PER_ELEMENT * 2,
      descriptor.handoffControlPointCount * 3),
  });
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
