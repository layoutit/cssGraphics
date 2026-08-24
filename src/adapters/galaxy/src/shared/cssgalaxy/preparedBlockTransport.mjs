// SPDX-License-Identifier: HPND

export const CSSGALAXY_BANK_ENCODING =
  "http-brotli-galaxy-leaf-major-axis-second-difference-decimal-blocks@6";
export const CSSGALAXY_BANK_SCHEMA = "cssgalaxy-prepared-stream-bank@6";
export const CSSGALAXY_BLOCK_SCHEMA = "cssgalaxy-materialized-playback-block@2";
export const CSSGALAXY_COORDINATE_SCALE = 10;
export const CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS = 0.05;
export const CSSGALAXY_HIDDEN_COORDINATE = -32_768 * CSSGALAXY_COORDINATE_SCALE;

const MAGIC = "CSGLXYB9";
const HEADER_BYTE_LENGTH = 64;
const DIRECTORY_ENTRY_BYTE_LENGTH = 20;
const VERSION = 6;
const SOURCE_COORDINATE_SCALE = 1_000;
const COORDINATE_DECIMAL_PLACES = 1;

export function encodeGalaxyPreparedBank({
  seed,
  starCount,
  galaxyCount,
  bankIndex,
  startFrameIndex,
  frameCount,
  blockFrameCount,
  coordinates,
}) {
  validatePreparedValues({
    seed, starCount, galaxyCount, bankIndex, startFrameIndex, frameCount,
    blockFrameCount, coordinates,
  });
  const blockCount = frameCount / blockFrameCount;
  const encodedBlocks = new Array(blockCount);
  let payloadByteLength = 0;
  let visibleSampleCount = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const block = encodeCoordinateBlock(
      coordinates, blockIndex * blockFrameCount, blockFrameCount, starCount);
    encodedBlocks[blockIndex] = block;
    payloadByteLength += block.bytes.byteLength;
    visibleSampleCount += block.visibleSampleCount;
  }
  const directoryByteLength = blockCount * DIRECTORY_ENTRY_BYTE_LENGTH;
  const bytes = new Uint8Array(HEADER_BYTE_LENGTH + directoryByteLength + payloadByteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  view.setUint16(8, HEADER_BYTE_LENGTH, true);
  view.setUint16(10, VERSION, true);
  view.setUint32(12, seed, true);
  view.setUint16(16, starCount, true);
  view.setUint8(18, galaxyCount);
  view.setUint8(19, bankIndex);
  view.setUint32(20, startFrameIndex, true);
  view.setUint16(24, frameCount, true);
  view.setUint16(26, blockFrameCount, true);
  view.setUint16(28, blockCount, true);
  view.setUint16(30, CSSGALAXY_COORDINATE_SCALE, true);
  view.setUint32(32, directoryByteLength, true);
  view.setUint32(36, payloadByteLength, true);
  view.setUint32(40, visibleSampleCount, true);
  let payloadOffset = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const block = encodedBlocks[blockIndex];
    const directoryOffset = HEADER_BYTE_LENGTH + blockIndex * DIRECTORY_ENTRY_BYTE_LENGTH;
    view.setUint32(directoryOffset, payloadOffset, true);
    view.setUint32(directoryOffset + 4, block.bytes.byteLength, true);
    view.setUint32(directoryOffset + 8, block.visibleSampleCount, true);
    view.setUint32(directoryOffset + 12, block.residualXByteLength, true);
    view.setUint16(directoryOffset + 16, blockFrameCount, true);
    view.setUint16(directoryOffset + 18, block.predictorOrder, true);
    bytes.set(block.bytes, HEADER_BYTE_LENGTH + directoryByteLength + payloadOffset);
    payloadOffset += block.bytes.byteLength;
  }
  if (payloadOffset !== payloadByteLength) throw new Error("Galaxy coordinate bank byte count drifted");
  return bytes;
}

