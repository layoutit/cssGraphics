import {
  CSSCYCLONE_BLOCK_ENCODING,
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
  decodeCyclonePreparedBlock,
  decodeCyclonePreparedBlockIncrementally,
} from "../shared/csscyclone/preparedBlockTransport.mjs";

const CATALOG_SCHEMA = "csscyclone-prepared-stream-catalog@1";
const BLOCK_SCHEMA = "csscyclone-prepared-stream-block@2";
const RUNTIME_LOOKAHEAD_BLOCK_COUNT = 11;
const STARTUP_HUE_SECTOR_NAMES = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const STARTUP_PALETTE_FAMILIES = Object.freeze(["blue", "yellow", "red", "magenta", "green"]);
const STARTUP_SILHOUETTE_SAMPLING = "browser-reviewed-expressive-source-windows";
const STARTUP_SELECTION = "session-crypto-shuffled-palette-family-source-window-no-immediate-repeat";

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
  previousSelectionId = null,
  preferredPaletteFamily = null,
  randomUint32Pair = cryptoRandomUint32Pair,
} = {}) {
  validateCatalog(catalog);
  const params = new URLSearchParams(search);
  const requestedChunk = params.get("chunk");
  const requestedFrame = params.get("frame");
  const requestedPaletteFamily = params.get("palette");
  if (requestedChunk !== null || requestedFrame !== null) {
    const chunkIndex = requestedChunk === null ? 0 : Number(requestedChunk);
    const frameIndex = requestedFrame === null ? 0 : Number(requestedFrame);
    const paletteFamily = requestedPaletteFamily ?? catalog.startupPaletteFamilies[0];
    validatePosition(catalog, chunkIndex, frameIndex);
    if (!catalog.startupPaletteFamilies.includes(paletteFamily)) {
      throw new RangeError("Requested Cyclone palette family is invalid");
    }
    return Object.freeze({ paletteFamily, chunkIndex, frameIndex, mode: "explicit" });
  }
  if (previousSelectionId !== null &&
      (typeof previousSelectionId !== "string" ||
        !catalog.startupSelections.some((selection) => selection.id === previousSelectionId))) {
    throw new RangeError("Previous Cyclone start selection is invalid");
  }
  if (preferredPaletteFamily !== null &&
      !catalog.startupPaletteFamilies.includes(preferredPaletteFamily)) {
    throw new RangeError("Preferred Cyclone palette family is invalid");
  }
  const values = randomUint32Pair();
  if (!Array.isArray(values) || values.length !== 2 ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new RangeError("Cyclone startup random values must be two uint32 values");
  }
  const paletteFamilyIndex = values[0] % catalog.startupPaletteFamilies.length;
  const paletteFamily = preferredPaletteFamily ?? catalog.startupPaletteFamilies[paletteFamilyIndex];
  const familySelections = catalog.startupSelections.filter((selection) =>
    selection.paletteFamily === paletteFamily);
  let selectionIndex = (preferredPaletteFamily === null
    ? Math.floor(values[0] / catalog.startupPaletteFamilies.length)
    : values[0]) % familySelections.length;
  if (familySelections[selectionIndex].id === previousSelectionId && familySelections.length > 1) {
    selectionIndex = (selectionIndex + 1) % familySelections.length;
  }
  const selection = familySelections[selectionIndex];
  const frameIndex = selection.startFrameIndex + values[1] % selection.frameCount;
  return Object.freeze({
    selectionId: selection.id,
    paletteFamily,
    chunkIndex: selection.chunkIndex,
    frameIndex,
    mode: preferredPaletteFamily !== null
      ? "session-shuffled-palette-crypto-random-source-window"
      : previousSelectionId === null
      ? "crypto-random-balanced-source-palette"
      : "crypto-random-balanced-source-palette-no-repeat",
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
  let residentPreparedCssStringBytes = 0;
  let peakResidentPreparedCssStringBytes = 0;
  let preparedMatrixExpansionCount = 0;
  let incrementalDecodeRequestCount = 0;
  let incrementalDecodeCompletedBlockCount = 0;
  let incrementalDecodeSliceCount = 0;
  let incrementalDecodeOperationCount = 0;
  let incrementalDecodeMaximumSliceMilliseconds = 0;
  let destroyed = false;

  async function load(streamBlockIndex, { incremental = false } = {}) {
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
      if (incremental) incrementalDecodeRequestCount += 1;
      const block = incremental
        ? await decodeCyclonePreparedBlockIncrementally(decoded, descriptor, catalog, {
          isCurrent: () => !destroyed && desiredBlockIndices.has(streamBlockIndex),
          onSlice(operationCount, durationMilliseconds) {
            incrementalDecodeSliceCount += 1;
            incrementalDecodeOperationCount += operationCount;
            incrementalDecodeMaximumSliceMilliseconds = Math.max(
              incrementalDecodeMaximumSliceMilliseconds,
              durationMilliseconds,
            );
          },
        })
        : decodeCyclonePreparedBlock(decoded, descriptor, catalog);
      if (block === null) {
        throw new Error(`Prepared Cyclone block ${streamBlockIndex} incremental decode was cancelled`);
      }
      validateBlock(block, descriptor, catalog);
      const record = Object.freeze({
        block,
        decodedByteLength: decoded.byteLength,
        preparedCssStringByteLength: block.preparedCssStringByteLength,
      });
      records.set(streamBlockIndex, record);
      loadCount += 1;
      if (incremental) incrementalDecodeCompletedBlockCount += 1;
      preparedMatrixExpansionCount += block.preparedMatrixExpansionCount;
      residentDecodedBytes += decoded.byteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      residentPreparedCssStringBytes += block.preparedCssStringByteLength;
      peakResidentPreparedCssStringBytes = Math.max(
        peakResidentPreparedCssStringBytes,
        residentPreparedCssStringBytes,
      );
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
    residentPreparedCssStringBytes -= record.preparedCssStringByteLength;
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
        residentPreparedCssStringBytes,
        peakResidentPreparedCssStringBytes,
        preparedMatrixExpansionCount,
        incrementalDecodeRequestCount,
        incrementalDecodeCompletedBlockCount,
        incrementalDecodeSliceCount,
        incrementalDecodeOperationCount,
        incrementalDecodeMaximumSliceMilliseconds,
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
      typeof catalog.modelId !== "string" || catalog.modelId.length < 1 ||
      !Number.isSafeInteger(catalog.particleCount) || catalog.particleCount < 1 ||
      !Number.isSafeInteger(catalog.leafCount) || catalog.leafCount !== catalog.particleCount * 6 ||
      catalog.playbackSchema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      catalog.lightingBlockSchema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA ||
      catalog.sourceTransformProfile?.controlPointCount !== 6 ||
      !Number.isFinite(catalog.sourceTransformProfile?.speed) || catalog.sourceTransformProfile.speed <= 0 ||
      !Number.isSafeInteger(catalog.sourceTransformProfile?.complexity) ||
      catalog.sourceTransformProfile.complexity < 1 ||
      !Number.isFinite(catalog.sourceTransformProfile?.particleSize) ||
      catalog.sourceTransformProfile.particleSize <= 0 ||
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
      !Array.isArray(catalog.startupPaletteFamilies) ||
      catalog.startupPaletteFamilies.length !== STARTUP_PALETTE_FAMILIES.length ||
      catalog.startupPaletteFamilies.some((family, index) =>
        family !== STARTUP_PALETTE_FAMILIES[index]) ||
      !Array.isArray(catalog.startupSelections) || catalog.startupSelections.length < 2 ||
      new Set(catalog.startupSelections.map((selection) => selection?.id)).size !==
        catalog.startupSelections.length ||
      catalog.startupSelections.some((selection) =>
        typeof selection?.id !== "string" || selection.id.length < 1 ||
        !catalog.startupPaletteFamilies.includes(selection.paletteFamily) ||
        !Number.isSafeInteger(selection.chunkIndex) || selection.chunkIndex < 0 ||
        selection.chunkIndex >= catalog.chunkCount ||
        !Number.isSafeInteger(selection.startFrameIndex) || selection.startFrameIndex < 0 ||
        !Number.isSafeInteger(selection.frameCount) || selection.frameCount < 1 ||
        selection.startFrameIndex + selection.frameCount > catalog.chunkFrameCount) ||
      catalog.maximumColorFamilyCount !== 3 ||
      catalog.startupSilhouetteSampling !== STARTUP_SILHOUETTE_SAMPLING ||
      !Array.isArray(catalog.startupSilhouetteSampleFrameOffsets) ||
      catalog.startupSilhouetteSampleFrameOffsets.length < 1 ||
      new Set(catalog.startupSilhouetteSampleFrameOffsets).size !==
        catalog.startupSilhouetteSampleFrameOffsets.length ||
      catalog.startupSilhouetteSampleFrameOffsets.some((frameOffset) =>
        !Number.isSafeInteger(frameOffset) || frameOffset < 0 ||
        catalog.startupSelections.some((selection) => frameOffset >= selection.frameCount)) ||
      catalog.selection !== STARTUP_SELECTION ||
      catalog.runtimeLookaheadBlockCount !== RUNTIME_LOOKAHEAD_BLOCK_COUNT ||
      catalog.entries.some((entry, index) => entry?.index !== index ||
        entry.chunkIndex !== Math.floor(index / catalog.blocksPerChunk) ||
        entry.blockIndex !== index % catalog.blocksPerChunk ||
        entry.startFrameIndex !== index * catalog.blockFrameCount ||
        entry.frameCount !== catalog.blockFrameCount ||
        entry.sourceContinuousFromPrevious !== (index > 0) ||
        entry.encoding !== CSSCYCLONE_BLOCK_ENCODING ||
        typeof entry.assetUrl !== "string" ||
        !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 ||
        !Number.isSafeInteger(entry.decodedByteLength) || entry.decodedByteLength < 1 ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/u.test(entry.decodedSha256 ?? ""))) {
    throw new Error("Prepared Cyclone stream catalog drifted");
  }
  validateStartupColorProfile(catalog.startupColorProfile, catalog);
}

function validateStartupColorProfile(profile, catalog) {
  const familySelectionCounts = new Map(catalog.startupPaletteFamilies.map((family) => [family, 0]));
  for (const selection of catalog.startupSelections) {
    familySelectionCounts.set(selection.paletteFamily, familySelectionCounts.get(selection.paletteFamily) + 1);
  }
  if (profile?.schema !== "csscyclone-prepared-startup-color-profile@2" ||
      profile.metric !== "prepared-source-particle-rgb-hsv-dominant-family-per-curated-window" ||
      typeof profile.minimumMeanSaturation !== "number" || profile.minimumMeanSaturation < 0 ||
      profile.minimumMeanSaturation > 1 ||
      typeof profile.minimumDominantHueShare !== "number" ||
      profile.minimumDominantHueShare <= 0 || profile.minimumDominantHueShare > 1 ||
      profile.maximumColorFamilyCount !== catalog.maximumColorFamilyCount ||
      !Array.isArray(profile.hueSectorNames) ||
      profile.hueSectorNames.length !== STARTUP_HUE_SECTOR_NAMES.length ||
      profile.hueSectorNames.some((name, index) => name !== STARTUP_HUE_SECTOR_NAMES[index]) ||
      !Array.isArray(profile.paletteFamilies) ||
      profile.paletteFamilies.length !== catalog.startupPaletteFamilies.length ||
      profile.paletteFamilies.some((family, index) => family !== catalog.startupPaletteFamilies[index]) ||
      !Number.isSafeInteger(profile.familySelectionCount) || profile.familySelectionCount < 1 ||
      [...familySelectionCounts.values()].some((count) => count !== profile.familySelectionCount) ||
      !Array.isArray(profile.selections) ||
      profile.selections.length !== catalog.startupSelections.length ||
      profile.selections.some((selectionProfile, index) => {
        const selection = catalog.startupSelections[index];
        return selectionProfile?.id !== selection.id ||
          selectionProfile.paletteFamily !== selection.paletteFamily ||
          selectionProfile.chunkIndex !== selection.chunkIndex ||
          selectionProfile.startFrameIndex !== selection.startFrameIndex ||
          selectionProfile.frameCount !== selection.frameCount ||
          typeof selectionProfile.meanSaturation !== "number" ||
          selectionProfile.meanSaturation < profile.minimumMeanSaturation ||
          selectionProfile.dominantHueSector !== selection.paletteFamily ||
          typeof selectionProfile.dominantHueShare !== "number" ||
          selectionProfile.dominantHueShare < profile.minimumDominantHueShare ||
          selectionProfile.dominantHueShare > 1 ||
          !Array.isArray(selectionProfile.hueSectorShares) ||
          selectionProfile.hueSectorShares.length !== STARTUP_HUE_SECTOR_NAMES.length ||
          selectionProfile.hueSectorShares.some((share) =>
            typeof share !== "number" || share < 0 || share > 1) ||
          Math.abs(selectionProfile.hueSectorShares.reduce((sum, share) => sum + share, 0) - 1) >
            0.00001;
      })) {
    throw new Error("Prepared Cyclone startup color profile drifted");
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
      playback?.schema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      playback.modelId !== catalog.modelId ||
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
      playback.particleCount !== catalog.particleCount ||
      playback.leafCount !== catalog.leafCount ||
      playback.transforms?.length !== descriptor.frameCount * catalog.particleCount ||
      playback.transforms.some((transform) =>
        typeof transform !== "string" || !transform.startsWith("matrix3d(")) ||
      lighting?.schema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA ||
      lighting.streamId !== catalog.streamId ||
      lighting.streamBlockIndex !== descriptor.index ||
      lighting.chunkIndex !== descriptor.chunkIndex ||
      lighting.blockIndex !== descriptor.blockIndex ||
      lighting.startFrameIndex !== descriptor.startFrameIndex ||
      lighting.frameCount !== descriptor.frameCount ||
      lighting.particleCount !== playback.particleCount ||
      !(lighting.frameParticleColorStateIndices instanceof Uint16Array) ||
      lighting.frameParticleColorStateIndices.length !== descriptor.frameCount * playback.particleCount ||
      block.preparedMatrixExpansionCount !== playback.transforms.length ||
      !Number.isSafeInteger(block.preparedCssStringByteLength) ||
      block.preparedCssStringByteLength < playback.transforms.length) {
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
