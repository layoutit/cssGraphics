// SPDX-License-Identifier: MIT
import {
  createBlackHolePreparedBlockCoordinateDecoder,
  decodeBlackHolePreparedOpacitySchedule,
  formatBlackHolePreparedTransform,
  quantizeBlackHolePreparedOpacityIndex,
  readBlackHolePreparedBankSections,
} from "../shared/cssblackhole/preparedBlockTransport.mjs";
import {
  CSSBLACKHOLE_RAIL_ENCODING,
  readBlackHolePreparedRailAsset,
  readBlackHolePreparedRepairBank,
  unpackBlackHolePreparedRailDescriptor,
} from "../shared/cssblackhole/preparedRailTransport.mjs";

const MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS = 2;
const TRANSFORM_RESPONSE_CHUNK_SIZE = 4_096;
const REPAIR_DIRECTIONS = Object.freeze([
  Object.freeze([1, 0]), Object.freeze([-1, 0]),
  Object.freeze([0, 1]), Object.freeze([0, -1]),
  Object.freeze([1, 1]), Object.freeze([-1, 1]),
  Object.freeze([1, -1]), Object.freeze([-1, -1]),
]);
let catalog = null;
let tail = Promise.resolve();
const retainedBanks = new Uint8Array(256);
const banks = new Map();
let sourceRails = null;
const sourceRailConfigurations = [];

self.addEventListener("message", ({ data }) => {
  try {
    if (data?.type === "initialize") {
      if (catalog !== null || data.catalog?.schema !== "cssblackhole-prepared-stream-catalog@1") {
        throw new Error("BlackHole worker catalog drifted");
      }
      catalog = data.catalog;
      self.postMessage({ type: "initialized" });
      return;
    }
    if (data?.type === "retain-banks") {
      if (catalog === null || !ArrayBuffer.isView(data.indices)) {
        throw new Error("BlackHole retained worker bank window drifted");
      }
      retainedBanks.fill(0);
      for (const index of data.indices) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.bankCount) {
          throw new Error("BlackHole retained worker bank index drifted");
        }
        retainedBanks[index] = 1;
      }
      trimBanks();
      return;
    }
    if (catalog === null || !Number.isSafeInteger(data?.requestId)) {
      throw new Error("BlackHole worker request drifted");
    }
    if (data.type === "register-bank" && data.bytes instanceof Uint8Array) {
      tail = tail.then(() => registerBank(data), () => registerBank(data))
        .catch((error) => postError(error, data.requestId));
      return;
    }
    if (data.type === "register-rails" && data.bytes instanceof Uint8Array) {
      tail = tail.then(() => registerRails(data), () => registerRails(data))
        .catch((error) => postError(error, data.requestId));
      return;
    }
    if (data.type === "materialize-block" && Number.isSafeInteger(data.blockIndex) &&
        typeof data.eager === "boolean") {
      tail = tail.then(() => materializeBlock(data), () => materializeBlock(data))
        .catch((error) => postError(error, data.requestId));
      return;
    }
    throw new Error("BlackHole worker request drifted");
  } catch (error) {
    postError(error, Number.isSafeInteger(data?.requestId) ? data.requestId : null);
  }
});

async function registerBank(data) {
  const startedAt = performance.now();
  const descriptor = catalog.banks[data.bankIndex];
  if (!descriptor || descriptor.index !== data.bankIndex || data.descriptor?.index !== data.bankIndex) {
    throw new Error("BlackHole worker bank registration drifted");
  }
  const decoded = data.bytes;
  await yieldTask();
  await verify(decoded, descriptor.decodedByteLength, descriptor.decodedSha256, "decoded");
  await yieldTask();
  const sliceStartedAt = performance.now();
  const bank = catalog.transport.encoding === CSSBLACKHOLE_RAIL_ENCODING ?
    readBlackHolePreparedRepairBank(decoded, descriptor, catalog) :
    readBlackHolePreparedBankSections(decoded, descriptor, catalog);
  const maximumSliceMilliseconds = performance.now() - sliceStartedAt;
  banks.set(descriptor.index, bank);
  trimBanks();
  self.postMessage({
    type: "registered-bank",
    requestId: data.requestId,
    bankIndex: descriptor.index,
    decodedByteLength: decoded.byteLength,
    workerDurationMilliseconds: performance.now() - startedAt,
    workerMaximumSliceMilliseconds: maximumSliceMilliseconds,
  });
}