export function readGalaxyPreparedBankSections(bytes, descriptor, catalog) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < HEADER_BYTE_LENGTH ||
      String.fromCharCode(...source.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new Error(`Galaxy bank ${descriptor?.index ?? "unknown"} binary header drifted`);
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const seed = view.getUint32(12, true);
  const starCount = view.getUint16(16, true);
  const galaxyCount = view.getUint8(18);
  const bankIndex = view.getUint8(19);
  const startFrameIndex = view.getUint32(20, true);
  const frameCount = view.getUint16(24, true);
  const blockFrameCount = view.getUint16(26, true);
  const blockCount = view.getUint16(28, true);
  const coordinateScale = view.getUint16(30, true);
  const directoryByteLength = view.getUint32(32, true);
  const payloadByteLength = view.getUint32(36, true);
  const visibleSampleCount = view.getUint32(40, true);
  if (view.getUint16(8, true) !== HEADER_BYTE_LENGTH || view.getUint16(10, true) !== VERSION ||
      seed !== catalog.selectedSeed || starCount !== catalog.starCount ||
      galaxyCount !== catalog.galaxyCount || bankIndex !== descriptor.index ||
      startFrameIndex !== descriptor.startFrameIndex || frameCount !== descriptor.frameCount ||
      frameCount !== catalog.bankFrameCount || blockFrameCount !== catalog.blockFrameCount ||
      blockCount !== catalog.blocksPerBank || coordinateScale !== CSSGALAXY_COORDINATE_SCALE ||
      directoryByteLength !== blockCount * DIRECTORY_ENTRY_BYTE_LENGTH ||
      HEADER_BYTE_LENGTH + directoryByteLength + payloadByteLength !== source.byteLength ||
      descriptor.decodedByteLength !== source.byteLength ||
      descriptor.blockCount !== blockCount || descriptor.visibleSampleCount !== visibleSampleCount ||
      descriptor.coordinateEncoding !==
        "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1") {
    throw new Error(`Galaxy bank ${descriptor.index} binary contract drifted`);
  }
  const payloadStart = HEADER_BYTE_LENGTH + directoryByteLength;
  const blocks = new Array(blockCount);
  let expectedPayloadOffset = 0;
  let countedVisibleSamples = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const directoryOffset = HEADER_BYTE_LENGTH + blockIndex * DIRECTORY_ENTRY_BYTE_LENGTH;
    const payloadOffset = view.getUint32(directoryOffset, true);
    const byteLength = view.getUint32(directoryOffset + 4, true);
    const blockVisibleSampleCount = view.getUint32(directoryOffset + 8, true);
    const residualXByteLength = view.getUint32(directoryOffset + 12, true);
    const blockFrames = view.getUint16(directoryOffset + 16, true);
    const predictorOrder = view.getUint16(directoryOffset + 18, true);
    const visibilityByteLength = Math.ceil(blockFrames * starCount / 8);
    const residualYByteLength = byteLength - visibilityByteLength - residualXByteLength;
    if (payloadOffset !== expectedPayloadOffset || residualXByteLength < 1 || residualYByteLength < 1 ||
        blockFrames !== blockFrameCount || predictorOrder !== 2 ||
        payloadOffset + byteLength > payloadByteLength ||
        blockVisibleSampleCount > blockFrames * starCount) {
      throw new Error(`Galaxy bank ${descriptor.index} block ${blockIndex} directory drifted`);
    }
    const blockStart = payloadStart + payloadOffset;
    blocks[blockIndex] = Object.freeze({
      bankBlockIndex: blockIndex,
      streamBlockIndex: bankIndex * blockCount + blockIndex,
      startFrameIndex: startFrameIndex + blockIndex * blockFrameCount,
      frameCount: blockFrames,
      visibleSampleCount: blockVisibleSampleCount,
      predictorOrder,
      visibilityBytes: source.subarray(blockStart, blockStart + visibilityByteLength),
      residualXBytes: source.subarray(
        blockStart + visibilityByteLength,
        blockStart + visibilityByteLength + residualXByteLength),
      residualYBytes: source.subarray(
        blockStart + visibilityByteLength + residualXByteLength,
        blockStart + byteLength),
    });
    expectedPayloadOffset += byteLength;
    countedVisibleSamples += blockVisibleSampleCount;
  }
  if (expectedPayloadOffset !== payloadByteLength || countedVisibleSamples !== visibleSampleCount) {
    throw new Error(`Galaxy bank ${descriptor.index} payload directory drifted`);
  }
  return Object.freeze({
    schema: CSSGALAXY_BANK_SCHEMA,
    seed,
    starCount,
    galaxyCount,
    bankIndex,
    startFrameIndex,
    frameCount,
    blockFrameCount,
    blockCount,
    coordinateScale,
    visibleSampleCount,
    blocks: Object.freeze(blocks),
  });
}

