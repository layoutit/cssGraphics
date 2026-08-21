import {
  CSSCYCLONE_BLOCK_ENCODING,
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
  decodeCyclonePreparedBlock,
  decodeCyclonePreparedBlockIncrementally,
} from "../shared/csscyclone/preparedBlockTransport.mjs";

const CATALOG_SCHEMA = "csscyclone-prepared-stream-catalog@3";
const BLOCK_SCHEMA = "csscyclone-prepared-stream-block@2";
const RUNTIME_LOOKAHEAD_BLOCK_COUNT = 11;
const RUNTIME_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT = 2;
const STARTUP_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT = 2;
const STARTUP_HUE_SECTOR_NAMES = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const STARTUP_PALETTE_FAMILIES = Object.freeze(["blue", "yellow", "red", "magenta", "green"]);
const STARTUP_PALETTE_VARIANT_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) =>
  `rotate-${String(index * 30).padStart(3, "0")}`));
const STARTUP_PALETTE_VARIANT_WEIGHTS = Object.freeze([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
const STARTUP_SILHOUETTE_SAMPLING = "browser-reviewed-expressive-source-windows";
const STARTUP_SELECTION = "session-weighted-shuffled-hue-rotation-plus-crypto-source-window-no-immediate-repeat";

export async function loadCyclonePreparedCatalog(descriptor) {
  if (typeof descriptor?.catalogUrl !== "string" ||
      !/^[a-f0-9]{64}$/u.test(descriptor.catalogSha256 ?? "") ||
      !Number.isSafeInteger(descriptor.catalogBytes) || descriptor.catalogBytes < 1) {
    throw new Error("Prepared Cyclone catalog descriptor is invalid");
  }
  const bytes = new Uint8Array(await fetchBytes(descriptor.catalogUrl, { cache: "no-store" }));
  await verifyBytes(bytes, descriptor.catalogBytes, descriptor.catalogSha256, "stream catalog");
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  validateCatalog(catalog);
  return Object.freeze(catalog);
}

export function selectInitialCyclonePosition(catalog, {
  search = globalThis.location?.search ?? "",
  previousSelectionId = null,
  preferredPaletteVariantId = null,
  randomUint32Pair = cryptoRandomUint32Pair,
} = {}) {
  validateCatalog(catalog);
  const params = new URLSearchParams(search);
  const requestedChunk = params.get("chunk");
  const requestedFrame = params.get("frame");
  const requestedPaletteVariantId = params.get("palette");
  if (requestedChunk !== null || requestedFrame !== null) {
    const chunkIndex = requestedChunk === null ? 0 : Number(requestedChunk);
    const frameIndex = requestedFrame === null ? 0 : Number(requestedFrame);
    const paletteVariantId = requestedPaletteVariantId ?? catalog.startupPaletteVariantIds[0];
    validatePosition(catalog, chunkIndex, frameIndex);
    if (!catalog.startupPaletteVariantIds.includes(paletteVariantId)) {
      throw new RangeError("Requested Cyclone palette variant is invalid");
    }
    return Object.freeze({ paletteVariantId, chunkIndex, frameIndex, mode: "explicit" });
  }
  if (previousSelectionId !== null &&
      (typeof previousSelectionId !== "string" ||
        !catalog.startupSelections.some((selection) => selection.id === previousSelectionId))) {
    throw new RangeError("Previous Cyclone start selection is invalid");
  }
  if (preferredPaletteVariantId !== null &&
      !catalog.startupPaletteVariantIds.includes(preferredPaletteVariantId)) {
    throw new RangeError("Preferred Cyclone palette variant is invalid");
  }
  const values = randomUint32Pair();
  if (!Array.isArray(values) || values.length !== 2 ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new RangeError("Cyclone startup random values must be two uint32 values");
  }
  const paletteVariantId = preferredPaletteVariantId ??
    catalog.startupPaletteVariantIds[values[0] % catalog.startupPaletteVariantIds.length];
  let selectionIndex = (preferredPaletteVariantId === null
    ? Math.floor(values[0] / catalog.startupPaletteVariantIds.length)
    : values[0]) % catalog.startupSelections.length;
  if (catalog.startupSelections[selectionIndex].id === previousSelectionId &&
      catalog.startupSelections.length > 1) {
    selectionIndex = (selectionIndex + 1) % catalog.startupSelections.length;
  }
  const selection = catalog.startupSelections[selectionIndex];
  const frameIndex = selection.startFrameIndex + values[1] % selection.frameCount;
  return Object.freeze({
    selectionId: selection.id,
    paletteVariantId,
    sourcePaletteFamily: selection.paletteFamily,
    chunkIndex: selection.chunkIndex,
    frameIndex,
    mode: preferredPaletteVariantId !== null
      ? "session-weighted-shuffled-hue-rotation-crypto-random-source-window"
      : previousSelectionId === null
      ? "crypto-random-balanced-source-palette"
      : "crypto-random-balanced-source-palette-no-repeat",
  });
}

export function createCyclonePreparedBlockLoader(catalog) {
  validateCatalog(catalog);
  const decodedRecords = new Map();
  const blockRecords = new Map();
  const workerMaterializer = createWorkerBlockMaterializer(catalog);
  let desiredBlockIndices = new Set();
  let fetchCount = 0;
  let loadCount = 0;
  let releaseCount = 0;
  let verifiedBlockReleaseCount = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let residentPreparedCssStringBytes = 0;
  let peakResidentPreparedCssStringBytes = 0;
  let preparedMatrixExpansionCount = 0;
  let incrementalDecodeRequestCount = 0;
  let incrementalDecodeCompletedBlockCount = 0;
  let incrementalDecodeSliceCount = 0;
  let incrementalDecodeOperationCount = 0;
  let incrementalDecodeMaximumSliceMilliseconds = 0;
  let incrementalDecodeQueuedCount = 0;
  let incrementalDecodeActiveCount = 0;
  let incrementalDecodeMaximumQueuedCount = 0;
  let workerMaterializationRequestCount = 0;
  let workerMaterializationCompletedBlockCount = 0;
  let workerMaterializationMaximumBlockMilliseconds = 0;
  let workerMaterializationResponseChunkCount = 0;
  let workerMaterializationResponseIdleSliceCount = 0;
  let workerMaterializationMaximumResponseChunkBytes = 0;
  let incrementalDecodeTail = Promise.resolve();
  let destroyed = false;

  function descriptorFor(streamBlockIndex) {
    if (destroyed) throw new Error("Prepared Cyclone block loader is destroyed");
    const descriptor = catalog.entries[streamBlockIndex];
    if (!descriptor || descriptor.index !== streamBlockIndex) {
      throw new RangeError(`Prepared Cyclone block ${streamBlockIndex} is missing`);
    }
    return descriptor;
  }

  async function ensureDecoded(streamBlockIndex) {
    const descriptor = descriptorFor(streamBlockIndex);
    const existing = decodedRecords.get(streamBlockIndex);
    if (existing?.bytes) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(descriptor.assetUrl, { cache: "force-cache" }));
      await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, `block ${streamBlockIndex}`);
      const bytes = await decompressGzip(encoded);
      await verifyBytes(
        bytes,
        descriptor.decodedByteLength,
        descriptor.decodedSha256,
        `decoded block ${streamBlockIndex}`,
      );
      const record = Object.freeze({ bytes, decodedByteLength: bytes.byteLength });
      decodedRecords.set(streamBlockIndex, record);
      fetchCount += 1;
      residentDecodedBytes += bytes.byteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (!desiredBlockIndices.has(streamBlockIndex)) releaseDecoded(streamBlockIndex, record);
      return record;
    })();
    decodedRecords.set(streamBlockIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (decodedRecords.get(streamBlockIndex)?.promise === promise) {
        decodedRecords.delete(streamBlockIndex);
      }
      throw error;
    }
  }

  function scheduleIncrementalDecode(work) {
    incrementalDecodeQueuedCount += 1;
    incrementalDecodeMaximumQueuedCount = Math.max(
      incrementalDecodeMaximumQueuedCount,
      incrementalDecodeQueuedCount,
    );
    const scheduled = incrementalDecodeTail.then(async () => {
      incrementalDecodeQueuedCount -= 1;
      incrementalDecodeActiveCount = 1;
      try {
        return await work();
      } finally {
        incrementalDecodeActiveCount = 0;
      }
    });
    incrementalDecodeTail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  async function load(streamBlockIndex, { incremental = false, offMainThread = false } = {}) {
    const descriptor = descriptorFor(streamBlockIndex);
    const existing = blockRecords.get(streamBlockIndex);
    if (existing?.block) return existing.block;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const decodedRecord = await ensureDecoded(streamBlockIndex);
      if (offMainThread && workerMaterializer !== null) {
        workerMaterializationRequestCount += 1;
      } else if (incremental) {
        incrementalDecodeRequestCount += 1;
      }
      let workerDurationMilliseconds = 0;
      let workerResponseChunkCount = 0;
      let workerResponseIdleSliceCount = 0;
      let workerMaximumResponseChunkBytes = 0;
      const block = offMainThread && workerMaterializer !== null
        ? await workerMaterializer.materialize(
          decodedRecord.bytes,
          descriptor,
          { incremental },
        ).then((result) => {
          workerDurationMilliseconds = result.durationMilliseconds;
          workerResponseChunkCount = result.responseChunkCount;
          workerResponseIdleSliceCount = result.responseIdleSliceCount;
          workerMaximumResponseChunkBytes = result.maximumResponseChunkBytes;
          return result.block;
        })
        : incremental
        ? await scheduleIncrementalDecode(() => decodeCyclonePreparedBlockIncrementally(
          decodedRecord.bytes,
          descriptor,
          catalog,
          {
            isCurrent: () => !destroyed && desiredBlockIndices.has(streamBlockIndex),
            onSlice(operationCount, durationMilliseconds) {
              incrementalDecodeSliceCount += 1;
              incrementalDecodeOperationCount += operationCount;
              incrementalDecodeMaximumSliceMilliseconds = Math.max(
                incrementalDecodeMaximumSliceMilliseconds,
                durationMilliseconds,
              );
            },
          },
        ))
        : decodeCyclonePreparedBlock(decodedRecord.bytes, descriptor, catalog);
      if (block === null) {
        throw new Error(`Prepared Cyclone block ${streamBlockIndex} incremental decode was cancelled`);
      }
      validateBlock(block, descriptor, catalog);
      const record = Object.freeze({
        block,
        preparedCssStringByteLength: block.preparedCssStringByteLength,
      });
      blockRecords.set(streamBlockIndex, record);
      loadCount += 1;
      if (offMainThread && workerMaterializer !== null) {
        workerMaterializationCompletedBlockCount += 1;
        workerMaterializationMaximumBlockMilliseconds = Math.max(
          workerMaterializationMaximumBlockMilliseconds,
          workerDurationMilliseconds,
        );
        workerMaterializationResponseChunkCount += workerResponseChunkCount;
        workerMaterializationResponseIdleSliceCount += workerResponseIdleSliceCount;
        workerMaterializationMaximumResponseChunkBytes = Math.max(
          workerMaterializationMaximumResponseChunkBytes,
          workerMaximumResponseChunkBytes,
        );
      } else if (incremental) {
        incrementalDecodeCompletedBlockCount += 1;
      }
      preparedMatrixExpansionCount += block.preparedMatrixExpansionCount;
      residentPreparedCssStringBytes += block.preparedCssStringByteLength;
      peakResidentPreparedCssStringBytes = Math.max(
        peakResidentPreparedCssStringBytes,
        residentPreparedCssStringBytes,
      );
      if (!desiredBlockIndices.has(streamBlockIndex)) releaseBlock(streamBlockIndex, record);
      return block;
    })();
    blockRecords.set(streamBlockIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (blockRecords.get(streamBlockIndex)?.promise === promise) {
        blockRecords.delete(streamBlockIndex);
      }
      throw error;
    }
  }

  async function prime(streamBlockIndices) {
    if (!Array.isArray(streamBlockIndices) ||
        streamBlockIndices.some((index) => !Number.isSafeInteger(index))) {
      throw new TypeError("Prepared Cyclone verified block horizon is invalid");
    }
    await Promise.all(streamBlockIndices.map((streamBlockIndex) => ensureDecoded(streamBlockIndex)));
  }

  function prefetch(streamBlockIndex) {
    void ensureDecoded(streamBlockIndex).catch(() => undefined);
  }

  function retain(streamBlockIndices) {
    desiredBlockIndices = new Set(streamBlockIndices);
    for (const [streamBlockIndex, record] of blockRecords) {
      if (!desiredBlockIndices.has(streamBlockIndex)) releaseBlock(streamBlockIndex, record);
    }
    for (const [streamBlockIndex, record] of decodedRecords) {
      if (!desiredBlockIndices.has(streamBlockIndex)) releaseDecoded(streamBlockIndex, record);
    }
  }

  function releaseBlock(streamBlockIndex, record) {
    if (!record?.block || blockRecords.get(streamBlockIndex) !== record) return;
    blockRecords.delete(streamBlockIndex);
    residentPreparedCssStringBytes -= record.preparedCssStringByteLength;
    releaseCount += 1;
  }

  function releaseDecoded(streamBlockIndex, record) {
    if (!record?.bytes || decodedRecords.get(streamBlockIndex) !== record) return;
    decodedRecords.delete(streamBlockIndex);
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
        loadCount,
        releaseCount,
        verifiedBlockReleaseCount,
        residentVerifiedBlockCount: [...decodedRecords.values()].filter((record) => record?.bytes).length,
        residentBlockCount: [...blockRecords.values()].filter((record) => record?.block).length,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        residentPreparedCssStringBytes,
        peakResidentPreparedCssStringBytes,
        preparedMatrixExpansionCount,
        incrementalDecodeRequestCount,
        incrementalDecodeCompletedBlockCount,
        incrementalDecodeSliceCount,
        incrementalDecodeOperationCount,
        incrementalDecodeMaximumSliceMilliseconds,
        incrementalDecodeQueuedCount,
        incrementalDecodeActiveCount,
        incrementalDecodeMaximumQueuedCount,
        workerMaterializationAvailable: workerMaterializer !== null,
        workerMaterializationRequestCount,
        workerMaterializationCompletedBlockCount,
        workerMaterializationMaximumBlockMilliseconds,
        workerMaterializationResponseChunkCount,
        workerMaterializationResponseIdleSliceCount,
        workerMaterializationResponseAnimationFrameCallbackCount: 0,
        workerMaterializationMaximumResponseChunkBytes,
        desiredBlockIndices: Object.freeze([...desiredBlockIndices].sort((left, right) => left - right)),
      });
    },
    destroy() {
      destroyed = true;
      retain([]);
      workerMaterializer?.destroy();
    },
  });
}