async function registerRails(data) {
  const startedAt = performance.now();
  const configurationIndex = data.descriptor?.configurationIndex;
  const expectedDescriptor = catalog.sourceRails?.[configurationIndex];
  if (!Number.isSafeInteger(configurationIndex) ||
      sourceRailConfigurations[configurationIndex] !== undefined ||
      data.descriptor?.decodedSha256 !== expectedDescriptor?.decodedSha256) {
    throw new Error("BlackHole worker source rail registration drifted");
  }
  const decoded = data.bytes;
  await yieldTask();
  await verify(decoded, expectedDescriptor.decodedByteLength,
    expectedDescriptor.decodedSha256, `source rails ${configurationIndex} decoded`);
  await yieldTask();
  const sliceStartedAt = performance.now();
  const rails = readBlackHolePreparedRailAsset(decoded, expectedDescriptor, catalog);
  if (sourceRails === null) {
    const phaseFrameIndices = new Uint16Array(catalog.starCount);
    const turns = new Uint8Array(catalog.starCount);
    const baseRailSampleIndices = new Uint32Array(catalog.starCount);
    for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
      const descriptor = unpackBlackHolePreparedRailDescriptor(rails.descriptors[leafIndex]);
      phaseFrameIndices[leafIndex] = descriptor.phaseFrameIndex;
      turns[leafIndex] = rails.periodicOrbitCounts[descriptor.radiusIndex];
      baseRailSampleIndices[leafIndex] =
        (descriptor.order * rails.radiusCount + descriptor.radiusIndex) * rails.sourceFrameCount;
    }
    sourceRails = Object.freeze({
      imageOrderCount: rails.imageOrderCount,
      radiusCount: rails.radiusCount,
      sourceFrameCount: rails.sourceFrameCount,
      descriptors: rails.descriptors,
      easing: rails.easing,
      periodicOrbitCounts: rails.periodicOrbitCounts,
      phaseFrameIndices,
      turns,
      baseRailSampleIndices,
    });
  } else if (!equalTypedValues(sourceRails.descriptors, rails.descriptors) ||
      !equalTypedValues(sourceRails.easing, rails.easing) ||
      !equalTypedValues(sourceRails.periodicOrbitCounts, rails.periodicOrbitCounts)) {
    throw new Error(`BlackHole source rail identity ${configurationIndex} drifted`);
  }
  sourceRailConfigurations[configurationIndex] = Object.freeze({
    coordinates: rails.coordinates,
    luminances: rails.luminances,
  });
  self.postMessage({
    type: "registered-rails",
    requestId: data.requestId,
    configurationIndex,
    decodedByteLength: decoded.byteLength,
    workerDurationMilliseconds: performance.now() - startedAt,
    workerMaximumSliceMilliseconds: performance.now() - sliceStartedAt,
  });
}

