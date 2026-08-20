import {
  createClothPreparedPlaybackMaterialization,
  loadClothPreparedPlaybackBytes,
  materializeClothPreparedMatrixRange,
} from "../shared/csscloth/preparedPlaybackTransport.mjs";

const RESPONSE_CHUNK_TRANSFORM_COUNT = 480;

let materializationTail = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  if (data?.type !== "materialize" || !Number.isSafeInteger(data.requestId) ||
      typeof data.paced !== "boolean") {
    postWorkerError(new Error("Prepared Cloth worker request drifted"), null);
    return;
  }
  materializationTail = materializationTail.then(
    () => materializePlayback(data),
    () => materializePlayback(data),
  ).catch((error) => postWorkerError(error, data.requestId));
});

async function materializePlayback({ requestId, descriptor, paced }) {
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
    preparationMilliseconds: performance.now() - startedAt,
  }, playbackTransferables(playback));
  await streamMatrixKind(
    requestId,
    materialization,
    "cloth",
    materialization.clothTransformCount,
    clothChunkCount,
    paced,
  );
  await streamMatrixKind(
    requestId,
    materialization,
    "shadow",
    materialization.shadowTransformValueCount,
    shadowChunkCount,
    paced,
  );
  self.postMessage({
    type: "materialized-complete",
    requestId,
    durationMilliseconds: performance.now() - startedAt,
  });
}

async function streamMatrixKind(requestId, materialization, kind, count, chunkCount, paced) {
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
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
