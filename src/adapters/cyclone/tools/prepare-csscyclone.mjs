#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph/prepare";
import {
  CSSCYCLONE_FALLBACK_ATLAS_PAGES,
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_MODEL_IDS,
  buildCyclonePreparedModel,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import { createCyclonePreparedLightingStream } from "../src/prepare/csscyclone/preparedLighting.mjs";
import {
  CSSCYCLONE_BLOCK_ENCODING,
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
  encodeCyclonePreparedBlock,
} from "../src/shared/csscyclone/preparedBlockTransport.mjs";
import {
  CSSCYCLONE_BANKS,
  CSSCYCLONE_PREPARED_CADENCE,
  CSSCYCLONE_PRESENTATION,
  CSSCYCLONE_SOURCE,
  CSSCYCLONE_SOURCE_BANK,
  CSSCYCLONE_SOURCE_SAFETY,
  buildCycloneSourceChunks,
  selectCycloneSourceParticlePrefix,
} from "../src/prepare/csscyclone/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/csscyclone");
const stagingRoot = join(repositoryRoot, `build/generated/.csscyclone-${process.pid}`);
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const blockFrameCount = CSSCYCLONE_PREPARED_CADENCE.framesPerSecond *
  CSSCYCLONE_PREPARED_CADENCE.blockSeconds;