async function materializeBlock(data) {
  const startedAt = performance.now();
  const blockIndex = normalize(data.blockIndex, catalog.blockCount);
  const bankIndex = Math.floor(blockIndex / catalog.blocksPerBank);
  const bankBlockIndex = blockIndex % catalog.blocksPerBank;
  const bank = banks.get(bankIndex);
  if (!bank) throw new Error(`BlackHole bank ${bankIndex} was not registered before block materialization`);
  let maximumSliceMilliseconds = 0;
  let sliceCount = 0;
  let coordinates;
  let opacitySchedule;
  if (catalog.transport.encoding === CSSBLACKHOLE_RAIL_ENCODING) {
    if (sourceRails === null) throw new Error("BlackHole source rails were not registered");
    const prepared = await materializeRailBlockState(blockIndex, bank, bankBlockIndex);
    coordinates = prepared.coordinates;
    opacitySchedule = prepared.opacitySchedule;
    maximumSliceMilliseconds = prepared.maximumSliceMilliseconds;
    sliceCount = prepared.sliceCount;
  } else {
    const decoder = createBlackHolePreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
    while (!decoder.finished) {
      const sliceStartedAt = performance.now();
      decoder.step(1_024);
      maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
        performance.now() - sliceStartedAt);
      sliceCount += 1;
      if (!decoder.finished) await yieldTask();
    }
    coordinates = decoder.coordinates;
    const opacityScheduleStartedAt = performance.now();
    opacitySchedule = decodeBlackHolePreparedOpacitySchedule(bank, bankBlockIndex);
    maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
      performance.now() - opacityScheduleStartedAt);
    sliceCount += 1;
    await yieldTask();
  }

  const frameOffsets = new Uint32Array(catalog.blockFrameCount + 1);
  let frameIndex = 0;
  let leafIndex = 0;
  let sliceStartedAt = performance.now();
  while (frameIndex < catalog.blockFrameCount) {
    const sampleIndex = frameIndex * catalog.starCount + leafIndex;
    const coordinateOffset = sampleIndex * 2;
    const x = coordinates[coordinateOffset];
    const y = coordinates[coordinateOffset + 1];
    const changed = frameIndex === 0 || x !== coordinates[coordinateOffset - catalog.starCount * 2] ||
      y !== coordinates[coordinateOffset - catalog.starCount * 2 + 1];
    if (changed) frameOffsets[frameIndex + 1] += 1;
    leafIndex += 1;
    if (leafIndex === catalog.starCount) {
      frameOffsets[frameIndex + 1] += frameOffsets[frameIndex];
      frameIndex += 1;
      leafIndex = 0;
    }
    if ((sampleIndex & 0xff) === 0 &&
        performance.now() - sliceStartedAt >= MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS) {
      maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
        performance.now() - sliceStartedAt);
      sliceCount += 1;
      await yieldTask();
      sliceStartedAt = performance.now();
    }
  }
  maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
    performance.now() - sliceStartedAt);
  sliceCount += 1;
  await yieldTask();

  const assignmentCount = frameOffsets[frameOffsets.length - 1];
  const assignmentLeafIndices = new Uint16Array(assignmentCount);
  const transforms = new Array(assignmentCount);
  let assignmentIndex = 0;
  frameIndex = 0;
  leafIndex = 0;
  sliceStartedAt = performance.now();
  while (frameIndex < catalog.blockFrameCount) {
    const sampleIndex = frameIndex * catalog.starCount + leafIndex;
    const coordinateOffset = sampleIndex * 2;
    const x = coordinates[coordinateOffset];
    const y = coordinates[coordinateOffset + 1];
    const changed = frameIndex === 0 || x !== coordinates[coordinateOffset - catalog.starCount * 2] ||
      y !== coordinates[coordinateOffset - catalog.starCount * 2 + 1];
    if (changed) {
      assignmentLeafIndices[assignmentIndex] = leafIndex;
      transforms[assignmentIndex] = formatBlackHolePreparedTransform(x, y);
      assignmentIndex += 1;
    }
    leafIndex += 1;
    if (leafIndex === catalog.starCount) {
      frameIndex += 1;
      leafIndex = 0;
    }
    if ((sampleIndex & 0xff) === 0 &&
        performance.now() - sliceStartedAt >= MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS) {
      maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
        performance.now() - sliceStartedAt);
      sliceCount += 1;
      await yieldTask();
      sliceStartedAt = performance.now();
    }
  }
  maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
    performance.now() - sliceStartedAt);
  sliceCount += 1;
  if (assignmentIndex !== assignmentCount || frameOffsets[1] !== catalog.starCount) {
    throw new Error("BlackHole prepared transform schedule drifted");
  }

  const chunkCount = Math.ceil(assignmentCount / TRANSFORM_RESPONSE_CHUNK_SIZE);
  self.postMessage({
    type: "materialized-start",
    requestId: data.requestId,
    descriptor: Object.freeze({
      index: blockIndex,
      bankIndex,
      bankBlockIndex,
      startFrameIndex: blockIndex * catalog.blockFrameCount,
      frameCount: catalog.blockFrameCount,
    }),
    assignmentCount,
    chunkCount,
    frameOffsets,
    assignmentLeafIndices,
    opacityAssignmentCount: opacitySchedule.opacityIndices.length,
    opacityFrameOffsets: opacitySchedule.frameOffsets,
    opacityLeafIndices: opacitySchedule.leafIndices,
    opacityIndices: opacitySchedule.opacityIndices,
    decodedCoordinateByteLength: coordinates.byteLength,
  }, [
    frameOffsets.buffer,
    assignmentLeafIndices.buffer,
    opacitySchedule.frameOffsets.buffer,
    opacitySchedule.leafIndices.buffer,
    opacitySchedule.opacityIndices.buffer,
  ]);
  await yieldTask();

  let transformCharacterCount = 0;
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const offset = chunkIndex * TRANSFORM_RESPONSE_CHUNK_SIZE;
    const values = transforms.slice(
      offset, Math.min(assignmentCount, offset + TRANSFORM_RESPONSE_CHUNK_SIZE));
    const chunkCharacterCount = values.reduce((sum, value) => sum + value.length, 0);
    transformCharacterCount += chunkCharacterCount;
    const postStartedAt = performance.now();
    self.postMessage({
      type: "materialized-transform-chunk",
      requestId: data.requestId,
      chunkIndex,
      chunkCount,
      transformOffset: offset,
      values,
      chunkCharacterCount,
    });
    maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
      performance.now() - postStartedAt);
    sliceCount += 1;
    if (chunkIndex + 1 < chunkCount) await yieldTask();
  }
  self.postMessage({
    type: "materialized-end",
    requestId: data.requestId,
    transformCharacterCount,
    workerDurationMilliseconds: performance.now() - startedAt,
    workerMaximumSliceMilliseconds: maximumSliceMilliseconds,
    workerSliceCount: sliceCount,
  });
}

