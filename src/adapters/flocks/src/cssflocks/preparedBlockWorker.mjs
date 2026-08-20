// SPDX-License-Identifier: GPL-2.0-or-later
import { decodeFlocksPreparedBlock } from "../shared/cssflocks/preparedBlockTransport.mjs";

const RESPONSE_CHUNK_SIZE = 960;
let catalog = null;
let tail = Promise.resolve();
const canceledRequestIds = new Set();

self.addEventListener("message", ({ data }) => {
  try {
    if (data?.type === "initialize") {
      if (catalog !== null || data.catalog?.schema !== "cssflocks-prepared-stream-catalog@1") {
        throw new Error("Prepared Flocks worker catalog drifted");
      }
      catalog = data.catalog;
      self.postMessage({ type: "initialized" });
      return;
    }
    if (data?.type === "cancel" && Number.isSafeInteger(data.requestId)) {
      canceledRequestIds.add(data.requestId);
      return;
    }
    if (data?.type !== "materialize" || catalog === null ||
        !Number.isSafeInteger(data.requestId) || !(data.bytes instanceof Uint8Array)) {
      throw new Error("Prepared Flocks worker request drifted");
    }
    tail = tail.then(() => materialize(data), () => materialize(data))
      .catch((error) => postError(error, data.requestId));
  } catch (error) {
    postError(error, Number.isSafeInteger(data?.requestId) ? data.requestId : null);
  }
});

async function materialize(data) {
  if (canceledRequestIds.delete(data.requestId)) return;
  const startedAt = performance.now();
  const block = decodeFlocksPreparedBlock(data.bytes, data.descriptor, catalog);
  if (canceledRequestIds.delete(data.requestId)) return;
  const { transforms, colors } = block.playback;
  const chunkCount = Math.ceil(transforms.length / RESPONSE_CHUNK_SIZE);
  self.postMessage({
    type: "materialized-start",
    requestId: data.requestId,
    block: { ...block, playback: { ...block.playback, transforms: null, colors: null } },
    chunkCount,
    durationMilliseconds: performance.now() - startedAt,
  });
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    if (canceledRequestIds.delete(data.requestId)) return;
    const start = chunkIndex * RESPONSE_CHUNK_SIZE;
    const end = Math.min(transforms.length, start + RESPONSE_CHUNK_SIZE);
    self.postMessage({
      type: "materialized-chunk",
      requestId: data.requestId,
      chunkIndex,
      chunkCount,
      transforms: transforms.slice(start, end),
      colors: colors.slice(start, end),
    });
    if (!data.eager && chunkIndex + 1 < chunkCount) {
      await new Promise((resolve) => setTimeout(resolve, catalog.frameMilliseconds));
    }
  }
}

function postError(error, requestId) {
  self.postMessage({
    type: "error",
    requestId,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  });
}
