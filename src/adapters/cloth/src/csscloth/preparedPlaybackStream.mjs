import {
  completeClothPreparedPlaybackMaterialization,
  loadClothPreparedPlayback,
} from "../shared/csscloth/preparedPlaybackTransport.mjs";

const RESPONSE_CHUNK_TRANSFORM_COUNT = 480;
const INITIAL_BUFFER_FRAME_COUNT = 240;

export function createClothPreparedPlaybackStream({ recordError = () => {} } = {}) {
  const workerMaterializer = createWorkerMaterializer();
  let loadCount = 0;
  let workerLoadCount = 0;
  let workerPreparationMaximumMilliseconds = 0;
  let workerMaterializationMaximumMilliseconds = 0;
  let responseChunkCount = 0;
  let responseIdleSliceCount = 0;
  let responseDirectChunkCount = 0;
  let responseMaximumChunkBytes = 0;
  let responseMaximumIdleSliceMilliseconds = 0;
  let responseMaximumDirectMilliseconds = 0;
  let initialBufferedFrameCount = 0;
  let initialMaterializationComplete = workerMaterializer === null;
  let resumeInitialMaterialization = null;

  async function loadInitial(descriptor) {
    if (workerMaterializer === null) {
      const playback = await loadClothPreparedPlayback(descriptor);
      loadCount += 1;
      return playback;
    }
    const materialization = workerMaterializer.materializeInitial(descriptor, {
      readyFrameCount: Math.min(INITIAL_BUFFER_FRAME_COUNT, descriptor.frameCount),
    });
    const result = await materialization.ready;
    loadCount += 1;
    workerLoadCount += 1;
    initialBufferedFrameCount = result.playback.materialization.readyFrameCount;
    workerPreparationMaximumMilliseconds = Math.max(
      workerPreparationMaximumMilliseconds,
      result.preparationMilliseconds,
    );
    resumeInitialMaterialization = materialization.resume;
    materialization.complete.then((completed) => {
      initialMaterializationComplete = true;
      recordWorkerMetrics(completed);
    }).catch((error) => recordError(error.stack || error.message || String(error)));
    return result.playback;
  }

  async function loadFuture(descriptor) {
    if (workerMaterializer === null) {
      const playback = await loadClothPreparedPlayback(descriptor);
      loadCount += 1;
      return playback;
    }
    const result = await workerMaterializer.materialize(descriptor, { paced: true });
    loadCount += 1;
    workerLoadCount += 1;
    recordWorkerMetrics(result);
    return result.playback;
  }

  function recordWorkerMetrics(result) {
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
    responseDirectChunkCount += result.responseDirectChunkCount;
    responseMaximumChunkBytes = Math.max(
      responseMaximumChunkBytes,
      result.maximumResponseChunkBytes,
    );
    responseMaximumIdleSliceMilliseconds = Math.max(
      responseMaximumIdleSliceMilliseconds,
      result.maximumResponseIdleSliceMilliseconds,
    );
    responseMaximumDirectMilliseconds = Math.max(
      responseMaximumDirectMilliseconds,
      result.maximumResponseDirectMilliseconds,
    );
  }

  return Object.freeze({
    loadInitial,
    loadFuture,
    resumeInitial() {
      const resume = resumeInitialMaterialization;
      resumeInitialMaterialization = null;
      resume?.();
    },
    stats() {
      return Object.freeze({
        preparedPlaybackStreamLoadCount: loadCount,
        preparedPlaybackWorkerAvailable: workerMaterializer !== null,
        preparedPlaybackWorkerLoadCount: workerLoadCount,
        preparedPlaybackInitialBufferedFrameCount: initialBufferedFrameCount,
        preparedPlaybackInitialMaterializationComplete: initialMaterializationComplete,
        preparedPlaybackWorkerPreparationMaximumMilliseconds:
          Number(workerPreparationMaximumMilliseconds.toFixed(2)),
        preparedPlaybackWorkerMaterializationMaximumMilliseconds:
          Number(workerMaterializationMaximumMilliseconds.toFixed(2)),
        preparedPlaybackResponseChunkCount: responseChunkCount,
        preparedPlaybackResponseIdleSliceCount: responseIdleSliceCount,
        preparedPlaybackResponseDirectChunkCount: responseDirectChunkCount,
        preparedPlaybackResponseMaximumChunkBytes: responseMaximumChunkBytes,
        preparedPlaybackResponseMaximumIdleSliceMilliseconds:
          Number(responseMaximumIdleSliceMilliseconds.toFixed(3)),
        preparedPlaybackResponseMaximumDirectMilliseconds:
          Number(responseMaximumDirectMilliseconds.toFixed(3)),
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
    for (const request of pending.values()) rejectRequest(request, error);
    pending.clear();
    responseQueue.length = 0;
    if (idleRequest !== null) cancelIdle(idleRequest);
    idleRequest = null;
  }

  function rejectRequest(request, error) {
    request.rejectReady?.(error);
    request.rejectComplete(error);
  }

  function scheduleResponseSlice() {
    if (idleRequest !== null || responseQueue.length === 0) return;
    idleRequest = requestIdle(processResponseSlice, { timeout: 500 });
  }

  function processResponseSlice(deadline) {
    idleRequest = null;
    const startedAt = performance.now();
    let processed = 0;
    while (responseQueue.length > 0 && processed < 24) {
      const queued = responseQueue.shift();
      processResponseChunk(queued.data, queued.request, true);
      processed += 1;
      if (performance.now() - startedAt >= 4 ||
          (!deadline.didTimeout && deadline.timeRemaining() <= 1)) break;
    }
    scheduleResponseSlice();
  }

  function processResponseChunk(data, request, idle) {
    if (pending.get(data.requestId) !== request) {
      return;
    }
    const startedAt = performance.now();
    try {
      const response = request.response;
      const expectedChunkIndex = data.kind === "cloth"
        ? response.processedClothChunkCount
        : response.processedShadowChunkCount;
      const target = data.kind === "cloth" ? response.transforms : response.shadowTransformValues;
      const receivedTransformCount = data.kind === "cloth"
        ? response.receivedClothTransformCount
        : response.receivedShadowTransformCount;
      if (data.chunkIndex !== expectedChunkIndex || data.start !== receivedTransformCount) {
        throw new Error("Prepared Cloth worker response ordering drifted");
      }
      for (let index = 0; index < data.transforms.length; index += 1) {
        target[data.start + index] = data.transforms[index];
      }
      if (data.kind === "cloth") {
        response.processedClothChunkCount += 1;
        response.receivedClothTransformCount += data.transforms.length;
      } else {
        response.processedShadowChunkCount += 1;
        response.receivedShadowTransformCount += data.transforms.length;
      }
      if (response.materialization) {
        response.materialization.clothTransformCount = response.receivedClothTransformCount;
        response.materialization.shadowTransformValueCount =
          response.receivedShadowTransformCount;
      }
      response.responseChunkCount += 1;
      if (idle) response.responseIdleSliceCount += 1;
      else response.responseDirectChunkCount += 1;
      response.receivedTransformBytes += data.transformByteLength;
      response.maximumResponseChunkBytes = Math.max(
        response.maximumResponseChunkBytes,
        data.transformByteLength,
      );
      const duration = performance.now() - startedAt;
      if (idle) {
        response.maximumResponseIdleSliceMilliseconds = Math.max(
          response.maximumResponseIdleSliceMilliseconds,
          duration,
        );
      } else {
        response.maximumResponseDirectMilliseconds = Math.max(
          response.maximumResponseDirectMilliseconds,
          duration,
        );
      }
      maybeComplete(data.requestId, request);
    } catch (error) {
      pending.delete(data.requestId);
      rejectRequest(request, error);
    }
  }

  function maybeComplete(requestId, request) {
    const response = request.response;
    if (!response?.workerComplete ||
        response.processedClothChunkCount !== response.clothChunkCount ||
        response.processedShadowChunkCount !== response.shadowChunkCount) return;
    if (response.receivedClothTransformCount !== response.clothTransformCount ||
        response.receivedShadowTransformCount !== response.shadowTransformValueCount) {
      throw new Error("Prepared Cloth worker response count drifted");
    }
    const completedPlayback = completeClothPreparedPlaybackMaterialization(
      response.playback,
      response.transforms,
      response.shadowTransformValues,
    );
    if (response.materialization) response.materialization.complete = true;
    const playback = response.progressivePlayback ?? completedPlayback;
    pending.delete(requestId);
    request.resolveComplete(Object.freeze({
      playback,
      preparationMilliseconds: response.preparationMilliseconds,
      durationMilliseconds: response.durationMilliseconds,
      responseChunkCount: response.responseChunkCount,
      responseIdleSliceCount: response.responseIdleSliceCount,
      responseDirectChunkCount: response.responseDirectChunkCount,
      maximumResponseChunkBytes: response.maximumResponseChunkBytes,
      maximumResponseIdleSliceMilliseconds: response.maximumResponseIdleSliceMilliseconds,
      maximumResponseDirectMilliseconds: response.maximumResponseDirectMilliseconds,
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
        if (request) rejectRequest(request, error);
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
          typeof data.paced !== "boolean" ||
          !Number.isSafeInteger(data.readyFrameCount) || data.readyFrameCount < 0 ||
          data.readyFrameCount > data.playback.frameCount ||
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
        paced: data.paced,
        readyFrameCount: data.readyFrameCount,
        readyResolved: false,
        preparationMilliseconds: data.preparationMilliseconds,
        durationMilliseconds: 0,
        processedClothChunkCount: 0,
        processedShadowChunkCount: 0,
        receivedClothTransformCount: 0,
        receivedShadowTransformCount: 0,
        responseChunkCount: 0,
        responseIdleSliceCount: 0,
        responseDirectChunkCount: 0,
        receivedTransformBytes: 0,
        maximumResponseChunkBytes: 0,
        maximumResponseIdleSliceMilliseconds: 0,
        maximumResponseDirectMilliseconds: 0,
        workerComplete: false,
        transforms: new Array(data.clothTransformCount),
        shadowTransformValues: new Array(data.shadowTransformValueCount),
        materialization: null,
        progressivePlayback: null,
      };
      return;
    }
    if (data.type === "materialized-ready") {
      const response = request.response;
      if (!response || response.readyFrameCount < 1 || response.readyResolved ||
          data.readyFrameCount !== response.readyFrameCount ||
          data.readyClothChunkCount !== response.processedClothChunkCount ||
          data.readyShadowChunkCount !== response.processedShadowChunkCount ||
          response.receivedClothTransformCount < data.readyFrameCount *
            response.playback.triangleCount ||
          response.receivedShadowTransformCount <
            response.playback.shadowTransformOffsets[data.readyFrameCount]) {
        rejectAll(new Error("Prepared Cloth worker readiness drifted"));
        return;
      }
      const materialization = {
        readyFrameCount: data.readyFrameCount,
        clothTransformCount: response.receivedClothTransformCount,
        shadowTransformValueCount: response.receivedShadowTransformCount,
        complete: false,
        completion: request.complete,
      };
      response.materialization = materialization;
      response.progressivePlayback = Object.freeze({
        ...response.playback,
        transforms: response.transforms,
        shadowTransformValues: response.shadowTransformValues,
        materialization,
      });
      response.readyResolved = true;
      request.resolveReady(Object.freeze({
        playback: response.progressivePlayback,
        preparationMilliseconds: response.preparationMilliseconds,
      }));
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
    if (request.response.paced || request.response.readyResolved) {
      responseQueue.push({ data, request });
      scheduleResponseSlice();
    } else {
      processResponseChunk(data, request, false);
    }
  });
  worker.addEventListener("error", (event) => {
    rejectAll(new Error(event.message || "Prepared Cloth worker failed"));
  });

  return Object.freeze({
    materialize(descriptor, { paced }) {
      return startMaterialization(descriptor, { paced, readyFrameCount: 0 }).complete;
    },
    materializeInitial(descriptor, { readyFrameCount }) {
      return startMaterialization(descriptor, { paced: false, readyFrameCount });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectAll(new Error("Prepared Cloth worker is destroyed"));
      worker.terminate();
    },
  });

  function startMaterialization(descriptor, { paced, readyFrameCount }) {
    if (destroyed) throw new Error("Prepared Cloth worker is destroyed");
    if (typeof paced !== "boolean" || !Number.isSafeInteger(readyFrameCount) ||
        readyFrameCount < 0 || readyFrameCount > descriptor?.frameCount) {
      throw new TypeError("Prepared Cloth worker materialization mode must be explicit");
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    let resolveReady;
    let rejectReady;
    const ready = readyFrameCount > 0
      ? new Promise((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        })
      : null;
    let resolveComplete;
    let rejectComplete;
    const complete = new Promise((resolve, reject) => {
      resolveComplete = resolve;
      rejectComplete = reject;
    });
    pending.set(requestId, {
      resolveReady,
      rejectReady,
      resolveComplete,
      rejectComplete,
      complete,
      response: null,
    });
    worker.postMessage({ type: "materialize", requestId, descriptor, paced, readyFrameCount });
    let resumed = false;
    return Object.freeze({
      ready: ready ?? complete,
      complete,
      resume() {
        if (resumed || readyFrameCount === 0) return;
        resumed = true;
        worker.postMessage({ type: "continue", requestId });
      },
    });
  }
}
