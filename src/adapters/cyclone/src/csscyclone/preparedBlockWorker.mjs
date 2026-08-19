import { decodeCyclonePreparedBlock } from "../shared/csscyclone/preparedBlockTransport.mjs";

const TRANSFORM_RESPONSE_CHUNK_BYTES = 128 * 1_024;

let catalog = null;
let materializationTail = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  try {
    if (data?.type === "initialize") {
      if (catalog !== null || data.catalog?.schema !== "csscyclone-prepared-stream-catalog@3") {
        throw new Error("Prepared Cyclone worker catalog drifted");
      }
      catalog = data.catalog;
      self.postMessage({ type: "initialized" });
      return;
    }
    if (data?.type !== "materialize" || catalog === null ||
        !Number.isSafeInteger(data.requestId) || !(data.bytes instanceof Uint8Array)) {
      throw new Error("Prepared Cyclone worker request drifted");
    }
    materializationTail = materializationTail.then(
      () => materializeBlock(data),
      () => materializeBlock(data),
    ).catch((error) => postWorkerError(error, data.requestId));
  } catch (error) {
    postWorkerError(error, Number.isSafeInteger(data?.requestId) ? data.requestId : null);
  }
});

async function materializeBlock(data) {
  const startedAt = performance.now();
  const block = decodeCyclonePreparedBlock(data.bytes, data.descriptor, catalog);
  const transformBytes = new TextEncoder().encode(block.playback.transforms.join("\n"));
  const transformChunkCount = Math.ceil(
    transformBytes.byteLength / TRANSFORM_RESPONSE_CHUNK_BYTES,
  );
  const transferredBlock = {
    ...block,
    playback: { ...block.playback, transforms: null },
  };
  self.postMessage({
    type: "materialized-start",
    requestId: data.requestId,
    block: transferredBlock,
    transformByteLength: transformBytes.byteLength,
    transformChunkCount,
    durationMilliseconds: performance.now() - startedAt,
  }, [block.lighting.frameParticleColorStateIndices.buffer]);
  for (let transformChunkIndex = 0;
    transformChunkIndex < transformChunkCount;
    transformChunkIndex += 1) {
    const offset = transformChunkIndex * TRANSFORM_RESPONSE_CHUNK_BYTES;
    const transformChunk = transformBytes.slice(
      offset,
      Math.min(transformBytes.byteLength, offset + TRANSFORM_RESPONSE_CHUNK_BYTES),
    );
    self.postMessage({
      type: "materialized-chunk",
      requestId: data.requestId,
      transformChunkIndex,
      transformChunkCount,
      transformBytes: transformChunk,
    }, [transformChunk.buffer]);
    if (transformChunkIndex + 1 < transformChunkCount) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

function postWorkerError(error, requestId) {
  self.postMessage({
    type: "error",
    requestId,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  });
}