function createWorkerBlockMaterializer(catalog) {
  if (typeof Worker !== "function") return null;
  let worker;
  try {
    worker = new Worker(new URL("./preparedBlockWorker.mjs", import.meta.url), {
      type: "module",
      name: "csscyclone-prepared-block-materializer",
    });
  } catch {
    return null;
  }
  const pending = new Map();
  const responseChunkQueue = [];
  const requestIdle = globalThis.requestIdleCallback?.bind(globalThis) ??
    ((callback) => setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0));
  const cancelIdle = globalThis.cancelIdleCallback?.bind(globalThis) ?? clearTimeout;
  let responseIdleRequest = null;
  let nextRequestId = 0;
  let destroyed = false;
  let resolveInitialization;
  let rejectInitialization;
  const initialized = new Promise((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });

  function rejectAll(error) {
    rejectInitialization(error);
    for (const { reject } of pending.values()) reject(error);
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
    const { data, request, response } = queued;
    if (pending.get(data.requestId) !== request || request.response !== response) {
      scheduleResponseChunk();
      return;
    }
    acceptResponseChunk(data, request, response, true);
    scheduleResponseChunk();
  }

  function acceptResponseChunk(data, request, response, idleSlice) {
    try {
      const isFinalChunk = data.transformChunkIndex + 1 === response.transformChunkCount;
      response.transforms.push(...data.transforms);
      response.processedTransformChunkCount += 1;
      response.idleSliceCount += Number(idleSlice);
      response.receivedTransformBytes += data.transformChunkByteLength;
      response.maximumResponseChunkBytes = Math.max(
        response.maximumResponseChunkBytes,
        data.transformChunkByteLength,
      );
      if (isFinalChunk) completeWorkerResponse(data.requestId, request, response);
    } catch (error) {
      pending.delete(data.requestId);
      request.reject(error);
    }
  }

  function completeWorkerResponse(requestId, request, response) {
    if (response.processedTransformChunkCount !== response.transformChunkCount ||
        response.receivedTransformBytes !== response.transformByteLength ||
        response.transforms.length !== response.expectedTransformCount ||
        response.transforms.some((transform) => !transform.startsWith("matrix3d("))) {
      throw new Error("Prepared Cyclone worker transform response drifted");
    }
    const transforms = Object.freeze(response.transforms);
    const block = Object.freeze({
      ...response.block,
      playback: Object.freeze({ ...response.block.playback, transforms }),
      lighting: Object.freeze(response.block.lighting),
    });
    pending.delete(requestId);
    request.resolve(Object.freeze({
      block,
      durationMilliseconds: response.durationMilliseconds,
      responseChunkCount: response.transformChunkCount,
      responseIdleSliceCount: response.idleSliceCount,
      maximumResponseChunkBytes: response.maximumResponseChunkBytes,
    }));
  }

  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "initialized") {
      resolveInitialization();
      return;
    }
    if (data?.type === "error") {
      const error = new Error(data.message);
      if (data.stack) error.stack = data.stack;
      if (data.requestId === null) rejectAll(error);
      else {
        const request = pending.get(data.requestId);
        pending.delete(data.requestId);
        request?.reject(error);
      }
      return;
    }
    if (data?.type === "materialized-start") {
      const request = pending.get(data.requestId);
      const expectedTransformCount =
        data.block?.playback?.frameCount * data.block?.playback?.particleCount;
      if (!request || request.response !== null ||
          !Number.isSafeInteger(data.transformByteLength) || data.transformByteLength < 1 ||
          !Number.isSafeInteger(data.transformChunkCount) || data.transformChunkCount < 1 ||
          !Number.isSafeInteger(expectedTransformCount) || expectedTransformCount < 1 ||
          !Number.isFinite(data.durationMilliseconds) || data.durationMilliseconds < 0) {
        rejectAll(new Error("Prepared Cyclone worker response drifted"));
        return;
      }
      request.response = {
        block: data.block,
        durationMilliseconds: data.durationMilliseconds,
        transformByteLength: data.transformByteLength,
        transformChunkCount: data.transformChunkCount,
        expectedTransformCount,
        queuedTransformChunkCount: 0,
        processedTransformChunkCount: 0,
        idleSliceCount: 0,
        receivedTransformBytes: 0,
        maximumResponseChunkBytes: 0,
        transforms: [],
      };
      return;
    }
    if (data?.type !== "materialized-chunk" || !Number.isSafeInteger(data.requestId) ||
        !Number.isSafeInteger(data.transformChunkIndex) || data.transformChunkIndex < 0 ||
        !Number.isSafeInteger(data.transformChunkCount) || data.transformChunkCount < 1 ||
        !Array.isArray(data.transforms) || data.transforms.length < 1 || data.transforms.length > 960 ||
        data.transforms.some((transform) =>
          typeof transform !== "string" || !transform.startsWith("matrix3d(")) ||
        !Number.isSafeInteger(data.transformChunkByteLength) || data.transformChunkByteLength < 1) {
      rejectAll(new Error("Prepared Cyclone worker response drifted"));
      return;
    }
    const request = pending.get(data.requestId);
    const response = request?.response;
    if (!request || !response ||
        data.transformChunkIndex !== response.queuedTransformChunkCount ||
        data.transformChunkCount !== response.transformChunkCount) {
      rejectAll(new Error("Prepared Cyclone worker response drifted"));
      return;
    }
    response.queuedTransformChunkCount += 1;
    if (request.incremental) {
      responseChunkQueue.push({ data, request, response });
      scheduleResponseChunk();
    } else {
      acceptResponseChunk(data, request, response, false);
    }
  });
  worker.addEventListener("error", (event) => {
    rejectAll(new Error(event.message || "Prepared Cyclone worker failed"));
  });
  worker.postMessage({ type: "initialize", catalog });

  return Object.freeze({
    async materialize(bytes, descriptor, { incremental }) {
      if (destroyed) throw new Error("Prepared Cyclone worker is destroyed");
      if (typeof incremental !== "boolean") {
        throw new TypeError("Prepared Cyclone worker materialization mode is invalid");
      }
      await initialized;
      const requestId = nextRequestId;
      nextRequestId += 1;
      const workerBytes = bytes.slice();
      const result = new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, response: null, incremental });
      });
      worker.postMessage({
        type: "materialize",
        requestId,
        incremental,
        bytes: workerBytes,
        descriptor,
      }, [workerBytes.buffer]);
      return result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectAll(new Error("Prepared Cyclone worker is destroyed"));
      worker.terminate();
    },
  });
}

