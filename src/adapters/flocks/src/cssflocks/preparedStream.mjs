// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  decodeFlocksPreparedBlock,
} from "../shared/cssflocks/preparedBlockTransport.mjs";
import { CSSFLOCKS_STARTUP_WINDOWS } from "../shared/cssflocks/startupWindows.mjs";

const RUNTIME_LOOKAHEAD_BLOCK_COUNT = 11;
const RUNTIME_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT = 2;
const STARTUP_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT = 2;

export async function loadFlocksPreparedCatalog(descriptor) {
  if (typeof descriptor?.catalogUrl !== "string" ||
      !/^[a-f0-9]{64}$/u.test(descriptor.catalogSha256 ?? "") ||
      !Number.isSafeInteger(descriptor.catalogBytes) || descriptor.catalogBytes < 1) {
    throw new Error("Prepared Flocks catalog descriptor is invalid");
  }
  const bytes = new Uint8Array(await fetchBytes(descriptor.catalogUrl, { cache: "no-store" }));
  await verifyBytes(bytes, descriptor.catalogBytes, descriptor.catalogSha256, "catalog");
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  validateCatalog(catalog);
  return Object.freeze(catalog);
}

export function createFlocksPreparedBlockLoader(catalog) {
  validateCatalog(catalog);
  const worker = createWorkerMaterializer(catalog);
  const decodedRecords = new Map();
  const blockRecords = new Map();
  let desiredBlockIndices = new Set();
  let fetchCount = 0;
  let materializationCount = 0;
  let workerMaterializationCount = 0;
  let releaseCount = 0;
  let verifiedBlockReleaseCount = 0;
  let cumulativeEncodedBytes = 0;
  let cumulativeDecodedBytes = 0;
  let cumulativePreparedCssStringBytes = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let residentPreparedCssStringBytes = 0;
  let peakResidentPreparedCssStringBytes = 0;
  let abortedLoadCount = 0;
  let staleResponseCount = 0;
  let destroyed = false;

  function descriptorFor(index) {
    if (destroyed) throw new Error("Prepared Flocks block loader is destroyed");
    const descriptor = catalog.entries[index];
    if (!descriptor || descriptor.index !== index) {
      throw new RangeError(`Prepared Flocks block ${index} is missing`);
    }
    return descriptor;
  }

  async function ensureDecoded(index) {
    const descriptor = descriptorFor(index);
    const existing = decodedRecords.get(index);
    if (existing?.bytes) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(descriptor.assetUrl, { cache: "force-cache" }));
      await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, `block ${index}`);
      cumulativeEncodedBytes += encoded.byteLength;
      const bytes = await decompressGzip(encoded);
      await verifyBytes(bytes, descriptor.decodedByteLength, descriptor.decodedSha256, `decoded block ${index}`);
      const record = Object.freeze({ bytes, decodedByteLength: bytes.byteLength });
      decodedRecords.set(index, record);
      fetchCount += 1;
      cumulativeDecodedBytes += bytes.byteLength;
      residentDecodedBytes += bytes.byteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (!desiredBlockIndices.has(index)) releaseDecoded(index, record);
      return record;
    })();
    decodedRecords.set(index, { promise });
    try {
      return await promise;
    } catch (error) {
      if (decodedRecords.get(index)?.promise === promise) decodedRecords.delete(index);
      throw error;
    }
  }

  async function load(index, { eager = false } = {}) {
    const descriptor = descriptorFor(index);
    const existing = blockRecords.get(index);
    if (existing?.block) return existing.block;
    if (existing?.promise) return existing.promise;
    const record = {
      controller: new AbortController(),
      promise: null,
      preparedCssStringByteLength: 0,
      block: null,
    };
    record.promise = (async () => {
      const decodedRecord = await ensureDecoded(index);
      assertCurrent(index, record);
      const result = worker
        ? await worker.materialize(decodedRecord.bytes, descriptor, { signal: record.controller.signal, eager })
        : Object.freeze({ block: decodeFlocksPreparedBlock(decodedRecord.bytes, descriptor, catalog) });
      assertCurrent(index, record);
      const block = result.block;
      validateBlock(block, descriptor, catalog);
      materializationCount += 1;
      if (worker) workerMaterializationCount += 1;
      cumulativePreparedCssStringBytes += block.preparedCssStringByteLength;
      record.preparedCssStringByteLength = block.preparedCssStringByteLength;
      record.block = block;
      residentPreparedCssStringBytes += block.preparedCssStringByteLength;
      peakResidentPreparedCssStringBytes = Math.max(
        peakResidentPreparedCssStringBytes,
        residentPreparedCssStringBytes,
      );
      if (!desiredBlockIndices.has(index)) releaseBlock(index, record);
      return block;
    })();
    blockRecords.set(index, record);
    try {
      return await record.promise;
    } catch (error) {
      if (blockRecords.get(index) === record) blockRecords.delete(index);
      if (error?.name === "AbortError") abortedLoadCount += 1;
      throw error;
    }
  }

  async function prime(indices) {
    if (!Array.isArray(indices) || indices.some((index) => !Number.isSafeInteger(index))) {
      throw new TypeError("Prepared Flocks verified block horizon is invalid");
    }
    await Promise.all(indices.map((index) => ensureDecoded(index)));
  }

  function prefetch(index) {
    void ensureDecoded(index).catch(() => undefined);
  }

  function retain(indices) {
    desiredBlockIndices = new Set(indices);
    for (const [index, record] of blockRecords) {
      if (!desiredBlockIndices.has(index)) releaseBlock(index, record);
    }
    for (const [index, record] of decodedRecords) {
      if (!desiredBlockIndices.has(index)) releaseDecoded(index, record);
    }
  }

  function releaseBlock(index, record) {
    if (blockRecords.get(index) !== record) return;
    blockRecords.delete(index);
    record.controller.abort();
    if (record.block) {
      residentPreparedCssStringBytes -= record.preparedCssStringByteLength;
      releaseCount += 1;
    }
  }

  function releaseDecoded(index, record) {
    if (!record?.bytes || decodedRecords.get(index) !== record) return;
    decodedRecords.delete(index);
    residentDecodedBytes -= record.decodedByteLength;
    verifiedBlockReleaseCount += 1;
  }

  return Object.freeze({
    load,
    prime,
    prefetch,
    retain,
    stats() {
      return Object.freeze({
        fetchCount,
        materializationCount,
        workerMaterializationAvailable: worker !== null,
        workerMaterializationCount,
        releaseCount,
        verifiedBlockReleaseCount,
        cumulativeEncodedBytes,
        cumulativeDecodedBytes,
        cumulativePreparedCssStringBytes,
        residentEncodedBytes: 0,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        residentPreparedCssStringBytes,
        peakResidentPreparedCssStringBytes,
        residentVerifiedBlockCount: [...decodedRecords.values()].filter((record) => record?.bytes).length,
        residentBlockCount: [...blockRecords.values()].filter((record) => record?.block).length,
        pendingBlockCount: [...blockRecords.values()].filter((record) => !record?.block).length,
        abortedLoadCount,
        staleResponseCount: staleResponseCount + (worker?.stats().staleResponseCount ?? 0),
        workerMaterializationRequestCount: worker?.stats().requestCount ?? 0,
        workerMaterializationCompletedBlockCount: worker?.stats().completedBlockCount ?? 0,
        workerMaterializationMaximumBlockMilliseconds: worker?.stats().maximumBlockMilliseconds ?? 0,
        workerMaterializationResponseChunkCount: worker?.stats().responseChunkCount ?? 0,
        workerMaterializationResponseIdleSliceCount: worker?.stats().responseIdleSliceCount ?? 0,
        workerMaterializationMaximumResponseChunkBytes: worker?.stats().maximumResponseChunkBytes ?? 0,
        desiredBlockIndices: Object.freeze([...desiredBlockIndices].sort((left, right) => left - right)),
      });
    },
    destroy() {
      destroyed = true;
      retain([]);
      worker?.destroy();
    },
  });

  function assertCurrent(index, record) {
    if (destroyed || record.controller.signal.aborted || blockRecords.get(index) !== record) {
      staleResponseCount += 1;
      throw abortError(`Prepared Flocks block ${index} left the retained window`);
    }
  }
}