const runtimeLookaheadBlockCount = 11;
const runtimeMaterializedLookaheadBlockCount = 2;
const startupMaterializedLookaheadBlockCount = 2;
const startupPaletteFamilies = CSSCYCLONE_PRESENTATION.startupPaletteFamilies;
const startupPaletteVariantIds = Object.freeze(
  CSSCYCLONE_PRESENTATION.preparedPaletteVariants.map(({ id }) => id),
);
const startupPaletteVariantWeights = Object.freeze(
  CSSCYCLONE_PRESENTATION.startupPaletteWeights,
);
const startupSilhouetteSampleFrameOffsets = CSSCYCLONE_PRESENTATION.startupSilhouetteSampleFrameOffsets;
const hueSectorNames = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const profileConfigs = Object.freeze([
  Object.freeze({
    id: "desktop",
    bank: CSSCYCLONE_BANKS.desktop,
    modelId: CSSCYCLONE_MODEL_IDS.desktop,
    catalogUrl: "/csscyclone/catalog.json",
    blockRoot: "/csscyclone/blocks",
    particleSelection: "prepared-source-particle-prefix",
    startupSelections: CSSCYCLONE_PRESENTATION.startupSelections,
  }),
  Object.freeze({
    id: "mobile",
    bank: CSSCYCLONE_BANKS.mobile,
    modelId: CSSCYCLONE_MODEL_IDS.mobile,
    catalogUrl: "/csscyclone/mobile/catalog.json",
    blockRoot: "/csscyclone/mobile/blocks",
    particleSelection: "prepared-source-particle-prefix",
    startupSelections: CSSCYCLONE_PRESENTATION.mobileStartupSelections,
  }),
]);

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const preparedProfiles = [];
for (const profile of profileConfigs) preparedProfiles.push(await prepareProfile(profile));
const sourceSeedSafety = preparedProfiles.find(({ profile }) => profile.id === "desktop")
  .metadata.presentation.preparedStream.sourceSeedSafety;
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
    representation: "retained-forward-triangular-bipyramid-roots-with-six-solid-triangle-faces",
    runtimeGeometryConstruction: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
    runtimePreparedStateMaterialization: true,
    runtimeBlockLoadMatrixFormatting: true,
    runtimeFrameMatrixFormatting: false,
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
    sourceSeedSafety,
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
  const lightingStream = createCyclonePreparedLightingStream();
  const blockEntries = [];
  const startupSelectionColorProfiles = new Map();
  let preparedModel = null;
  let preparedFrameCount = 0;
  let uniquePreparedTransformCount = 0;
  let shapeTransformSelections = 0;
  let preparedBlockEncodedBytes = 0;
  let preparedBlockDecodedBytes = 0;
  let maximumRawParticleCenterZ = -Infinity;
  let maximumObservedParticleCenterZ = -Infinity;
  let guardedParticleFrameCount = 0;
  let rawUnsafeParticleFrameCount = 0;
  let unsafeParticleFrameCount = 0;
  const unsafeBlockIndices = new Set();
  for (const desktopSource of buildCycloneSourceChunks({ bank: CSSCYCLONE_SOURCE_BANK })) {
    const selectedSource = selectCycloneSourceParticlePrefix(desktopSource, bank);
    const guarded = applyCycloneCameraDepthGuard(selectedSource);
    const source = guarded.source;
    maximumRawParticleCenterZ = Math.max(
      maximumRawParticleCenterZ,
      guarded.metrics.maximumRawParticleCenterZ,
    );
    maximumObservedParticleCenterZ = Math.max(
      maximumObservedParticleCenterZ,
      guarded.metrics.maximumGuardedParticleCenterZ,
    );
    guardedParticleFrameCount += guarded.metrics.guardedParticleFrameCount;
    rawUnsafeParticleFrameCount += guarded.metrics.rawUnsafeParticleFrameCount;
    unsafeParticleFrameCount += guarded.metrics.unsafeParticleFrameCount;
    for (const frameIndex of guarded.metrics.unsafeFrameIndices) {
      unsafeBlockIndices.add(Math.floor(
        (source.bank.startFrameIndex + frameIndex) / blockFrameCount,
      ));
    }
    if (preparedModel === null) {
      const result = buildCyclonePreparedModel({ source, modelId: profile.modelId });
      preparedModel = Object.freeze({ model: result.model, metrics: result.metrics });
    }
    const lighting = lightingStream.add(source);
    for (const selection of startupSelections.filter((entry) =>
      entry.chunkIndex === source.bank.chunkIndex)) {
      startupSelectionColorProfiles.set(selection.id, analyzeStartupSelectionColors(source, selection));
    }
    for (let blockIndex = 0; blockIndex < blocksPerChunk; blockIndex += 1) {
      const streamBlockIndex = source.bank.chunkIndex * blocksPerChunk + blockIndex;
      const localStartFrameIndex = blockIndex * blockFrameCount;
      const startFrameIndex = source.bank.startFrameIndex + localStartFrameIndex;
      const decoded = Buffer.from(encodeCyclonePreparedBlock({
        frames: source.frames.slice(localStartFrameIndex, localStartFrameIndex + blockFrameCount),
        lightingRows: lighting.frameParticleColorStateIndices.slice(
          localStartFrameIndex,
          localStartFrameIndex + blockFrameCount,
        ),
        particleCount: source.bank.particleCount,
      }));
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
        encoding: CSSCYCLONE_BLOCK_ENCODING,
        byteLength: encoded.byteLength,
        sha256: encodedSha256,
        decodedByteLength: decoded.byteLength,
        decodedSha256,
      }));
      preparedBlockEncodedBytes += encoded.byteLength;
      preparedBlockDecodedBytes += decoded.byteLength;
    }
    preparedFrameCount += source.frames.length;
    uniquePreparedTransformCount += source.frames.length * source.bank.particleCount;
    shapeTransformSelections += source.frames.length * source.bank.particleCount;
  }
  const residentBlockWindowCount = runtimeLookaheadBlockCount + 1;
  const sourceSeedSafety = Object.freeze({
    schema: "csscyclone-source-seed-safety@1",
    seed: bank.seed,
    measuredParticleCount: bank.particleCount,
    cameraDepthGuardStart: CSSCYCLONE_SOURCE_SAFETY.cameraDepthGuardStart,
    minimumParticleCenterDepth: CSSCYCLONE_SOURCE_SAFETY.minimumParticleCenterDepth,
    maximumRawParticleCenterZ: roundMetric(maximumRawParticleCenterZ),
    maximumObservedParticleCenterZ: roundMetric(maximumObservedParticleCenterZ),
    guardedParticleFrameCount,
    rawUnsafeParticleFrameCount,
    unsafeParticleFrameCount,
    unsafeBlockIndices: Object.freeze([...unsafeBlockIndices]),
    safe: unsafeParticleFrameCount === 0,
  });
  if (!sourceSeedSafety.safe) {
    throw new Error(`Cyclone ${profile.id} source seed violates the prepared camera-depth contract: ${JSON.stringify(sourceSeedSafety)}`);
  }
  const maximumResidentBlockWindowDecodedBytes = Math.max(...blockEntries.map((unused, startIndex) =>
    Array.from({ length: residentBlockWindowCount }, (ignored, offset) =>
      blockEntries[(startIndex + offset) % blockEntries.length].decodedByteLength)
      .reduce((total, byteLength) => total + byteLength, 0)));
  const startupColorProfile = buildStartupColorProfile(
    startupSelections.map((selection) => startupSelectionColorProfiles.get(selection.id)),
    bank,
    startupSelections,
  );
  const preparedLighting = await lightingStream.finalize();
  const preparedLightingAssets = await writePreparedLightingVariantAssets(
    preparedLighting.contract,
    profile,
  );
  const catalogBytes = Buffer.from(`${JSON.stringify({
    schema: "csscyclone-prepared-stream-catalog@3",
    streamId: bank.id,
    modelId: profile.modelId,
    particleCount: bank.particleCount,
    facesPerParticle: CSSCYCLONE_FACE_INDICES.length,
    leafCount: bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
    playbackSchema: CSSCYCLONE_PLAYBACK_SCHEMA,
    lightingBlockSchema: CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
    sourceTransformProfile: Object.freeze({
      controlPointCount: 6,
      speed: CSSCYCLONE_SOURCE.speed,
      complexity: CSSCYCLONE_SOURCE.complexity,
      particleSize: CSSCYCLONE_SOURCE.particleSize,
      radialOrbitScale: CSSCYCLONE_PRESENTATION.radialOrbitScale,
    }),
    seed: bank.seed,
    chunkCount: bank.chunkCount,
    chunkFrameCount: bank.frameCount,
    blockCount,
    blocksPerChunk,
    blockFrameCount,
    framesPerSecond: bank.framesPerSecond,
    frameMilliseconds: bank.frameMilliseconds,
    streamFrameCount: bank.chunkCount * bank.frameCount,
    streamDurationMilliseconds: bank.chunkCount * bank.frameCount / bank.framesPerSecond * 1_000,
    startupPaletteFamilies,
    startupPaletteVariantIds,
    startupPaletteVariantWeights,
    startupSelections,
    startupSilhouetteSampling: CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
    startupSilhouetteSampleFrameOffsets,
    maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
    startupColorProfile,
    selection: "session-weighted-shuffled-hue-rotation-plus-crypto-source-window-no-immediate-repeat",
    playbackOrder: "source-continuous-ascending-chunks-with-one-terminal-stream-wrap",
    runtimeLookaheadBlockCount,
    runtimeMaterializedLookaheadBlockCount,
    startupMaterializedLookaheadBlockCount,
    entries: blockEntries,
  })}\n`);
  const catalogSha256 = sha256(catalogBytes);
  await writeBytes(
    join(stagingRoot, profile.catalogUrl.replace(/^\/csscyclone\//u, "")),
    catalogBytes,
  );
  if (preparedModel === null) throw new Error(`Cyclone ${profile.id} stream produced no prepared model`);
  const built = await buildPolyMorphPackage(
    preparedModel.model,
    CSSCYCLONE_FALLBACK_ATLAS_PAGES.map((page) => ({
      path: page.path,
      role: "image",
      mediaType: "image/png",
      bytes: page.bytes,
    })),
  );
  const packageRoot = join(stagingRoot, "model", profile.modelId);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
  const metadata = Object.freeze({
    id: profile.id,
    particleSelection: profile.particleSelection,
    presentation: Object.freeze({
      radialOrbitScale: CSSCYCLONE_PRESENTATION.radialOrbitScale,
      sourceDefaults: Object.freeze({
        cyclones: 1,
        particles: CSSCYCLONE_SOURCE_BANK.particleCount,
        size: CSSCYCLONE_SOURCE.particleSize,
        complexity: CSSCYCLONE_SOURCE.complexity,
        speed: CSSCYCLONE_SOURCE.speed,
        stretch: CSSCYCLONE_SOURCE.stretch,
        saturationSampling: CSSCYCLONE_PRESENTATION.saturationSampling,
        minimumSaturation: CSSCYCLONE_PRESENTATION.minimumSaturation,
        hueSampling: CSSCYCLONE_PRESENTATION.hueSampling,
        particleColorAssignment: CSSCYCLONE_PRESENTATION.particleColorAssignment,
        preparedPaletteAssignment: CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
        preparedPaletteVariantCount: startupPaletteVariantIds.length,
        maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
      }),
      preparedStream: Object.freeze({
        id: bank.id,
        seed: bank.seed,
        sourceSeedSafety,
        chunkCount: bank.chunkCount,
        chunkFrameCount: bank.frameCount,
        framesPerSecond: bank.framesPerSecond,
        frameMilliseconds: bank.frameMilliseconds,
        streamFrameCount: bank.chunkCount * bank.frameCount,
        streamDurationMilliseconds: bank.chunkCount * bank.frameCount / bank.framesPerSecond * 1_000,
        startupPaletteFamilies,
        startupPaletteVariantIds,
        startupPaletteVariantWeights,
        startupSelections,
        startupSilhouetteSampling: CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
        startupSilhouetteSampleFrameOffsets,
        maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
        startupColorProfile,
        startupSelection: "session-weighted-shuffled-hue-rotation-plus-crypto-source-window-no-immediate-repeat",
        handoff: "source-continuous-twelve-block-decoded-window",
      }),
      productParticleCount: bank.particleCount,
      productLeafCount: bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
      viewDistance: CSSCYCLONE_SOURCE.viewDistance,
      fieldOfViewDegrees: CSSCYCLONE_SOURCE.fieldOfViewDegrees,
      startupWarmupMilliseconds: bank.warmupFrames / bank.framesPerSecond * 1_000,
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
      residentBlockWindowCount,
      maximumResidentBlockWindowDecodedBytes,
      runtimeLookaheadBlockCount,
      runtimeMaterializedLookaheadBlockCount,
      startupMaterializedLookaheadBlockCount,
      transportEncoding: CSSCYCLONE_BLOCK_ENCODING,
      runtimePreparedStateMaterialization: true,
      runtimePreparedStateMaterializationPhase: "block-load-before-publication",
      runtimeIncrementalLookaheadMaterialization: true,
      runtimeOffMainThreadLookaheadMaterialization: true,
      startupVerifiedBlockCount: residentBlockWindowCount,
      startupMaterializedBlockCount: startupMaterializedLookaheadBlockCount + 1,
      maximumRuntimeMaterializedBlockCount: runtimeMaterializedLookaheadBlockCount + 1,
    }),
    lighting: preparedLightingAssets.contract,
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
      residentBlockWindowCount,
      maximumResidentBlockWindowDecodedBytes,
      ...preparedLighting.metrics,
      preparedLightingVariantAssetBytes: preparedLightingAssets.byteLength,
    }),
  });
}