export async function decodeCyclonePreparedTransformsIncrementally(
  bytes,
  expectedTransformCount,
  {
    chunkByteLength = 128 * 1_024,
    setDelay = globalThis.setTimeout.bind(globalThis),
  } = {},
) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 ||
      !Number.isSafeInteger(expectedTransformCount) || expectedTransformCount < 1 ||
      !Number.isSafeInteger(chunkByteLength) || chunkByteLength < 1 ||
      chunkByteLength > 128 * 1_024 || typeof setDelay !== "function") {
    throw new TypeError("Prepared Cyclone transform response slicing is invalid");
  }
  const decoder = new TextDecoder();
  const transforms = [];
  let carry = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkByteLength) {
    if (offset > 0) await new Promise((resolve) => setDelay(resolve, 0));
    const end = Math.min(bytes.byteLength, offset + chunkByteLength);
    const isFinalChunk = end === bytes.byteLength;
    const text = carry + decoder.decode(bytes.subarray(offset, end), { stream: !isFinalChunk });
    const lines = text.split("\n");
    if (isFinalChunk) {
      transforms.push(...lines);
      carry = "";
    } else {
      carry = lines.pop();
      transforms.push(...lines);
    }
  }
  if (carry !== "" || transforms.length !== expectedTransformCount ||
      transforms.some((transform) => !transform.startsWith("matrix3d("))) {
    throw new Error("Prepared Cyclone worker transform response drifted");
  }
  return Object.freeze(transforms);
}

