import {
  createClothPreparedPlaybackMaterialization,
  loadClothPreparedPlaybackBytes,
  materializeClothPreparedMatrixRange,
} from "../shared/csscloth/preparedCheckpointTransport.mjs";

const RESPONSE_CHUNK_TRANSFORM_COUNT = 480;

let materializationTail = Promise.resolve();
const continuations = new Map();

self.addEventListener("message", ({ data }) => {
  if (data?.type === "continue" && Number.isSafeInteger(data.requestId)) {
    continuations.get(data.requestId)?.();
    continuations.delete(data.requestId);
    return;
  }
  if (data?.type !== "materialize" || !Number.isSafeInteger(data.requestId) ||
      typeof data.paced !== "boolean" || !Number.isSafeInteger(data.readyFrameCount) ||
      data.readyFrameCount < 0 || data.readyFrameCount > data.descriptor?.frameCount) {
    postWorkerError(new Error("Prepared Cloth worker request drifted"), null);
    return;
  }
  materializationTail = materializationTail.then(
    () => materializePlayback(data),
    () => materializePlayback(data),
  ).catch((error) => postWorkerError(error, data.requestId));
});

async function materializePlayback({ requestId, descriptor, paced, readyFrameCount }) {
  const startedAt = performance.now();
  const bytes = await loadClothPreparedPlaybackBytes(descriptor);
  const materialization = createClothPreparedPlaybackMaterialization(bytes, descriptor);
  const playback = materialization.playback;
  const clothChunkCount = Math.ceil(
    materialization.clothTransformCount / RESPONSE_CHUNK_TRANSFORM_COUNT,
  );
  const shadowChunkCount = Math.ceil(
    materialization.shadowTransformValueCount / RESPONSE_CHUNK_TRANSFORM_COUNT,
  );
  self.postMessage({
    type: "materialized-start",
    requestId,
    playback,
    clothTransformCount: materialization.clothTransformCount,
    shadowTransformValueCount: materialization.shadowTransformValueCount,
    clothChunkCount,
    shadowChunkCount,
    paced,
    readyFrameCount,
    preparationMilliseconds: performance.now() - startedAt,
  }, playbackTransferables(playback));
  if (readyFrameCount > 0) {
    const readyClothChunkCount = Math.ceil(
      Math.min(materialization.clothTransformCount, readyFrameCount * playback.triangleCount) /
        RESPONSE_CHUNK_TRANSFORM_COUNT,
    );
    const shadowTransformLimit = readyFrameCount * playback.shadowTriangleCount;
    const readyShadowTransformCount = materialization.shadowTransformSourceIndices.findIndex(
      (sourceIndex) => sourceIndex >= shadowTransformLimit,
    );
    const readyShadowChunkCount = Math.ceil(
      (readyShadowTransformCount < 0
        ? materialization.shadowTransformValueCount
        : readyShadowTransformCount) / RESPONSE_CHUNK_TRANSFORM_COUNT,
    );
    await streamMatrixKind(
      requestId,
      materialization,
      "cloth",
      materialization.clothTransformCount,
      clothChunkCount,
      0,
      readyClothChunkCount,
      false,
    );
    await streamMatrixKind(
      requestId,
      materialization,
      "shadow",
      materialization.shadowTransformValueCount,
      shadowChunkCount,
      0,
      readyShadowChunkCount,
      false,
    );
    self.postMessage({
      type: "materialized-ready",
      requestId,
      readyFrameCount,
      readyClothChunkCount,
      readyShadowChunkCount,
    });
    await waitForContinuation(requestId);
    await streamMatrixKind(
      requestId,
      materialization,
      "cloth",
      materialization.clothTransformCount,
      clothChunkCount,
      readyClothChunkCount,
      clothChunkCount,
      false,
    );
    await streamMatrixKind(
      requestId,
      materialization,
      "shadow",
      materialization.shadowTransformValueCount,
      shadowChunkCount,
      readyShadowChunkCount,
      shadowChunkCount,
      false,
    );
  } else {
    await streamMatrixKind(
      requestId,
      materialization,
      "cloth",
      materialization.clothTransformCount,
      clothChunkCount,
      0,
      clothChunkCount,
      paced,
    );
    await streamMatrixKind(
      requestId,
      materialization,
      "shadow",
      materialization.shadowTransformValueCount,
      shadowChunkCount,
      0,
      shadowChunkCount,
      paced,
    );
  }
  self.postMessage({
    type: "materialized-complete",
    requestId,
    durationMilliseconds: performance.now() - startedAt,
  });
}

async function streamMatrixKind(
  requestId,
  materialization,
  kind,
  count,
  chunkCount,
  startChunkIndex,
  endChunkIndex,
  paced,
) {
  for (let chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex += 1) {
    const start = chunkIndex * RESPONSE_CHUNK_TRANSFORM_COUNT;
    const end = Math.min(count, start + RESPONSE_CHUNK_TRANSFORM_COUNT);
    const transforms = materializeClothPreparedMatrixRange(materialization, kind, start, end);
    const transformByteLength = transforms.reduce(
      (total, transform) => total + transform.length * Uint16Array.BYTES_PER_ELEMENT,
      0,
    );
    self.postMessage({
      type: "materialized-chunk",
      requestId,
      kind,
      chunkIndex,
      chunkCount,
      start,
      transforms,
      transformByteLength,
    });
    if (paced && (kind !== "shadow" || chunkIndex + 1 < chunkCount)) {
      await new Promise((resolve) => setTimeout(resolve, materialization.playback.frameMilliseconds));
    }
  }
}

function waitForContinuation(requestId) {
  return new Promise((resolve) => continuations.set(requestId, resolve));
}

function playbackTransferables(playback) {
  return [
    playback.lightingOffsets.buffer,
    playback.lightingIndices.buffer,
    playback.lightingSlots.buffer,
    playback.shadowTransformOffsets.buffer,
    playback.shadowTransformIndices.buffer,
    playback.shadowVisibilityOffsets.buffer,
    playback.shadowVisibilityIndices.buffer,
    playback.shadowVisibilityValues.buffer,
  ];
}

function postWorkerError(error, requestId) {
  self.postMessage({
    type: "error",
    requestId,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  });
}
