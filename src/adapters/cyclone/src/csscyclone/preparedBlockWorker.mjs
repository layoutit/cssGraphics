import { decodeCyclonePreparedBlock } from "../shared/csscyclone/preparedBlockTransport.mjs";

const TRANSFORM_RESPONSE_CHUNK_TRANSFORMS = 960;

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
  const transforms = block.playback.transforms;
  const transformByteLength = transforms.reduce((total, transform) => total + transform.length, 0) +
    transforms.length - 1;
  const transformChunkCount = Math.ceil(
    transforms.length / TRANSFORM_RESPONSE_CHUNK_TRANSFORMS,
  );
  const transferredBlock = {
    ...block,
    playback: { ...block.playback, transforms: null },
  };
  self.postMessage({
    type: "materialized-start",
    requestId: data.requestId,
    block: transferredBlock,
    transformByteLength,
    transformChunkCount,
    durationMilliseconds: performance.now() - startedAt,
  }, [block.lighting.frameParticleColorStateIndices.buffer]);
  for (let transformChunkIndex = 0;
    transformChunkIndex < transformChunkCount;
    transformChunkIndex += 1) {
    const offset = transformChunkIndex * TRANSFORM_RESPONSE_CHUNK_TRANSFORMS;
    const transformChunk = transforms.slice(
      offset,
      Math.min(transforms.length, offset + TRANSFORM_RESPONSE_CHUNK_TRANSFORMS),
    );
    const transformChunkByteLength = transformChunk.reduce(
      (total, transform) => total + transform.length,
      Math.min(transformChunk.length, transforms.length - offset - 1),
    );
    self.postMessage({
      type: "materialized-chunk",
      requestId: data.requestId,
      transformChunkIndex,
      transformChunkCount,
      transforms: transformChunk,
      transformChunkByteLength,
    });
    if (transformChunkIndex + 1 < transformChunkCount) {
      await new Promise((resolve) => setTimeout(resolve, catalog.frameMilliseconds));
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
