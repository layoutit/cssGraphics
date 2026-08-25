// SPDX-License-Identifier: MIT

export const CSSBLACKHOLE_BANK_ENCODING =
  "http-brotli-blackhole-leaf-major-axis-second-difference-plus-prepared-opacity@4";
export const CSSBLACKHOLE_BANK_SCHEMA = "cssblackhole-prepared-stream-bank@1";
export const CSSBLACKHOLE_BLOCK_SCHEMA = "cssblackhole-materialized-playback-block@1";
export const CSSBLACKHOLE_COORDINATE_SCALE = 10;
export const CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS = 0.05;
export const CSSBLACKHOLE_HIDDEN_COORDINATE = -32_768 * CSSBLACKHOLE_COORDINATE_SCALE;
export const CSSBLACKHOLE_OPACITY_ENCODING =
  "prepared-state-major-u16-offsets-u16-packed-leaf12-opacity4-nearest-decile";
export const CSSBLACKHOLE_OPACITY_PALETTE = Object.freeze(
  Array.from({ length: 11 }, (_, index) => index === 0 ? "0" : index === 10 ? "1" :
    (index / 10).toFixed(1)));

const MAGIC = "CSBLKH60";
const HEADER_BYTE_LENGTH = 64;
const DIRECTORY_ENTRY_BYTE_LENGTH = 28;
const VERSION = 4;
const SOURCE_COORDINATE_SCALE = 1_000;
const COORDINATE_DECIMAL_PLACES = 1;

export function encodeBlackHolePreparedBank({
  transportSeed,
  starCount,
  configurationCount,
  bankIndex,
  startFrameIndex,
  frameCount,
  blockFrameCount,
  coordinates,
  luminances,
}) {
  validatePreparedValues({
    transportSeed, starCount, configurationCount, bankIndex, startFrameIndex, frameCount,
    blockFrameCount, coordinates, luminances,
  });
  const blockCount = frameCount / blockFrameCount;
  const encodedBlocks = new Array(blockCount);
  let payloadByteLength = 0;
  let visibleSampleCount = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const block = encodeCoordinateBlock(
      coordinates, luminances, blockIndex * blockFrameCount, blockFrameCount, starCount);
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
  view.setUint32(12, transportSeed, true);
  view.setUint16(16, starCount, true);
  view.setUint8(18, configurationCount);
  view.setUint8(19, bankIndex);
  view.setUint32(20, startFrameIndex, true);
  view.setUint16(24, frameCount, true);
  view.setUint16(26, blockFrameCount, true);
  view.setUint16(28, blockCount, true);
  view.setUint16(30, CSSBLACKHOLE_COORDINATE_SCALE, true);
  view.setUint32(32, directoryByteLength, true);
  view.setUint32(36, payloadByteLength, true);
  view.setUint32(40, visibleSampleCount, true);
  view.setUint32(44, encodedBlocks.reduce(
    (sum, block) => sum + block.opacityAssignmentCount, 0), true);
  let payloadOffset = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const block = encodedBlocks[blockIndex];
    const directoryOffset = HEADER_BYTE_LENGTH + blockIndex * DIRECTORY_ENTRY_BYTE_LENGTH;
    view.setUint32(directoryOffset, payloadOffset, true);
    view.setUint32(directoryOffset + 4, block.bytes.byteLength, true);
    view.setUint32(directoryOffset + 8, block.visibleSampleCount, true);
    view.setUint32(directoryOffset + 12, block.residualXByteLength, true);
    view.setUint32(directoryOffset + 16, block.residualYByteLength, true);
    view.setUint32(directoryOffset + 20, block.opacityAssignmentCount, true);
    view.setUint16(directoryOffset + 24, blockFrameCount, true);
    view.setUint16(directoryOffset + 26, block.predictorOrder, true);
    bytes.set(block.bytes, HEADER_BYTE_LENGTH + directoryByteLength + payloadOffset);
    payloadOffset += block.bytes.byteLength;
  }
  if (payloadOffset !== payloadByteLength) throw new Error("BlackHole coordinate bank byte count drifted");
  return bytes;
}

