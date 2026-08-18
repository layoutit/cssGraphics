const CATALOG_SCHEMA = "csscyclone-prepared-stream-catalog@1";
const BLOCK_SCHEMA = "csscyclone-prepared-stream-block@1";
const PLAYBACK_SCHEMA = "csscyclone-prepared-dom-playback@3";
const LIGHTING_BLOCK_SCHEMA = "csscyclone-prepared-lighting-block@1";

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
  previousChunkIndex = null,
  randomUint32Pair = cryptoRandomUint32Pair,
} = {}) {
  validateCatalog(catalog);
  const params = new URLSearchParams(search);
  const requestedChunk = params.get("chunk");
  const requestedFrame = params.get("frame");
  if (requestedChunk !== null || requestedFrame !== null) {
    const chunkIndex = requestedChunk === null ? 0 : Number(requestedChunk);
    const frameIndex = requestedFrame === null ? 0 : Number(requestedFrame);
    validatePosition(catalog, chunkIndex, frameIndex);
    return Object.freeze({ chunkIndex, frameIndex, mode: "explicit" });
  }
  if (previousChunkIndex !== null &&
      (!Number.isSafeInteger(previousChunkIndex) || previousChunkIndex < 0 ||
        previousChunkIndex >= catalog.randomStartChunkCount)) {
    throw new RangeError("Previous Cyclone start chunk is invalid");
  }
  const values = randomUint32Pair();
  if (!Array.isArray(values) || values.length !== 2 ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new RangeError("Cyclone startup random values must be two uint32 values");
  }
  const availableChunkCount = previousChunkIndex === null || catalog.randomStartChunkCount === 1
    ? catalog.randomStartChunkCount
    : catalog.randomStartChunkCount - 1;
  let chunkIndex = values[0] % availableChunkCount;
  if (previousChunkIndex !== null && chunkIndex >= previousChunkIndex) chunkIndex += 1;
  const frameIndex = values[1] % catalog.randomStartFrameCount;
  return Object.freeze({
    chunkIndex,
    frameIndex,
    mode: previousChunkIndex === null ? "crypto-random" : "crypto-random-no-repeat",
  });
}

export function createCyclonePreparedBlockLoader(catalog) {
  validateCatalog(catalog);
  const records = new Map();
  let desiredBlockIndices = new Set();
  let loadCount = 0;
  let releaseCount = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let destroyed = false;

  async function load(streamBlockIndex) {
    if (destroyed) throw new Error("Prepared Cyclone block loader is destroyed");
    const descriptor = catalog.entries[streamBlockIndex];
    if (!descriptor || descriptor.index !== streamBlockIndex) {
      throw new RangeError(`Prepared Cyclone block ${streamBlockIndex} is missing`);
    }
    const existing = records.get(streamBlockIndex);
    if (existing?.block) return existing.block;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(descriptor.assetUrl, { cache: "force-cache" }));
      await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, `block ${streamBlockIndex}`);
      const decoded = await decompressGzip(encoded);
      await verifyBytes(
        decoded,
        descriptor.decodedByteLength,
        descriptor.decodedSha256,
        `decoded block ${streamBlockIndex}`,
      );
      const block = JSON.parse(new TextDecoder().decode(decoded));
      validateBlock(block, descriptor, catalog);
      const record = Object.freeze({ block, decodedByteLength: decoded.byteLength });
      records.set(streamBlockIndex, record);
      loadCount += 1;
      residentDecodedBytes += decoded.byteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (!desiredBlockIndices.has(streamBlockIndex)) release(streamBlockIndex, record);
      return block;
    })();
    records.set(streamBlockIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (records.get(streamBlockIndex)?.promise === promise) records.delete(streamBlockIndex);
      throw error;
    }
  }

  function prefetch(streamBlockIndex) {
    void load(streamBlockIndex).catch(() => undefined);
  }

  function retain(streamBlockIndices) {
    desiredBlockIndices = new Set(streamBlockIndices);
    for (const [streamBlockIndex, record] of records) {
      if (!desiredBlockIndices.has(streamBlockIndex)) release(streamBlockIndex, record);
    }
  }

  function release(streamBlockIndex, record) {
    if (!record?.block || records.get(streamBlockIndex) !== record) return;
    records.delete(streamBlockIndex);
    residentDecodedBytes -= record.decodedByteLength;
    releaseCount += 1;
  }

  return Object.freeze({
    load,
    prefetch,
    retain,
    stats() {
      return Object.freeze({
        loadCount,
        releaseCount,
        residentBlockCount: [...records.values()].filter((record) => record?.block).length,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        desiredBlockIndices: Object.freeze([...desiredBlockIndices].sort((left, right) => left - right)),
      });
    },
    destroy() {
      destroyed = true;
      retain([]);
    },
  });
}

