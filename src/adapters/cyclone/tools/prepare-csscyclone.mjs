#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph/prepare";
import {
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_MODEL_IDS,
  buildCyclonePreparedModel,
  buildCyclonePreparedPlayback,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import { createCyclonePreparedLightingStream } from "../src/prepare/csscyclone/preparedLighting.mjs";
import {
  CSSCYCLONE_BANKS,
  CSSCYCLONE_PRESENTATION,
  CSSCYCLONE_SOURCE,
  buildCycloneSourceChunks,
  selectCycloneSourceParticlePrefix,
} from "../src/prepare/csscyclone/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/csscyclone");
const stagingRoot = join(repositoryRoot, `build/generated/.csscyclone-${process.pid}`);
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const blockFrameCount = 50;
const startupPaletteFamilies = CSSCYCLONE_PRESENTATION.startupPaletteFamilies;
const startupSilhouetteSampleFrameOffsets = CSSCYCLONE_PRESENTATION.startupSilhouetteSampleFrameOffsets;
const hueSectorNames = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const profileConfigs = Object.freeze([
  Object.freeze({
    id: "desktop",
    bank: CSSCYCLONE_BANKS.desktop,
    modelId: CSSCYCLONE_MODEL_IDS.desktop,
    catalogUrl: "/csscyclone/catalog.json",
    blockRoot: "/csscyclone/blocks",
    lightingAssetRoot: "/csscyclone/assets",
    particleSelection: "source-default-all-particles",
    startupSelections: CSSCYCLONE_PRESENTATION.startupSelections,
  }),
  Object.freeze({
    id: "mobile",
    bank: CSSCYCLONE_BANKS.mobile,
    modelId: CSSCYCLONE_MODEL_IDS.mobile,
    catalogUrl: "/csscyclone/mobile/catalog.json",
    blockRoot: "/csscyclone/mobile/blocks",
    lightingAssetRoot: "/csscyclone/mobile/assets",
    particleSelection: "prepared-source-particle-prefix",
    startupSelections: CSSCYCLONE_PRESENTATION.mobileStartupSelections,
  }),
]);

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const preparedProfiles = [];
for (const profile of profileConfigs) preparedProfiles.push(await prepareProfile(profile));
const modelCatalog = await buildPolyMorphCatalog(
  CSSCYCLONE_MODEL_IDS.desktop,
  preparedProfiles.map(({ profile, built }) => ({
    manifest: built.manifest,
    manifestPath: `${profile.modelId}/manifest.json`,
    manifestSha256: built.manifestSha256,
  })),
);
await writeBytes(join(stagingRoot, "model", "catalog.json"), modelCatalog.bytes);
await writeJson(join(stagingRoot, "prepared.json"), {
  schema: "csscyclone-prepared-scene@2",
  status: "ready",
  source: sourceLock,
  renderer: {
    package: "@layoutit/polycss-morph",
    profile: "static-prepared",
    representation: "retained-particle-roots-with-six-solid-triangle-leaves",
    runtimeGeometryConstruction: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
    runtimePreparedStateMaterialization: false,
    runtimeMatrixFormatting: false,
    runtimeIdLookup: false
  },
  profileSelection: {
    startupOnly: true,
    desktopProfileId: "desktop",
    mobileProfileId: "mobile",
    mobileParticleBudget: CSSCYCLONE_BANKS.mobile.particleCount,
    mobileLeafBudget: CSSCYCLONE_BANKS.mobile.particleCount * CSSCYCLONE_FACE_INDICES.length,
    mobileCapabilityQuery: "(hover: none) and (pointer: coarse)",
    mobileMaximumViewportWidth: 599,
  },
  profiles: Object.freeze(Object.fromEntries(preparedProfiles.map(({ profile, metadata }) =>
    [profile.id, metadata]))),
  oracle: {
    sourceState: "pinned-continuous-source-translation-with-fixed-mt19937-authoring-seed",
    visual: "frame-zero-lighting-qualified-moving-highlight-approximate-full-scene-not-pixel-qualified"
  }
});

