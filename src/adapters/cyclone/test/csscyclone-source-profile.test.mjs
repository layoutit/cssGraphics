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
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_FACE_TILE_VERTEX_ORDERS,
  CSSCYCLONE_MODEL_IDS,
  CSSCYCLONE_PARTICLE_VERTICES,
  buildCyclonePreparedModel,
  buildCyclonePreparedPlayback,
} from "../src/prepare/csscyclone/modelBuilder.mjs";
import {
  buildCyclonePreparedLighting,
  createCyclonePreparedLightingStream,
  prepareCyclonePaletteColor,
} from "../src/prepare/csscyclone/preparedLighting.mjs";
import { resolveCyclonePerspective } from "../src/csscyclone/preparedPlayback.mjs";
import { CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANTS } from "../../shared/reallyslickPalette.mjs";
import {
  CSSCYCLONE_BLOCK_ENCODING,
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
  decodeCyclonePreparedBlock,
  decodeCyclonePreparedBlockIncrementally,
  encodeCyclonePreparedBlock,
} from "../src/shared/csscyclone/preparedBlockTransport.mjs";

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  assert.ok(length > 1e-12);
  return vector.map((value) => value / length);
}

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
  assert.equal(CSSCYCLONE_PRESENTATION.radialOrbitScale, 0.75);
  assert.equal(CSSCYCLONE_PRESENTATION.minimumSaturation, 0.55);
  assert.equal(CSSCYCLONE_PRESENTATION.hueSampling, "source-uniform-random-targets");
  assert.equal(CSSCYCLONE_PRESENTATION.particleColorAssignment, "source-hue-at-particle-restart");
  assert.equal(
    CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
    "source-hue-ranked-curated-three-color-analogous-palette",
  );
  assert.equal(CSSCYCLONE_PRESENTATION.preparedPaletteVariants.length, 12);
  assert.equal(
    CSSCYCLONE_PRESENTATION.preparedPaletteVariants,
    CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANTS,
  );
  assert.deepEqual(CSSCYCLONE_PRESENTATION.preparedPaletteVariants[4], {
    id: "rotate-120",
    hueRotation: 1 / 3,
    preparedHues: [180 / 360, 210 / 360, 240 / 360],
    startupWeight: 2,
  });
  assert.deepEqual(
    CSSCYCLONE_PRESENTATION.startupPaletteWeights,
    Array(12).fill(1),
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
  assert.equal(CSSCYCLONE_BANKS.desktop.particleCount, 320);
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
  assert.deepEqual(
    preparedModel.model.render.leaves.slice(0, 6).map(({ strategy }) => strategy),
    Array(6).fill("solid-triangle"),
  );
  assert.deepEqual(CSSCYCLONE_PARTICLE_VERTICES[0], [0, 0, CSSCYCLONE_SOURCE.particleSize / 4]);
  assert.deepEqual(CSSCYCLONE_PARTICLE_VERTICES.at(-1), [0, 0, -CSSCYCLONE_SOURCE.particleSize / 4]);
  assert.equal(CSSCYCLONE_PARTICLE_VERTICES.slice(1, -1).every((vertex) => vertex[2] === 0), true);
  assert.deepEqual(CSSCYCLONE_FACE_INDICES.at(-1), [4, 1, 3]);
  assert.deepEqual(CSSCYCLONE_FACE_TILE_VERTEX_ORDERS, [
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
  ]);
  preparedModel.model.render.leaves.slice(0, 6).forEach((leaf, faceIndex) => {
    const centroid = CSSCYCLONE_FACE_INDICES[faceIndex]
      .map((index) => CSSCYCLONE_PARTICLE_VERTICES[index])
      .reduce((sum, vertex) => sum.map((value, axis) => value + vertex[axis]), [0, 0, 0])
      .map((value) => value / CSSCYCLONE_FACE_INDICES[faceIndex].length);
    const normal = leaf.matrix.slice(8, 11);
    assert.equal(normal.reduce((sum, value, axis) => sum + value * centroid[axis], 0) < 0, true);
  });
  assert.equal(preparedPlayback.playback.transforms.length, 12);
  assert.equal(preparedPlayback.playback.schema, "csscyclone-prepared-dom-playback@5");
  assert.equal(preparedPlayback.metrics.shapeTransformSelections, 12);
  assert.equal(preparedModel.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(preparedModel.metrics.runtimeAtlasRasterizationCount, 0);
  assert.equal(preparedModel.metrics.runtimeDomGrowth, false);
});

