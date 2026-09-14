import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  CSSLED_FACE_SIZE,
  CSSLED_RETAINED_LED_COUNT,
  CSSLED_SCENE_HTML,
} from "../src/cssled/sceneMarkup.mjs";
import {
  CSSLED_INITIAL_DARK_MS,
  CSSLED_LOOP_DURATION_MS,
  CSSLED_SOURCE_ANIMATION_DURATION_MS,
} from "../src/cssled/client.mjs";

const adapterRoot = resolve(import.meta.dirname, "..");

test("animation-only scene retains the three source LED faces", () => {
  assert.equal(CSSLED_FACE_SIZE, 9);
  assert.equal(CSSLED_RETAINED_LED_COUNT, 243);
  assert.equal(CSSLED_SCENE_HTML.match(/class="cssled-cell\b/gu)?.length, 243);
  assert.equal(CSSLED_SCENE_HTML.match(/class="cssled-grid\b/gu)?.length, 3);
  assert.equal(CSSLED_SCENE_HTML.match(/class="cssled-light\b/gu)?.length, 36);
  assert.equal(CSSLED_SCENE_HTML.match(/<u class="cssled-cell[^>]*><i><\/i><b><\/b><\/u>/gu)?.length, 243);
  assert.equal(CSSLED_SCENE_HTML.match(/\bis-active\b/gu)?.length, 47);
  assert.equal(CSSLED_SCENE_HTML.match(/\bis-repeat\b/gu)?.length, 8);
  assert.equal(CSSLED_SCENE_HTML.match(/\bis-trailing\b/gu)?.length, 49);

  assert.deepEqual(activePattern("top"), []);
  assert.deepEqual(trailPattern("top"), [
    "5:5", "4:5", "3:5", "3:6", "3:7", "4:7",
    "5:7", "6:7", "7:7", "7:6", "7:5", "7:4",
    "7:3", "6:3", "5:3", "4:3", "3:3", "2:3",
    "1:3", "1:4", "1:5", "1:6", "1:7", "1:8",
    "1:9", "2:9", "3:9", "4:9", "5:9", "6:9",
    "7:9", "8:9", "9:9", "9:8", "9:7", "9:6",
    "9:5", "9:4", "9:3", "9:2", "9:1", "8:1",
    "7:1", "6:1", "5:1", "4:1", "3:1", "2:1",
    "1:1",
  ]);
  assert.deepEqual(activePattern("front"), [
    "3:2", "4:2", "6:2", "7:2",
    "2:3", "5:3", "8:3",
    "2:4", "8:4", "2:5", "8:5",
    "3:6", "7:6", "4:7", "6:7", "5:8",
  ]);
  assert.deepEqual(activePattern("right"), [
    "1:2", "2:2", "3:2", "5:2", "6:2", "8:2", "9:2",
    "1:3", "5:3", "8:3",
    "1:4", "5:4", "8:4",
    "1:5", "5:5", "6:5", "8:5", "9:5",
    "1:6", "6:6", "9:6",
    "1:7", "6:7", "9:7",
    "1:8", "2:8", "3:8", "5:8", "6:8", "8:8", "9:8",
  ]);
});

function activePattern(face) {
  const grid = CSSLED_SCENE_HTML.match(
    new RegExp(`<pixel-grid class="cssled-grid ${face}">(?<cells>[\\s\\S]*?)<\\/pixel-grid>`, "u"),
  )?.groups?.cells;
  assert.ok(grid);
  return [...grid.matchAll(
    /class="cssled-cell c(?<column>\d) r(?<row>\d)[^"]*\bis-active\b/gu,
  )].map(({ groups }) => `${groups.column}:${groups.row}`);
}

function trailPattern(face) {
  const grid = CSSLED_SCENE_HTML.match(
    new RegExp(`<pixel-grid class="cssled-grid ${face}">(?<cells>[\\s\\S]*?)<\\/pixel-grid>`, "u"),
  )?.groups?.cells;
  assert.ok(grid);
  return [...grid.matchAll(
    /class="cssled-cell c(?<column>\d) r(?<row>\d)[^"]*\bis-trailing trail-(?<index>\d+)\b/gu,
  )]
    .sort((left, right) => Number(left.groups.index) - Number(right.groups.index))
    .map(({ groups }) => `${groups.column}:${groups.row}`);
}

test("adapter extracts only the looped animation surface", async () => {
  const [html, css, client, sourceLockText] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssled/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssled/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "notes/source-lock.json"), "utf8"),
  ]);
  const sourceLock = JSON.parse(sourceLockText);

  assert.equal(CSSLED_SOURCE_ANIMATION_DURATION_MS, 4_500);
  assert.equal(CSSLED_INITIAL_DARK_MS, 1_500);
  assert.equal(CSSLED_LOOP_DURATION_MS, 10_500);
  assert.doesNotMatch(`${html}\n${CSSLED_SCENE_HTML}`, /view-2d|view-3d|<header|<nav|<label/iu);
  assert.doesNotMatch(css, /:hover|pointer-events:\s*auto/iu);
  assert.doesNotMatch(css, /contain:\s*(?:layout|paint)/iu);
  assert.doesNotMatch(css, /url\(/iu);
  assert.match(client, /runtimeFrameConstruction:\s*false/u);
  assert.equal(sourceLock.schema, "cssled-source-lock@1");
  assert.equal(sourceLock.sourceFiles.length, 4);
  assert.match(sourceLock.reference.url, /^https:\/\/codepen\.io\//u);
});
