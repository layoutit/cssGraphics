import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCYCLONE_BANK,
  CSSCYCLONE_BANKS,
  CSSCYCLONE_PRESENTATION,
  CSSCYCLONE_SOURCE,
  CSSCYCLONE_SOURCE_BANK,
  buildCycloneSourceChunks,
  buildCycloneSourceSequence,
  selectCycloneSourceParticlePrefix,
} from "../src/prepare/csscyclone/sourceModel.mjs";
import {
  CSSCYCLONE_MODEL_IDS,
  buildCyclonePreparedModel,
  buildCyclonePreparedPlayback,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import {
  buildCyclonePreparedLighting,
  createCyclonePreparedLightingStream,
  prepareCyclonePaletteColor,
} from "../src/prepare/csscyclone/preparedLighting.mjs";
import { resolveCyclonePerspective } from "../src/csscyclone/preparedPlayback.mjs";
import {
  CSSCYCLONE_BLOCK_ENCODING,
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
  decodeCyclonePreparedBlock,
  decodeCyclonePreparedBlockIncrementally,
  encodeCyclonePreparedBlock,
} from "../src/shared/csscyclone/preparedBlockTransport.mjs";

test("pins the current Really Slick Cyclone source profile", () => {
  assert.equal(CSSCYCLONE_SOURCE.revision, "5f0a788bf0cc47f66a233ed528919295cd1e7500");
  assert.equal(CSSCYCLONE_SOURCE.sha256, "1b6268aaf4fe25a43a14a0dcea4c4c58f18c1d2472e1366af2287efd938ea286");
  assert.equal(CSSCYCLONE_SOURCE.fieldOfViewDegrees, 80);
  assert.equal(CSSCYCLONE_SOURCE.viewDistance, 400);
  assert.equal(CSSCYCLONE_SOURCE.particleSize, 7);
  assert.equal(CSSCYCLONE_SOURCE.complexity, 3);
  assert.equal(CSSCYCLONE_SOURCE.speed, 10);
  assert.equal(CSSCYCLONE_BANK.framesPerSecond, 60);
  assert.equal(CSSCYCLONE_BANK.frameMilliseconds, 1_000 / 60);
  assert.equal(CSSCYCLONE_BANK.warmupFrames, 720);
  assert.equal(CSSCYCLONE_BANK.chunkCount, 24);
  assert.equal(CSSCYCLONE_BANK.frameCount, 540);
  assert.equal(CSSCYCLONE_BANK.warmupFrames / CSSCYCLONE_BANK.framesPerSecond, 12);
  assert.equal(CSSCYCLONE_BANK.frameCount / CSSCYCLONE_BANK.framesPerSecond, 9);
  assert.equal(
    CSSCYCLONE_BANK.chunkCount * CSSCYCLONE_BANK.frameCount / CSSCYCLONE_BANK.framesPerSecond,
    216,
  );
  assert.equal(CSSCYCLONE_PRESENTATION.saturationSampling, "floor-0.55-plus-0.45-sqrt-uniform");
  assert.equal(CSSCYCLONE_PRESENTATION.minimumSaturation, 0.55);
  assert.equal(CSSCYCLONE_PRESENTATION.hueSampling, "source-uniform-random-targets");
  assert.equal(CSSCYCLONE_PRESENTATION.particleColorAssignment, "source-hue-at-particle-restart");
  assert.equal(CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount, 3);
  assert.equal(
    CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
    "source-hue-quantized-to-session-three-family-variant",
  );
  assert.equal(CSSCYCLONE_PRESENTATION.maximumColorFamilyCount, 3);
  assert.deepEqual(
    CSSCYCLONE_PRESENTATION.startupPaletteFamilies,
    ["blue", "yellow", "red", "magenta", "green"],
  );
  assert.equal(CSSCYCLONE_PRESENTATION.startupSelections.length, 10);
  assert.equal(CSSCYCLONE_PRESENTATION.mobileStartupSelections.length, 10);
  assert.deepEqual(
    CSSCYCLONE_PRESENTATION.mobileStartupSelections.find(({ id }) => id === "blue-a"),
    { id: "blue-a", paletteFamily: "blue", chunkIndex: 1, startFrameIndex: 123, frameCount: 48 },
  );
  assert.deepEqual(
    CSSCYCLONE_PRESENTATION.startupSelections.map(({ id, paletteFamily, chunkIndex }) =>
      [id, paletteFamily, chunkIndex]),
    [
      ["blue-a", "blue", 17], ["blue-b", "blue", 23],
      ["yellow-a", "yellow", 6], ["yellow-b", "yellow", 21],
      ["red-a", "red", 19], ["red-b", "red", 13],
      ["magenta-a", "magenta", 18], ["magenta-b", "magenta", 12],
      ["green-a", "green", 7], ["green-b", "green", 15],
    ],
  );
  assert.equal(
    CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
    "browser-reviewed-expressive-source-windows",
  );
  assert.deepEqual(CSSCYCLONE_PRESENTATION.startupSilhouetteSampleFrameOffsets, [0, 12, 24, 36, 47]);
  assert.equal(CSSCYCLONE_PRESENTATION.startupMinimumMeanSaturation, 0.68);
  assert.equal(CSSCYCLONE_PRESENTATION.startupMinimumDominantHueShare, 0.25);
});

test("prepares desktop and mobile banks as complete source-particle prefixes", () => {
  assert.equal(CSSCYCLONE_SOURCE_BANK.particleCount, 400);
  assert.equal(CSSCYCLONE_BANKS.desktop.particleCount, 360);
  assert.equal(CSSCYCLONE_BANKS.mobile.particleCount, 166);
  const desktopBank = {
    ...CSSCYCLONE_SOURCE_BANK,
    warmupFrames: 2,
    frameCount: 2,
    chunkCount: 1,
  };
  const mobileBank = {
    ...CSSCYCLONE_BANKS.mobile,
    warmupFrames: desktopBank.warmupFrames,
    frameCount: desktopBank.frameCount,
    chunkCount: desktopBank.chunkCount,
  };
  const desktopSource = buildCycloneSourceSequence({ bank: desktopBank });
  const source = selectCycloneSourceParticlePrefix(desktopSource, mobileBank);
  const preparedModel = buildCyclonePreparedModel({
    source,
    modelId: CSSCYCLONE_MODEL_IDS.mobile,
  });
  const preparedPlayback = buildCyclonePreparedPlayback({
    source,
    modelId: CSSCYCLONE_MODEL_IDS.mobile,
  });
  assert.equal(preparedModel.model.identity.id, "cyclone-mobile");
  assert.equal(preparedModel.model.render.shapes.length, 166);
  assert.equal(preparedModel.model.render.leaves.length, 996);
  assert.equal(preparedModel.metrics.polygonsPerParticle, 6);
  assert.equal(preparedPlayback.playback.particleCount, 166);
  assert.equal(preparedPlayback.playback.leafCount, 996);
  assert.deepEqual(source.frames[0].particles, desktopSource.frames[0].particles.slice(0, 166));
});

test("widens only the mobile presentation field of view", () => {
  assert.equal(resolveCyclonePerspective(1_280, 800), 476.7014);
  assert.equal(resolveCyclonePerspective(600, 844), 502.92);
  assert.equal(resolveCyclonePerspective(599, 844), 422);
  assert.equal(resolveCyclonePerspective(390, 844), 422);
});

test("builds a stable retained particle graph and prepared state bank", () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 20, frameCount: 4 };
  const source = buildCycloneSourceSequence({ bank });
  const preparedModel = buildCyclonePreparedModel({ source });
  const preparedPlayback = buildCyclonePreparedPlayback({ source });
  assert.equal(preparedModel.model.render.shapes.length, 3);
  assert.equal(preparedModel.model.render.leaves.length, 18);
  assert.equal(preparedModel.model.topology.polygons.length, 18);
  assert.equal(preparedPlayback.playback.transforms.length, 12);
  assert.equal(preparedPlayback.playback.schema, "csscyclone-prepared-dom-playback@5");
  assert.equal(preparedPlayback.metrics.shapeTransformSelections, 12);
  assert.equal(preparedModel.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(preparedModel.metrics.runtimeAtlasRasterizationCount, 0);
  assert.equal(preparedModel.metrics.runtimeDomGrowth, false);
});