function createWorkerMaterializer(catalog) {
  if (typeof Worker !== "function") return null;
  const worker = new Worker(new URL("./preparedBlockWorker.mjs", import.meta.url), { type: "module" });
  const responseChunkQueue = [];
  const canceledRequestIds = new Set();
  const requestIdle = globalThis.requestIdleCallback?.bind(globalThis) ??
    ((callback) => setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0));
  const cancelIdle = globalThis.cancelIdleCallback?.bind(globalThis) ?? clearTimeout;
  let responseIdleRequest = null;
  let requestId = 0;
  let destroyed = false;
  let staleResponseCount = 0;
  let requestCount = 0;
  let completedBlockCount = 0;
  let maximumBlockMilliseconds = 0;
  let responseChunkCount = 0;
  let responseIdleSliceCount = 0;
  let maximumResponseChunkBytes = 0;
  const pending = new Map();
  let resolveInitialization;
  let rejectInitialization;
  const initialized = new Promise((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });

  function rejectAll(error) {
    rejectInitialization(error);
    for (const record of pending.values()) {
      record.cleanup?.();
      record.reject(error);
    }
    pending.clear();
    responseChunkQueue.length = 0;
    if (responseIdleRequest !== null) cancelIdle(responseIdleRequest);
    responseIdleRequest = null;
  }

  function scheduleResponseChunk() {
    if (responseIdleRequest !== null || responseChunkQueue.length === 0) return;
    responseIdleRequest = requestIdle(processResponseChunk, { timeout: 500 });
  }

  function processResponseChunk() {
    responseIdleRequest = null;
    const queued = responseChunkQueue.shift();
    if (!queued) return;
    const { data, record, response } = queued;
    if (pending.get(data.requestId) !== record || record.response !== response) {
      scheduleResponseChunk();
      return;
    }
    response.transforms.push(...data.transforms);
    response.colors.push(...data.colors);
    response.processedChunkCount += 1;
    response.idleSliceCount += 1;
    response.maximumChunkBytes = Math.max(response.maximumChunkBytes, data.chunkByteLength);
    if (response.processedChunkCount === response.chunkCount) {
      const expectedStateCount = response.block.playback.frameCount * response.block.playback.bugCount;
      if (response.transforms.length !== expectedStateCount || response.colors.length !== expectedStateCount) {
        rejectAll(new Error("Prepared Flocks worker response drifted"));
        return;
      }
      const block = Object.freeze({
        ...response.block,
        playback: Object.freeze({
          ...response.block.playback,
          transforms: Object.freeze(response.transforms),
          colors: Object.freeze(response.colors),
        }),
      });
      pending.delete(data.requestId);
      record.cleanup?.();
      completedBlockCount += 1;
      maximumBlockMilliseconds = Math.max(maximumBlockMilliseconds, response.durationMilliseconds);
      responseChunkCount += response.chunkCount;
      responseIdleSliceCount += response.idleSliceCount;
      maximumResponseChunkBytes = Math.max(maximumResponseChunkBytes, response.maximumChunkBytes);
      record.resolve(Object.freeze({ block }));
    }
    scheduleResponseChunk();
  }

  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "initialized") {
      resolveInitialization();
      return;
    }
    const record = pending.get(data?.requestId);
    if (!record) {
      if (Number.isSafeInteger(data?.requestId) && canceledRequestIds.has(data.requestId)) {
        if (data.type === "error" ||
            (data.type === "materialized-chunk" && data.chunkIndex + 1 === data.chunkCount)) {
          canceledRequestIds.delete(data.requestId);
        }
        return;
      }
      if (Number.isSafeInteger(data?.requestId)) staleResponseCount += 1;
      return;
    }
    if (data.type === "error") {
      pending.delete(data.requestId);
      record.cleanup?.();
      record.reject(new Error(data.stack || data.message));
      return;
    }
    if (data.type === "materialized-start") {
      const expectedStateCount = data.block?.playback?.frameCount * data.block?.playback?.bugCount;
      if (record.response !== null || !Number.isSafeInteger(data.chunkCount) || data.chunkCount < 1 ||
          !Number.isSafeInteger(expectedStateCount) || expectedStateCount < 1 ||
          !Number.isFinite(data.durationMilliseconds) || data.durationMilliseconds < 0) {
        rejectAll(new Error("Prepared Flocks worker response drifted"));
        return;
      }
      record.response = {
        block: data.block,
        chunkCount: data.chunkCount,
        queuedChunkCount: 0,
        processedChunkCount: 0,
        durationMilliseconds: data.durationMilliseconds,
        idleSliceCount: 0,
        maximumChunkBytes: 0,
        transforms: [],
        colors: [],
      };
      return;
    }
    if (data.type === "materialized-chunk") {
      const response = record.response;
      if (!response || !Number.isSafeInteger(data.chunkIndex) || data.chunkIndex < 0 ||
          data.chunkIndex !== response.queuedChunkCount || data.chunkCount !== response.chunkCount ||
          !Array.isArray(data.transforms) || data.transforms.length < 1 || data.transforms.length > 960 ||
          !Array.isArray(data.colors) || data.colors.length !== data.transforms.length ||
          !Number.isSafeInteger(data.chunkByteLength) || data.chunkByteLength < 1) {
        rejectAll(new Error("Prepared Flocks worker response drifted"));
        return;
      }
      response.queuedChunkCount += 1;
      responseChunkQueue.push({ data, record, response });
      scheduleResponseChunk();
    }
  });
  worker.addEventListener("error", (event) => {
    rejectAll(new Error(event.message || "Prepared Flocks worker failed"));
  });
  worker.postMessage({ type: "initialize", catalog });
  return Object.freeze({
    async materialize(bytes, descriptor, { signal, eager = false } = {}) {
      if (destroyed) throw new Error("Prepared Flocks worker is destroyed");
      await initialized;
      if (signal?.aborted) throw abortError(`Prepared Flocks block ${descriptor.index} materialization was canceled`);
      const id = requestId++;
      requestCount += 1;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const record = pending.get(id);
          if (!record) return;
          pending.delete(id);
          canceledRequestIds.add(id);
          worker.postMessage({ type: "cancel", requestId: id });
          record.cleanup();
          reject(abortError(`Prepared Flocks block ${descriptor.index} materialization was canceled`));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        pending.set(id, { resolve, reject, cleanup, response: null });
        signal?.addEventListener("abort", onAbort, { once: true });
        const workerBytes = bytes.slice();
        worker.postMessage({
          type: "materialize",
          requestId: id,
          bytes: workerBytes,
          descriptor,
          eager,
        }, [workerBytes.buffer]);
      });
    },
    stats() {
      return Object.freeze({
        staleResponseCount,
        requestCount,
        completedBlockCount,
        maximumBlockMilliseconds,
        responseChunkCount,
        responseIdleSliceCount,
        maximumResponseChunkBytes,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectAll(new Error("Prepared Flocks worker was destroyed"));
      worker.terminate();
    },
  });
}