function applyCycloneCameraDepthGuard(source) {
  const guardStartZ = CSSCYCLONE_SOURCE.viewDistance -
    CSSCYCLONE_SOURCE_SAFETY.cameraDepthGuardStart;
  const maximumParticleCenterZ = CSSCYCLONE_SOURCE.viewDistance -
    CSSCYCLONE_SOURCE_SAFETY.minimumParticleCenterDepth;
  const compressionRange = CSSCYCLONE_SOURCE_SAFETY.cameraDepthGuardStart -
    CSSCYCLONE_SOURCE_SAFETY.minimumParticleCenterDepth;
  let maximumRawParticleCenterZ = -Infinity;
  let maximumGuardedParticleCenterZ = -Infinity;
  let guardedParticleFrameCount = 0;
  let rawUnsafeParticleFrameCount = 0;
  let unsafeParticleFrameCount = 0;
  const unsafeFrameIndices = new Set();
  const frames = source.frames.map((frame, frameIndex) => {
    let guardedParticles = null;
    for (let particleIndex = 0; particleIndex < frame.particles.length; particleIndex += 1) {
      const particle = frame.particles[particleIndex];
      const rawCenterZ = particle.matrix[14];
      maximumRawParticleCenterZ = Math.max(maximumRawParticleCenterZ, rawCenterZ);
      if (rawCenterZ <= guardStartZ) {
        maximumGuardedParticleCenterZ = Math.max(maximumGuardedParticleCenterZ, rawCenterZ);
        continue;
      }
      guardedParticleFrameCount += 1;
      if (rawCenterZ > maximumParticleCenterZ) rawUnsafeParticleFrameCount += 1;
      const guardedCenterZ = guardStartZ + compressionRange *
        (1 - Math.exp(-(rawCenterZ - guardStartZ) / compressionRange));
      maximumGuardedParticleCenterZ = Math.max(maximumGuardedParticleCenterZ, guardedCenterZ);
      if (guardedCenterZ > maximumParticleCenterZ) {
        unsafeParticleFrameCount += 1;
        unsafeFrameIndices.add(frameIndex);
      }
      if (guardedParticles === null) guardedParticles = [...frame.particles];
      const matrix = [...particle.matrix];
      matrix[14] = roundMetric(guardedCenterZ);
      guardedParticles[particleIndex] = Object.freeze({
        ...particle,
        matrix: Object.freeze(matrix),
      });
    }
    return guardedParticles === null ? frame : Object.freeze({
      ...frame,
      particles: Object.freeze(guardedParticles),
    });
  });
  return Object.freeze({
    source: Object.freeze({ ...source, frames: Object.freeze(frames) }),
    metrics: Object.freeze({
      maximumRawParticleCenterZ,
      maximumGuardedParticleCenterZ,
      guardedParticleFrameCount,
      rawUnsafeParticleFrameCount,
      unsafeParticleFrameCount,
      unsafeFrameIndices: Object.freeze([...unsafeFrameIndices]),
    }),
  });
}