export function readBlackHolePreparedBankSections(bytes, descriptor, catalog) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (source.byteLength < HEADER_BYTE_LENGTH ||
      String.fromCharCode(...source.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new Error(`BlackHole bank ${descriptor?.index ?? "unknown"} binary header drifted`);
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const transportSeed = view.getUint32(12, true);
  const starCount = view.getUint16(16, true);
  const configurationCount = view.getUint8(18);
  const bankIndex = view.getUint8(19);
  const startFrameIndex = view.getUint32(20, true);
  const frameCount = view.getUint16(24, true);
  const blockFrameCount = view.getUint16(26, true);
  const blockCount = view.getUint16(28, true);
  const coordinateScale = view.getUint16(30, true);
  const directoryByteLength = view.getUint32(32, true);
  const payloadByteLength = view.getUint32(36, true);
  const visibleSampleCount = view.getUint32(40, true);
  const opacityAssignmentCount = view.getUint32(44, true);
  if (view.getUint16(8, true) !== HEADER_BYTE_LENGTH || view.getUint16(10, true) !== VERSION ||
      transportSeed !== catalog.transportSeed || starCount !== catalog.starCount ||
      configurationCount !== catalog.configurationCount || bankIndex !== descriptor.index ||
      startFrameIndex !== descriptor.startFrameIndex || frameCount !== descriptor.frameCount ||
      frameCount !== catalog.bankFrameCount || blockFrameCount !== catalog.blockFrameCount ||
      blockCount !== catalog.blocksPerBank || coordinateScale !== CSSBLACKHOLE_COORDINATE_SCALE ||
      directoryByteLength !== blockCount * DIRECTORY_ENTRY_BYTE_LENGTH ||
      HEADER_BYTE_LENGTH + directoryByteLength + payloadByteLength !== source.byteLength ||
      descriptor.decodedByteLength !== source.byteLength ||
      descriptor.blockCount !== blockCount || descriptor.visibleSampleCount !== visibleSampleCount ||
      descriptor.opacityAssignmentCount !== opacityAssignmentCount ||
      descriptor.coordinateEncoding !==
        "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1" ||
      descriptor.opacityEncoding !== CSSBLACKHOLE_OPACITY_ENCODING) {
    throw new Error(`BlackHole bank ${descriptor.index} binary contract drifted`);
  }
  const payloadStart = HEADER_BYTE_LENGTH + directoryByteLength;
  const blocks = new Array(blockCount);
  let expectedPayloadOffset = 0;
  let countedVisibleSamples = 0;
  let countedOpacityAssignments = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const directoryOffset = HEADER_BYTE_LENGTH + blockIndex * DIRECTORY_ENTRY_BYTE_LENGTH;
    const payloadOffset = view.getUint32(directoryOffset, true);
    const byteLength = view.getUint32(directoryOffset + 4, true);
    const blockVisibleSampleCount = view.getUint32(directoryOffset + 8, true);
    const residualXByteLength = view.getUint32(directoryOffset + 12, true);
    const residualYByteLength = view.getUint32(directoryOffset + 16, true);
    const blockOpacityAssignmentCount = view.getUint32(directoryOffset + 20, true);
    const blockFrames = view.getUint16(directoryOffset + 24, true);
    const predictorOrder = view.getUint16(directoryOffset + 26, true);
    const visibilityByteLength = Math.ceil(blockFrames * starCount / 8);
    const opacityOffsetByteLength = (blockFrames + 1) * 2;
    const opacityAssignmentByteLength = blockOpacityAssignmentCount * 2;
    const expectedBlockByteLength = visibilityByteLength + residualXByteLength +
      residualYByteLength + opacityOffsetByteLength + opacityAssignmentByteLength;
    if (payloadOffset !== expectedPayloadOffset || residualXByteLength < 1 || residualYByteLength < 1 ||
        blockFrames !== blockFrameCount || predictorOrder !== 2 ||
        expectedBlockByteLength !== byteLength ||
        blockOpacityAssignmentCount < starCount || blockOpacityAssignmentCount > 0xffff ||
        blockOpacityAssignmentCount > blockFrames * starCount ||
        payloadOffset + byteLength > payloadByteLength ||
        blockVisibleSampleCount > blockFrames * starCount) {
      throw new Error(`BlackHole bank ${descriptor.index} block ${blockIndex} directory drifted`);
    }
    const blockStart = payloadStart + payloadOffset;
    const opacityOffsetStart = blockStart + visibilityByteLength +
      residualXByteLength + residualYByteLength;
    const opacityAssignmentStart = opacityOffsetStart + opacityOffsetByteLength;
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
        opacityOffsetStart),
      opacityAssignmentCount: blockOpacityAssignmentCount,
      opacityOffsetBytes: source.subarray(
        opacityOffsetStart, opacityAssignmentStart),
      opacityAssignmentBytes: source.subarray(
        opacityAssignmentStart, opacityAssignmentStart + opacityAssignmentByteLength),
    });
    expectedPayloadOffset += byteLength;
    countedVisibleSamples += blockVisibleSampleCount;
    countedOpacityAssignments += blockOpacityAssignmentCount;
  }
  if (expectedPayloadOffset !== payloadByteLength || countedVisibleSamples !== visibleSampleCount ||
      countedOpacityAssignments !== opacityAssignmentCount) {
    throw new Error(`BlackHole bank ${descriptor.index} payload directory drifted`);
  }
  return Object.freeze({
    schema: CSSBLACKHOLE_BANK_SCHEMA,
    transportSeed,
    starCount,
    configurationCount,
    bankIndex,
    startFrameIndex,
    frameCount,
    blockFrameCount,
    blockCount,
    coordinateScale,
    visibleSampleCount,
    opacityAssignmentCount,
    blocks: Object.freeze(blocks),
  });
}

