// SPDX-License-Identifier: MIT

export const CSSBLACKHOLE_RAIL_ENCODING =
  "http-brotli-luminet-source-rails-plus-prepared-sparse-collision-repairs@1";
export const CSSBLACKHOLE_RAIL_ASSET_SCHEMA = "cssblackhole-prepared-source-rails@1";
export const CSSBLACKHOLE_REPAIR_BANK_SCHEMA = "cssblackhole-prepared-repair-bank@1";

const RAIL_MAGIC = "CSBLKHR1";
const RAIL_VERSION = 1;
const RAIL_HEADER_BYTE_LENGTH = 96;
const REPAIR_MAGIC = "CSBLKHRP";
const REPAIR_VERSION = 1;
const REPAIR_HEADER_BYTE_LENGTH = 64;
const COORDINATE_SCALE = 10;
const DESCRIPTOR_PHASE_BITS = 13;
const DESCRIPTOR_PHASE_MASK = (1 << DESCRIPTOR_PHASE_BITS) - 1;
const DESCRIPTOR_RADIUS_SHIFT = DESCRIPTOR_PHASE_BITS;
const DESCRIPTOR_ORDER_SHIFT = 17;
const REPAIR_LEAF_BITS = 11;
const REPAIR_LEAF_MASK = (1 << REPAIR_LEAF_BITS) - 1;
const REPAIR_DIRECTION_SHIFT = REPAIR_LEAF_BITS;
const REPAIR_RADIUS_SHIFT = 14;
const REPAIR_DIRECTIONS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
  Object.freeze([1, 1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, -1]),
]);

