// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  decodeFlocksPreparedBlock,
} from "../shared/cssflocks/preparedBlockTransport.mjs";
import { CSSFLOCKS_STARTUP_WINDOWS } from "../shared/cssflocks/startupWindows.mjs";

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
  const records = new Map();
  let fetchCount = 0;
  let materializationCount = 0;
  let workerMaterializationCount = 0;
  let cumulativeEncodedBytes = 0;
  let cumulativeDecodedBytes = 0;
  let cumulativePreparedCssStringBytes = 0;
  let abortedLoadCount = 0;
  let staleResponseCount = 0;
  let destroyed = false;

  async function load(index, { eager = false } = {}) {
    if (destroyed) throw new Error("Prepared Flocks block loader is destroyed");
    const descriptor = catalog.entries[index];
    if (!descriptor || descriptor.index !== index) throw new RangeError(`Prepared Flocks block ${index} is missing`);
    if (records.has(index)) return records.get(index).promise;
    const record = {
      controller: new AbortController(),
      promise: null,
      preparedCssStringByteLength: 0,
      materialized: false,
    };
    record.promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(descriptor.assetUrl, {
        cache: "force-cache",
        signal: record.controller.signal,
      }));
      assertCurrent(index, record);
      await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, `block ${index}`);
      cumulativeEncodedBytes += encoded.byteLength;
      const bytes = await decompressGzip(encoded);
      assertCurrent(index, record);
      await verifyBytes(bytes, descriptor.decodedByteLength, descriptor.decodedSha256, `decoded block ${index}`);
      assertCurrent(index, record);
      fetchCount += 1;
      cumulativeDecodedBytes += bytes.byteLength;
      const block = worker
        ? await worker.materialize(bytes, descriptor, { signal: record.controller.signal, eager })
        : decodeFlocksPreparedBlock(bytes, descriptor, catalog);
      assertCurrent(index, record);
      validateBlock(block, descriptor, catalog);
      materializationCount += 1;
      if (worker) workerMaterializationCount += 1;
      cumulativePreparedCssStringBytes += block.preparedCssStringByteLength;
      record.preparedCssStringByteLength = block.preparedCssStringByteLength;
      record.materialized = true;
      return block;
    })();
    records.set(index, record);
    try {
      return await record.promise;
    } catch (error) {
      if (records.get(index) === record) records.delete(index);
      if (error?.name === "AbortError") abortedLoadCount += 1;
      throw error;
    }
  }

  function prefetch(index) {
    void load(index).catch(() => undefined);
  }

  function retain(indices) {
    const retained = new Set(indices);
    for (const [index, record] of records) {
      if (!retained.has(index)) {
        record.controller.abort();
        records.delete(index);
      }
    }
  }

  return Object.freeze({
    load,
    prefetch,
    retain,
    stats() {
      const residentPreparedCssStringBytes = [...records.values()]
        .reduce((total, record) => total + record.preparedCssStringByteLength, 0);
      return Object.freeze({
        fetchCount,
        materializationCount,
        workerMaterializationAvailable: worker !== null,
        workerMaterializationCount,
        cumulativeEncodedBytes,
        cumulativeDecodedBytes,
        cumulativePreparedCssStringBytes,
        residentEncodedBytes: 0,
        residentDecodedBytes: 0,
        residentPreparedCssStringBytes,
        residentBlockCount: records.size,
        pendingBlockCount: [...records.values()].filter((record) => !record.materialized).length,
        abortedLoadCount,
        staleResponseCount: staleResponseCount + (worker?.stats().staleResponseCount ?? 0),
      });
    },
    destroy() {
      destroyed = true;
      for (const record of records.values()) record.controller.abort();
      records.clear();
      worker?.destroy();
    },
  });

  function assertCurrent(index, record) {
    if (destroyed || record.controller.signal.aborted || records.get(index) !== record) {
      staleResponseCount += 1;
      throw abortError(`Prepared Flocks block ${index} left the retained window`);
    }
  }
}

function createWorkerMaterializer(catalog) {
  if (typeof Worker !== "function") return null;
  const worker = new Worker(new URL("./preparedBlockWorker.mjs", import.meta.url), { type: "module" });
  let requestId = 0;
  let initialized = false;
  let destroyed = false;
  let staleResponseCount = 0;
  const pending = new Map();
  const initializedPromise = new Promise((resolve, reject) => {
    pending.set("initialize", { resolve, reject });
  });
  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "initialized") {
      initialized = true;
      pending.get("initialize")?.resolve();
      pending.delete("initialize");
      return;
    }
    const record = pending.get(data?.requestId);
    if (!record) {
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
      record.block = data.block;
      record.chunkCount = data.chunkCount;
      return;
    }
    if (data.type === "materialized-chunk") {
      record.transforms.push(...data.transforms);
      record.colors.push(...data.colors);
      record.received += 1;
      if (record.received === record.chunkCount) {
        pending.delete(data.requestId);
        record.cleanup?.();
        record.resolve(Object.freeze({
          ...record.block,
          playback: Object.freeze({
            ...record.block.playback,
            transforms: Object.freeze(record.transforms),
            colors: Object.freeze(record.colors),
          }),
        }));
      }
    }
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Prepared Flocks worker failed");
    for (const record of pending.values()) record.reject(error);
    pending.clear();
  });
  worker.postMessage({ type: "initialize", catalog });
  return Object.freeze({
    async materialize(bytes, descriptor, { signal, eager = false } = {}) {
      if (destroyed) throw new Error("Prepared Flocks worker is destroyed");
      if (!initialized) await initializedPromise;
      if (signal?.aborted) throw abortError(`Prepared Flocks block ${descriptor.index} materialization was canceled`);
      const id = requestId++;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const record = pending.get(id);
          if (!record) return;
          pending.delete(id);
          worker.postMessage({ type: "cancel", requestId: id });
          record.cleanup();
          reject(abortError(`Prepared Flocks block ${descriptor.index} materialization was canceled`));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        pending.set(id, { resolve, reject, cleanup, block: null, chunkCount: 0, received: 0, transforms: [], colors: [] });
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.postMessage({ type: "materialize", requestId: id, bytes, descriptor, eager }, [bytes.buffer]);
      });
    },
    stats() {
      return Object.freeze({ staleResponseCount });
    },
    destroy() {
      destroyed = true;
      worker.terminate();
      for (const record of pending.values()) {
        record.cleanup?.();
        record.reject(new Error("Prepared Flocks worker was destroyed"));
      }
      pending.clear();
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
