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
  assert.equal(CSSLED_SCENE_HTML.match(/\bis-active\b/gu)?.length, 40);
  assert.equal(CSSLED_SCENE_HTML.match(/\bis-repeat\b/gu)?.length, 20);
});

test("adapter extracts only the looped animation surface", async () => {
  const [html, css, client, sourceLockText] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssled/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssled/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "notes/source-lock.json"), "utf8"),
  ]);
  const sourceLock = JSON.parse(sourceLockText);

  assert.equal(CSSLED_SOURCE_ANIMATION_DURATION_MS, 4_500);
  assert.equal(CSSLED_INITIAL_DARK_MS, 400);
  assert.equal(CSSLED_LOOP_DURATION_MS, 9_400);
  assert.doesNotMatch(`${html}\n${CSSLED_SCENE_HTML}`, /view-2d|view-3d|<header|<nav|<label/iu);
  assert.doesNotMatch(css, /:hover|pointer-events:\s*auto/iu);
  assert.doesNotMatch(css, /contain:\s*(?:layout|paint)/iu);
  assert.doesNotMatch(css, /url\(/iu);
  assert.match(client, /runtimeFrameConstruction:\s*false/u);
  assert.equal(sourceLock.schema, "cssled-source-lock@1");
  assert.equal(sourceLock.sourceFiles.length, 4);
  assert.match(sourceLock.reference.url, /^https:\/\/codepen\.io\//u);
});