export function encodeBlackHolePreparedRailAsset({
  transportSeed,
  starCount,
  configurationCount,
  sourceConfigurationIndex,
  imageOrderCount,
  radiusCount,
  sourceFrameCount,
  transitionFrameCount,
  railCoordinates,
  railLuminances,
  particleOrders,
  particleRadiusIndices,
  particlePhaseFrameIndices,
  particlePeriodicOrbitCounts,
  selectedSourcePointIndices,
  periodicOrbitCounts,
}) {
  const railSampleCount = imageOrderCount * radiusCount * sourceFrameCount;
  if (!Number.isSafeInteger(transportSeed) || transportSeed < 1 ||
      !Number.isSafeInteger(starCount) || starCount < 1 || starCount > REPAIR_LEAF_MASK ||
      configurationCount !== 3 || !Number.isSafeInteger(sourceConfigurationIndex) ||
      sourceConfigurationIndex < 0 || sourceConfigurationIndex >= configurationCount ||
      imageOrderCount !== 2 || radiusCount !== 16 ||
      sourceFrameCount !== 5_400 || transitionFrameCount !== 120 ||
      !(railCoordinates instanceof Uint16Array) ||
      railCoordinates.length !== railSampleCount * 2 ||
      !(railLuminances instanceof Uint8Array) || railLuminances.length !== railSampleCount ||
      !Array.isArray(particleOrders) || !Array.isArray(particleRadiusIndices) ||
      !Array.isArray(particlePhaseFrameIndices) || !Array.isArray(particlePeriodicOrbitCounts) ||
      particleOrders.length !== 3_000 || particleRadiusIndices.length !== 3_000 ||
      particlePhaseFrameIndices.length !== 3_000 || particlePeriodicOrbitCounts.length !== 3_000 ||
      !Array.isArray(selectedSourcePointIndices) || selectedSourcePointIndices.length !== starCount ||
      !Array.isArray(periodicOrbitCounts) || periodicOrbitCounts.length !== radiusCount) {
    throw new TypeError("Complete prepared Luminet rail values are required");
  }
  const coordinateByteLength = railCoordinates.byteLength;
  const luminanceByteLength = railLuminances.byteLength;
  const descriptorByteLength = starCount * Uint32Array.BYTES_PER_ELEMENT;
  const easingByteLength = transitionFrameCount * Float64Array.BYTES_PER_ELEMENT;
  const orbitCountByteLength = radiusCount;
  const coordinateOffset = RAIL_HEADER_BYTE_LENGTH;
  const luminanceOffset = coordinateOffset + coordinateByteLength;
  const descriptorOffset = align(luminanceOffset + luminanceByteLength, 4);
  const easingOffset = align(descriptorOffset + descriptorByteLength, 8);
  const orbitCountOffset = easingOffset + easingByteLength;
  const bytes = new Uint8Array(orbitCountOffset + orbitCountByteLength);
  const view = new DataView(bytes.buffer);
  writeMagic(bytes, RAIL_MAGIC);
  view.setUint16(8, RAIL_HEADER_BYTE_LENGTH, true);
  view.setUint16(10, RAIL_VERSION, true);
  view.setUint32(12, transportSeed, true);
  view.setUint16(16, starCount, true);
  view.setUint8(18, configurationCount);
  view.setUint8(19, imageOrderCount);
  view.setUint16(20, radiusCount, true);
  view.setUint16(22, sourceFrameCount, true);
  view.setUint16(24, transitionFrameCount, true);
  view.setUint16(26, COORDINATE_SCALE, true);
  view.setUint32(28, coordinateOffset, true);
  view.setUint32(32, coordinateByteLength, true);
  view.setUint32(36, luminanceOffset, true);
  view.setUint32(40, luminanceByteLength, true);
  view.setUint32(44, descriptorOffset, true);
  view.setUint32(48, descriptorByteLength, true);
  view.setUint32(52, easingOffset, true);
  view.setUint32(56, easingByteLength, true);
  view.setUint32(60, orbitCountOffset, true);
  view.setUint32(64, orbitCountByteLength, true);
  view.setUint8(68, sourceConfigurationIndex);
  view.setUint8(69, 1);
  bytes.set(new Uint8Array(
    railCoordinates.buffer, railCoordinates.byteOffset, railCoordinates.byteLength), coordinateOffset);
  bytes.set(railLuminances, luminanceOffset);
  for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
    const sourceIndex = selectedSourcePointIndices[leafIndex];
    const order = particleOrders[sourceIndex];
    const radiusIndex = particleRadiusIndices[sourceIndex];
    const phaseFrameIndex = particlePhaseFrameIndices[sourceIndex];
    const turns = particlePeriodicOrbitCounts[sourceIndex];
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= 3_000 ||
        !Number.isSafeInteger(order) || order < 0 || order >= imageOrderCount ||
        !Number.isSafeInteger(radiusIndex) || radiusIndex < 0 || radiusIndex >= radiusCount ||
        !Number.isSafeInteger(phaseFrameIndex) || phaseFrameIndex < 0 ||
        phaseFrameIndex >= sourceFrameCount || turns !== periodicOrbitCounts[radiusIndex]) {
      throw new Error(`Luminet selected rail descriptor ${leafIndex} drifted`);
    }
    const packed = phaseFrameIndex | radiusIndex << DESCRIPTOR_RADIUS_SHIFT |
      order << DESCRIPTOR_ORDER_SHIFT;
    view.setUint32(descriptorOffset + leafIndex * 4, packed, true);
  }
  for (let transitionIndex = 0; transitionIndex < transitionFrameCount; transitionIndex += 1) {
    const progress = (transitionIndex + 1) / transitionFrameCount;
    view.setFloat64(
      easingOffset + transitionIndex * 8,
      progress * progress * (3 - 2 * progress),
      true,
    );
  }
  for (let radiusIndex = 0; radiusIndex < radiusCount; radiusIndex += 1) {
    const turns = periodicOrbitCounts[radiusIndex];
    if (!Number.isSafeInteger(turns) || turns < 1 || turns > 0xff) {
      throw new Error(`Luminet periodic orbit ${radiusIndex} drifted`);
    }
    bytes[orbitCountOffset + radiusIndex] = turns;
  }
  return bytes;
}