function validateCatalog(catalog) {
  if (catalog?.schema !== "cssflocks-prepared-stream-catalog@1" ||
      catalog.playbackSchema !== CSSFLOCKS_PLAYBACK_SCHEMA ||
      catalog.sourceDefaultBugCount !== 1_004 ||
      catalog.leaderCount !== 4 ||
      catalog.bugCount !== catalog.leaderCount + catalog.followerCount ||
      catalog.leafCount !== catalog.bugCount * catalog.facesPerBug ||
      catalog.framesPerSecond !== 60 ||
      catalog.frameMilliseconds !== 1_000 / 60 ||
      catalog.blockCount !== catalog.entries?.length ||
      catalog.runtimeLookaheadBlockCount !== RUNTIME_LOOKAHEAD_BLOCK_COUNT ||
      catalog.runtimeMaterializedLookaheadBlockCount !== RUNTIME_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT ||
      catalog.startupMaterializedLookaheadBlockCount !== STARTUP_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT ||
      catalog.startupMaterializedLookaheadBlockCount > catalog.runtimeMaterializedLookaheadBlockCount ||
      catalog.runtimeMaterializedLookaheadBlockCount > catalog.runtimeLookaheadBlockCount ||
      catalog.streamFrameCount !== catalog.blockCount * catalog.blockFrameCount ||
      catalog.sourceFrameCount < 216 * catalog.framesPerSecond ||
      catalog.terminalSeam?.strategy !== "cubic-hermite-correspondence" ||
      catalog.terminalSeam?.sourceBehaviorDeviation !== true ||
      !isPermutation(catalog.terminalSeam?.correspondence, catalog.bugCount) ||
      !Array.isArray(catalog.startupWindows) || catalog.startupWindows.length !== CSSFLOCKS_STARTUP_WINDOWS.length ||
      catalog.startupWindows.some((window, index) =>
        window.id !== CSSFLOCKS_STARTUP_WINDOWS[index].id || window.blockIndex !== CSSFLOCKS_STARTUP_WINDOWS[index].blockIndex) ||
      catalog.entries.some((entry, index) =>
        entry.index !== index || entry.encoding !== CSSFLOCKS_BLOCK_ENCODING ||
        entry.startFrameIndex !== index * catalog.blockFrameCount ||
        entry.frameCount !== catalog.blockFrameCount)) {
    throw new Error("Prepared Flocks catalog binding drifted");
  }
}

function isPermutation(values, count) {
  return Array.isArray(values) && values.length === count &&
    values.every((value) => Number.isSafeInteger(value) && value >= 0 && value < count) &&
    new Set(values).size === count;
}

function validateBlock(block, descriptor, catalog) {
  if (block?.schema !== "cssflocks-prepared-stream-block@1" ||
      block.index !== descriptor.index || block.startFrameIndex !== descriptor.startFrameIndex ||
      block.playback?.schema !== CSSFLOCKS_PLAYBACK_SCHEMA ||
      block.playback.modelId !== catalog.modelId || block.playback.bugCount !== catalog.bugCount ||
      block.playback.transforms?.length !== descriptor.frameCount * catalog.bugCount ||
      block.playback.colors?.length !== descriptor.frameCount * catalog.bugCount) {
    throw new Error(`Prepared Flocks block ${descriptor.index} binding drifted`);
  }
}

async function fetchBytes(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Prepared Flocks asset failed: ${response.status} ${url}`);
  return response.arrayBuffer();
}

async function verifyBytes(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) throw new Error(`Prepared Flocks ${label} byte length drifted`);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== expectedSha256) throw new Error(`Prepared Flocks ${label} SHA-256 drifted`);
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("Prepared Flocks gzip decoding is unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