function validateCatalog(catalog) {
  if (catalog?.schema !== CATALOG_SCHEMA ||
      typeof catalog.streamId !== "string" ||
      catalog.chunkCount !== 24 ||
      !Number.isSafeInteger(catalog.chunkFrameCount) || catalog.chunkFrameCount < 1 ||
      !Number.isSafeInteger(catalog.blockCount) || catalog.blockCount < catalog.chunkCount ||
      catalog.entries?.length !== catalog.blockCount ||
      !Number.isSafeInteger(catalog.blocksPerChunk) || catalog.blocksPerChunk < 1 ||
      catalog.blockCount !== catalog.chunkCount * catalog.blocksPerChunk ||
      !Number.isSafeInteger(catalog.blockFrameCount) || catalog.blockFrameCount < 1 ||
      catalog.chunkFrameCount !== catalog.blocksPerChunk * catalog.blockFrameCount ||
      !Number.isSafeInteger(catalog.frameMilliseconds) || catalog.frameMilliseconds < 1 ||
      catalog.streamFrameCount !== catalog.chunkCount * catalog.chunkFrameCount ||
      catalog.streamDurationMilliseconds !== catalog.streamFrameCount * catalog.frameMilliseconds ||
      !Number.isSafeInteger(catalog.randomStartChunkCount) || catalog.randomStartChunkCount < 1 ||
      catalog.randomStartChunkCount > catalog.chunkCount ||
      !Number.isSafeInteger(catalog.randomStartFrameCount) || catalog.randomStartFrameCount < 1 ||
      catalog.randomStartFrameCount > catalog.chunkFrameCount ||
      catalog.runtimeLookaheadBlockCount !== 1 ||
      catalog.entries.some((entry, index) => entry?.index !== index ||
        entry.chunkIndex !== Math.floor(index / catalog.blocksPerChunk) ||
        entry.blockIndex !== index % catalog.blocksPerChunk ||
        entry.startFrameIndex !== index * catalog.blockFrameCount ||
        entry.frameCount !== catalog.blockFrameCount ||
        entry.sourceContinuousFromPrevious !== (index > 0) ||
        entry.encoding !== "gzip-newline-json" ||
        typeof entry.assetUrl !== "string" ||
        !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 ||
        !Number.isSafeInteger(entry.decodedByteLength) || entry.decodedByteLength < 1 ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/u.test(entry.decodedSha256 ?? ""))) {
    throw new Error("Prepared Cyclone stream catalog drifted");
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
      playback?.schema !== PLAYBACK_SCHEMA ||
      playback.streamId !== catalog.streamId ||
      playback.streamBlockIndex !== descriptor.index ||
      playback.chunkIndex !== descriptor.chunkIndex ||
      playback.blockIndex !== descriptor.blockIndex ||
      playback.chunkCount !== catalog.chunkCount ||
      playback.blockCount !== catalog.blockCount ||
      playback.blocksPerChunk !== catalog.blocksPerChunk ||
      playback.startFrameIndex !== descriptor.startFrameIndex ||
      playback.frameMilliseconds !== catalog.frameMilliseconds ||
      playback.frameCount !== descriptor.frameCount ||
      playback.durationMilliseconds !== descriptor.frameCount * catalog.frameMilliseconds ||
      playback.loop !== false ||
      playback.frames?.length !== descriptor.frameCount ||
      playback.mounted?.shapeTransformIndices?.length !== playback.particleCount ||
      playback.frames.some((row) => row?.length !== playback.particleCount * 2) ||
      lighting?.schema !== LIGHTING_BLOCK_SCHEMA ||
      lighting.streamId !== catalog.streamId ||
      lighting.streamBlockIndex !== descriptor.index ||
      lighting.chunkIndex !== descriptor.chunkIndex ||
      lighting.blockIndex !== descriptor.blockIndex ||
      lighting.startFrameIndex !== descriptor.startFrameIndex ||
      lighting.frameCount !== descriptor.frameCount ||
      lighting.particleCount !== playback.particleCount ||
      lighting.frameParticleColorStateIndices?.length !== descriptor.frameCount ||
      lighting.frameParticleColorStateIndices.some((row) => row?.length !== playback.particleCount)) {
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