export function readBlackHolePreparedRailAsset(bytes, descriptor, catalog) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < RAIL_HEADER_BYTE_LENGTH || readMagic(source) !== RAIL_MAGIC) {
    throw new Error("BlackHole source rail binary header drifted");
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const coordinateOffset = view.getUint32(28, true);
  const coordinateByteLength = view.getUint32(32, true);
  const luminanceOffset = view.getUint32(36, true);
  const luminanceByteLength = view.getUint32(40, true);
  const descriptorOffset = view.getUint32(44, true);
  const descriptorByteLength = view.getUint32(48, true);
  const easingOffset = view.getUint32(52, true);
  const easingByteLength = view.getUint32(56, true);
  const orbitCountOffset = view.getUint32(60, true);
  const orbitCountByteLength = view.getUint32(64, true);
  const railSampleCount = descriptor.imageOrderCount * descriptor.radiusCount *
    descriptor.sourceFrameCount;
  if (view.getUint16(8, true) !== RAIL_HEADER_BYTE_LENGTH ||
      view.getUint16(10, true) !== RAIL_VERSION ||
      view.getUint32(12, true) !== catalog.transportSeed ||
      view.getUint16(16, true) !== catalog.starCount ||
      view.getUint8(18) !== catalog.configurationCount ||
      view.getUint8(19) !== descriptor.imageOrderCount ||
      view.getUint16(20, true) !== descriptor.radiusCount ||
      view.getUint16(22, true) !== descriptor.sourceFrameCount ||
      view.getUint16(24, true) !== catalog.configurationLoop.transitionFrameCount ||
      view.getUint16(26, true) !== COORDINATE_SCALE ||
      view.getUint8(68) !== descriptor.configurationIndex || view.getUint8(69) !== 1 ||
      coordinateOffset !== RAIL_HEADER_BYTE_LENGTH ||
      coordinateByteLength !== railSampleCount * 2 * Uint16Array.BYTES_PER_ELEMENT ||
      luminanceOffset !== coordinateOffset + coordinateByteLength ||
      luminanceByteLength !== railSampleCount ||
      descriptorOffset !== align(luminanceOffset + luminanceByteLength, 4) ||
      descriptorByteLength !== catalog.starCount * Uint32Array.BYTES_PER_ELEMENT ||
      easingOffset !== align(descriptorOffset + descriptorByteLength, 8) ||
      easingByteLength !== catalog.configurationLoop.transitionFrameCount *
        Float64Array.BYTES_PER_ELEMENT ||
      orbitCountOffset !== easingOffset + easingByteLength ||
      orbitCountByteLength !== descriptor.radiusCount ||
      orbitCountOffset + orbitCountByteLength !== source.byteLength ||
      descriptor.decodedByteLength !== source.byteLength) {
    throw new Error("BlackHole source rail binary contract drifted");
  }
  return Object.freeze({
    bytes: source,
    imageOrderCount: descriptor.imageOrderCount,
    radiusCount: descriptor.radiusCount,
    sourceFrameCount: descriptor.sourceFrameCount,
    sourceConfigurationIndex: descriptor.configurationIndex,
    coordinates: new Uint16Array(
      source.buffer, source.byteOffset + coordinateOffset, coordinateByteLength / 2),
    luminances: source.subarray(luminanceOffset, luminanceOffset + luminanceByteLength),
    descriptors: new Uint32Array(
      source.buffer, source.byteOffset + descriptorOffset, descriptorByteLength / 4),
    easing: new Float64Array(
      source.buffer, source.byteOffset + easingOffset, easingByteLength / 8),
    periodicOrbitCounts: source.subarray(
      orbitCountOffset, orbitCountOffset + orbitCountByteLength),
  });
}