export function createGalaxyPreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog) {
  const block = bank?.blocks?.[bankBlockIndex];
  if (bank?.schema !== CSSGALAXY_BANK_SCHEMA || !block ||
      block.bankBlockIndex !== bankBlockIndex || bank.starCount !== catalog.starCount ||
      catalog.viewport?.width < 1 || catalog.viewport?.height < 1) {
    throw new Error("Galaxy prepared coordinate block binding drifted");
  }
  const sampleCount = block.frameCount * bank.starCount;
  const coordinates = new Int32Array(sampleCount * 2);
  coordinates.fill(CSSGALAXY_HIDDEN_COORDINATE);
  const residualXCursor = { offset: 0 };
  const residualYCursor = { offset: 0 };
  let sampleIndex = 0;
  let historyX1 = 0;
  let historyX2 = 0;
  let historyY1 = 0;
  let historyY2 = 0;
  let historyCount = 0;
  let decodedVisibleSampleCount = 0;
  let finished = false;

  function step(maximumSampleCount = 8_192) {
    if (finished) return true;
    if (!Number.isSafeInteger(maximumSampleCount) || maximumSampleCount < 1) {
      throw new RangeError("Galaxy coordinate decode slice is invalid");
    }
    const end = Math.min(sampleCount, sampleIndex + maximumSampleCount);
    for (; sampleIndex < end; sampleIndex += 1) {
      const leafIndex = Math.floor(sampleIndex / block.frameCount);
      const localFrameIndex = sampleIndex - leafIndex * block.frameCount;
      if (localFrameIndex === 0) {
        historyX1 = 0;
        historyX2 = 0;
        historyY1 = 0;
        historyY2 = 0;
        historyCount = 0;
      }
      if ((block.visibilityBytes[sampleIndex >> 3] & (1 << (sampleIndex & 7))) === 0) continue;
      const residualX = readSignedVarint(block.residualXBytes, residualXCursor);
      const residualY = readSignedVarint(block.residualYBytes, residualYCursor);
      const x = restoreCoordinate(residualX, historyCount, historyX1, historyX2);
      const y = restoreCoordinate(residualY, historyCount, historyY1, historyY2);
      if (x < 0 || x > catalog.viewport.width * CSSGALAXY_COORDINATE_SCALE ||
          y < 0 || y > catalog.viewport.height * CSSGALAXY_COORDINATE_SCALE) {
        throw new Error(`Galaxy block ${block.streamBlockIndex} decoded coordinate drifted at ` +
          `frame ${localFrameIndex}, leaf ${leafIndex}: ${x},${y} from ${residualX},${residualY}`);
      }
      const coordinateOffset = (localFrameIndex * bank.starCount + leafIndex) * 2;
      coordinates[coordinateOffset] = x;
      coordinates[coordinateOffset + 1] = y;
      historyX2 = historyX1;
      historyX1 = x;
      historyY2 = historyY1;
      historyY1 = y;
      if (historyCount < 2) historyCount += 1;
      decodedVisibleSampleCount += 1;
    }
    if (sampleIndex !== sampleCount) return false;
    if (decodedVisibleSampleCount !== block.visibleSampleCount ||
        residualXCursor.offset !== block.residualXBytes.byteLength ||
        residualYCursor.offset !== block.residualYBytes.byteLength) {
      throw new Error(`Galaxy block ${block.streamBlockIndex} residual cardinality drifted`);
    }
    finished = true;
    return true;
  }

  return Object.freeze({
    block,
    coordinates,
    step,
    get finished() { return finished; },
  });
}

export function decodeGalaxyPreparedBlock(bank, bankBlockIndex, catalog) {
  const decoder = createGalaxyPreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
  while (!decoder.step()) {}
  const transforms = new Array(decoder.block.frameCount * bank.starCount);
  for (let sampleIndex = 0; sampleIndex < transforms.length; sampleIndex += 1) {
    const coordinateOffset = sampleIndex * 2;
    transforms[sampleIndex] = formatGalaxyPreparedTransform(
      decoder.coordinates[coordinateOffset], decoder.coordinates[coordinateOffset + 1]);
  }
  return Object.freeze({
    schema: CSSGALAXY_BLOCK_SCHEMA,
    index: decoder.block.streamBlockIndex,
    startFrameIndex: decoder.block.startFrameIndex,
    frameCount: decoder.block.frameCount,
    starCount: bank.starCount,
    coordinates: decoder.coordinates,
    transforms: Object.freeze(transforms),
  });
}

export function decodeGalaxyPreparedBank(bytes, descriptor, catalog) {
  const bank = readGalaxyPreparedBankSections(bytes, descriptor, catalog);
  return Object.freeze({
    ...bank,
    decodedBlocks: Object.freeze(Array.from({ length: bank.blockCount }, (_, blockIndex) =>
      decodeGalaxyPreparedBlock(bank, blockIndex, catalog))),
  });
}

