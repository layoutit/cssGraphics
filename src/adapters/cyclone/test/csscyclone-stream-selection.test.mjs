import assert from "node:assert/strict";
import test from "node:test";
import { selectInitialCyclonePosition } from "../src/csscyclone/preparedStream.mjs";

const hash = "0".repeat(64);
const hueSectorNames = Object.freeze(["red", "yellow", "green", "cyan", "blue", "magenta"]);
const startupPaletteFamilies = Object.freeze(["blue", "yellow", "red", "magenta", "green"]);
const startupSelections = Object.freeze([
  Object.freeze({ id: "blue-a", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 20, frameCount: 40 }),
  Object.freeze({ id: "blue-b", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 190, frameCount: 40 }),
  Object.freeze({ id: "yellow-a", paletteFamily: "yellow", chunkIndex: 1, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "yellow-b", paletteFamily: "yellow", chunkIndex: 7, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "red-a", paletteFamily: "red", chunkIndex: 5, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "red-b", paletteFamily: "red", chunkIndex: 9, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "magenta-a", paletteFamily: "magenta", chunkIndex: 4, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "magenta-b", paletteFamily: "magenta", chunkIndex: 11, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "green-a", paletteFamily: "green", chunkIndex: 17, startFrameIndex: 55, frameCount: 40 }),
  Object.freeze({ id: "green-b", paletteFamily: "green", chunkIndex: 19, startFrameIndex: 55, frameCount: 40 }),
]);
const catalog = Object.freeze({
  schema: "csscyclone-prepared-stream-catalog@1",
  streamId: "desktop-stream",
  chunkCount: 24,
  chunkFrameCount: 450,
  blockCount: 216,
  blocksPerChunk: 9,
  blockFrameCount: 50,
  frameMilliseconds: 20,
  streamFrameCount: 10_800,
  streamDurationMilliseconds: 216_000,
  startupPaletteFamilies,
  startupSelections,
  startupSilhouetteSampling: "browser-reviewed-expressive-source-windows",
  startupSilhouetteSampleFrameOffsets: Object.freeze([0, 10, 20, 30, 39]),
  maximumColorFamilyCount: 3,
  selection: "session-crypto-shuffled-palette-family-source-window-no-immediate-repeat",
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
  runtimeLookaheadBlockCount: 3,
  entries: Object.freeze(Array.from({ length: 216 }, (_, index) => Object.freeze({
    index,
    chunkIndex: Math.floor(index / 9),
    blockIndex: index % 9,
    startFrameIndex: index * 50,
    frameCount: 50,
    sourceContinuousFromPrevious: index > 0,
    encoding: "gzip-newline-json",
    assetUrl: `/block-${index}.bin`,
    byteLength: 1,
    sha256: hash,
    decodedByteLength: 1,
    decodedSha256: hash,
  }))),
});

test("selects a balanced prepared source-palette window once", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "red-b",
    paletteFamily: "red",
    chunkIndex: 9,
    frameIndex: 76,
    mode: "crypto-random-balanced-source-palette",
  });
});

test("does not immediately repeat the previous prepared window", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    previousSelectionId: "red-b",
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "red-a",
    paletteFamily: "red",
    chunkIndex: 5,
    frameIndex: 76,
    mode: "crypto-random-balanced-source-palette-no-repeat",
  });
});

test("uses the session-shuffled family while retaining a random curated source window", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    preferredPaletteFamily: "green",
    randomUint32Pair: () => [7, 901],
  }), {
    selectionId: "green-b",
    paletteFamily: "green",
    chunkIndex: 19,
    frameIndex: 76,
    mode: "session-shuffled-palette-crypto-random-source-window",
  });
});

test("rejects a previous start outside the prepared window pool", () => {
  assert.throws(() => selectInitialCyclonePosition(catalog, {
    previousSelectionId: "cyan-a",
    randomUint32Pair: () => [7, 901],
  }), /Previous Cyclone start selection is invalid/u);
});

test("gives each prepared three-family palette variant equal selection coverage", () => {
  const selected = Array.from({ length: 10 }, (_, value) => selectInitialCyclonePosition(catalog, {
    randomUint32Pair: () => [value, value],
  }));
  assert.deepEqual([...new Set(selected.map(({ paletteFamily }) => paletteFamily))], startupPaletteFamilies);
  assert.deepEqual([...new Set(selected.map(({ selectionId }) => selectionId))].sort(),
    [...startupSelections.map(({ id }) => id)].sort());
});

test("accepts an explicit chunk and frame for deterministic browser proof", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    search: "?chunk=23&frame=449&palette=green",
  }), {
    paletteFamily: "green",
    chunkIndex: 23,
    frameIndex: 449,
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