test("round-trips exact prepared matrices through compact source-state blocks", async () => {
  const bank = {
    ...CSSCYCLONE_BANK,
    id: "transport-test",
    particleCount: 10,
    warmupFrames: 20,
    frameCount: 20,
    chunkCount: 1,
  };
  const source = buildCycloneSourceSequence({ bank });
  const expected = buildCyclonePreparedPlayback({ source }).playback;
  const lightingRows = source.frames.map((unused, frameIndex) =>
    Array.from({ length: bank.particleCount }, (ignored, particleIndex) =>
      (frameIndex + particleIndex) % 7));
  const bytes = encodeCyclonePreparedBlock({
    frames: source.frames,
    lightingRows,
    particleCount: bank.particleCount,
  });
  const descriptor = Object.freeze({
    index: 0,
    chunkIndex: 0,
    blockIndex: 0,
    startFrameIndex: 0,
    frameCount: bank.frameCount,
    encoding: CSSCYCLONE_BLOCK_ENCODING,
  });
  const catalog = Object.freeze({
    streamId: bank.id,
    modelId: CSSCYCLONE_MODEL_IDS.desktop,
    particleCount: bank.particleCount,
    leafCount: bank.particleCount * 6,
    frameMilliseconds: bank.frameMilliseconds,
    chunkCount: 1,
    blockCount: 1,
    blocksPerChunk: 1,
    playbackSchema: CSSCYCLONE_PLAYBACK_SCHEMA,
    lightingBlockSchema: CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
    sourceTransformProfile: Object.freeze({
      controlPointCount: 6,
      speed: CSSCYCLONE_SOURCE.speed,
      complexity: CSSCYCLONE_SOURCE.complexity,
      particleSize: CSSCYCLONE_SOURCE.particleSize,
    }),
  });
  const decoded = decodeCyclonePreparedBlock(bytes, descriptor, catalog);
  assert.deepEqual(decoded.playback.transforms, expected.transforms);
  assert.deepEqual(
    [...decoded.lighting.frameParticleColorStateIndices],
    lightingRows.flat(),
  );
  assert.equal(decoded.preparedMatrixExpansionCount, expected.transforms.length);
  assert.ok(decoded.preparedCssStringByteLength > bytes.byteLength);
  let clock = 0;
  let delayCount = 0;
  const slices = [];
  const incrementallyDecoded = await decodeCyclonePreparedBlockIncrementally(
    bytes,
    descriptor,
    catalog,
    {
      setDelay(callback) {
        delayCount += 1;
        callback();
      },
      readNow() {
        clock += 1;
        return clock;
      },
      sliceBudgetMilliseconds: 2,
      onSlice(operationCount, durationMilliseconds) {
        slices.push({ operationCount, durationMilliseconds });
      },
    },
  );
  assert.deepEqual(incrementallyDecoded.playback.transforms, expected.transforms);
  assert.ok(delayCount >= 1);
  assert.ok(slices.every(({ operationCount }) => operationCount <= 8_192));
  assert.throws(
    () => decodeCyclonePreparedBlock(bytes.slice(0, -1), descriptor, catalog),
    /binary byte length drifted/u,
  );
});