export function parseGalaxyPreparedTranslation(value) {
  const coordinates = new Int32Array(2);
  writeGalaxyPreparedTranslationCoordinates(value, coordinates, 0);
  return Object.freeze([coordinates[0], coordinates[1]]);
}

export function writeGalaxyPreparedTranslationCoordinates(
  value, target, offset, quantizationError = null) {
  if (!(target instanceof Int32Array) || !Number.isSafeInteger(offset) || offset < 0 ||
      offset + 1 >= target.length) {
    throw new TypeError("Galaxy prepared coordinate target is invalid");
  }
  if (value === "-32768px -32768px") {
    target[offset] = CSSGALAXY_HIDDEN_COORDINATE;
    target[offset + 1] = CSSGALAXY_HIDDEN_COORDINATE;
    return false;
  }
  const separator = value.indexOf("px ");
  if (separator < 1 || !value.endsWith("px")) {
    throw new TypeError("Galaxy prepared translation is invalid");
  }
  target[offset] = parseFixedCoordinateText(
    value, 0, separator, quantizationError);
  target[offset + 1] = parseFixedCoordinateText(
    value, separator + 3, value.length - 2, quantizationError);
  return true;
}

export function formatGalaxyPreparedTransform(x, y) {
  if (x === CSSGALAXY_HIDDEN_COORDINATE && y === CSSGALAXY_HIDDEN_COORDINATE) {
    return "translate(-32768px, -32768px)";
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new RangeError("Galaxy prepared fixed-point coordinate drifted");
  }
  return `translate(${formatFixedCoordinate(x)}px, ${formatFixedCoordinate(y)}px)`;
}

export function formatGalaxyPreparedPosition(x, y) {
  if (x === CSSGALAXY_HIDDEN_COORDINATE && y === CSSGALAXY_HIDDEN_COORDINATE) {
    return "-32768px, -32768px";
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new RangeError("Galaxy prepared fixed-point coordinate drifted");
  }
  return `${formatFixedCoordinate(x)}px, ${formatFixedCoordinate(y)}px`;
}

function encodeCoordinateBlock(coordinates, startFrame, frameCount, starCount) {
  const sampleCount = frameCount * starCount;
  const visibilityBytes = new Uint8Array(Math.ceil(sampleCount / 8));
  const residualXBytes = [];
  const residualYBytes = [];
  let visibleSampleCount = 0;
  for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
    let historyX1 = 0;
    let historyX2 = 0;
    let historyY1 = 0;
    let historyY2 = 0;
    let historyCount = 0;
    for (let localFrameIndex = 0; localFrameIndex < frameCount; localFrameIndex += 1) {
      const sampleIndex = leafIndex * frameCount + localFrameIndex;
      const frameIndex = startFrame + localFrameIndex;
      const coordinateOffset = (frameIndex * starCount + leafIndex) * 2;
      const x = coordinates[coordinateOffset];
      const y = coordinates[coordinateOffset + 1];
      const hidden = x === CSSGALAXY_HIDDEN_COORDINATE && y === CSSGALAXY_HIDDEN_COORDINATE;
      if (hidden) continue;
      visibilityBytes[sampleIndex >> 3] |= 1 << (sampleIndex & 7);
      writeSignedVarint(residualXBytes, predictResidual(x, historyCount, historyX1, historyX2));
      writeSignedVarint(residualYBytes, predictResidual(y, historyCount, historyY1, historyY2));
      historyX2 = historyX1;
      historyX1 = x;
      historyY2 = historyY1;
      historyY1 = y;
      if (historyCount < 2) historyCount += 1;
      visibleSampleCount += 1;
    }
  }
  const bytes = new Uint8Array(
    visibilityBytes.byteLength + residualXBytes.length + residualYBytes.length);
  bytes.set(visibilityBytes);
  bytes.set(residualXBytes, visibilityBytes.byteLength);
  bytes.set(residualYBytes, visibilityBytes.byteLength + residualXBytes.length);
  return Object.freeze({
    bytes,
    visibleSampleCount,
    residualXByteLength: residualXBytes.length,
    predictorOrder: 2,
  });
}

