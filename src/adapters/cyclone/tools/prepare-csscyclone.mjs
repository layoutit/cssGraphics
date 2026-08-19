#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph/prepare";
import {
  CSSCYCLONE_MODEL_ID,
  buildCyclonePreparedModel,
  buildCyclonePreparedPlayback,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import { createCyclonePreparedLightingStream } from "../src/prepare/csscyclone/preparedLighting.mjs";
import {
  CSSCYCLONE_BANK,
  CSSCYCLONE_PRESENTATION,
  CSSCYCLONE_SOURCE,
  buildCycloneSourceChunks,
} from "../src/prepare/csscyclone/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/csscyclone");
const stagingRoot = join(repositoryRoot, `build/generated/.csscyclone-${process.pid}`);
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const blockFrameCount = 50;
const blocksPerChunk = CSSCYCLONE_BANK.frameCount / blockFrameCount;
const blockCount = CSSCYCLONE_BANK.chunkCount * blocksPerChunk;

if (!Number.isSafeInteger(blocksPerChunk)) {
  throw new Error("Cyclone prepared chunk must divide into exact transport blocks");
}

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const lightingStream = createCyclonePreparedLightingStream();
const blockEntries = [];
let preparedModel = null;
let preparedFrameCount = 0;
let uniquePreparedTransformCount = 0;
let shapeTransformSelections = 0;
let preparedBlockEncodedBytes = 0;
let preparedBlockDecodedBytes = 0;
let maximumResidentBlockPairDecodedBytes = 0;
let previousBlockDecodedBytes = 0;
let firstBlockDecodedBytes = 0;
for (const source of buildCycloneSourceChunks()) {
  if (preparedModel === null) {
    const result = buildCyclonePreparedModel({ source });
    preparedModel = Object.freeze({ model: result.model, metrics: result.metrics });
  }
  const preparedPlayback = buildCyclonePreparedPlayback({ source });
  const lighting = lightingStream.add(source);
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
    const assetUrl = `/csscyclone/blocks/block-${String(streamBlockIndex).padStart(3, "0")}-${encodedSha256}.bin`;
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
const preparedLighting = await lightingStream.finalize();
const catalogBytes = Buffer.from(`${JSON.stringify({
  schema: "csscyclone-prepared-stream-catalog@1",
  streamId: CSSCYCLONE_BANK.id,
  seed: CSSCYCLONE_BANK.seed,
  chunkCount: CSSCYCLONE_BANK.chunkCount,
  chunkFrameCount: CSSCYCLONE_BANK.frameCount,
  blockCount,
  blocksPerChunk,
  blockFrameCount,
  frameMilliseconds: CSSCYCLONE_BANK.frameMilliseconds,
  streamFrameCount: CSSCYCLONE_BANK.chunkCount * CSSCYCLONE_BANK.frameCount,
  streamDurationMilliseconds:
    CSSCYCLONE_BANK.chunkCount * CSSCYCLONE_BANK.frameCount * CSSCYCLONE_BANK.frameMilliseconds,
  randomStartChunkCount: Math.ceil(CSSCYCLONE_BANK.chunkCount / 2),
  randomStartFrameCount: Math.floor(CSSCYCLONE_BANK.frameCount / 3),
  selection: "session-crypto-random-chunk-and-frame-no-immediate-chunk-repeat",
  playbackOrder: "source-continuous-ascending-chunks-with-one-terminal-stream-wrap",
  runtimeLookaheadBlockCount: 1,
  entries: blockEntries,
})}\n`);
const catalogSha256 = sha256(catalogBytes);
await writeBytes(join(stagingRoot, "catalog.json"), catalogBytes);

if (preparedModel === null) throw new Error("Cyclone source stream produced no prepared model");
const built = await buildPolyMorphPackage(preparedModel.model);
const packageRoot = join(stagingRoot, "model", CSSCYCLONE_MODEL_ID);
await mkdir(packageRoot, { recursive: true });
for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
const catalog = await buildPolyMorphCatalog(CSSCYCLONE_MODEL_ID, [{
  manifest: built.manifest,
  manifestPath: `${CSSCYCLONE_MODEL_ID}/manifest.json`,
  manifestSha256: built.manifestSha256,
}]);
await writeBytes(join(stagingRoot, "model", "catalog.json"), catalog.bytes);
await writeBytes(
  join(stagingRoot, preparedLighting.contract.assetUrl.replace(/^\/csscyclone\//u, "")),
  preparedLighting.bytes,
);

await writeJson(join(stagingRoot, "prepared.json"), {
  schema: "csscyclone-prepared-scene@1",
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
  presentation: {
    sourceDefaults: {
      cyclones: 1,
      particles: 400,
      size: CSSCYCLONE_SOURCE.particleSize,
      complexity: CSSCYCLONE_SOURCE.complexity,
      speed: CSSCYCLONE_SOURCE.speed,
      stretch: CSSCYCLONE_SOURCE.stretch,
      saturationSampling: CSSCYCLONE_PRESENTATION.saturationSampling
    },
    preparedStream: {
      id: CSSCYCLONE_BANK.id,
      seed: CSSCYCLONE_BANK.seed,
      chunkCount: CSSCYCLONE_BANK.chunkCount,
      chunkFrameCount: CSSCYCLONE_BANK.frameCount,
      streamFrameCount: CSSCYCLONE_BANK.chunkCount * CSSCYCLONE_BANK.frameCount,
      streamDurationMilliseconds:
        CSSCYCLONE_BANK.chunkCount * CSSCYCLONE_BANK.frameCount * CSSCYCLONE_BANK.frameMilliseconds,
      randomStartChunkCount: Math.ceil(CSSCYCLONE_BANK.chunkCount / 2),
      randomStartFrameCount: Math.floor(CSSCYCLONE_BANK.frameCount / 3),
      startupSelection: "session-crypto-random-chunk-and-frame-no-immediate-chunk-repeat",
      handoff: "source-continuous-next-block-with-one-block-lookahead",
    },
    productParticleCount: CSSCYCLONE_BANK.particleCount,
    viewDistance: CSSCYCLONE_SOURCE.viewDistance,
    fieldOfViewDegrees: CSSCYCLONE_SOURCE.fieldOfViewDegrees,
    startupWarmupMilliseconds: CSSCYCLONE_BANK.warmupFrames * CSSCYCLONE_BANK.frameMilliseconds
  },
  model: {
    id: CSSCYCLONE_MODEL_ID,
    manifestSha256: built.manifestSha256,
    ...preparedModel.metrics
  },
  playback: {
    catalogUrl: "/csscyclone/catalog.json",
    catalogSha256,
    catalogBytes: catalogBytes.byteLength,
    chunkCount: CSSCYCLONE_BANK.chunkCount,
    preparedBlockCount: blockEntries.length,
    preparedFrameCount,
    uniquePreparedTransformCount,
    shapeTransformSelections,
    preparedBlockEncodedBytes,
    preparedBlockDecodedBytes,
    maximumResidentBlockPairDecodedBytes,
    runtimeLookaheadBlockCount: 1,
    runtimePreparedStateMaterialization: false,
  },
  lighting: preparedLighting.contract,
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
  manifestSha256: built.manifestSha256,
  ...preparedModel.metrics,
  preparedChunkCount: CSSCYCLONE_BANK.chunkCount,
  preparedBlockCount: blockEntries.length,
  preparedFrameCount,
  uniquePreparedTransformCount,
  shapeTransformSelections,
  preparedBlockEncodedBytes,
  preparedBlockDecodedBytes,
  maximumResidentBlockPairDecodedBytes,
  ...preparedLighting.metrics,
}, null, 2));

function slicePreparedPlayback({
  playback,
  blockIndex,
  streamBlockIndex,
  startFrameIndex,
  localStartFrameIndex,
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
