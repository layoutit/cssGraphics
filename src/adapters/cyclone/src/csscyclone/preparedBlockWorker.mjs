import { decodeCyclonePreparedBlock } from "../shared/csscyclone/preparedBlockTransport.mjs";

let catalog = null;

self.addEventListener("message", ({ data }) => {
  try {
    if (data?.type === "initialize") {
      if (catalog !== null || data.catalog?.schema !== "csscyclone-prepared-stream-catalog@1") {
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
    const startedAt = performance.now();
    const block = decodeCyclonePreparedBlock(data.bytes, data.descriptor, catalog);
    const transformBytes = new TextEncoder().encode(block.playback.transforms.join("\n"));
    const transferredBlock = {
      ...block,
      playback: { ...block.playback, transforms: null },
    };
    self.postMessage({
      type: "materialized",
      requestId: data.requestId,
      block: transferredBlock,
      transformBytes,
      durationMilliseconds: performance.now() - startedAt,
    }, [transformBytes.buffer, block.lighting.frameParticleColorStateIndices.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: Number.isSafeInteger(data?.requestId) ? data.requestId : null,
      message: String(error?.message || error),
      stack: String(error?.stack || ""),
    });
  }
});
