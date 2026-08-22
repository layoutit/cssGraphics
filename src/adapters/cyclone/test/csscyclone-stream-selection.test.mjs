import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeCyclonePreparedTransformsIncrementally,
  selectInitialCyclonePosition,
} from "../src/csscyclone/preparedStream.mjs";

const hash = "0".repeat(64);
const hueSectorNames = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const startupPaletteFamilies = Object.freeze(["blue", "yellow", "red", "magenta", "green"]);
const startupPaletteVariantIds = Object.freeze(Array.from({ length: 12 }, (_, index) =>
  `rotate-${String(index * 30).padStart(3, "0")}`));
const startupPaletteVariantWeights = Object.freeze(Array(12).fill(1));
const startupSelections = Object.freeze([
  Object.freeze({ id: "blue-a", paletteFamily: "blue", chunkIndex: 17, startFrameIndex: 249, frameCount: 48 }),
  Object.freeze({ id: "blue-b", paletteFamily: "blue", chunkIndex: 23, startFrameIndex: 492, frameCount: 48 }),
  Object.freeze({ id: "yellow-a", paletteFamily: "yellow", chunkIndex: 6, startFrameIndex: 447, frameCount: 48 }),
  Object.freeze({ id: "yellow-b", paletteFamily: "yellow", chunkIndex: 21, startFrameIndex: 162, frameCount: 48 }),
  Object.freeze({ id: "red-a", paletteFamily: "red", chunkIndex: 19, startFrameIndex: 171, frameCount: 48 }),
  Object.freeze({ id: "red-b", paletteFamily: "red", chunkIndex: 13, startFrameIndex: 104, frameCount: 48 }),
  Object.freeze({ id: "magenta-a", paletteFamily: "magenta", chunkIndex: 18, startFrameIndex: 279, frameCount: 48 }),
  Object.freeze({ id: "magenta-b", paletteFamily: "magenta", chunkIndex: 12, startFrameIndex: 414, frameCount: 48 }),
  Object.freeze({ id: "green-a", paletteFamily: "green", chunkIndex: 7, startFrameIndex: 250, frameCount: 48 }),
  Object.freeze({ id: "green-b", paletteFamily: "green", chunkIndex: 15, startFrameIndex: 201, frameCount: 48 }),
]);
const catalog = Object.freeze({
  schema: "csscyclone-prepared-stream-catalog@3",
  streamId: "desktop-stream",
  modelId: "cyclone",
  particleCount: 340,
  facesPerParticle: 6,
  leafCount: 2_040,
  playbackSchema: "csscyclone-prepared-dom-playback@5",
  lightingBlockSchema: "csscyclone-prepared-lighting-block@2",
  sourceTransformProfile: Object.freeze({
    controlPointCount: 6,
    speed: 10,
    complexity: 3,
    particleSize: 7,
    radialOrbitScale: 0.85,
  }),
  chunkCount: 24,
  chunkFrameCount: 540,
  blockCount: 216,
  blocksPerChunk: 9,
  blockFrameCount: 60,
  framesPerSecond: 60,
  frameMilliseconds: 1_000 / 60,
  streamFrameCount: 12_960,
  streamDurationMilliseconds: 216_000,
  startupPaletteFamilies,
  startupPaletteVariantIds,
  startupPaletteVariantWeights,
  startupSelections,
  startupSilhouetteSampling: "browser-reviewed-expressive-source-windows",
  startupSilhouetteSampleFrameOffsets: Object.freeze([0, 12, 24, 36, 47]),
  maximumColorFamilyCount: 3,
  selection: "session-weighted-shuffled-hue-rotation-plus-crypto-source-window-no-immediate-repeat",
  startupColorProfile: Object.freeze({
    schema: "csscyclone-prepared-startup-color-profile@2",
    metric: "prepared-source-particle-rgb-hsv-dominant-family-per-curated-window",
    minimumMeanSaturation: 0.68,
    minimumDominantHueShare: 0.25,
    maximumColorFamilyCount: 3,
    hueSectorNames,
    paletteFamilies: startupPaletteFamilies,
    familySelectionCount: 2,
    selections: Object.freeze(startupSelections.map((selection) => {
      const dominantIndex = hueSectorNames.indexOf(selection.paletteFamily);
      return Object.freeze({
        ...selection,
        meanSaturation: 0.9,
        dominantHueSector: selection.paletteFamily,
        dominantHueShare: 1,
        hueSectorShares: Object.freeze(hueSectorNames.map((_, index) =>
          index === dominantIndex ? 1 : 0)),
      });
    })),
  }),
  runtimeLookaheadBlockCount: 11,
  runtimeMaterializedLookaheadBlockCount: 2,
  startupMaterializedLookaheadBlockCount: 2,
  entries: Object.freeze(Array.from({ length: 216 }, (_, index) => Object.freeze({
    index,
    chunkIndex: Math.floor(index / 9),
    blockIndex: index % 9,
    startFrameIndex: index * 60,
    frameCount: 60,
    sourceContinuousFromPrevious: index > 0,
    encoding: "gzip-cyclone-source-state-float64-uint16@1",
    assetUrl: `/block-${index}.bin`,
    byteLength: 1,
    sha256: hash,
    decodedByteLength: 1,
    decodedSha256: hash,
  }))),
});