test("prepares smooth reference lighting without a runtime lighting timeline", async () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 20, frameCount: 4 };
  const source = buildCycloneSourceSequence({ bank });
  const prepared = await buildCyclonePreparedLighting({ source });
  assert.equal(prepared.contract.schema, "csscyclone-prepared-smooth-lighting-atlas@7");
  assert.equal(prepared.contract.contentSize, 2);
  assert.equal(prepared.contract.gutterPixels, 1);
  assert.equal(prepared.contract.leafCount, 18);
  assert.equal(prepared.contract.colorStateCount, 3);
  assert.equal(prepared.contract.colorRestartCount, 0);
  assert.equal(prepared.contract.tileCount, 18);
  assert.ok(prepared.contract.uniqueTileCount <= prepared.contract.tileCount);
  assert.equal(
    prepared.contract.deduplicatedTileCount,
    prepared.contract.tileCount - prepared.contract.uniqueTileCount,
  );
  assert.equal(prepared.contract.tileDeduplication, "exact-cross-palette-rgba8-slot-content");
  assert.equal(prepared.contract.packing, "near-square-row-major-unique-slots");
  assert.equal(prepared.contract.tileBackgroundPositions.length, 18);
  assert.equal(prepared.contract.paletteFamilyCount, 5);
  assert.equal(prepared.contract.paletteHueSlotCount, 3);
  assert.equal(prepared.contract.maximumColorFamilyCount, 3);
  assert.equal(prepared.contract.preparedMinimumSaturation, 0.55);
  assert.equal(prepared.contract.preparedMinimumValue, 0.65);
  assert.equal(prepared.contract.variants.length, 5);
  assert.ok(prepared.contract.variants.every((variant) => variant.hueSlots.length === 3));
  assert.equal(prepared.contract.sourceStreamFrameCount, 4);
  assert.equal(prepared.contract.chunkCount, 1);
  assert.equal(prepared.chunk.frameParticleColorStateIndices.length, 4);
  assert.equal(prepared.contract.displayScale, 16);
  assert.ok(Math.abs(prepared.contract.width - prepared.contract.height) <= prepared.contract.slotSize);
  assert.equal(prepared.contract.runtime.rootLightingRowWritesPerSample, 0);
  assert.equal(prepared.contract.runtime.lightingCalculations, 0);
  assert.equal(prepared.contract.runtime.atlasConstruction, 0);
  assert.equal(prepared.assets.length, 5);
  assert.ok(prepared.assets.every((asset) => asset.bytes.byteLength > 0));
  assert.ok(prepared.contract.variants.every((variant) => /^[a-f0-9]{64}$/u.test(variant.assetSha256)));
  const liftedBlack = prepareCyclonePaletteColor([0, 0, 0], "yellow");
  assert.equal(Math.max(...liftedBlack), 0.65);
  assert.equal(Number((1 - Math.min(...liftedBlack) / Math.max(...liftedBlack)).toFixed(2)), 0.55);
});

