// SPDX-License-Identifier: MIT
import {
  createBlackHolePreparedBlockCoordinateDecoder,
  decodeBlackHolePreparedOpacitySchedule,
  formatBlackHolePreparedTransform,
  readBlackHolePreparedBankSections,
} from "../shared/cssblackhole/preparedBlockTransport.mjs";

const MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS = 2;
const TRANSFORM_RESPONSE_CHUNK_SIZE = 4_096;
let catalog = null;
let tail = Promise.resolve();
const retainedBanks = new Uint8Array(256);
const banks = new Map();

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
  const bank = readBlackHolePreparedBankSections(decoded, descriptor, catalog);
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

async function materializeBlock(data) {
  const startedAt = performance.now();
  const blockIndex = normalize(data.blockIndex, catalog.blockCount);
  const bankIndex = Math.floor(blockIndex / catalog.blocksPerBank);
  const bankBlockIndex = blockIndex % catalog.blocksPerBank;
  const bank = banks.get(bankIndex);
  if (!bank) throw new Error(`BlackHole bank ${bankIndex} was not registered before block materialization`);
  let maximumSliceMilliseconds = 0;
  let sliceCount = 0;
  const decoder = createBlackHolePreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
  while (!decoder.finished) {
    const sliceStartedAt = performance.now();
    decoder.step(1_024);
    maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
      performance.now() - sliceStartedAt);
    sliceCount += 1;
    if (!decoder.finished) await yieldTask();
  }
  const opacityScheduleStartedAt = performance.now();
  const opacitySchedule = decodeBlackHolePreparedOpacitySchedule(bank, bankBlockIndex);
  maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
    performance.now() - opacityScheduleStartedAt);
  sliceCount += 1;
  await yieldTask();

  const frameOffsets = new Uint32Array(catalog.blockFrameCount + 1);
  let frameIndex = 0;
  let leafIndex = 0;
  let sliceStartedAt = performance.now();
  while (frameIndex < catalog.blockFrameCount) {
    const sampleIndex = frameIndex * catalog.starCount + leafIndex;
    const coordinateOffset = sampleIndex * 2;
    const x = decoder.coordinates[coordinateOffset];
    const y = decoder.coordinates[coordinateOffset + 1];
    const changed = frameIndex === 0 || x !== decoder.coordinates[coordinateOffset - catalog.starCount * 2] ||
      y !== decoder.coordinates[coordinateOffset - catalog.starCount * 2 + 1];
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
    const x = decoder.coordinates[coordinateOffset];
    const y = decoder.coordinates[coordinateOffset + 1];
    const changed = frameIndex === 0 || x !== decoder.coordinates[coordinateOffset - catalog.starCount * 2] ||
      y !== decoder.coordinates[coordinateOffset - catalog.starCount * 2 + 1];
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
    decodedCoordinateByteLength: decoder.coordinates.byteLength,
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
    if (chunkIndex + 1 < chunkCount) {
      if (data.eager) await yieldTask();
      else await new Promise((resolve) => setTimeout(resolve, catalog.frameMilliseconds));
    }
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