test("slices worker transform responses before publishing a materialized block", async () => {
  const source = ["matrix3d(1)", "matrix3d(2)", "matrix3d(3)"].join("\n");
  let yieldCount = 0;
  const transforms = await decodeCyclonePreparedTransformsIncrementally(
    new TextEncoder().encode(source),
    3,
    {
      chunkByteLength: 8,
      setDelay(callback) {
        yieldCount += 1;
        callback();
      },
    },
  );
  assert.deepEqual(transforms, ["matrix3d(1)", "matrix3d(2)", "matrix3d(3)"]);
  assert.ok(yieldCount > 0);
});

test("selects an independent prepared hue rotation and source window", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "blue-a",
    paletteVariantId: "rotate-210",
    sourcePaletteFamily: "blue",
    chunkIndex: 17,
    frameIndex: 286,
    mode: "crypto-random-balanced-source-palette",
  });
});

test("does not immediately repeat the previous prepared window", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    previousSelectionId: "blue-a",
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "blue-b",
    paletteVariantId: "rotate-210",
    sourcePaletteFamily: "blue",
    chunkIndex: 23,
    frameIndex: 529,
    mode: "crypto-random-balanced-source-palette-no-repeat",
  });
});

test("uses the session-shuffled hue rotation with an independent curated source window", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    preferredPaletteVariantId: "rotate-120",
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "magenta-b",
    paletteVariantId: "rotate-120",
    sourcePaletteFamily: "magenta",
    chunkIndex: 12,
    frameIndex: 451,
    mode: "session-weighted-shuffled-hue-rotation-crypto-random-source-window",
  });
});

test("rejects a previous start outside the prepared window pool", () => {
  assert.throws(() => selectInitialCyclonePosition(catalog, {
    previousSelectionId: "cyan-a",
    randomUint32Pair: () => [7, 901],
  }), /Previous Cyclone start selection is invalid/u);
});

test("covers every prepared hue rotation and curated source window independently", () => {
  const selected = Array.from({ length: 120 }, (_, value) => selectInitialCyclonePosition(catalog, {
    randomUint32Pair: () => [value, value],
  }));
  assert.deepEqual(
    [...new Set(selected.map(({ paletteVariantId }) => paletteVariantId))],
    startupPaletteVariantIds,
  );
  assert.deepEqual([...new Set(selected.map(({ selectionId }) => selectionId))].sort(),
    [...startupSelections.map(({ id }) => id)].sort());
});

test("accepts an explicit chunk and frame for deterministic browser proof", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    search: "?chunk=23&frame=539&palette=rotate-120",
  }), {
    paletteVariantId: "rotate-120",
    chunkIndex: 23,
    frameIndex: 539,
    mode: "explicit",
  });
});

test("rejects startup source-palette profile drift", () => {
  const driftedCatalog = {
    ...catalog,
    startupColorProfile: {
      ...catalog.startupColorProfile,
      paletteFamilies: ["blue", "yellow", "red", "magenta", "cyan"],
    },
  };
  assert.throws(() => selectInitialCyclonePosition(driftedCatalog, {
    randomUint32Pair: () => [7, 901],
  }), /Prepared Cyclone startup color profile drifted/u);
});

test("rejects startup selection policy drift", () => {
  const driftedCatalog = {
    ...catalog,
    selection: "session-crypto-random-prepared-any-chunk",
  };
  assert.throws(() => selectInitialCyclonePosition(driftedCatalog, {
    randomUint32Pair: () => [7, 901],
  }), /Prepared Cyclone stream catalog drifted/u);
});