export function decodeBlackHolePreparedOpacitySchedule(bank, bankBlockIndex) {
  const block = bank?.blocks?.[bankBlockIndex];
  if (bank?.schema !== CSSBLACKHOLE_BANK_SCHEMA || !block ||
      block.bankBlockIndex !== bankBlockIndex || block.opacityAssignmentCount < bank.starCount) {
    throw new Error("BlackHole prepared opacity block binding drifted");
  }
  const frameOffsets = new Uint32Array(block.frameCount + 1);
  const offsetView = new DataView(block.opacityOffsetBytes.buffer,
    block.opacityOffsetBytes.byteOffset, block.opacityOffsetBytes.byteLength);
  for (let index = 0; index < frameOffsets.length; index += 1) {
    frameOffsets[index] = offsetView.getUint16(index * 2, true);
  }
  const leafIndices = new Uint16Array(block.opacityAssignmentCount);
  const opacityIndices = new Uint8Array(block.opacityAssignmentCount);
  const assignmentView = new DataView(block.opacityAssignmentBytes.buffer,
    block.opacityAssignmentBytes.byteOffset, block.opacityAssignmentBytes.byteLength);
  for (let index = 0; index < leafIndices.length; index += 1) {
    const packed = assignmentView.getUint16(index * 2, true);
    leafIndices[index] = packed >>> 4;
    opacityIndices[index] = packed & 0x0f;
  }
  if (frameOffsets[0] !== 0 || frameOffsets[1] !== bank.starCount ||
      frameOffsets.at(-1) !== block.opacityAssignmentCount ||
      leafIndices.some((leafIndex) => leafIndex >= bank.starCount) ||
      opacityIndices.some((opacityIndex) => opacityIndex >= CSSBLACKHOLE_OPACITY_PALETTE.length)) {
    throw new Error(`BlackHole block ${block.streamBlockIndex} prepared opacity schedule drifted`);
  }
  for (let frameIndex = 0; frameIndex < block.frameCount; frameIndex += 1) {
    const start = frameOffsets[frameIndex];
    const end = frameOffsets[frameIndex + 1];
    if (start > end || end > block.opacityAssignmentCount || end - start > bank.starCount) {
      throw new Error(`BlackHole block ${block.streamBlockIndex} opacity range drifted`);
    }
  }
  for (let leafIndex = 0; leafIndex < bank.starCount; leafIndex += 1) {
    if (leafIndices[leafIndex] !== leafIndex) {
      throw new Error(`BlackHole block ${block.streamBlockIndex} initial opacity identity drifted`);
    }
  }
  return Object.freeze({ frameOffsets, leafIndices, opacityIndices });
}