test("publishes only exact source color restarts through sparse leaf addresses", async () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 24, frameCount: 48 };
  const source = buildCycloneSourceSequence({ bank });
  const prepared = await buildCyclonePreparedLighting({ source });
  let changedParticleCount = 0;
  for (let frameIndex = 1; frameIndex < prepared.chunk.frameParticleColorStateIndices.length; frameIndex += 1) {
    const previous = prepared.chunk.frameParticleColorStateIndices[frameIndex - 1];
    const current = prepared.chunk.frameParticleColorStateIndices[frameIndex];
    for (let particleIndex = 0; particleIndex < current.length; particleIndex += 1) {
      changedParticleCount += Number(current[particleIndex] !== previous[particleIndex]);
    }
  }
  assert.equal(prepared.contract.colorRestartCount, 1);
  assert.equal(changedParticleCount, 1);
  assert.equal(prepared.contract.colorStateCount, 4);
  assert.equal(prepared.contract.tileCount, 24);
  assert.equal(prepared.contract.runtime.maximumSparseLeafWritesPerParticleRestart, 6);
});

test("splits one uninterrupted prepared source stream into exact consecutive chunks", () => {
  const chunkedBank = {
    ...CSSCYCLONE_BANK,
    particleCount: 2,
    warmupFrames: 12,
    frameCount: 4,
    chunkCount: 2,
  };
  const continuousBank = { ...chunkedBank, frameCount: 8, chunkCount: 1 };
  const chunks = [...buildCycloneSourceChunks({ bank: chunkedBank })];
  const continuous = buildCycloneSourceSequence({ bank: continuousBank });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].bank.startFrameIndex, 0);
  assert.equal(chunks[1].bank.startFrameIndex, 4);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.frames), continuous.frames);
});

test("prepares one shared lighting address space across consecutive chunks", async () => {
  const bank = {
    ...CSSCYCLONE_BANK,
    particleCount: 3,
    warmupFrames: 20,
    frameCount: 20,
    chunkCount: 2,
  };
  const stream = createCyclonePreparedLightingStream();
  const lightingChunks = [...buildCycloneSourceChunks({ bank })].map(stream.add);
  const prepared = await stream.finalize();
  assert.equal(prepared.contract.chunkCount, 2);
  assert.equal(prepared.contract.sourceStreamFrameCount, 40);
  assert.equal(lightingChunks.length, 2);
  assert.equal(lightingChunks[1].startFrameIndex, 20);
  assert.equal(lightingChunks[1].frameParticleColorStateIndices.length, 20);
});

test("is deterministic for an explicit bank seed", () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 2, warmupFrames: 12, frameCount: 5 };
  const left = buildCycloneSourceSequence({ bank });
  const right = buildCycloneSourceSequence({ bank });
  assert.deepEqual(left, right);
});

test("preserves the source tangent orientation", () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 2, warmupFrames: 24, frameCount: 2 };
  const source = buildCycloneSourceSequence({ bank });
  assert.deepEqual(source.frames[0].particles[0].matrix, [
    0.532427, -0.451061, 0.716286, 0,
    0.215511, 0.890546, 0.400604, 0,
    -4.092909, -0.294623, 2.856797, 0,
    12.934245, -19.506742, 81.488458, 1,
  ]);
});