await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({
  outputRoot,
  profiles: preparedProfiles.map(({ profile, built, metadata, metrics }) => ({
    id: profile.id,
    modelId: profile.modelId,
    manifestSha256: built.manifestSha256,
    retainedParticleRootCount: metadata.model.retainedParticleRootCount,
    retainedPolygonLeafCount: metadata.model.retainedPolygonLeafCount,
    ...metrics,
  })),
}, null, 2));

async function prepareProfile(profile) {
  const { bank, startupSelections } = profile;
  const blocksPerChunk = bank.frameCount / blockFrameCount;
  const blockCount = bank.chunkCount * blocksPerChunk;
  if (!Number.isSafeInteger(blocksPerChunk)) {
    throw new Error(`Cyclone ${profile.id} prepared chunk must divide into exact transport blocks`);
  }
  const lightingStream = createCyclonePreparedLightingStream({
    assetRoot: profile.lightingAssetRoot,
  });
  const blockEntries = [];
  const startupSelectionColorProfiles = new Map();
  let preparedModel = null;
  let preparedFrameCount = 0;
  let uniquePreparedTransformCount = 0;
  let shapeTransformSelections = 0;
  let preparedBlockEncodedBytes = 0;
  let preparedBlockDecodedBytes = 0;
  let maximumResidentBlockPairDecodedBytes = 0;
  let previousBlockDecodedBytes = 0;
  let firstBlockDecodedBytes = 0;
  for (const desktopSource of buildCycloneSourceChunks({ bank: CSSCYCLONE_BANKS.desktop })) {
    const source = profile.id === "mobile"
      ? selectCycloneSourceParticlePrefix(desktopSource, bank)
      : desktopSource;
    if (preparedModel === null) {
      const result = buildCyclonePreparedModel({ source, modelId: profile.modelId });
      preparedModel = Object.freeze({ model: result.model, metrics: result.metrics });
    }
    const preparedPlayback = buildCyclonePreparedPlayback({ source, modelId: profile.modelId });
    const lighting = lightingStream.add(source);
    for (const selection of startupSelections.filter((entry) =>
      entry.chunkIndex === source.bank.chunkIndex)) {
      startupSelectionColorProfiles.set(selection.id, analyzeStartupSelectionColors(source, selection));
    }
    for (let blockIndex = 0; blockIndex < blocksPerChunk; blockIndex += 1) {
      const streamBlockIndex = source.bank.chunkIndex * blocksPerChunk + blockIndex;
      const localStartFrameIndex = blockIndex * blockFrameCount;
      const startFrameIndex = source.bank.startFrameIndex + localStartFrameIndex;
      const blockPlayback = slicePreparedPlayback({
        playback: preparedPlayback.playback,
        blockIndex,
        streamBlockIndex,
        startFrameIndex,
        localStartFrameIndex,
        blockCount,
        blocksPerChunk,
      });
      const blockLighting = Object.freeze({
        schema: "csscyclone-prepared-lighting-block@1",
        streamId: source.bank.streamId,
        chunkIndex: source.bank.chunkIndex,
        blockIndex,
        streamBlockIndex,
        startFrameIndex,
        frameCount: blockFrameCount,
        particleCount: source.bank.particleCount,
        frameParticleColorStateIndices: lighting.frameParticleColorStateIndices.slice(
          localStartFrameIndex,
          localStartFrameIndex + blockFrameCount,
        ),
      });
      const decoded = Buffer.from(`${JSON.stringify({
        schema: "csscyclone-prepared-stream-block@1",
        streamId: source.bank.streamId,
        chunkIndex: source.bank.chunkIndex,
        blockIndex,
        streamBlockIndex,
        startFrameIndex,
        frameCount: blockFrameCount,
        playback: blockPlayback,
        lighting: blockLighting,
      })}\n`);
      const encoded = gzipSync(decoded, { level: 9 });
      const encodedSha256 = sha256(encoded);
      const decodedSha256 = sha256(decoded);
      const assetUrl = `${profile.blockRoot}/block-${String(streamBlockIndex).padStart(3, "0")}-${encodedSha256}.bin`;
      await writeBytes(join(stagingRoot, assetUrl.replace(/^\/csscyclone\//u, "")), encoded);
      blockEntries.push(Object.freeze({
        index: streamBlockIndex,
        chunkIndex: source.bank.chunkIndex,
        blockIndex,
        startFrameIndex,
        frameCount: blockFrameCount,
        sourceContinuousFromPrevious: streamBlockIndex > 0,
        assetUrl,
        encoding: "gzip-newline-json",
        byteLength: encoded.byteLength,
        sha256: encodedSha256,
        decodedByteLength: decoded.byteLength,
        decodedSha256,
      }));
      preparedBlockEncodedBytes += encoded.byteLength;
      preparedBlockDecodedBytes += decoded.byteLength;
      if (streamBlockIndex === 0) firstBlockDecodedBytes = decoded.byteLength;
      maximumResidentBlockPairDecodedBytes = Math.max(
        maximumResidentBlockPairDecodedBytes,
        previousBlockDecodedBytes + decoded.byteLength,
      );
      previousBlockDecodedBytes = decoded.byteLength;
    }
    preparedFrameCount += preparedPlayback.metrics.preparedFrameCount;
    uniquePreparedTransformCount += preparedPlayback.metrics.uniquePreparedTransformCount;
    shapeTransformSelections += preparedPlayback.metrics.shapeTransformSelections;
  }
  maximumResidentBlockPairDecodedBytes = Math.max(
    maximumResidentBlockPairDecodedBytes,
    previousBlockDecodedBytes + firstBlockDecodedBytes,
  );
  const startupColorProfile = buildStartupColorProfile(
    startupSelections.map((selection) => startupSelectionColorProfiles.get(selection.id)),
    bank,
    startupSelections,
  );
  const preparedLighting = await lightingStream.finalize();
  const catalogBytes = Buffer.from(`${JSON.stringify({
    schema: "csscyclone-prepared-stream-catalog@1",
    streamId: bank.id,
    seed: bank.seed,
    chunkCount: bank.chunkCount,
    chunkFrameCount: bank.frameCount,
    blockCount,
    blocksPerChunk,
    blockFrameCount,
    frameMilliseconds: bank.frameMilliseconds,
    streamFrameCount: bank.chunkCount * bank.frameCount,
    streamDurationMilliseconds: bank.chunkCount * bank.frameCount * bank.frameMilliseconds,
    startupPaletteFamilies,
    startupSelections,
    startupSilhouetteSampling: CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
    startupSilhouetteSampleFrameOffsets,
    maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
    startupColorProfile,
    selection: "session-crypto-shuffled-palette-family-source-window-no-immediate-repeat",
    playbackOrder: "source-continuous-ascending-chunks-with-one-terminal-stream-wrap",
    runtimeLookaheadBlockCount: 1,
    entries: blockEntries,
  })}\n`);
  const catalogSha256 = sha256(catalogBytes);
  await writeBytes(
    join(stagingRoot, profile.catalogUrl.replace(/^\/csscyclone\//u, "")),
    catalogBytes,
  );
  if (preparedModel === null) throw new Error(`Cyclone ${profile.id} stream produced no prepared model`);
  const built = await buildPolyMorphPackage(preparedModel.model);
  const packageRoot = join(stagingRoot, "model", profile.modelId);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
  for (const asset of preparedLighting.assets) {
    await writeBytes(
      join(stagingRoot, asset.assetUrl.replace(/^\/csscyclone\//u, "")),
      asset.bytes,
    );
  }
  const metadata = Object.freeze({
    id: profile.id,
    particleSelection: profile.particleSelection,
    presentation: Object.freeze({
      sourceDefaults: Object.freeze({
        cyclones: 1,
        particles: CSSCYCLONE_BANKS.desktop.particleCount,
        size: CSSCYCLONE_SOURCE.particleSize,
        complexity: CSSCYCLONE_SOURCE.complexity,
        speed: CSSCYCLONE_SOURCE.speed,
        stretch: CSSCYCLONE_SOURCE.stretch,
        saturationSampling: CSSCYCLONE_PRESENTATION.saturationSampling,
        minimumSaturation: CSSCYCLONE_PRESENTATION.minimumSaturation,
        hueSampling: CSSCYCLONE_PRESENTATION.hueSampling,
        particleColorAssignment: CSSCYCLONE_PRESENTATION.particleColorAssignment,
        preparedPaletteHueSlotCount: CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount,
        preparedPaletteAssignment: CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
        maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
      }),
      preparedStream: Object.freeze({
        id: bank.id,
        seed: bank.seed,
        chunkCount: bank.chunkCount,
        chunkFrameCount: bank.frameCount,
        streamFrameCount: bank.chunkCount * bank.frameCount,
        streamDurationMilliseconds: bank.chunkCount * bank.frameCount * bank.frameMilliseconds,
        startupPaletteFamilies,
        startupSelections,
        startupSilhouetteSampling: CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
        startupSilhouetteSampleFrameOffsets,
        maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
        startupColorProfile,
        startupSelection: "session-crypto-shuffled-palette-family-source-window-no-immediate-repeat",
        handoff: "source-continuous-next-block-with-one-block-lookahead",
      }),
      productParticleCount: bank.particleCount,
      productLeafCount: bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
      viewDistance: CSSCYCLONE_SOURCE.viewDistance,
      fieldOfViewDegrees: CSSCYCLONE_SOURCE.fieldOfViewDegrees,
      startupWarmupMilliseconds: bank.warmupFrames * bank.frameMilliseconds,
    }),
    model: Object.freeze({
      id: profile.modelId,
      manifestSha256: built.manifestSha256,
      ...preparedModel.metrics,
    }),
    playback: Object.freeze({
      catalogUrl: profile.catalogUrl,
      catalogSha256,
      catalogBytes: catalogBytes.byteLength,
      chunkCount: bank.chunkCount,
      preparedBlockCount: blockEntries.length,
      preparedFrameCount,
      uniquePreparedTransformCount,
      shapeTransformSelections,
      preparedBlockEncodedBytes,
      preparedBlockDecodedBytes,
      maximumResidentBlockPairDecodedBytes,
      runtimeLookaheadBlockCount: 1,
      runtimePreparedStateMaterialization: false,
    }),
    lighting: preparedLighting.contract,
  });
  return Object.freeze({
    profile,
    built,
    metadata,
    metrics: Object.freeze({
      preparedChunkCount: bank.chunkCount,
      preparedBlockCount: blockEntries.length,
      preparedFrameCount,
      uniquePreparedTransformCount,
      shapeTransformSelections,
      preparedBlockEncodedBytes,
      preparedBlockDecodedBytes,
      maximumResidentBlockPairDecodedBytes,
      ...preparedLighting.metrics,
    }),
  });
}

function slicePreparedPlayback({
  playback,
  blockIndex,
  streamBlockIndex,
  startFrameIndex,
  localStartFrameIndex,
  blockCount,
  blocksPerChunk,
}) {
  const sourceRows = playback.frames.slice(
    localStartFrameIndex,
    localStartFrameIndex + blockFrameCount,
  );
  const transforms = [];
  const remappedTransformIndices = new Map();
  const frames = sourceRows.map((row) => Object.freeze(row.map((value, index) => {
    if (index % 2 === 0) return value;
    let remapped = remappedTransformIndices.get(value);
    if (remapped === undefined) {
      remapped = transforms.length;
      transforms.push(playback.transforms[value]);
      remappedTransformIndices.set(value, remapped);
    }
    return remapped;
  })));
  const shapeTransformIndices = Array(playback.particleCount);
  for (let operation = 0; operation < frames[0].length; operation += 2) {
    shapeTransformIndices[frames[0][operation]] = frames[0][operation + 1];
  }
  return Object.freeze({
    ...playback,
    blockIndex,
    streamBlockIndex,
    blockCount,
    blocksPerChunk,
    startFrameIndex,
    durationMilliseconds: blockFrameCount * playback.frameMilliseconds,
    frameCount: blockFrameCount,
    transforms: Object.freeze(transforms),
    mounted: Object.freeze({
      shapeTransformIndices: Object.freeze(shapeTransformIndices),
    }),
    frames: Object.freeze(frames),
  });
}

function analyzeStartupSelectionColors(source, selection) {
  const hueSectorCounts = Array(hueSectorNames.length).fill(0);
  let saturationSum = 0;
  let sampleCount = 0;
  for (const frame of source.frames.slice(
    selection.startFrameIndex,
    selection.startFrameIndex + selection.frameCount,
  )) {
    for (const particle of frame.particles) {
      const [red, green, blue] = particle.colorRgb;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const chroma = maximum - minimum;
      saturationSum += maximum > 0 ? chroma / maximum : 0;
      hueSectorCounts[hueSector(red, green, blue, maximum, chroma)] += 1;
      sampleCount += 1;
    }
  }
  const hueSectorShares = hueSectorCounts.map((count) => count / sampleCount);
  const dominantHueSectorIndex = hueSectorShares.reduce(
    (bestIndex, share, index) => share > hueSectorShares[bestIndex] ? index : bestIndex,
    0,
  );
  return Object.freeze({
    id: selection.id,
    paletteFamily: selection.paletteFamily,
    chunkIndex: source.bank.chunkIndex,
    startFrameIndex: selection.startFrameIndex,
    frameCount: selection.frameCount,
    meanSaturation: saturationSum / sampleCount,
    dominantHueSector: hueSectorNames[dominantHueSectorIndex],
    dominantHueShare: hueSectorShares[dominantHueSectorIndex],
    hueSectorShares: Object.freeze(hueSectorShares),
  });
}

function buildStartupColorProfile(selectionProfiles, bank, startupSelections) {
  const familySelectionCounts = new Map(startupPaletteFamilies.map((family) => [family, 0]));
  const selectionIds = new Set();
  for (const selection of startupSelections) {
    familySelectionCounts.set(
      selection.paletteFamily,
      (familySelectionCounts.get(selection.paletteFamily) ?? 0) + 1,
    );
    selectionIds.add(selection.id);
  }
  const familySelectionCount = familySelectionCounts.get(startupPaletteFamilies[0]);
  if (startupPaletteFamilies.length < 2 ||
      new Set(startupPaletteFamilies).size !== startupPaletteFamilies.length ||
      startupPaletteFamilies.some((family) => !hueSectorNames.includes(family)) ||
      selectionIds.size !== startupSelections.length ||
      startupSelections.some((selection) =>
        typeof selection.id !== "string" || selection.id.length < 1 ||
        !startupPaletteFamilies.includes(selection.paletteFamily) ||
        !Number.isSafeInteger(selection.chunkIndex) || selection.chunkIndex < 0 ||
        selection.chunkIndex >= bank.chunkCount ||
        !Number.isSafeInteger(selection.startFrameIndex) || selection.startFrameIndex < 0 ||
        !Number.isSafeInteger(selection.frameCount) || selection.frameCount < 1 ||
        selection.startFrameIndex + selection.frameCount > bank.frameCount) ||
      !Number.isSafeInteger(familySelectionCount) || familySelectionCount < 1 ||
      [...familySelectionCounts.values()].some((count) => count !== familySelectionCount) ||
      new Set(startupSilhouetteSampleFrameOffsets).size !== startupSilhouetteSampleFrameOffsets.length ||
      startupSilhouetteSampleFrameOffsets.some((offset) =>
        !Number.isSafeInteger(offset) || offset < 0 ||
        startupSelections.some((selection) => offset >= selection.frameCount))) {
    throw new Error("Cyclone prepared startup selection configuration is invalid");
  }
  if (selectionProfiles.length !== startupSelections.length ||
      selectionProfiles.some((profile, index) => {
        const selection = startupSelections[index];
        return profile?.id !== selection.id ||
          profile.paletteFamily !== selection.paletteFamily ||
          profile.chunkIndex !== selection.chunkIndex ||
          profile.startFrameIndex !== selection.startFrameIndex ||
          profile.frameCount !== selection.frameCount ||
          profile.meanSaturation < CSSCYCLONE_PRESENTATION.startupMinimumMeanSaturation ||
          profile.dominantHueSector !== selection.paletteFamily ||
          profile.dominantHueShare < CSSCYCLONE_PRESENTATION.startupMinimumDominantHueShare;
      })) {
    throw new Error("Cyclone prepared startup source-palette profile drifted");
  }
  return Object.freeze({
    schema: "csscyclone-prepared-startup-color-profile@2",
    metric: "prepared-source-particle-rgb-hsv-dominant-family-per-curated-window",
    minimumMeanSaturation: CSSCYCLONE_PRESENTATION.startupMinimumMeanSaturation,
    minimumDominantHueShare: CSSCYCLONE_PRESENTATION.startupMinimumDominantHueShare,
    maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
    hueSectorNames,
    paletteFamilies: startupPaletteFamilies,
    familySelectionCount,
    selections: Object.freeze(selectionProfiles.map((profile) => Object.freeze({
      id: profile.id,
      paletteFamily: profile.paletteFamily,
      chunkIndex: profile.chunkIndex,
      startFrameIndex: profile.startFrameIndex,
      frameCount: profile.frameCount,
      meanSaturation: roundMetric(profile.meanSaturation),
      dominantHueSector: profile.dominantHueSector,
      dominantHueShare: roundMetric(profile.dominantHueShare),
      hueSectorShares: Object.freeze(profile.hueSectorShares.map(roundMetric)),
    }))),
  });
}

function hueSector(red, green, blue, maximum, chroma) {
  if (chroma <= 1e-12) return 0;
  let hue;
  if (maximum === red) hue = 60 * (((green - blue) / chroma) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / chroma + 2);
  else hue = 60 * ((red - green) / chroma + 4);
  if (hue < 0) hue += 360;
  return Math.floor((hue + 30) % 360 / 60);
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

async function assertSourceIdentity() {
  if (sourceLock.revision !== CSSCYCLONE_SOURCE.revision ||
      sourceLock.primary.sha256 !== CSSCYCLONE_SOURCE.sha256 ||
      sourceLock.rslibs.revision !== CSSCYCLONE_SOURCE.rslibsRevision) {
    throw new Error("Cyclone source lock drifted from the preparer");
  }
  const primaryRoot = resolve(repositoryRoot, ".local/cyclone/reference");
  const rslibsRoot = resolve(repositoryRoot, ".local/cyclone/rslibs");
  await verifyBytes(
    join(primaryRoot, sourceLock.primary.path),
    rawUrl(sourceLock.repository, sourceLock.revision, sourceLock.primary.path),
    sourceLock.primary.sha256,
  );
  await verifyBytes(
    join(primaryRoot, sourceLock.license.path),
    rawUrl(sourceLock.repository, sourceLock.revision, sourceLock.license.path),
    sourceLock.license.sha256,
  );
  for (const input of sourceLock.rslibs.files) {
    await verifyBytes(
      join(rslibsRoot, input.path),
      rawUrl(sourceLock.rslibs.repository, sourceLock.rslibs.revision, input.path),
      input.sha256,
    );
  }
}

async function verifyBytes(localPath, url, expected) {
  let bytes;
  try {
    bytes = await readFile(localPath);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cyclone source fetch failed: ${response.status} ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`Cyclone source bytes drifted: ${localPath}`);
}

function rawUrl(repository, revision, path) {
  const name = new URL(repository).pathname.replace(/^\//u, "").replace(/\/$/u, "");
  return `https://raw.githubusercontent.com/${name}/${revision}/${path}`;
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJson(path, value) {
  await writeBytes(path, `${JSON.stringify(value)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
