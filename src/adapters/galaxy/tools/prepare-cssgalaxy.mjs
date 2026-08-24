#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import {
  CSSGALAXY_CADENCE,
  CSSGALAXY_MOBILE_STAR_COUNT,
  CSSGALAXY_PREPARED_GALAXY_COUNTS,
  CSSGALAXY_SOURCE,
  CSSGALAXY_VARIANT_COUNTS,
  CSSGALAXY_VIEWPORT,
  distributeGalaxyPrefixCounts,
} from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { ensureGalaxySourceFile } from "../src/prepare/cssgalaxy/sourceAuthority.mjs";
import {
  CSSGALAXY_COLOR_FAMILY,
  CSSGALAXY_THREE_GALAXY_ROLES,
  createThreeGalaxyPresentation,
  createThreeGalaxyRolePalette,
} from "../src/prepare/cssgalaxy/colorFamilies.mjs";
import {
  CSSGALAXY_ENCOUNTER_REEL,
  createEncounterSchedule,
} from "../src/prepare/cssgalaxy/encounterReel.mjs";
import { createGalaxyColorStylesheet } from "../src/cssgalaxy/colorFamilyContract.mjs";
import {
  CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT,
  CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT,
  CSSGALAXY_MOBILE_COMPARISON_SEED,
  CSSGALAXY_THREE_GALAXY_PALETTE_SEED,
  qualifyGalaxyParticleCounts,
} from "../src/prepare/cssgalaxy/qualification.mjs";
import {
  CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION,
  CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION,
  qualifyGalaxySeeds,
} from "../src/prepare/cssgalaxy/seedQualification.mjs";
import {
  CSSGALAXY_BANK_ENCODING,
  CSSGALAXY_COORDINATE_SCALE,
  CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
  createGalaxyPreparedBlockCoordinateDecoder,
  encodeGalaxyPreparedBank,
  readGalaxyPreparedBankSections,
  writeGalaxyPreparedTranslationCoordinates,
} from "../src/shared/cssgalaxy/preparedBlockTransport.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = resolve(repositoryRoot, "build/generated/cssgalaxy-product-public/cssgalaxy");
const stagingRoot = resolve(repositoryRoot, `build/generated/.cssgalaxy-product-${process.pid}`);
const sourceRoot = resolve(process.env.CSSGALAXY_SOURCE_ROOT ??
  resolve(repositoryRoot, ".local/upstreams/xscreensaver-galaxy"));