function validateCatalog(catalog) {
  if (catalog?.schema !== CATALOG_SCHEMA ||
      typeof catalog.streamId !== "string" ||
      typeof catalog.modelId !== "string" || catalog.modelId.length < 1 ||
      !Number.isSafeInteger(catalog.particleCount) || catalog.particleCount < 1 ||
      !Number.isSafeInteger(catalog.facesPerParticle) || catalog.facesPerParticle < 1 ||
      !Number.isSafeInteger(catalog.leafCount) ||
      catalog.leafCount !== catalog.particleCount * catalog.facesPerParticle ||
      catalog.playbackSchema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      catalog.lightingBlockSchema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA ||
      catalog.sourceTransformProfile?.controlPointCount !== 6 ||
      !Number.isFinite(catalog.sourceTransformProfile?.speed) || catalog.sourceTransformProfile.speed <= 0 ||
      !Number.isSafeInteger(catalog.sourceTransformProfile?.complexity) ||
      catalog.sourceTransformProfile.complexity < 1 ||
      !Number.isFinite(catalog.sourceTransformProfile?.particleSize) ||
      catalog.sourceTransformProfile.particleSize <= 0 ||
      !Number.isFinite(catalog.sourceTransformProfile?.radialOrbitScale) ||
      catalog.sourceTransformProfile.radialOrbitScale <= 0 ||
      catalog.chunkCount !== 24 ||
      !Number.isSafeInteger(catalog.chunkFrameCount) || catalog.chunkFrameCount < 1 ||
      !Number.isSafeInteger(catalog.blockCount) || catalog.blockCount < catalog.chunkCount ||
      catalog.entries?.length !== catalog.blockCount ||
      !Number.isSafeInteger(catalog.blocksPerChunk) || catalog.blocksPerChunk < 1 ||
      catalog.blockCount !== catalog.chunkCount * catalog.blocksPerChunk ||
      !Number.isSafeInteger(catalog.blockFrameCount) || catalog.blockFrameCount < 1 ||
      catalog.chunkFrameCount !== catalog.blocksPerChunk * catalog.blockFrameCount ||
      catalog.framesPerSecond !== 60 ||
      !Number.isFinite(catalog.frameMilliseconds) ||
      catalog.frameMilliseconds !== 1_000 / catalog.framesPerSecond ||
      catalog.streamFrameCount !== catalog.chunkCount * catalog.chunkFrameCount ||
      catalog.streamDurationMilliseconds !== catalog.streamFrameCount /
        catalog.framesPerSecond * 1_000 ||
      !Array.isArray(catalog.startupPaletteFamilies) ||
      catalog.startupPaletteFamilies.length !== STARTUP_PALETTE_FAMILIES.length ||
      catalog.startupPaletteFamilies.some((family, index) =>
        family !== STARTUP_PALETTE_FAMILIES[index]) ||
      !Array.isArray(catalog.startupPaletteVariantIds) ||
      catalog.startupPaletteVariantIds.length !== STARTUP_PALETTE_VARIANT_IDS.length ||
      catalog.startupPaletteVariantIds.some((variantId, index) =>
        variantId !== STARTUP_PALETTE_VARIANT_IDS[index]) ||
      !Array.isArray(catalog.startupPaletteVariantWeights) ||
      catalog.startupPaletteVariantWeights.length !== STARTUP_PALETTE_VARIANT_WEIGHTS.length ||
      catalog.startupPaletteVariantWeights.some((weight, index) =>
        weight !== STARTUP_PALETTE_VARIANT_WEIGHTS[index]) ||
      !Array.isArray(catalog.startupSelections) || catalog.startupSelections.length < 2 ||
      new Set(catalog.startupSelections.map((selection) => selection?.id)).size !==
        catalog.startupSelections.length ||
      catalog.startupSelections.some((selection) =>
        typeof selection?.id !== "string" || selection.id.length < 1 ||
        !catalog.startupPaletteFamilies.includes(selection.paletteFamily) ||
        !Number.isSafeInteger(selection.chunkIndex) || selection.chunkIndex < 0 ||
        selection.chunkIndex >= catalog.chunkCount ||
        !Number.isSafeInteger(selection.startFrameIndex) || selection.startFrameIndex < 0 ||
        !Number.isSafeInteger(selection.frameCount) || selection.frameCount < 1 ||
        selection.startFrameIndex + selection.frameCount > catalog.chunkFrameCount) ||
      catalog.maximumColorFamilyCount !== 3 ||
      catalog.startupSilhouetteSampling !== STARTUP_SILHOUETTE_SAMPLING ||
      !Array.isArray(catalog.startupSilhouetteSampleFrameOffsets) ||
      catalog.startupSilhouetteSampleFrameOffsets.length < 1 ||
      new Set(catalog.startupSilhouetteSampleFrameOffsets).size !==
        catalog.startupSilhouetteSampleFrameOffsets.length ||
      catalog.startupSilhouetteSampleFrameOffsets.some((frameOffset) =>
        !Number.isSafeInteger(frameOffset) || frameOffset < 0 ||
        catalog.startupSelections.some((selection) => frameOffset >= selection.frameCount)) ||
      catalog.selection !== STARTUP_SELECTION ||
      catalog.runtimeLookaheadBlockCount !== RUNTIME_LOOKAHEAD_BLOCK_COUNT ||
      catalog.runtimeMaterializedLookaheadBlockCount !==
        RUNTIME_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT ||
      catalog.startupMaterializedLookaheadBlockCount !==
        STARTUP_MATERIALIZED_LOOKAHEAD_BLOCK_COUNT ||
      catalog.startupMaterializedLookaheadBlockCount >
        catalog.runtimeMaterializedLookaheadBlockCount ||
      catalog.runtimeMaterializedLookaheadBlockCount > catalog.runtimeLookaheadBlockCount ||
      catalog.entries.some((entry, index) => entry?.index !== index ||
        entry.chunkIndex !== Math.floor(index / catalog.blocksPerChunk) ||
        entry.blockIndex !== index % catalog.blocksPerChunk ||
        entry.startFrameIndex !== index * catalog.blockFrameCount ||
        entry.frameCount !== catalog.blockFrameCount ||
        entry.sourceContinuousFromPrevious !== (index > 0) ||
        entry.encoding !== CSSCYCLONE_BLOCK_ENCODING ||
        typeof entry.assetUrl !== "string" ||
        !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 ||
        !Number.isSafeInteger(entry.decodedByteLength) || entry.decodedByteLength < 1 ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/u.test(entry.decodedSha256 ?? ""))) {
    throw new Error("Prepared Cyclone stream catalog drifted");
  }
  validateStartupColorProfile(catalog.startupColorProfile, catalog);
}

