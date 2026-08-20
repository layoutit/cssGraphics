import {
  completeClothPreparedPlaybackMaterialization,
  loadClothPreparedPlayback,
} from "../shared/csscloth/preparedPlaybackTransport.mjs";

const RESPONSE_CHUNK_TRANSFORM_COUNT = 480;

export function createClothPreparedPlaybackStream() {
  const workerMaterializer = createWorkerMaterializer();
  let loadCount = 0;
  let workerLoadCount = 0;
  let workerPreparationMaximumMilliseconds = 0;
  let workerMaterializationMaximumMilliseconds = 0;
  let responseChunkCount = 0;
  let responseIdleSliceCount = 0;
  let responseMaximumChunkBytes = 0;
  let responseMaximumIdleSliceMilliseconds = 0;

  async function loadInitial(descriptor) {
    const playback = await loadClothPreparedPlayback(descriptor);
    loadCount += 1;
    return playback;
  }

  async function loadFuture(descriptor) {
    if (workerMaterializer === null) {
      const playback = await loadClothPreparedPlayback(descriptor);
      loadCount += 1;
      return playback;
    }
    const result = await workerMaterializer.materialize(descriptor);
    loadCount += 1;
    workerLoadCount += 1;
    workerPreparationMaximumMilliseconds = Math.max(
      workerPreparationMaximumMilliseconds,
      result.preparationMilliseconds,
    );
    workerMaterializationMaximumMilliseconds = Math.max(
      workerMaterializationMaximumMilliseconds,
      result.durationMilliseconds,
    );
    responseChunkCount += result.responseChunkCount;
    responseIdleSliceCount += result.responseIdleSliceCount;
    responseMaximumChunkBytes = Math.max(
      responseMaximumChunkBytes,
      result.maximumResponseChunkBytes,
    );
    responseMaximumIdleSliceMilliseconds = Math.max(
      responseMaximumIdleSliceMilliseconds,
      result.maximumResponseIdleSliceMilliseconds,
    );
    return result.playback;
  }

  return Object.freeze({
    loadInitial,
    loadFuture,
    stats() {
      return Object.freeze({
        preparedPlaybackStreamLoadCount: loadCount,
        preparedPlaybackWorkerAvailable: workerMaterializer !== null,
        preparedPlaybackWorkerLoadCount: workerLoadCount,
        preparedPlaybackWorkerPreparationMaximumMilliseconds:
          Number(workerPreparationMaximumMilliseconds.toFixed(2)),
        preparedPlaybackWorkerMaterializationMaximumMilliseconds:
          Number(workerMaterializationMaximumMilliseconds.toFixed(2)),
        preparedPlaybackResponseChunkCount: responseChunkCount,
        preparedPlaybackResponseIdleSliceCount: responseIdleSliceCount,
        preparedPlaybackResponseMaximumChunkBytes: responseMaximumChunkBytes,
        preparedPlaybackResponseMaximumIdleSliceMilliseconds:
          Number(responseMaximumIdleSliceMilliseconds.toFixed(3)),
      });
    },
    destroy() {
      workerMaterializer?.destroy();
    },
  });
}