const sourcePath = resolve(sourceRoot, CSSGALAXY_SOURCE.path);
const nativeRoot = resolve(repositoryRoot, "build/native/cssgalaxy");
const sourceLock = JSON.parse(await readFile(resolve(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const blockFrameCount = CSSGALAXY_CADENCE.framesPerSecond * CSSGALAXY_CADENCE.blockSeconds;
const blocksPerBank = CSSGALAXY_CADENCE.bankSeconds / CSSGALAXY_CADENCE.blockSeconds;
const bankFrameCount = blockFrameCount * blocksPerBank;
const blockCount = CSSGALAXY_CADENCE.streamSeconds / CSSGALAXY_CADENCE.blockSeconds;
if (!Number.isSafeInteger(blockCount) ||
    !Number.isSafeInteger(blocksPerBank) ||
    Math.ceil(blockCount / blocksPerBank) !== CSSGALAXY_CADENCE.bankCount) {
  throw new Error("Galaxy stream must use whole prepared blocks and bounded 24-second banks");
}
const productProfiles = Object.freeze([
  Object.freeze({ id: "desktop", galaxyCount: 3, starCount: 1500,
    seed: CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT[3],
    seedQualification: CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION }),
  Object.freeze({ id: "mobile", galaxyCount: 2, starCount: CSSGALAXY_MOBILE_STAR_COUNT,
    seed: CSSGALAXY_MOBILE_COMPARISON_SEED,
    seedQualification: CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION }),
]);
const projectionStarsPerGalaxy = Math.ceil(
  Math.max(...CSSGALAXY_VARIANT_COUNTS) / Math.min(...CSSGALAXY_PREPARED_GALAXY_COUNTS));
const seedQualifications = new Map(productProfiles.map((profile) => [
  profile.galaxyCount,
  qualifyGalaxySeeds(profile.seedQualification),
]));
const qualifications = new Map(productProfiles.map((profile) => [
  profile.galaxyCount,
  qualifyGalaxyParticleCounts({ galaxyCount: profile.galaxyCount }),
]));
const nativeProjectionCache = new Map();
let threeGalaxyRolePalette;

for (const { galaxyCount } of productProfiles) {
  if (JSON.stringify(seedQualifications.get(galaxyCount).selectedSeeds) !==
      JSON.stringify(CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT[galaxyCount])) {
    throw new Error(`Galaxy ${galaxyCount}-body curated seeds drifted from qualification`);
  }
}

await ensureGalaxySourceFile({ sourceRoot, source: CSSGALAXY_SOURCE });
await assertSourceIdentity();
await mkdir(nativeRoot, { recursive: true });
const nativeExecutables = new Map();
for (const galaxyCount of new Set(productProfiles.map((profile) => profile.galaxyCount))) {
  const nativeExecutable = resolve(nativeRoot, `prepare-native-galaxy-oracle-g${galaxyCount}`);
  await run("clang", [
    "-std=c11", "-O2", "-Wall", "-Wextra", "-Wno-misleading-indentation",
    `-DGALAXIES=${galaxyCount}`,
    resolve(adapterRoot, "tools/native-galaxy-oracle.c"), "-lm", "-o", nativeExecutable,
  ]);
  nativeExecutables.set(galaxyCount, nativeExecutable);
}
threeGalaxyRolePalette = await prepareThreeGalaxyRolePalette();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const catalogs = new Map(productProfiles.map((profile) => {
    const { galaxyCount, starCount: count } = profile;
    const prefixStarCounts = distributeGalaxyPrefixCounts(count, galaxyCount);
    const relativeRoot = join(`g${galaxyCount}`, String(count));
    const comparisonSeed = profile.seed;
    const curatedEncounterSeeds = CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT[galaxyCount];
    const cohortRoles = CSSGALAXY_THREE_GALAXY_ROLES.slice(0, galaxyCount);
    return [catalogKey(galaxyCount, count), {
  schema: "cssgalaxy-prepared-stream-catalog@4",
  source: sourceLock,
  starCount: count,
  galaxyCount,
  prefixStarCounts,
  relativeRoot,
  viewport: CSSGALAXY_VIEWPORT,
  sourceFramesPerSecond: CSSGALAXY_CADENCE.sourceFramesPerSecond,
  framesPerSecond: CSSGALAXY_CADENCE.framesPerSecond,
  frameMilliseconds: CSSGALAXY_CADENCE.frameMilliseconds,
  blockFrameCount,
  blocksPerBank,
  bankFrameCount,
  bankSeconds: CSSGALAXY_CADENCE.bankSeconds,
  bankCount: CSSGALAXY_CADENCE.bankCount,
  blockCount,
  transport: Object.freeze({
    schema: "cssgalaxy-prepared-bank-transport@6",
    encoding: CSSGALAXY_BANK_ENCODING,
    contentEncoding: "br",
    bankSeconds: CSSGALAXY_CADENCE.bankSeconds,
    coordinateScale: CSSGALAXY_COORDINATE_SCALE,
    maximumCoordinateQuantizationErrorPixels:
      CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
    predictor:
      "independent-four-second-leaf-major-axis-split-second-difference-zigzag-varint",
  }),
  streamFrameCount: blockFrameCount * blockCount,
  streamDurationMilliseconds: CSSGALAXY_CADENCE.streamSeconds * 1000,
  curatedSeeds: Object.freeze([comparisonSeed]),
  curatedEncounterSeeds,
  comparisonSeed,
  selection: "session-shuffled-qualified-encounter-start-without-replacement",
  colorFamilyVariantCount: CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.length,
  colorPropertyCount: galaxyCount * CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.length,
  presentationColors: CSSGALAXY_COLOR_FAMILY,
  encounterReel: CSSGALAXY_ENCOUNTER_REEL,
  threeGalaxyRolePalette: galaxyCount === 3 ? threeGalaxyRolePalette : null,
  particleCohortRoles: cohortRoles,
  particleCohortColors: Object.freeze(
    cohortRoles.flatMap((role) => threeGalaxyRolePalette.roleFamilies[role])),
  camera: Object.freeze({ mode: "fixed-retained-camera-source-projection-in-point-transforms" }),
  runtimeLookaheadBankCount: 1,
  runtimeMaterializedLookaheadBlockCount: 1,
  startupMaterializedLookaheadBlockCount: 0,
  seeds: {},
  }];
  }));

for (const catalog of catalogs.values()) {
  const snapshot = Buffer.from(createPreparedSnapshot(catalog.starCount, catalog.prefixStarCounts,
    catalog.colorFamilyVariantCount, catalog.particleCohortColors));
  const snapshotSha256 = digest(snapshot);
  const relative = join(catalog.relativeRoot, "snapshot.html");
  await writeBytes(resolve(stagingRoot, relative), snapshot);
  catalog.snapshot = Object.freeze({
    schema: "cssgalaxy-prepared-polycss-snapshot@1",
    url: `/cssgalaxy/${relative.split("\\").join("/")}?sha256=${snapshotSha256}`,
    sha256: snapshotSha256,
    encoding: "identity",
    byteLength: snapshot.byteLength,
    retainedPointLeafCount: catalog.starCount,
    retainedPerPointWrapperCount: 0,
  });
}

for (const profile of productProfiles) {
  await prepareSeed(profile.galaxyCount, profile.starCount, profile.seed);
}
for (const projection of nativeProjectionCache.values()) await rm(projection.path, { force: true });
nativeProjectionCache.clear();
const catalogDescriptors = {};
for (const catalog of catalogs.values()) {
  const bytes = Buffer.from(`${JSON.stringify(catalog)}\n`);
  const sha256 = digest(bytes);
  const relative = join(catalog.relativeRoot, "catalog.json");
  await writeBytes(resolve(stagingRoot, relative), bytes);
  catalogDescriptors[catalogKey(catalog.galaxyCount, catalog.starCount)] = Object.freeze({
    schema: "cssgalaxy-prepared-catalog-descriptor@1",
    url: `/cssgalaxy/${relative.split("\\").join("/")}?sha256=${sha256}`,
    sha256,
    byteLength: bytes.byteLength,
  });
}
const profiles = Object.freeze(Object.fromEntries(productProfiles.map((profile) => [
  profile.id,
  Object.freeze({
    id: profile.id,
    galaxyCount: profile.galaxyCount,
    starCount: profile.starCount,
    comparisonSeed: profile.seed,
    catalog: catalogDescriptors[catalogKey(profile.galaxyCount, profile.starCount)],
  }),
])));
await writeJson(resolve(stagingRoot, "prepared.json"), {
  schema: "cssgalaxy-prepared-scene@5",
  status: "ready",
  source: sourceLock,
  renderer: {
    representation: "one-retained-canonical-polycss-quad-point-leaf-per-published-star",
    artifactMode: "prepared-flat-polycss-snapshot-plus-twenty-four-second-banks",
    directPointLeaves: true,
    perPointWrapperCount: 0,
    perPointIdentityAttributeCount: 0,
    preparedStateGenerator: "native-c11-headless-source-equation-oracle-with-prepared-60hz-screen-interpolation",
    completeSourceStateBeforePrefix: true,
    runtimePhysics: false,
    runtimeRasterization: false,
    runtimeMatrixFormatting: false,
    animationPathTransformFormatting: false,
    workerPreparedTransformMaterialization: true,
    workerPreparedPackedCoordinateMaterialization: false,
    workerPreparedPositionMaterialization: false,
    runtimeFrameAllocation: false,
    runtimeDomReconstruction: false,
    runtimeCameraWrites: false,
    preparedOffscreenCulling: true,
    preparedSceneOpacityReset: false,
    preparedIdentityPreservingReformation: true,
    stableParticleRoleCohorts: true,
    workerBankDecode: false,
    httpExpandedBrotliBankTransport: true,
    transportBankSeconds: CSSGALAXY_CADENCE.bankSeconds,
    workerPreparedResponseMode: "bounded-four-second-direct-transform-blocks",
  },
  viewport: CSSGALAXY_VIEWPORT,
  cadence: CSSGALAXY_CADENCE,
  encounterReel: CSSGALAXY_ENCOUNTER_REEL,
  defaultProfile: "desktop",
  profileSelection: Object.freeze({
    mobileBreakpointWidth: 600,
    mobileCapabilityQuery: "(hover: none) and (pointer: coarse)",
    mode: "viewport-capability-or-mobile-user-agent-before-profile-fetch-and-mount",
  }),
  profiles,
  presentationColors: CSSGALAXY_COLOR_FAMILY,
  threeGalaxyRolePalette,
});
await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);

console.log(JSON.stringify({
  outputRoot,
  profiles: Object.fromEntries(productProfiles.map((profile) => [profile.id, {
    galaxyCount: profile.galaxyCount,
    starCount: profile.starCount,
    comparisonSeed: profile.seed,
  }])),
  qualification: Object.fromEntries([...qualifications].map(
    ([galaxyCount, value]) => [galaxyCount, value.candidates])),
  variants: [...catalogs.values()].map((catalog) => ({
    galaxyCount: catalog.galaxyCount,
    count: catalog.starCount,
    encodedBytes: Object.values(catalog.seeds).flatMap((seed) => seed.banks)
      .reduce((sum, entry) => sum + entry.byteLength, 0),
    decodedBytes: Object.values(catalog.seeds).flatMap((seed) => seed.banks)
      .reduce((sum, entry) => sum + entry.decodedByteLength, 0),
  })),
}, null, 2));

async function prepareSeed(galaxyCount, starCount, seed) {
  const builders = new Map([[starCount, createBankBuilder(starCount)]]);
  const banksByCount = new Map([[starCount, []]]);
  const curatedSeeds = CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT[galaxyCount];
  const startIndex = curatedSeeds.indexOf(seed);
  const encounterOrder = Object.freeze(Array.from({ length: CSSGALAXY_ENCOUNTER_REEL.encounterCount },
    (_, offset) => curatedSeeds[(startIndex + offset) % curatedSeeds.length]));
  const encounterEvents = [];
  let streamFrameIndex = 0;

  for (let encounterIndex = 0;
    encounterIndex < CSSGALAXY_ENCOUNTER_REEL.encounterCount; encounterIndex += 1) {
    const bankIndex = Math.floor(
      encounterIndex * CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount /
      CSSGALAXY_ENCOUNTER_REEL.bankFrameCount);
    const currentSeed = encounterOrder[encounterIndex];
    const nextSeed = encounterOrder[(encounterIndex + 1) % encounterOrder.length];
    const [currentProjection, nextProjection] = await Promise.all([
      loadNativeProjection(galaxyCount, currentSeed),
      loadNativeProjection(galaxyCount, nextSeed),
    ]);
    const currentStart = currentProjection.frames[0];
    const nextStart = nextProjection.frames[0];
    const currentPresentation = createEncounterColorPresentation(galaxyCount, currentStart.galaxies);
    const nextPresentation = createEncounterColorPresentation(galaxyCount, nextStart.galaxies);
    const currentCohorts = createEncounterParticleCohorts(galaxyCount, currentPresentation);
    const nextCohorts = createEncounterParticleCohorts(galaxyCount, nextPresentation);
    if (JSON.stringify(currentCohorts.roles) !== JSON.stringify(nextCohorts.roles) ||
        JSON.stringify(currentCohorts.colors) !== JSON.stringify(nextCohorts.colors)) {
      throw new Error("Galaxy prepared particle role identity drifted between encounters");
    }
    const schedule = createEncounterSchedule(currentSeed, nextSeed);
    encounterEvents.push(Object.freeze({
      encounterIndex,
      bankIndex,
      startFrameIndex: encounterIndex * CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount,
      sourceSeed: currentSeed,
      nextSourceSeed: nextSeed,
      sourceGeneration: 0,
      sourceGenerationFrameCount: currentProjection.frames.length,
      galaxyStarCounts: Object.freeze(currentStart.galaxies.map((galaxy) => galaxy.nstars)),
      galaxyMasses: Object.freeze(currentStart.galaxies.map((galaxy) => galaxy.mass)),
      galaxyNativeColors: Object.freeze(currentStart.galaxies.map((galaxy) => galaxy.color)),
      galaxyPresentationRoles: currentPresentation.roles,
      galaxyPresentationCenters: currentPresentation.presentationCenters,
      galaxyColorFamilies: currentPresentation.families,
      particleCohortRoles: currentCohorts.roles,
      particleCohortNativeGalaxyOrder: currentCohorts.nativeGalaxyOrder,
      schedule,
    }));

    const sourceStart = CSSGALAXY_ENCOUNTER_REEL.nativeMotionStartFrameIndex;
    const sourceFramesPerPresentationFrame =
      CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepNumerator /
      CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepDenominator;
    for (let frameIndex = 0;
      frameIndex < CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameCount; frameIndex += 1) {
      await appendPreparedSample(currentProjection,
        sourceStart + frameIndex * sourceFramesPerPresentationFrame,
        currentCohorts.nativeGalaxyOrder);
    }
    const reformation = createPreparedReformation({
      outgoingProjection: currentProjection,
      outgoingGalaxyOrder: currentCohorts.nativeGalaxyOrder,
      incomingProjection: nextProjection,
      incomingGalaxyOrder: nextCohorts.nativeGalaxyOrder,
      prefixStarCounts: distributeGalaxyPrefixCounts(starCount, galaxyCount),
    });
    for (let frameIndex = 0;
      frameIndex < CSSGALAXY_ENCOUNTER_REEL.reformationFrameCount; frameIndex += 1) {
      await appendPreparedReformationSample(reformation, frameIndex);
    }
  }
  if (streamFrameIndex !== blockCount * blockFrameCount) {
    throw new Error(`Galaxy prepared encounter reel frame count drifted for seed ${seed}`);
  }
  for (const count of [starCount]) {
    if (banksByCount.get(count).length !== CSSGALAXY_CADENCE.bankCount) {
      throw new Error(`Galaxy prepared bank cardinality drifted for seed ${seed}`);
    }
  }
  for (const count of [starCount]) {
    const catalog = catalogs.get(catalogKey(galaxyCount, count));
    catalog.seeds[String(seed)] = Object.freeze({
      seed,
      encounterOrder,
      encounterEvents: Object.freeze(encounterEvents),
      banks: Object.freeze(banksByCount.get(count)),
    });
  }

  async function appendPreparedSample(projection, sourceFramePosition, galaxyOrder) {
    for (const [count, builder] of builders) {
      addFrame(builder, renderNativePrefixSample(projection, sourceFramePosition,
        distributeGalaxyPrefixCounts(count, galaxyCount), galaxyOrder));
    }
    await finishPreparedFrame();
  }

  async function appendPreparedReformationSample(reformation, frameIndex) {
    for (const [count, builder] of builders) {
      if (count !== reformation.starCount) {
        throw new Error("Galaxy reformation particle count drifted");
      }
      addFrame(builder, renderPreparedReformation(reformation, frameIndex));
    }
    await finishPreparedFrame();
  }

  async function finishPreparedFrame() {
    streamFrameIndex += 1;
    if (streamFrameIndex % bankFrameCount !== 0) return;
    const streamBankIndex = streamFrameIndex / bankFrameCount - 1;
    for (const [count, builder] of builders) {
      const catalog = catalogs.get(catalogKey(galaxyCount, count));
      banksByCount.get(count).push(
        await writePreparedBank(catalog, seed, streamBankIndex, builder));
      builders.set(count, createBankBuilder(count));
    }
  }
}

async function prepareThreeGalaxyRolePalette() {
  const projection = await loadNativeProjection(3, CSSGALAXY_THREE_GALAXY_PALETTE_SEED);
  return createThreeGalaxyRolePalette(projection.frames[0].galaxies);
}

function createEncounterColorPresentation(galaxyCount, galaxies) {
  if (galaxyCount === 3) return createThreeGalaxyPresentation(galaxies, threeGalaxyRolePalette);
  const roles = CSSGALAXY_THREE_GALAXY_ROLES.slice(0, galaxyCount);
  return Object.freeze({
    schema: "cssgalaxy-prepared-two-role-assignment@1",
    roles,
    nativeSourceColors: Object.freeze(galaxies.map(({ color }) => color)),
    presentationCenters: Object.freeze(roles.map((role) => threeGalaxyRolePalette.roleCenters[role])),
    families: Object.freeze(roles.map((role) => threeGalaxyRolePalette.roleFamilies[role])),
  });
}

function createEncounterParticleCohorts(galaxyCount, presentation) {
  if (galaxyCount !== 3) {
    return Object.freeze({
      roles: presentation.roles,
      nativeGalaxyOrder: Object.freeze(Array.from({ length: galaxyCount }, (_, index) => index)),
      colors: Object.freeze(presentation.roles.flatMap(
        (role) => threeGalaxyRolePalette.roleFamilies[role])),
    });
  }
  const nativeGalaxyOrder = Object.freeze(CSSGALAXY_THREE_GALAXY_ROLES.map((role) => {
    const nativeGalaxyIndex = presentation.roles.indexOf(role);
    if (nativeGalaxyIndex < 0) throw new Error(`Galaxy presentation omitted the ${role} role`);
    return nativeGalaxyIndex;
  }));
  return Object.freeze({
    roles: CSSGALAXY_THREE_GALAXY_ROLES,
    nativeGalaxyOrder,
    colors: Object.freeze(CSSGALAXY_THREE_GALAXY_ROLES.flatMap(
      (role) => threeGalaxyRolePalette.roleFamilies[role])),
  });
}

async function loadNativeProjection(galaxyCount, seed) {
  const key = `${galaxyCount}:${seed}`;
  if (nativeProjectionCache.has(key)) return nativeProjectionCache.get(key);
  const nativeExecutable = nativeExecutables.get(galaxyCount);
  const path = resolve(nativeRoot, `g${galaxyCount}-seed-${seed}-generation-zero-projection.bin`);
  await run(nativeExecutable, [
    "projection", String(seed), String(CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount), path,
  ]);
  const projection = await readFile(path);
  const view = new DataView(projection.buffer, projection.byteOffset, projection.byteLength);
  if (projection.subarray(0, 8).toString("ascii") !== "CSSGALP1" ||
      view.getUint32(8, true) !== seed ||
      view.getUint32(12, true) !== CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount ||
      view.getUint32(16, true) !== projectionStarsPerGalaxy * galaxyCount ||
      view.getUint32(20, true) !== galaxyCount) {
    throw new Error(`Native Galaxy ${galaxyCount}-body projection header drifted for seed ${seed}`);
  }
  let projectionOffset = 24;
  const frames = [];
  for (let frameIndex = 0;
    frameIndex < CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount; frameIndex += 1) {
    const nativeFrameIndex = view.getInt32(projectionOffset, true);
    const generation = view.getInt32(projectionOffset + 4, true);
    const generationFrameIndex = view.getInt32(projectionOffset + 8, true);
    projectionOffset += 12;
    if (nativeFrameIndex !== frameIndex || generation !== 0 || generationFrameIndex !== frameIndex) {
      throw new Error(`Native Galaxy generation-zero projection drifted at ${frameIndex}`);
    }
    const galaxies = new Array(galaxyCount);
    for (let galaxyIndex = 0; galaxyIndex < galaxyCount; galaxyIndex += 1) {
      const mass = view.getInt32(projectionOffset, true);
      const nstars = view.getInt32(projectionOffset + 4, true);
      const galcol = view.getInt32(projectionOffset + 8, true);
      const color = `#${[12, 13, 14].map((byteOffset) =>
        view.getUint8(projectionOffset + byteOffset).toString(16).padStart(2, "0")).join("")}`;
      projectionOffset += 16;
      galaxies[galaxyIndex] = Object.freeze({
        mass, nstars, galcol, color, pointsOffset: projectionOffset,
      });
      projectionOffset += projectionStarsPerGalaxy * 8;
    }
    frames.push(Object.freeze({ frameIndex, view, galaxies: Object.freeze(galaxies) }));
  }
  if (projectionOffset !== projection.byteLength) {
    throw new Error(`Native Galaxy projection byte tail drifted for seed ${seed}`);
  }
  const result = Object.freeze({ seed, galaxyCount, path, frames: Object.freeze(frames) });
  nativeProjectionCache.set(key, result);
  return result;
}

function renderNativePrefix(view, galaxies, prefixStarCounts,
  galaxyOrder = galaxies.map((_, index) => index)) {
  const laterOldPoints = new Array(galaxies.length);
  const suffixOldPoints = new Set();
  for (let galaxyIndex = galaxies.length - 1; galaxyIndex >= 0; galaxyIndex -= 1) {
    laterOldPoints[galaxyIndex] = new Set(suffixOldPoints);
    for (let starIndex = 0; starIndex < prefixStarCounts[galaxyIndex]; starIndex += 1) {
      const offset = galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      suffixOldPoints.add(pointKey(
        view.getInt16(offset + 4, true), view.getInt16(offset + 6, true)));
    }
  }
  const transforms = new Array(prefixStarCounts.reduce((sum, count) => sum + count, 0));
  let transformIndex = 0;
  for (const galaxyIndex of galaxyOrder) {
    for (let starIndex = 0; starIndex < prefixStarCounts[galaxyIndex]; starIndex += 1) {
      const offset = galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      const x = view.getInt16(offset, true);
      const y = view.getInt16(offset + 2, true);
      transforms[transformIndex++] = laterOldPoints[galaxyIndex].has(pointKey(x, y)) ||
        isOutsidePreparedViewport(x, y)
        ? "-32768px -32768px"
        : `${x}px ${y}px`;
    }
  }
  return transforms;
}

function renderNativePrefixSample(projection, sourceFramePosition, prefixStarCounts,
  galaxyOrder = projection.frames[0].galaxies.map((_, index) => index)) {
  const leftIndex = Math.floor(sourceFramePosition + 1e-9);
  const fraction = sourceFramePosition - leftIndex;
  const left = projection.frames[leftIndex];
  const right = projection.frames[Math.min(leftIndex + 1, projection.frames.length - 1)];
  if (!left || !right || fraction < -1e-9 || fraction >= 1 + 1e-9) {
    throw new RangeError(`Galaxy prepared source sample drifted at ${sourceFramePosition}`);
  }
  if (Math.abs(fraction) < 1e-9) {
    return renderNativePrefix(left.view, left.galaxies, prefixStarCounts, galaxyOrder);
  }
  const visibilityFrame = fraction < 0.5 ? left : right;
  const laterOldPoints = new Array(visibilityFrame.galaxies.length);
  const suffixOldPoints = new Set();
  for (let galaxyIndex = visibilityFrame.galaxies.length - 1; galaxyIndex >= 0; galaxyIndex -= 1) {
    laterOldPoints[galaxyIndex] = new Set(suffixOldPoints);
    for (let starIndex = 0; starIndex < prefixStarCounts[galaxyIndex]; starIndex += 1) {
      const offset = visibilityFrame.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      suffixOldPoints.add(pointKey(
        visibilityFrame.view.getInt16(offset + 4, true),
        visibilityFrame.view.getInt16(offset + 6, true)));
    }
  }
  const transforms = new Array(prefixStarCounts.reduce((sum, count) => sum + count, 0));
  let transformIndex = 0;
  for (const galaxyIndex of galaxyOrder) {
    for (let starIndex = 0; starIndex < prefixStarCounts[galaxyIndex]; starIndex += 1) {
      const visibilityOffset = visibilityFrame.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      const leftOffset = left.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      const rightOffset = right.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      const sourceHidden = laterOldPoints[galaxyIndex].has(pointKey(
        visibilityFrame.view.getInt16(visibilityOffset, true),
        visibilityFrame.view.getInt16(visibilityOffset + 2, true)));
      const x = interpolateCoordinateValue(left.view.getInt16(leftOffset, true),
        right.view.getInt16(rightOffset, true), fraction);
      const y = interpolateCoordinateValue(left.view.getInt16(leftOffset + 2, true),
        right.view.getInt16(rightOffset + 2, true), fraction);
      if (sourceHidden || isOutsidePreparedViewport(x, y)) {
        transforms[transformIndex++] = "-32768px -32768px";
        continue;
      }
      transforms[transformIndex++] =
        `${formatPreparedCoordinate(x)}px ${formatPreparedCoordinate(y)}px`;
    }
  }
  return transforms;
}

function createPreparedReformation({
  outgoingProjection,
  outgoingGalaxyOrder,
  incomingProjection,
  incomingGalaxyOrder,
  prefixStarCounts,
}) {
  const sourceFrameStep = CSSGALAXY_ENCOUNTER_REEL.sourceFramesPerSecond /
    CSSGALAXY_ENCOUNTER_REEL.presentationFramesPerSecond;
  const outgoingFrameIndex = CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount - 1;
  const incomingFrameIndex = CSSGALAXY_ENCOUNTER_REEL.reformationTargetNativeFrameIndex;
  const outgoing = readNativePrefixCoordinatesSample(
    outgoingProjection, outgoingFrameIndex, prefixStarCounts, outgoingGalaxyOrder);
  const outgoingPrevious = readNativePrefixCoordinatesSample(
    outgoingProjection, outgoingFrameIndex - 1, prefixStarCounts, outgoingGalaxyOrder);
  const incoming = readNativePrefixCoordinatesSample(
    incomingProjection, incomingFrameIndex, prefixStarCounts, incomingGalaxyOrder);
  const incomingNext = readNativePrefixCoordinatesSample(
    incomingProjection, incomingFrameIndex + sourceFrameStep, prefixStarCounts, incomingGalaxyOrder);
  const starCount = prefixStarCounts.reduce((sum, count) => sum + count, 0);
  const firstControls = new Float64Array(starCount * 2);
  const secondControls = new Float64Array(starCount * 2);
  for (let coordinateIndex = 0; coordinateIndex < starCount * 2; coordinateIndex += 2) {
    const outgoingVelocityX =
      (outgoing[coordinateIndex] - outgoingPrevious[coordinateIndex]) * sourceFrameStep;
    const outgoingVelocityY =
      (outgoing[coordinateIndex + 1] - outgoingPrevious[coordinateIndex + 1]) * sourceFrameStep;
    const incomingVelocityX = incomingNext[coordinateIndex] - incoming[coordinateIndex];
    const incomingVelocityY = incomingNext[coordinateIndex + 1] - incoming[coordinateIndex + 1];
    const outgoingControl = cappedVector(
      outgoingVelocityX * CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale,
      outgoingVelocityY * CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale,
      CSSGALAXY_ENCOUNTER_REEL.reformationMaximumControlDisplacement);
    const incomingControl = cappedVector(
      incomingVelocityX * CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale,
      incomingVelocityY * CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale,
      CSSGALAXY_ENCOUNTER_REEL.reformationMaximumControlDisplacement);
    firstControls[coordinateIndex] = outgoing[coordinateIndex] + outgoingControl[0];
    firstControls[coordinateIndex + 1] = outgoing[coordinateIndex + 1] + outgoingControl[1];
    secondControls[coordinateIndex] = incoming[coordinateIndex] - incomingControl[0];
    secondControls[coordinateIndex + 1] = incoming[coordinateIndex + 1] - incomingControl[1];
  }
  return Object.freeze({
    starCount,
    outgoing,
    incoming,
    firstControls,
    secondControls,
  });
}

function readNativePrefixCoordinatesSample(projection, sourceFramePosition, prefixStarCounts,
  galaxyOrder) {
  const leftIndex = Math.floor(sourceFramePosition + 1e-9);
  const fraction = sourceFramePosition - leftIndex;
  const left = projection.frames[leftIndex];
  const right = projection.frames[Math.min(leftIndex + 1, projection.frames.length - 1)];
  if (!left || !right || fraction < -1e-9 || fraction >= 1 + 1e-9) {
    throw new RangeError(`Galaxy prepared raw source sample drifted at ${sourceFramePosition}`);
  }
  const coordinates = new Float64Array(
    prefixStarCounts.reduce((sum, count) => sum + count, 0) * 2);
  let coordinateIndex = 0;
  for (const galaxyIndex of galaxyOrder) {
    for (let starIndex = 0; starIndex < prefixStarCounts[galaxyIndex]; starIndex += 1) {
      const leftOffset = left.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      const rightOffset = right.galaxies[galaxyIndex].pointsOffset + starIndex * 8;
      coordinates[coordinateIndex++] = interpolateCoordinateValue(
        left.view.getInt16(leftOffset, true), right.view.getInt16(rightOffset, true), fraction);
      coordinates[coordinateIndex++] = interpolateCoordinateValue(
        left.view.getInt16(leftOffset + 2, true), right.view.getInt16(rightOffset + 2, true), fraction);
    }
  }
  return coordinates;
}

function renderPreparedReformation(reformation, frameIndex) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 ||
      frameIndex >= CSSGALAXY_ENCOUNTER_REEL.reformationFrameCount) {
    throw new RangeError("Galaxy prepared reformation frame is invalid");
  }
  const progress = frameIndex / CSSGALAXY_ENCOUNTER_REEL.reformationFrameCount;
  const inverse = 1 - progress;
  const outgoingWeight = inverse * inverse * inverse;
  const firstControlWeight = 3 * inverse * inverse * progress;
  const secondControlWeight = 3 * inverse * progress * progress;
  const incomingWeight = progress * progress * progress;
  const transforms = new Array(reformation.starCount);
  for (let leafIndex = 0; leafIndex < reformation.starCount; leafIndex += 1) {
    const coordinateIndex = leafIndex * 2;
    const x = reformation.outgoing[coordinateIndex] * outgoingWeight +
      reformation.firstControls[coordinateIndex] * firstControlWeight +
      reformation.secondControls[coordinateIndex] * secondControlWeight +
      reformation.incoming[coordinateIndex] * incomingWeight;
    const y = reformation.outgoing[coordinateIndex + 1] * outgoingWeight +
      reformation.firstControls[coordinateIndex + 1] * firstControlWeight +
      reformation.secondControls[coordinateIndex + 1] * secondControlWeight +
      reformation.incoming[coordinateIndex + 1] * incomingWeight;
    transforms[leafIndex] = isOutsidePreparedViewport(x, y)
      ? "-32768px -32768px"
      : `${formatPreparedCoordinate(x)}px ${formatPreparedCoordinate(y)}px`;
  }
  return transforms;
}