function validateStartupColorProfile(profile, catalog) {
  const familySelectionCounts = new Map(catalog.startupPaletteFamilies.map((family) => [family, 0]));
  for (const selection of catalog.startupSelections) {
    familySelectionCounts.set(selection.paletteFamily, familySelectionCounts.get(selection.paletteFamily) + 1);
  }
  if (profile?.schema !== "csscyclone-prepared-startup-color-profile@2" ||
      profile.metric !== "prepared-source-particle-rgb-hsv-dominant-family-per-curated-window" ||
      typeof profile.minimumMeanSaturation !== "number" || profile.minimumMeanSaturation < 0 ||
      profile.minimumMeanSaturation > 1 ||
      typeof profile.minimumDominantHueShare !== "number" ||
      profile.minimumDominantHueShare <= 0 || profile.minimumDominantHueShare > 1 ||
      profile.maximumColorFamilyCount !== catalog.maximumColorFamilyCount ||
      !Array.isArray(profile.hueSectorNames) ||
      profile.hueSectorNames.length !== STARTUP_HUE_SECTOR_NAMES.length ||
      profile.hueSectorNames.some((name, index) => name !== STARTUP_HUE_SECTOR_NAMES[index]) ||
      !Array.isArray(profile.paletteFamilies) ||
      profile.paletteFamilies.length !== catalog.startupPaletteFamilies.length ||
      profile.paletteFamilies.some((family, index) => family !== catalog.startupPaletteFamilies[index]) ||
      !Number.isSafeInteger(profile.familySelectionCount) || profile.familySelectionCount < 1 ||
      [...familySelectionCounts.values()].some((count) => count !== profile.familySelectionCount) ||
      !Array.isArray(profile.selections) ||
      profile.selections.length !== catalog.startupSelections.length ||
      profile.selections.some((selectionProfile, index) => {
        const selection = catalog.startupSelections[index];
        return selectionProfile?.id !== selection.id ||
          selectionProfile.paletteFamily !== selection.paletteFamily ||
          selectionProfile.chunkIndex !== selection.chunkIndex ||
          selectionProfile.startFrameIndex !== selection.startFrameIndex ||
          selectionProfile.frameCount !== selection.frameCount ||
          typeof selectionProfile.meanSaturation !== "number" ||
          selectionProfile.meanSaturation < profile.minimumMeanSaturation ||
          selectionProfile.dominantHueSector !== selection.paletteFamily ||
          typeof selectionProfile.dominantHueShare !== "number" ||
          selectionProfile.dominantHueShare < profile.minimumDominantHueShare ||
          selectionProfile.dominantHueShare > 1 ||
          !Array.isArray(selectionProfile.hueSectorShares) ||
          selectionProfile.hueSectorShares.length !== STARTUP_HUE_SECTOR_NAMES.length ||
          selectionProfile.hueSectorShares.some((share) =>
            typeof share !== "number" || share < 0 || share > 1) ||
          Math.abs(selectionProfile.hueSectorShares.reduce((sum, share) => sum + share, 0) - 1) >
            0.00001;
      })) {
    throw new Error("Prepared Cyclone startup color profile drifted");
  }
}