async function materializeRailBlockState(blockIndex, bank, bankBlockIndex) {
  const coordinates = new Int32Array(catalog.blockFrameCount * catalog.starCount * 2);
  const opacityFrameOffsets = new Uint32Array(catalog.blockFrameCount + 1);
  const opacityLeafIndices = new Uint16Array(
    catalog.materialization.maximumOpacityAssignmentCount);
  const opacityAssignmentIndices = new Uint8Array(
    catalog.materialization.maximumOpacityAssignmentCount);
  const previousOpacityIndices = new Uint8Array(catalog.starCount);
  const sequenceFrameCount = catalog.configurationLoop.presentationSequenceFrameCount;
  const sourceFrameCount = sourceRails.sourceFrameCount;
  const slots = catalog.configurationLoop.presentationSlots;
  const phaseFrameIndices = new Uint16Array(catalog.starCount);
  const blockStartSourceFrameIndex = blockIndex * catalog.blockFrameCount % sourceFrameCount;
  for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
    phaseFrameIndices[leafIndex] = (
      sourceRails.phaseFrameIndices[leafIndex] +
      sourceRails.turns[leafIndex] * blockStartSourceFrameIndex
    ) % sourceFrameCount;
  }
  let opacityAssignmentCount = 0;
  let maximumSliceMilliseconds = 0;
  let sliceCount = 0;
  let sliceStartedAt = performance.now();
  for (let localFrameIndex = 0; localFrameIndex < catalog.blockFrameCount; localFrameIndex += 1) {
    const globalFrameIndex = blockIndex * catalog.blockFrameCount + localFrameIndex;
    const sequenceFrameIndex = globalFrameIndex % sequenceFrameCount;
    const presentationIndex = slots.findIndex((slot) =>
      sequenceFrameIndex >= slot.startFrameIndex &&
      sequenceFrameIndex < slot.startFrameIndex + slot.frameCount);
    const slot = slots[presentationIndex];
    if (!slot) throw new Error(`BlackHole presentation slot for frame ${globalFrameIndex} drifted`);
    const slotFrameIndex = sequenceFrameIndex - slot.startFrameIndex;
    const transitionIndex = slotFrameIndex - slot.transitionStartFrameIndex;
    const transitioning = transitionIndex >= 0;
    const nextSlot = transitioning ? slots[(presentationIndex + 1) % slots.length] : null;
    const eased = transitioning ? sourceRails.easing[transitionIndex] : 0;
    const currentRails = sourceRailConfigurations[slot.stateIndex];
    const nextRails = transitioning ? sourceRailConfigurations[nextSlot.stateIndex] : null;
    if (!currentRails || transitioning && !nextRails) {
      throw new Error(`BlackHole required source rails for frame ${globalFrameIndex} were not registered`);
    }
    const repairFrameIndex = bankBlockIndex * catalog.blockFrameCount + localFrameIndex;
    let repairIndex = bank.frameOffsets[repairFrameIndex];
    const repairEnd = bank.frameOffsets[repairFrameIndex + 1];
    for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
      const phaseFrameIndex = phaseFrameIndices[leafIndex];
      const currentRailSampleIndex =
        sourceRails.baseRailSampleIndices[leafIndex] + phaseFrameIndex;
      let x = currentRails.coordinates[currentRailSampleIndex * 2];
      let y = currentRails.coordinates[currentRailSampleIndex * 2 + 1];
      let luminance = currentRails.luminances[currentRailSampleIndex];
      if (transitioning) {
        const nextRailSampleIndex =
          sourceRails.baseRailSampleIndices[leafIndex] + phaseFrameIndex;
        x = roundTiesToEven(
          x * (1 - eased) + nextRails.coordinates[nextRailSampleIndex * 2] * eased);
        y = roundTiesToEven(
          y * (1 - eased) + nextRails.coordinates[nextRailSampleIndex * 2 + 1] * eased);
        luminance = roundTiesToEven(
          luminance * (1 - eased) + nextRails.luminances[nextRailSampleIndex] * eased);
      }
      if (repairIndex < repairEnd) {
        const packedRepair = bank.packedRepairs[repairIndex];
        const repairLeafIndex = packedRepair & 0x7ff;
        if (repairLeafIndex < leafIndex) {
          throw new Error(`BlackHole prepared repair order for frame ${globalFrameIndex} drifted`);
        }
        if (repairLeafIndex === leafIndex) {
          const direction = REPAIR_DIRECTIONS[packedRepair >> 11 & 0x7];
          const radius = (packedRepair >> 14 & 0x7) + 1;
          x += direction[0] * 10 * radius;
          y += direction[1] * 10 * radius;
          repairIndex += 1;
        }
      }
      const sampleIndex = localFrameIndex * catalog.starCount + leafIndex;
      const coordinateOffset = sampleIndex * 2;
      coordinates[coordinateOffset] = x;
      coordinates[coordinateOffset + 1] = y;
      const opacityIndex = quantizeBlackHolePreparedOpacityIndex(luminance);
      if (localFrameIndex === 0 || opacityIndex !== previousOpacityIndices[leafIndex]) {
        if (opacityAssignmentCount >= opacityLeafIndices.length) {
          throw new Error("BlackHole rail opacity assignments exceeded prepared bound");
        }
        opacityLeafIndices[opacityAssignmentCount] = leafIndex;
        opacityAssignmentIndices[opacityAssignmentCount] = opacityIndex;
        opacityAssignmentCount += 1;
      }
      previousOpacityIndices[leafIndex] = opacityIndex;
      let nextPhaseFrameIndex = phaseFrameIndex + sourceRails.turns[leafIndex];
      if (nextPhaseFrameIndex >= sourceFrameCount) nextPhaseFrameIndex -= sourceFrameCount;
      phaseFrameIndices[leafIndex] = nextPhaseFrameIndex;
      if ((sampleIndex & 0xff) === 0 &&
          performance.now() - sliceStartedAt >= MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS) {
        maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
          performance.now() - sliceStartedAt);
        sliceCount += 1;
        await yieldTask();
        sliceStartedAt = performance.now();
      }
    }
    if (repairIndex !== repairEnd) {
      throw new Error(`BlackHole prepared repairs for frame ${globalFrameIndex} were not consumed`);
    }
    opacityFrameOffsets[localFrameIndex + 1] = opacityAssignmentCount;
  }
  maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
    performance.now() - sliceStartedAt);
  sliceCount += 1;
  await yieldTask();

  if (opacityFrameOffsets.at(-1) !== opacityAssignmentCount ||
      opacityFrameOffsets[1] !== catalog.starCount) {
    throw new Error("BlackHole rail opacity schedule drifted");
  }
  return Object.freeze({
    coordinates,
    opacitySchedule: Object.freeze({
      frameOffsets: opacityFrameOffsets,
      leafIndices: opacityLeafIndices.slice(0, opacityAssignmentCount),
      opacityIndices: opacityAssignmentIndices.slice(0, opacityAssignmentCount),
    }),
    maximumSliceMilliseconds,
    sliceCount,
  });
}

function roundTiesToEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function equalTypedValues(left, right) {
  return left?.length === right?.length && left.every((value, index) => value === right[index]);
}

function trimBanks() {
  for (const index of banks.keys()) if (retainedBanks[index] === 0) banks.delete(index);
}

async function verify(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) throw new Error(`BlackHole ${label} length drifted`);
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) throw new Error(`BlackHole ${label} hash drifted`);
}

function normalize(index, count) {
  return (index % count + count) % count;
}

function yieldTask() {
  if (typeof globalThis.scheduler?.yield === "function") return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function postError(error, requestId) {
  self.postMessage({
    type: "error",
    requestId,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  });
}