export function encodeBlackHolePreparedRepairBank({
  transportSeed,
  starCount,
  bankIndex,
  startFrameIndex,
  frameCount,
  blockFrameCount,
  rawCoordinates,
  repairedCoordinates,
}) {
  if (!Number.isSafeInteger(transportSeed) || transportSeed < 1 ||
      !Number.isSafeInteger(starCount) || starCount < 1 || starCount > REPAIR_LEAF_MASK ||
      !Number.isSafeInteger(bankIndex) || bankIndex < 0 || bankIndex > 0xffff ||
      !Number.isSafeInteger(startFrameIndex) || startFrameIndex < 0 ||
      !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 0xffff ||
      !Number.isSafeInteger(blockFrameCount) || blockFrameCount < 1 ||
      frameCount % blockFrameCount !== 0 ||
      !(rawCoordinates instanceof Int32Array) || !(repairedCoordinates instanceof Int32Array) ||
      rawCoordinates.length !== frameCount * starCount * 2 ||
      repairedCoordinates.length !== rawCoordinates.length) {
    throw new TypeError("Complete prepared Luminet repair-bank values are required");
  }
  const frameOffsets = new Uint16Array(frameCount + 1);
  const entries = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
      const coordinateOffset = (frameIndex * starCount + leafIndex) * 2;
      const deltaX = repairedCoordinates[coordinateOffset] - rawCoordinates[coordinateOffset];
      const deltaY = repairedCoordinates[coordinateOffset + 1] - rawCoordinates[coordinateOffset + 1];
      if (deltaX === 0 && deltaY === 0) continue;
      entries.push(packRepair(leafIndex, deltaX, deltaY));
    }
    if (entries.length > 0xffff) {
      throw new RangeError("Luminet repair bank exceeded uint16 frame offsets");
    }
    frameOffsets[frameIndex + 1] = entries.length;
  }
  const frameOffsetByteLength = frameOffsets.byteLength;
  const entryByteLength = entries.length * Uint32Array.BYTES_PER_ELEMENT;
  const frameOffsetOffset = REPAIR_HEADER_BYTE_LENGTH;
  const entryOffset = align(frameOffsetOffset + frameOffsetByteLength, 4);
  const bytes = new Uint8Array(entryOffset + entryByteLength);
  const view = new DataView(bytes.buffer);
  writeMagic(bytes, REPAIR_MAGIC);
  view.setUint16(8, REPAIR_HEADER_BYTE_LENGTH, true);
  view.setUint16(10, REPAIR_VERSION, true);
  view.setUint32(12, transportSeed, true);
  view.setUint16(16, starCount, true);
  view.setUint16(18, bankIndex, true);
  view.setUint32(20, startFrameIndex, true);
  view.setUint16(24, frameCount, true);
  view.setUint16(26, blockFrameCount, true);
  view.setUint32(28, entries.length, true);
  view.setUint32(32, frameOffsetOffset, true);
  view.setUint32(36, frameOffsetByteLength, true);
  view.setUint32(40, entryOffset, true);
  view.setUint32(44, entryByteLength, true);
  view.setUint16(48, COORDINATE_SCALE, true);
  for (let index = 0; index < frameOffsets.length; index += 1) {
    view.setUint16(frameOffsetOffset + index * 2, frameOffsets[index], true);
  }
  for (let index = 0; index < entries.length; index += 1) {
    view.setUint32(entryOffset + index * 4, entries[index], true);
  }
  return bytes;
}