async function writePreparedLightingVariantAssets(lighting, profile) {
  const assetRoot = profile.blockRoot.replace(/\/blocks$/u, "/lighting");
  const variants = [];
  let byteLength = 0;
  for (const variant of lighting.variants) {
    const bytes = Buffer.from(`${JSON.stringify({
      schema: "csscyclone-prepared-lighting-color-variant@1",
      streamId: lighting.streamId,
      paletteVariantId: variant.paletteVariantId,
      hueRotation: variant.hueRotation,
      preparedHues: variant.preparedHues,
      uniqueColorCount: lighting.uniqueColorCount,
      colors: variant.colors,
    })}\n`);
    const digest = sha256(bytes);
    const assetUrl = `${assetRoot}/${variant.paletteVariantId}-${digest}.json`;
    await writeBytes(join(stagingRoot, assetUrl.replace(/^\/csscyclone\//u, "")), bytes);
    variants.push(Object.freeze({
      paletteVariantId: variant.paletteVariantId,
      hueRotation: variant.hueRotation,
      preparedHues: variant.preparedHues,
      assetUrl,
      byteLength: bytes.byteLength,
      sha256: digest,
    }));
    byteLength += bytes.byteLength;
  }
  return Object.freeze({
    contract: Object.freeze({ ...lighting, variants: Object.freeze(variants) }),
    byteLength,
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
  const invalidSelectionProfiles = startupSelections.flatMap((selection, index) => {
    const profile = selectionProfiles[index];
    const failures = [];
    if (profile?.id !== selection.id) failures.push("id");
    if (profile?.paletteFamily !== selection.paletteFamily) failures.push("paletteFamily");
    if (profile?.chunkIndex !== selection.chunkIndex) failures.push("chunkIndex");
    if (profile?.startFrameIndex !== selection.startFrameIndex) failures.push("startFrameIndex");
    if (profile?.frameCount !== selection.frameCount) failures.push("frameCount");
    if (!(profile?.meanSaturation >= CSSCYCLONE_PRESENTATION.startupMinimumMeanSaturation)) {
      failures.push("meanSaturation");
    }
    if (profile?.dominantHueSector !== selection.paletteFamily) failures.push("dominantHueSector");
    if (!(profile?.dominantHueShare >= CSSCYCLONE_PRESENTATION.startupMinimumDominantHueShare)) {
      failures.push("dominantHueShare");
    }
    return failures.length === 0 ? [] : [{ selection, profile, failures }];
  });
  if (selectionProfiles.length !== startupSelections.length || invalidSelectionProfiles.length > 0) {
    throw new Error(`Cyclone prepared startup source-palette profile drifted: ${JSON.stringify({
      selectionProfileCount: selectionProfiles.length,
      startupSelectionCount: startupSelections.length,
      invalidSelectionProfiles,
    })}`);
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