function cappedVector(x, y, maximumMagnitude) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maximumMagnitude || magnitude === 0) return [x, y];
  const scale = maximumMagnitude / magnitude;
  return [x * scale, y * scale];
}

function interpolateCoordinateValue(left, right, fraction) {
  return left + (right - left) * fraction;
}

function formatPreparedCoordinate(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function isOutsidePreparedViewport(x, y) {
  return x < 0 || x >= CSSGALAXY_VIEWPORT.width || y < 0 || y >= CSSGALAXY_VIEWPORT.height;
}

function createBankBuilder(count) {
  return {
    count,
    frameCount: 0,
    visibleSampleCount: 0,
    quantizationError: { maximumPixels: 0 },
    coordinates: new Int32Array(bankFrameCount * count * 2),
  };
}

function addFrame(builder, transforms) {
  if (transforms.length !== builder.count) throw new Error("Galaxy bank frame contract drifted");
  if (builder.frameCount >= bankFrameCount) throw new Error("Galaxy bank frame capacity drifted");
  let coordinateOffset = builder.frameCount * builder.count * 2;
  for (const transform of transforms) {
    if (writeGalaxyPreparedTranslationCoordinates(
      transform, builder.coordinates, coordinateOffset,
      builder.quantizationError)) builder.visibleSampleCount += 1;
    coordinateOffset += 2;
  }
  builder.frameCount += 1;
}

async function writePreparedBank(catalog, seed, bankIndex, builder) {
  if (builder.frameCount !== catalog.bankFrameCount) {
    throw new Error(`Galaxy prepared bank ${bankIndex} frame cardinality drifted`);
  }
  if (builder.quantizationError.maximumPixels >
      CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS + Number.EPSILON) {
    throw new Error(`Galaxy prepared bank ${bankIndex} exceeded its coordinate error bound`);
  }
  const decoded = Buffer.from(encodeGalaxyPreparedBank({
    seed,
    starCount: catalog.starCount,
    galaxyCount: catalog.galaxyCount,
    bankIndex,
    startFrameIndex: bankIndex * catalog.bankFrameCount,
    frameCount: catalog.bankFrameCount,
    blockFrameCount: catalog.blockFrameCount,
    coordinates: builder.coordinates,
  }));
  assertEncodedBankCoordinates(catalog, seed, bankIndex, builder, decoded);
  const encoded = brotliCompressSync(decoded, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const sha256 = digest(encoded);
  const decodedSha256 = digest(decoded);
  const relative = join(
    catalog.relativeRoot, `seed-${seed}`,
    `bank-${String(bankIndex).padStart(2, "0")}-${sha256}.bin.br`,
  );
  await writeBytes(resolve(stagingRoot, relative), encoded);
  return Object.freeze({
    index: bankIndex,
    startFrameIndex: bankIndex * catalog.bankFrameCount,
    frameCount: catalog.bankFrameCount,
    sourceContinuousFromPrevious: true,
    presentationContinuousFromPrevious: true,
    assetUrl: `/cssgalaxy/${relative.split("\\").join("/")}`,
    byteLength: encoded.byteLength,
    sha256,
    decodedByteLength: decoded.byteLength,
    decodedSha256,
    contentEncoding: "br",
    maximumCoordinateQuantizationErrorPixels:
      Number(builder.quantizationError.maximumPixels.toFixed(6)),
    blockCount: catalog.blocksPerBank,
    visibleSampleCount: builder.visibleSampleCount,
    sourceSampleCount: catalog.bankFrameCount * catalog.starCount,
    coordinateEncoding:
      "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1",
  });
}

function assertEncodedBankCoordinates(catalog, seed, bankIndex, builder, decoded) {
  const descriptor = Object.freeze({
    index: bankIndex,
    startFrameIndex: bankIndex * catalog.bankFrameCount,
    frameCount: catalog.bankFrameCount,
    decodedByteLength: decoded.byteLength,
    blockCount: catalog.blocksPerBank,
    visibleSampleCount: builder.visibleSampleCount,
    coordinateEncoding:
      "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1",
  });
  const bank = readGalaxyPreparedBankSections(
    decoded, descriptor, { ...catalog, selectedSeed: seed });
  for (let bankBlockIndex = 0; bankBlockIndex < catalog.blocksPerBank; bankBlockIndex += 1) {
    const decoder = createGalaxyPreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
    while (!decoder.step()) {}
    const sourceOffset = bankBlockIndex * catalog.blockFrameCount * catalog.starCount * 2;
    for (let coordinateIndex = 0; coordinateIndex < decoder.coordinates.length; coordinateIndex += 1) {
      if (decoder.coordinates[coordinateIndex] === builder.coordinates[sourceOffset + coordinateIndex]) continue;
      const sampleIndex = Math.floor(coordinateIndex / 2);
      const frameIndex = bankIndex * catalog.bankFrameCount + bankBlockIndex * catalog.blockFrameCount +
        Math.floor(sampleIndex / catalog.starCount);
      const leafIndex = sampleIndex % catalog.starCount;
      const axis = coordinateIndex % 2 === 0 ? "x" : "y";
      throw new Error(
        `Galaxy coordinate transport first diverged at frame ${frameIndex}, leaf ${leafIndex}, ${axis}`);
    }
  }
}

async function assertSourceIdentity() {
  if (sourceLock.repository !== CSSGALAXY_SOURCE.repository ||
      sourceLock.revision !== CSSGALAXY_SOURCE.revision || sourceLock.path !== CSSGALAXY_SOURCE.path ||
      sourceLock.sha256 !== CSSGALAXY_SOURCE.sha256 || sourceLock.license !== CSSGALAXY_SOURCE.license) {
    throw new Error("Galaxy tracked source lock drifted");
  }
  const bytes = await readFile(sourcePath);
  if (digest(bytes) !== CSSGALAXY_SOURCE.sha256) throw new Error("Pinned Galaxy source bytes drifted");
}

async function writeJson(path, value) {
  await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pointKey(x, y) {
  return ((x & 0xffff) * 0x10000) + (y & 0xffff);
}

function catalogKey(galaxyCount, starCount) {
  return `${galaxyCount}:${starCount}`;
}

function createPreparedSnapshot(count, prefixStarCounts, familyVariantCount, preparedColors) {
  const { stylesheet, leafCount } = createGalaxyColorStylesheet(
    prefixStarCounts, familyVariantCount, preparedColors);
  if (leafCount !== count) throw new Error("Galaxy snapshot prefix ranges drifted");
  return "<!doctype html><html><head>" +
    `<style>${stylesheet}</style>` +
    "</head><body>" +
    '<main class="polycss-camera" aria-label="XScreenSaver Galaxy prepared point field">' +
    `<div class="polycss-scene">${"<b></b>".repeat(count)}</div>` +
    "</main></body></html>\n";
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}