function createWorkerMaterializer() {
  if (typeof Worker !== "function") return null;
  let worker;
  try {
    worker = new Worker(new URL("./preparedPlaybackWorker.mjs", import.meta.url), {
      type: "module",
      name: "csscloth-prepared-playback-materializer",
    });
  } catch {
    return null;
  }
  const pending = new Map();
  const responseQueue = [];
  const requestIdle = globalThis.requestIdleCallback?.bind(globalThis) ??
    ((callback) => setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0));
  const cancelIdle = globalThis.cancelIdleCallback?.bind(globalThis) ?? clearTimeout;
  let idleRequest = null;
  let nextRequestId = 0;
  let destroyed = false;

  function rejectAll(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    responseQueue.length = 0;
    if (idleRequest !== null) cancelIdle(idleRequest);
    idleRequest = null;
  }

  function scheduleResponseSlice() {
    if (idleRequest !== null || responseQueue.length === 0) return;
    idleRequest = requestIdle(processResponseSlice, { timeout: 500 });
  }

  function processResponseSlice() {
    idleRequest = null;
    const queued = responseQueue.shift();
    if (!queued) return;
    const { data, request } = queued;
    if (pending.get(data.requestId) !== request) {
      scheduleResponseSlice();
      return;
    }
    const startedAt = performance.now();
    try {
      const response = request.response;
      const expectedChunkIndex = data.kind === "cloth"
        ? response.processedClothChunkCount
        : response.processedShadowChunkCount;
      const target = data.kind === "cloth" ? response.transforms : response.shadowTransformValues;
      if (data.chunkIndex !== expectedChunkIndex || data.start !== target.length) {
        throw new Error("Prepared Cloth worker response ordering drifted");
      }
      target.push(...data.transforms);
      if (data.kind === "cloth") response.processedClothChunkCount += 1;
      else response.processedShadowChunkCount += 1;
      response.responseChunkCount += 1;
      response.responseIdleSliceCount += 1;
      response.receivedTransformBytes += data.transformByteLength;
      response.maximumResponseChunkBytes = Math.max(
        response.maximumResponseChunkBytes,
        data.transformByteLength,
      );
      response.maximumResponseIdleSliceMilliseconds = Math.max(
        response.maximumResponseIdleSliceMilliseconds,
        performance.now() - startedAt,
      );
      maybeComplete(data.requestId, request);
    } catch (error) {
      pending.delete(data.requestId);
      request.reject(error);
    }
    scheduleResponseSlice();
  }

  function maybeComplete(requestId, request) {
    const response = request.response;
    if (!response?.workerComplete ||
        response.processedClothChunkCount !== response.clothChunkCount ||
        response.processedShadowChunkCount !== response.shadowChunkCount) return;
    if (response.transforms.length !== response.clothTransformCount ||
        response.shadowTransformValues.length !== response.shadowTransformValueCount) {
      throw new Error("Prepared Cloth worker response count drifted");
    }
    const playback = completeClothPreparedPlaybackMaterialization(
      response.playback,
      response.transforms,
      response.shadowTransformValues,
    );
    pending.delete(requestId);
    request.resolve(Object.freeze({
      playback,
      preparationMilliseconds: response.preparationMilliseconds,
      durationMilliseconds: response.durationMilliseconds,
      responseChunkCount: response.responseChunkCount,
      responseIdleSliceCount: response.responseIdleSliceCount,
      maximumResponseChunkBytes: response.maximumResponseChunkBytes,
      maximumResponseIdleSliceMilliseconds: response.maximumResponseIdleSliceMilliseconds,
    }));
  }

  worker.addEventListener("message", ({ data }) => {
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
    const request = pending.get(data?.requestId);
    if (!request) return;
    if (data.type === "materialized-start") {
      if (request.response !== null || data.playback?.transforms !== null ||
          data.playback?.shadowTransformValues !== null ||
          !Number.isSafeInteger(data.clothTransformCount) || data.clothTransformCount < 1 ||
          !Number.isSafeInteger(data.shadowTransformValueCount) || data.shadowTransformValueCount < 1 ||
          !Number.isSafeInteger(data.clothChunkCount) || data.clothChunkCount < 1 ||
          !Number.isSafeInteger(data.shadowChunkCount) || data.shadowChunkCount < 1 ||
          !Number.isFinite(data.preparationMilliseconds) || data.preparationMilliseconds < 0) {
        rejectAll(new Error("Prepared Cloth worker response drifted"));
        return;
      }
      request.response = {
        playback: data.playback,
        clothTransformCount: data.clothTransformCount,
        shadowTransformValueCount: data.shadowTransformValueCount,
        clothChunkCount: data.clothChunkCount,
        shadowChunkCount: data.shadowChunkCount,
        preparationMilliseconds: data.preparationMilliseconds,
        durationMilliseconds: 0,
        processedClothChunkCount: 0,
        processedShadowChunkCount: 0,
        responseChunkCount: 0,
        responseIdleSliceCount: 0,
        receivedTransformBytes: 0,
        maximumResponseChunkBytes: 0,
        maximumResponseIdleSliceMilliseconds: 0,
        workerComplete: false,
        transforms: [],
        shadowTransformValues: [],
      };
      return;
    }
    if (data.type === "materialized-complete") {
      if (!request.response || !Number.isFinite(data.durationMilliseconds) ||
          data.durationMilliseconds < request.response.preparationMilliseconds) {
        rejectAll(new Error("Prepared Cloth worker completion drifted"));
        return;
      }
      request.response.durationMilliseconds = data.durationMilliseconds;
      request.response.workerComplete = true;
      maybeComplete(data.requestId, request);
      return;
    }
    if (data.type !== "materialized-chunk" || !request.response ||
        !new Set(["cloth", "shadow"]).has(data.kind) ||
        !Number.isSafeInteger(data.chunkIndex) || data.chunkIndex < 0 ||
        !Number.isSafeInteger(data.chunkCount) || data.chunkCount < 1 ||
        !Number.isSafeInteger(data.start) || data.start < 0 ||
        !Array.isArray(data.transforms) || data.transforms.length < 1 ||
        data.transforms.length > RESPONSE_CHUNK_TRANSFORM_COUNT ||
        data.transforms.some((transform) =>
          typeof transform !== "string" || !transform.startsWith("matrix3d(")) ||
        !Number.isSafeInteger(data.transformByteLength) || data.transformByteLength < 1) {
      rejectAll(new Error("Prepared Cloth worker response drifted"));
      return;
    }
    const expectedChunkCount = data.kind === "cloth"
      ? request.response.clothChunkCount
      : request.response.shadowChunkCount;
    if (data.chunkCount !== expectedChunkCount) {
      rejectAll(new Error("Prepared Cloth worker chunk count drifted"));
      return;
    }
    responseQueue.push({ data, request });
    scheduleResponseSlice();
  });
  worker.addEventListener("error", (event) => {
    rejectAll(new Error(event.message || "Prepared Cloth worker failed"));
  });

  return Object.freeze({
    materialize(descriptor) {
      if (destroyed) throw new Error("Prepared Cloth worker is destroyed");
      const requestId = nextRequestId;
      nextRequestId += 1;
      const result = new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, response: null });
      });
      worker.postMessage({ type: "materialize", requestId, descriptor });
      return result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectAll(new Error("Prepared Cloth worker is destroyed"));
      worker.terminate();
    },
  });
}