export function createBlackHolePreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog) {
  const block = bank?.blocks?.[bankBlockIndex];
  if (bank?.schema !== CSSBLACKHOLE_BANK_SCHEMA || !block ||
      block.bankBlockIndex !== bankBlockIndex || bank.starCount !== catalog.starCount ||
      catalog.viewport?.width < 1 || catalog.viewport?.height < 1) {
    throw new Error("BlackHole prepared coordinate block binding drifted");
  }
  const sampleCount = block.frameCount * bank.starCount;
  const coordinates = new Int32Array(sampleCount * 2);
  coordinates.fill(CSSBLACKHOLE_HIDDEN_COORDINATE);
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
      throw new RangeError("BlackHole coordinate decode slice is invalid");
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
      if (x < 0 || x > catalog.camera.viewport.width * CSSBLACKHOLE_COORDINATE_SCALE ||
          y < 0 || y > catalog.camera.viewport.height * CSSBLACKHOLE_COORDINATE_SCALE) {
        throw new Error(`BlackHole block ${block.streamBlockIndex} decoded coordinate drifted at ` +
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
      throw new Error(`BlackHole block ${block.streamBlockIndex} residual cardinality drifted`);
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

export function decodeBlackHolePreparedBlock(bank, bankBlockIndex, catalog) {
  const decoder = createBlackHolePreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
  while (!decoder.step()) {}
  const transforms = new Array(decoder.block.frameCount * bank.starCount);
  for (let sampleIndex = 0; sampleIndex < transforms.length; sampleIndex += 1) {
    const coordinateOffset = sampleIndex * 2;
    transforms[sampleIndex] = formatBlackHolePreparedTransform(
      decoder.coordinates[coordinateOffset], decoder.coordinates[coordinateOffset + 1]);
  }
  const opacitySchedule = decodeBlackHolePreparedOpacitySchedule(bank, bankBlockIndex);
  return Object.freeze({
    schema: CSSBLACKHOLE_BLOCK_SCHEMA,
    index: decoder.block.streamBlockIndex,
    startFrameIndex: decoder.block.startFrameIndex,
    frameCount: decoder.block.frameCount,
    starCount: bank.starCount,
    coordinates: decoder.coordinates,
    transforms: Object.freeze(transforms),
    opacitySchedule,
  });
}

export function decodeBlackHolePreparedBank(bytes, descriptor, catalog) {
  const bank = readBlackHolePreparedBankSections(bytes, descriptor, catalog);
  return Object.freeze({
    ...bank,
    decodedBlocks: Object.freeze(Array.from({ length: bank.blockCount }, (_, blockIndex) =>
      decodeBlackHolePreparedBlock(bank, blockIndex, catalog))),
  });
}

export function parseBlackHolePreparedTranslation(value) {
  const coordinates = new Int32Array(2);
  writeBlackHolePreparedTranslationCoordinates(value, coordinates, 0);
  return Object.freeze([coordinates[0], coordinates[1]]);
}

export function writeBlackHolePreparedTranslationCoordinates(
  value, target, offset, quantizationError = null) {
  if (!(target instanceof Int32Array) || !Number.isSafeInteger(offset) || offset < 0 ||
      offset + 1 >= target.length) {
    throw new TypeError("BlackHole prepared coordinate target is invalid");
  }
  if (value === "-32768px -32768px") {
    target[offset] = CSSBLACKHOLE_HIDDEN_COORDINATE;
    target[offset + 1] = CSSBLACKHOLE_HIDDEN_COORDINATE;
    return false;
  }
  const separator = value.indexOf("px ");
  if (separator < 1 || !value.endsWith("px")) {
    throw new TypeError("BlackHole prepared translation is invalid");
  }
  target[offset] = parseFixedCoordinateText(
    value, 0, separator, quantizationError);
  target[offset + 1] = parseFixedCoordinateText(
    value, separator + 3, value.length - 2, quantizationError);
  return true;
}

export function formatBlackHolePreparedTransform(x, y) {
  if (x === CSSBLACKHOLE_HIDDEN_COORDINATE && y === CSSBLACKHOLE_HIDDEN_COORDINATE) {
    return "translate(-32768px, -32768px)";
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new RangeError("BlackHole prepared fixed-point coordinate drifted");
  }
  return `translate(${formatFixedCoordinate(x)}px, ${formatFixedCoordinate(y)}px)`;
}

export function formatBlackHolePreparedPosition(x, y) {
  if (x === CSSBLACKHOLE_HIDDEN_COORDINATE && y === CSSBLACKHOLE_HIDDEN_COORDINATE) {
    return "-32768px, -32768px";
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new RangeError("BlackHole prepared fixed-point coordinate drifted");
  }
  return `${formatFixedCoordinate(x)}px, ${formatFixedCoordinate(y)}px`;
}

function encodeCoordinateBlock(coordinates, luminances, startFrame, frameCount, starCount) {
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
      const hidden = x === CSSBLACKHOLE_HIDDEN_COORDINATE && y === CSSBLACKHOLE_HIDDEN_COORDINATE;
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
  const opacity = encodeOpacitySchedule(luminances, startFrame, frameCount, starCount);
  const bytes = new Uint8Array(
    visibilityBytes.byteLength + residualXBytes.length + residualYBytes.length +
    opacity.offsetBytes.byteLength + opacity.assignmentBytes.byteLength);
  bytes.set(visibilityBytes);
  bytes.set(residualXBytes, visibilityBytes.byteLength);
  bytes.set(residualYBytes, visibilityBytes.byteLength + residualXBytes.length);
  const opacityOffset = visibilityBytes.byteLength + residualXBytes.length + residualYBytes.length;
  bytes.set(opacity.offsetBytes, opacityOffset);
  bytes.set(opacity.assignmentBytes, opacityOffset + opacity.offsetBytes.byteLength);
  return Object.freeze({
    bytes,
    visibleSampleCount,
    residualXByteLength: residualXBytes.length,
    residualYByteLength: residualYBytes.length,
    opacityAssignmentCount: opacity.assignmentCount,
    predictorOrder: 2,
  });
}

function encodeOpacitySchedule(luminances, startFrame, frameCount, starCount) {
  const frameOffsets = new Uint16Array(frameCount + 1);
  const packedAssignments = [];
  for (let localFrameIndex = 0; localFrameIndex < frameCount; localFrameIndex += 1) {
    const frameIndex = startFrame + localFrameIndex;
    const frameOffset = frameIndex * starCount;
    const previousOffset = frameOffset - starCount;
    for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
      const opacityIndex = quantizeBlackHolePreparedOpacityIndex(
        luminances[frameOffset + leafIndex]);
      if (localFrameIndex > 0 && opacityIndex === quantizeBlackHolePreparedOpacityIndex(
        luminances[previousOffset + leafIndex])) continue;
      packedAssignments.push((leafIndex << 4) | opacityIndex);
    }
    if (packedAssignments.length > 0xffff) {
      throw new RangeError("BlackHole prepared opacity block exceeded uint16 offsets");
    }
    frameOffsets[localFrameIndex + 1] = packedAssignments.length;
  }
  const offsetBytes = new Uint8Array(frameOffsets.byteLength);
  const offsetView = new DataView(offsetBytes.buffer);
  for (let index = 0; index < frameOffsets.length; index += 1) {
    offsetView.setUint16(index * 2, frameOffsets[index], true);
  }
  const assignmentBytes = new Uint8Array(packedAssignments.length * 2);
  const assignmentView = new DataView(assignmentBytes.buffer);
  for (let index = 0; index < packedAssignments.length; index += 1) {
    assignmentView.setUint16(index * 2, packedAssignments[index], true);
  }
  return Object.freeze({
    offsetBytes,
    assignmentBytes,
    assignmentCount: packedAssignments.length,
  });
}

export function quantizeBlackHolePreparedOpacityIndex(luminance) {
  if (!Number.isSafeInteger(luminance) || luminance < 0 || luminance > 255) {
    throw new RangeError("BlackHole source luminance must be an unsigned byte");
  }
  return Math.round(luminance * 10 / 255);
}

function validatePreparedValues(value) {
  if (!Number.isSafeInteger(value.transportSeed) || value.transportSeed < 1 || value.transportSeed > 0xffffffff ||
      !Number.isSafeInteger(value.starCount) || value.starCount < 1 || value.starCount > 0x1000 ||
      !Number.isSafeInteger(value.configurationCount) || value.configurationCount < 2 || value.configurationCount > 5 ||
      !Number.isSafeInteger(value.bankIndex) || value.bankIndex < 0 || value.bankIndex > 0xff ||
      !Number.isSafeInteger(value.startFrameIndex) || value.startFrameIndex < 0 ||
      !Number.isSafeInteger(value.frameCount) || value.frameCount < 1 || value.frameCount > 0xffff ||
      !Number.isSafeInteger(value.blockFrameCount) || value.blockFrameCount < 1 ||
      value.frameCount % value.blockFrameCount !== 0 || !(value.coordinates instanceof Int32Array) ||
      value.coordinates.length !== value.frameCount * value.starCount * 2 ||
      !(value.luminances instanceof Uint8Array) ||
      value.luminances.length !== value.frameCount * value.starCount) {
    throw new TypeError("Complete prepared BlackHole fixed-point bank values are required");
  }
  for (let coordinateIndex = 0; coordinateIndex < value.coordinates.length; coordinateIndex += 2) {
    const x = value.coordinates[coordinateIndex];
    const y = value.coordinates[coordinateIndex + 1];
    const hidden = x === CSSBLACKHOLE_HIDDEN_COORDINATE && y === CSSBLACKHOLE_HIDDEN_COORDINATE;
    if (!hidden && (x < 0 || y < 0)) {
      throw new RangeError("BlackHole prepared coordinate pair drifted");
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
    throw new RangeError("BlackHole prepared coordinate residual overflowed int32");
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
    if (cursor.offset >= bytes.byteLength) throw new Error("BlackHole coordinate residual ended early");
    const byte = bytes[cursor.offset++];
    encoded |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (encoded >>> 1) ^ -(encoded & 1);
    shift += 7;
  }
  throw new Error("BlackHole coordinate residual varint overflowed");
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
    if (digit < 0 || digit > 9) throw new TypeError("BlackHole prepared coordinate is invalid");
    integer = integer * 10 + digit;
    integerDigits += 1;
  }
  if (integerDigits === 0) throw new TypeError("BlackHole prepared coordinate is invalid");
  let fraction = 0;
  let fractionDigits = 0;
  if (index < end) {
    index += 1;
    for (; index < end; index += 1) {
      const digit = value.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9 || fractionDigits === 3) {
        throw new TypeError("BlackHole prepared coordinate is invalid");
      }
      fraction = fraction * 10 + digit;
      fractionDigits += 1;
    }
    if (fractionDigits === 0) throw new TypeError("BlackHole prepared coordinate is invalid");
  }
  while (fractionDigits < 3) {
    fraction *= 10;
    fractionDigits += 1;
  }
  const sourceMagnitude = integer * SOURCE_COORDINATE_SCALE + fraction;
  const quantizedMagnitude = Math.floor(
    (sourceMagnitude * CSSBLACKHOLE_COORDINATE_SCALE + SOURCE_COORDINATE_SCALE / 2) /
      SOURCE_COORDINATE_SCALE);
  if (quantizationError !== null) {
    const reconstructedMagnitude =
      quantizedMagnitude * SOURCE_COORDINATE_SCALE / CSSBLACKHOLE_COORDINATE_SCALE;
    quantizationError.maximumPixels = Math.max(
      quantizationError.maximumPixels,
      Math.abs(reconstructedMagnitude - sourceMagnitude) / SOURCE_COORDINATE_SCALE);
  }
  return sign * quantizedMagnitude;
}

function formatFixedCoordinate(value) {
  const integer = Math.floor(value / CSSBLACKHOLE_COORDINATE_SCALE);
  const fraction = value % CSSBLACKHOLE_COORDINATE_SCALE;
  if (fraction === 0) return String(integer);
  return `${integer}.${String(fraction).padStart(COORDINATE_DECIMAL_PLACES, "0")
    .replace(/0+$/u, "")}`;
}