test("points the bipyramid forward tip along prepared particle travel", () => {
  const source = buildCycloneSourceSequence({
    bank: {
      ...CSSCYCLONE_BANK,
      particleCount: 80,
      warmupFrames: 720,
      frameCount: 180,
      chunkCount: 1,
    },
  });
  const localApex = normalized(CSSCYCLONE_PARTICLE_VERTICES.at(-1));
  let alignmentTotal = 0;
  let closestAxisCount = 0;
  let transitionCount = 0;
  for (let frameIndex = 0; frameIndex < source.frames.length - 1; frameIndex += 1) {
    const frame = source.frames[frameIndex];
    const nextFrame = source.frames[frameIndex + 1];
    for (let particleIndex = 0; particleIndex < source.bank.particleCount; particleIndex += 1) {
      const matrix = frame.particles[particleIndex].matrix;
      const nextMatrix = nextFrame.particles[particleIndex].matrix;
      const velocity = normalized([
        nextMatrix[12] - matrix[12],
        nextMatrix[13] - matrix[13],
        nextMatrix[14] - matrix[14],
      ]);
      const transformedAxes = [
        [matrix[0], matrix[1], matrix[2]],
        [matrix[4], matrix[5], matrix[6]],
        [matrix[8], matrix[9], matrix[10]],
      ].map(normalized);
      const apexDirection = normalized([
        matrix[0] * localApex[0] + matrix[4] * localApex[1] + matrix[8] * localApex[2],
        matrix[1] * localApex[0] + matrix[5] * localApex[1] + matrix[9] * localApex[2],
        matrix[2] * localApex[0] + matrix[6] * localApex[1] + matrix[10] * localApex[2],
      ]);
      const apexAlignment = dot(velocity, apexDirection);
      const cardinalAlignments = transformedAxes.flatMap((axis) => [
        dot(velocity, axis),
        dot(velocity, axis.map((value) => -value)),
      ]);
      alignmentTotal += apexAlignment;
      if (apexAlignment >= Math.max(...cardinalAlignments)) closestAxisCount += 1;
      transitionCount += 1;
    }
  }
  assert.equal(transitionCount, 14_320);
  assert.ok(alignmentTotal / transitionCount > 0.94);
  assert.ok(closestAxisCount / transitionCount > 0.96);
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
    leafCount: bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
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
      radialOrbitScale: CSSCYCLONE_PRESENTATION.radialOrbitScale,
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
  const delayMilliseconds = [];
  const slices = [];
  const incrementallyDecoded = await decodeCyclonePreparedBlockIncrementally(
    bytes,
    descriptor,
    catalog,
    {
      setDelay(callback, milliseconds) {
        delayCount += 1;
        delayMilliseconds.push(milliseconds);
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
  assert.ok(delayMilliseconds.every((milliseconds) => milliseconds === catalog.frameMilliseconds));
  assert.ok(slices.every(({ operationCount }) => operationCount <= 8_192));
  assert.throws(
    () => decodeCyclonePreparedBlock(bytes.slice(0, -1), descriptor, catalog),
    /binary byte length drifted/u,
  );
});

test("prepares source-vertex-averaged face lighting without a runtime lighting timeline", async () => {
  const bank = { ...CSSCYCLONE_BANK, particleCount: 3, warmupFrames: 20, frameCount: 4 };
  const source = buildCycloneSourceSequence({ bank });
  const prepared = await buildCyclonePreparedLighting({ source });
  assert.equal(prepared.contract.schema, "csscyclone-prepared-source-lit-three-color-vertex-lighting-colors@20");
  assert.equal(prepared.contract.leafCount, 18);
  assert.equal(prepared.contract.colorStateCount, 3);
  assert.equal(prepared.contract.colorRestartCount, 0);
  assert.equal(prepared.contract.colorEntryCount, 18);
  assert.ok(prepared.contract.uniqueColorCount <= prepared.contract.colorEntryCount);
  assert.equal(
    prepared.contract.deduplicatedColorCount,
    prepared.contract.colorEntryCount - prepared.contract.uniqueColorCount,
  );
  assert.equal(prepared.contract.colorDeduplication, "exact-cross-palette-css-srgb-tuples");
  assert.equal(prepared.contract.colorSlotIndexCount, 18);
  assert.ok([2, 4].includes(prepared.contract.colorSlotIndexBytes));
  assert.ok(prepared.contract.colorSlotIndicesBase64.length > 0);
  assert.equal(prepared.contract.paletteVariantCount, 12);
  assert.equal(prepared.contract.paletteVariantIds.length, 12);
  assert.equal(prepared.contract.preparedMinimumSaturation, 0.55);
  assert.equal(prepared.contract.preparedMinimumValue, 0.75);
  assert.equal(
    prepared.contract.sampling,
    "three-source-smooth-vertex-light-samples-averaged-per-solid-face-state",
  );
  assert.equal(
    prepared.contract.interpolation,
    "browser-solid-face-average-of-stream-frame-zero-source-vertex-lighting",
  );
  assert.equal(
    prepared.contract.finalLitColorProfile.schema,
    "csscyclone-prepared-final-lit-color-profile@3",
  );
  assert.equal(prepared.contract.finalLitColorProfile.darkFaceValueThreshold, 0.4);
  assert.equal(prepared.contract.finalLitColorProfile.maximumDarkFaceShare, 0.2);
  assert.equal(prepared.contract.finalLitColorProfile.minimumMedianLitValue, 0.5);
  assert.equal(prepared.contract.finalLitColorProfile.srgbExposure, 1.4);
  assert.equal(prepared.contract.finalLitColorProfile.variants.length, 12);
  assert.equal(prepared.contract.variants.length, 12);
  assert.ok(prepared.contract.variants.every((variant, index) =>
    variant.paletteVariantId === prepared.contract.paletteVariantIds[index] &&
    variant.hueRotation === index / 12 &&
    variant.preparedHues.length === 3));
  assert.equal(prepared.contract.sourceStreamFrameCount, 4);
  assert.equal(prepared.contract.chunkCount, 1);
  assert.equal(prepared.chunk.frameParticleColorStateIndices.length, 4);
  assert.equal(prepared.contract.runtime.rootLightingRowWritesPerSample, 0);
  assert.equal(prepared.contract.runtime.lightingCalculations, 0);
  assert.equal(prepared.contract.runtime.imageConstruction, 0);
  assert.ok(prepared.contract.variants.every((variant) =>
    variant.colors.length === prepared.contract.uniqueColorCount &&
    variant.colors.every((color) => /^#[a-f0-9]{6}$/u.test(color))));
  const liftedBlack = prepareCyclonePaletteColor([0, 0, 0], "rotate-060");
  assert.equal(Math.max(...liftedBlack), 0.75);
  const liftedRedBlack = prepareCyclonePaletteColor([0, 0, 0], "rotate-000");
  assert.equal(Math.max(...liftedRedBlack), 0.75);
  assert.equal(Number((1 - Math.min(...liftedBlack) / Math.max(...liftedBlack)).toFixed(2)), 0.55);
});

test("maps source hues into three neighboring prepared colors", () => {
  const preparedHues = Array.from({ length: 10 }, (_, index) => {
    const source = hsvColor((index + 0.5) / 10, 0.8, 0.8);
    return rgbHue(prepareCyclonePaletteColor(source, "rotate-000"));
  });
  const hueCounts = new Map();
  for (const hue of preparedHues) hueCounts.set(hue, (hueCounts.get(hue) ?? 0) + 1);
  assert.deepEqual([...hueCounts.values()], [4, 4, 2]);
  assert.deepEqual([...hueCounts.keys()], [0.25, 0.333333, 0.416667]);
});

test("publishes only exact source color restarts through sparse leaf colors", async () => {
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
  assert.equal(prepared.contract.colorEntryCount, 24);
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

test("prepares one shared lighting color-slot space across consecutive chunks", async () => {
  const bank = {
    ...CSSCYCLONE_BANK,
    particleCount: 3,
    warmupFrames: 20,
    frameCount: 20,
    chunkCount: 2,
  };
  const stream = createCyclonePreparedLightingStream({ enforceFinalColorProfile: false });
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
    11.576768, -18.356715, 79.662214, 1,
  ]);
});

function hsvColor(hue, saturation, value) {
  const sector = hue * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const minimum = value * (1 - saturation);
  const descending = value * (1 - fraction * saturation);
  const ascending = value * (1 - (1 - fraction) * saturation);
  return [
    [value, ascending, minimum],
    [descending, value, minimum],
    [minimum, value, ascending],
    [minimum, descending, value],
    [ascending, minimum, value],
    [value, minimum, descending],
  ][index];
}

function rgbHue(color) {
  const maximum = Math.max(...color);
  const minimum = Math.min(...color);
  const chroma = maximum - minimum;
  let hue = 0;
  if (maximum === color[0]) hue = ((color[1] - color[2]) / chroma) % 6;
  else if (maximum === color[1]) hue = (color[2] - color[0]) / chroma + 2;
  else hue = (color[0] - color[1]) / chroma + 4;
  return Number(((hue / 6 + 1) % 1).toFixed(6));
}