export function readBlackHolePreparedRepairBank(bytes, descriptor, catalog) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < REPAIR_HEADER_BYTE_LENGTH || readMagic(source) !== REPAIR_MAGIC) {
    throw new Error(`BlackHole repair bank ${descriptor?.index ?? "unknown"} header drifted`);
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const repairCount = view.getUint32(28, true);
  const frameOffsetOffset = view.getUint32(32, true);
  const frameOffsetByteLength = view.getUint32(36, true);
  const entryOffset = view.getUint32(40, true);
  const entryByteLength = view.getUint32(44, true);
  if (view.getUint16(8, true) !== REPAIR_HEADER_BYTE_LENGTH ||
      view.getUint16(10, true) !== REPAIR_VERSION ||
      view.getUint32(12, true) !== catalog.transportSeed ||
      view.getUint16(16, true) !== catalog.starCount ||
      view.getUint16(18, true) !== descriptor.index ||
      view.getUint32(20, true) !== descriptor.startFrameIndex ||
      view.getUint16(24, true) !== descriptor.frameCount ||
      view.getUint16(26, true) !== catalog.blockFrameCount ||
      repairCount !== descriptor.preparedCollisionRepairCount ||
      frameOffsetOffset !== REPAIR_HEADER_BYTE_LENGTH ||
      frameOffsetByteLength !== (descriptor.frameCount + 1) * 2 ||
      entryOffset !== align(frameOffsetOffset + frameOffsetByteLength, 4) ||
      entryByteLength !== repairCount * 4 || entryOffset + entryByteLength !== source.byteLength ||
      view.getUint16(48, true) !== COORDINATE_SCALE ||
      descriptor.decodedByteLength !== source.byteLength) {
    throw new Error(`BlackHole repair bank ${descriptor.index} contract drifted`);
  }
  const frameOffsets = new Uint16Array(descriptor.frameCount + 1);
  for (let index = 0; index < frameOffsets.length; index += 1) {
    frameOffsets[index] = view.getUint16(frameOffsetOffset + index * 2, true);
  }
  const packedRepairs = new Uint32Array(repairCount);
  for (let index = 0; index < repairCount; index += 1) {
    packedRepairs[index] = view.getUint32(entryOffset + index * 4, true);
  }
  if (frameOffsets[0] !== 0 || frameOffsets.at(-1) !== repairCount) {
    throw new Error(`BlackHole repair bank ${descriptor.index} offsets drifted`);
  }
  return Object.freeze({ frameOffsets, packedRepairs });
}

export function unpackBlackHolePreparedRailDescriptor(packed) {
  return Object.freeze({
    phaseFrameIndex: packed & DESCRIPTOR_PHASE_MASK,
    radiusIndex: packed >> DESCRIPTOR_RADIUS_SHIFT & 0xf,
    order: packed >> DESCRIPTOR_ORDER_SHIFT & 0x1,
  });
}

export function unpackBlackHolePreparedRepair(packed) {
  const radius = (packed >> REPAIR_RADIUS_SHIFT & 0x7) + 1;
  const direction = REPAIR_DIRECTIONS[packed >> REPAIR_DIRECTION_SHIFT & 0x7];
  return Object.freeze({
    leafIndex: packed & REPAIR_LEAF_MASK,
    deltaX: direction[0] * COORDINATE_SCALE * radius,
    deltaY: direction[1] * COORDINATE_SCALE * radius,
  });
}

function packRepair(leafIndex, deltaX, deltaY) {
  if (deltaX % COORDINATE_SCALE !== 0 || deltaY % COORDINATE_SCALE !== 0) {
    throw new Error("Luminet prepared repair lost tenth-pixel grid alignment");
  }
  const unitX = deltaX / COORDINATE_SCALE;
  const unitY = deltaY / COORDINATE_SCALE;
  const radius = Math.max(Math.abs(unitX), Math.abs(unitY));
  const directionX = Math.sign(unitX);
  const directionY = Math.sign(unitY);
  const directionIndex = REPAIR_DIRECTIONS.findIndex(
    ([candidateX, candidateY]) => candidateX === directionX && candidateY === directionY);
  if (leafIndex < 0 || leafIndex > REPAIR_LEAF_MASK || radius < 1 || radius > 8 ||
      directionIndex < 0 ||
      (directionX !== 0 && Math.abs(unitX) !== radius) ||
      (directionY !== 0 && Math.abs(unitY) !== radius)) {
    throw new Error(`Luminet prepared repair for leaf ${leafIndex} drifted`);
  }
  return leafIndex | directionIndex << REPAIR_DIRECTION_SHIFT |
    (radius - 1) << REPAIR_RADIUS_SHIFT;
}

function writeMagic(bytes, magic) {
  for (let index = 0; index < magic.length; index += 1) bytes[index] = magic.charCodeAt(index);
}

function readMagic(bytes) {
  return String.fromCharCode(...bytes.subarray(0, 8));
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}