function validatePreparedValues(value) {
  if (!Number.isSafeInteger(value.seed) || value.seed < 1 || value.seed > 0xffffffff ||
      !Number.isSafeInteger(value.starCount) || value.starCount < 1 || value.starCount > 0xffff ||
      !Number.isSafeInteger(value.galaxyCount) || value.galaxyCount < 2 || value.galaxyCount > 5 ||
      !Number.isSafeInteger(value.bankIndex) || value.bankIndex < 0 || value.bankIndex > 0xff ||
      !Number.isSafeInteger(value.startFrameIndex) || value.startFrameIndex < 0 ||
      !Number.isSafeInteger(value.frameCount) || value.frameCount < 1 || value.frameCount > 0xffff ||
      !Number.isSafeInteger(value.blockFrameCount) || value.blockFrameCount < 1 ||
      value.frameCount % value.blockFrameCount !== 0 || !(value.coordinates instanceof Int32Array) ||
      value.coordinates.length !== value.frameCount * value.starCount * 2) {
    throw new TypeError("Complete prepared Galaxy fixed-point bank values are required");
  }
  for (let coordinateIndex = 0; coordinateIndex < value.coordinates.length; coordinateIndex += 2) {
    const x = value.coordinates[coordinateIndex];
    const y = value.coordinates[coordinateIndex + 1];
    const hidden = x === CSSGALAXY_HIDDEN_COORDINATE && y === CSSGALAXY_HIDDEN_COORDINATE;
    if (!hidden && (x < 0 || y < 0)) {
      throw new RangeError("Galaxy prepared coordinate pair drifted");
    }
  }
}

function predictResidual(value, count, previous1, previous2) {
  if (count === 0) return value;
  if (count === 1) return value - previous1;
  return value - 2 * previous1 + previous2;
}

function restoreCoordinate(residual, count, previous1, previous2) {
  if (count === 0) return residual;
  if (count === 1) return previous1 + residual;
  return 2 * previous1 - previous2 + residual;
}

function writeSignedVarint(bytes, value) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError("Galaxy prepared coordinate residual overflowed int32");
  }
  let encoded = ((value << 1) ^ (value >> 31)) >>> 0;
  while (encoded >= 0x80) {
    bytes.push((encoded & 0x7f) | 0x80);
    encoded >>>= 7;
  }
  bytes.push(encoded);
}

function readSignedVarint(bytes, cursor) {
  let encoded = 0;
  let shift = 0;
  for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
    if (cursor.offset >= bytes.byteLength) throw new Error("Galaxy coordinate residual ended early");
    const byte = bytes[cursor.offset++];
    encoded |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (encoded >>> 1) ^ -(encoded & 1);
    shift += 7;
  }
  throw new Error("Galaxy coordinate residual varint overflowed");
}

function parseFixedCoordinateText(value, start, end, quantizationError) {
  let index = start;
  let sign = 1;
  if (value.charCodeAt(index) === 45) {
    sign = -1;
    index += 1;
  }
  let integer = 0;
  let integerDigits = 0;
  for (; index < end && value.charCodeAt(index) !== 46; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) throw new TypeError("Galaxy prepared coordinate is invalid");
    integer = integer * 10 + digit;
    integerDigits += 1;
  }
  if (integerDigits === 0) throw new TypeError("Galaxy prepared coordinate is invalid");
  let fraction = 0;
  let fractionDigits = 0;
  if (index < end) {
    index += 1;
    for (; index < end; index += 1) {
      const digit = value.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9 || fractionDigits === 3) {
        throw new TypeError("Galaxy prepared coordinate is invalid");
      }
      fraction = fraction * 10 + digit;
      fractionDigits += 1;
    }
    if (fractionDigits === 0) throw new TypeError("Galaxy prepared coordinate is invalid");
  }
  while (fractionDigits < 3) {
    fraction *= 10;
    fractionDigits += 1;
  }
  const sourceMagnitude = integer * SOURCE_COORDINATE_SCALE + fraction;
  const quantizedMagnitude = Math.floor(
    (sourceMagnitude * CSSGALAXY_COORDINATE_SCALE + SOURCE_COORDINATE_SCALE / 2) /
      SOURCE_COORDINATE_SCALE);
  if (quantizationError !== null) {
    const reconstructedMagnitude =
      quantizedMagnitude * SOURCE_COORDINATE_SCALE / CSSGALAXY_COORDINATE_SCALE;
    quantizationError.maximumPixels = Math.max(
      quantizationError.maximumPixels,
      Math.abs(reconstructedMagnitude - sourceMagnitude) / SOURCE_COORDINATE_SCALE);
  }
  return sign * quantizedMagnitude;
}

function formatFixedCoordinate(value) {
  const integer = Math.floor(value / CSSGALAXY_COORDINATE_SCALE);
  const fraction = value % CSSGALAXY_COORDINATE_SCALE;
  if (fraction === 0) return String(integer);
  return `${integer}.${String(fraction).padStart(COORDINATE_DECIMAL_PLACES, "0")
    .replace(/0+$/u, "")}`;
}
