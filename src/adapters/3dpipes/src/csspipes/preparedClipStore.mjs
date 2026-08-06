import { CssPipesContractError, object, safeGeneratedUrl } from "./types.mjs";
import { readPreparedJson } from "./preparedResponse.mjs";

function validateDescriptor(value, index) {
  const descriptor = object(value, `playback.clipChunks.descriptors[${index}]`);
  if (descriptor.clipIndex !== index || !Number.isInteger(descriptor.bytes) ||
      descriptor.bytes <= 0 || !Number.isInteger(descriptor.transformCount) ||
      descriptor.transformCount <= 0 || descriptor.encoding !== "gzip" ||
      !Number.isInteger(descriptor.storedBytes) || descriptor.storedBytes <= 0) {
    throw new CssPipesContractError(`Prepared clip descriptor ${index} is invalid`);
  }
  return Object.freeze({
    ...descriptor,
    url: safeGeneratedUrl(descriptor.url, `playback clip ${index} URL`),
  });
}

function validateChunk(input, descriptor) {
  const chunk = object(input, `prepared clip ${descriptor.clipIndex}`);
  if (chunk.schema !== "csspipes-prepared-clip-chunk@1" ||
      chunk.clipIndex !== descriptor.clipIndex ||
      !Array.isArray(chunk.transforms) ||
      chunk.transforms.length !== descriptor.transformCount ||
      !chunk.transforms.every((transform) => typeof transform === "string") ||
      !chunk.placement || !chunk.recording) {
    throw new CssPipesContractError(
      `Prepared clip ${descriptor.clipIndex} does not match its descriptor`,
    );
  }
  return Object.freeze(chunk);
}

export function createPreparedClipStore(playback, fetchImpl = globalThis.fetch) {
  const contract = object(playback.clipChunks, "playback.clipChunks");
  if (contract.schema !== "csspipes-prepared-clip-chunks@1" ||
      !Array.isArray(contract.descriptors) ||
      contract.count !== playback.clipCount ||
      contract.descriptors.length !== contract.count) {
    throw new CssPipesContractError("Prepared clip storage contract is invalid");
  }
  const descriptors = Object.freeze(contract.descriptors.map(validateDescriptor));
  const cache = new Map();
  const values = new Map();

  function load(index) {
    const descriptor = descriptors[index];
    if (!descriptor) throw new RangeError(`Prepared clip ${index} is out of range`);
    let request = cache.get(index);
    if (!request) {
      request = fetchImpl(descriptor.url, { cache: "force-cache" }).then(async (response) => {
        if (!response?.ok) {
          throw new CssPipesContractError(
            `Prepared clip ${index} request failed (${response?.status ?? "network"})`,
          );
        }
        const chunk = validateChunk(await readPreparedJson(response), descriptor);
        if (cache.get(index) === request) values.set(index, chunk);
        return chunk;
      });
      cache.set(index, request);
    }
    return request;
  }

  return Object.freeze({
    load,
    preload(indices) {
      return Promise.all([...new Set(indices)].map(load));
    },
    loaded(index) {
      return values.get(index) ?? null;
    },
    retain(indices) {
      const retained = new Set(indices);
      for (const index of cache.keys()) {
        if (retained.has(index)) continue;
        cache.delete(index);
        values.delete(index);
      }
    },
  });
}