function validateBlock(block, descriptor, catalog) {
  const playback = block?.playback;
  const lighting = block?.lighting;
  if (block?.schema !== BLOCK_SCHEMA ||
      block.streamId !== catalog.streamId ||
      block.streamBlockIndex !== descriptor.index ||
      block.chunkIndex !== descriptor.chunkIndex ||
      block.blockIndex !== descriptor.blockIndex ||
      block.startFrameIndex !== descriptor.startFrameIndex ||
      block.frameCount !== descriptor.frameCount ||
      playback?.schema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      playback.modelId !== catalog.modelId ||
      playback.streamId !== catalog.streamId ||
      playback.streamBlockIndex !== descriptor.index ||
      playback.chunkIndex !== descriptor.chunkIndex ||
      playback.blockIndex !== descriptor.blockIndex ||
      playback.chunkCount !== catalog.chunkCount ||
      playback.blockCount !== catalog.blockCount ||
      playback.blocksPerChunk !== catalog.blocksPerChunk ||
      playback.startFrameIndex !== descriptor.startFrameIndex ||
      playback.framesPerSecond !== catalog.framesPerSecond ||
      playback.frameMilliseconds !== catalog.frameMilliseconds ||
      playback.frameCount !== descriptor.frameCount ||
      playback.durationMilliseconds !== descriptor.frameCount / catalog.framesPerSecond * 1_000 ||
      playback.loop !== false ||
      playback.particleCount !== catalog.particleCount ||
      playback.leafCount !== catalog.leafCount ||
      playback.transforms?.length !== descriptor.frameCount * catalog.particleCount ||
      playback.transforms.some((transform) =>
        typeof transform !== "string" || !transform.startsWith("matrix3d(")) ||
      lighting?.schema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA ||
      lighting.streamId !== catalog.streamId ||
      lighting.streamBlockIndex !== descriptor.index ||
      lighting.chunkIndex !== descriptor.chunkIndex ||
      lighting.blockIndex !== descriptor.blockIndex ||
      lighting.startFrameIndex !== descriptor.startFrameIndex ||
      lighting.frameCount !== descriptor.frameCount ||
      lighting.particleCount !== playback.particleCount ||
      !(lighting.frameParticleColorStateIndices instanceof Uint16Array) ||
      lighting.frameParticleColorStateIndices.length !== descriptor.frameCount * playback.particleCount ||
      block.preparedMatrixExpansionCount !== playback.transforms.length ||
      !Number.isSafeInteger(block.preparedCssStringByteLength) ||
      block.preparedCssStringByteLength < playback.transforms.length) {
    throw new Error(`Prepared Cyclone block ${descriptor.index} drifted`);
  }
}

function validatePosition(catalog, chunkIndex, frameIndex) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= catalog.chunkCount ||
      !Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= catalog.chunkFrameCount) {
    throw new RangeError("Requested Cyclone stream position is invalid");
  }
}

function cryptoRandomUint32Pair() {
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return [...values];
}

async function fetchBytes(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Prepared Cyclone asset failed: ${response.status} ${url}`);
  return response.arrayBuffer();
}

async function decompressGzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function verifyBytes(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) {
    throw new Error(`Prepared Cyclone ${label} byte length drifted`);
  }
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Prepared Cyclone ${label} hash drifted (${actualSha256})`);
  }
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
