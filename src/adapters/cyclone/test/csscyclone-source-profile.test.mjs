import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCYCLONE_BANK,
  CSSCYCLONE_PRESENTATION,
  CSSCYCLONE_SOURCE,
  buildCycloneSourceChunks,
  buildCycloneSourceSequence,
} from "../src/prepare/csscyclone/sourceModel.mjs";
import {
  buildCyclonePreparedModel,
  buildCyclonePreparedPlayback,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import {
  buildCyclonePreparedLighting,
  createCyclonePreparedLightingStream,
} from "../src/prepare/csscyclone/preparedLighting.mjs";
import { resolveCyclonePerspective } from "../src/csscyclone/preparedPlayback.mjs";

test("pins the current Really Slick Cyclone source profile", () => {
  assert.equal(CSSCYCLONE_SOURCE.revision, "5f0a788bf0cc47f66a233ed528919295cd1e7500");
  assert.equal(CSSCYCLONE_SOURCE.sha256, "1b6268aaf4fe25a43a14a0dcea4c4c58f18c1d2472e1366af2287efd938ea286");
  assert.equal(CSSCYCLONE_SOURCE.fieldOfViewDegrees, 80);
  assert.equal(CSSCYCLONE_SOURCE.viewDistance, 400);
  assert.equal(CSSCYCLONE_SOURCE.particleSize, 7);
  assert.equal(CSSCYCLONE_SOURCE.complexity, 3);
  assert.equal(CSSCYCLONE_SOURCE.speed, 10);
  assert.equal(CSSCYCLONE_BANK.chunkCount, 24);
  assert.equal(CSSCYCLONE_BANK.frameCount, 450);
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
  assert.deepEqual(
    CSSCYCLONE_PRESENTATION.startupSelections.map(({ id, paletteFamily, chunkIndex }) =>
      [id, paletteFamily, chunkIndex]),
    [
      ["blue-a", "blue", 0], ["blue-b", "blue", 0],
      ["yellow-a", "yellow", 1], ["yellow-b", "yellow", 7],
      ["red-a", "red", 5], ["red-b", "red", 9],
      ["magenta-a", "magenta", 4], ["magenta-b", "magenta", 11],
      ["green-a", "green", 17], ["green-b", "green", 19],
    ],
  );
  assert.equal(
    CSSCYCLONE_PRESENTATION.startupSilhouetteSampling,
    "browser-reviewed-expressive-source-windows",
  );
  assert.deepEqual(CSSCYCLONE_PRESENTATION.startupSilhouetteSampleFrameOffsets, [0, 10, 20, 30, 39]);
  assert.equal(CSSCYCLONE_PRESENTATION.startupMinimumMeanSaturation, 0.68);
  assert.equal(CSSCYCLONE_PRESENTATION.startupMinimumDominantHueShare, 0.25);
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
  assert.equal(preparedPlayback.playback.frames.length, 4);
  assert.equal(preparedPlayback.playback.transforms.length, 12);
  assert.equal(preparedPlayback.playback.schema, "csscyclone-prepared-dom-playback@3");
  assert.equal(preparedPlayback.playback.frames[0].length, 6);
  assert.equal(preparedPlayback.metrics.shapeTransformSelections, 12);
  assert.equal(preparedModel.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(preparedModel.metrics.runtimeAtlasRasterizationCount, 0);
  assert.equal(preparedModel.metrics.runtimeDomGrowth, false);
});

test("prepares smooth reference lighting without a runtime lighting timeline", async () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 20, frameCount: 4 };
  const source = buildCycloneSourceSequence({ bank });
  const prepared = await buildCyclonePreparedLighting({ source });
  assert.equal(prepared.contract.schema, "csscyclone-prepared-smooth-lighting-atlas@5");
  assert.equal(prepared.contract.contentSize, 2);
  assert.equal(prepared.contract.gutterPixels, 1);
  assert.equal(prepared.contract.leafCount, 18);
  assert.equal(prepared.contract.colorStateCount, 3);
  assert.equal(prepared.contract.colorRestartCount, 0);
  assert.equal(prepared.contract.tileCount, 18);
  assert.equal(prepared.contract.tileBackgroundPositions.length, 18);
  assert.equal(prepared.contract.paletteFamilyCount, 5);
  assert.equal(prepared.contract.paletteHueSlotCount, 3);
  assert.equal(prepared.contract.maximumColorFamilyCount, 3);
  assert.equal(prepared.contract.variants.length, 5);
  assert.ok(prepared.contract.variants.every((variant) => variant.hueSlots.length === 3));
  assert.equal(prepared.contract.sourceStreamFrameCount, 4);
  assert.equal(prepared.contract.chunkCount, 1);
  assert.equal(prepared.chunk.frameParticleColorStateIndices.length, 4);
  assert.equal(prepared.contract.displayScale, 16);
  assert.equal(prepared.contract.height, 4);
  assert.equal(prepared.contract.runtime.rootLightingRowWritesPerSample, 0);
  assert.equal(prepared.contract.runtime.lightingCalculations, 0);
  assert.equal(prepared.contract.runtime.atlasConstruction, 0);
  assert.equal(prepared.assets.length, 5);
  assert.ok(prepared.assets.every((asset) => asset.bytes.byteLength > 0));
  assert.ok(prepared.contract.variants.every((variant) => /^[a-f0-9]{64}$/u.test(variant.assetSha256)));
});

test("publishes only exact source color restarts through sparse leaf addresses", async () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 20, frameCount: 40 };
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
  const bank = { ...CSSCYCLONE_BANK, particleCount: 2, warmupFrames: 20, frameCount: 2 };
  const source = buildCycloneSourceSequence({ bank });
  assert.deepEqual(source.frames[0].particles[0].matrix, [
    0.616677, -0.443615, 0.65032, 0,
    0.215753, 0.889711, 0.402324, 0,
    -4.542442, -0.646772, 3.866253, 0,
    13.837036, -19.302883, 80.890841, 1,
  ]);
});
