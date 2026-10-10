import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  CSSSATURN_CAP_FACE_COUNT,
  CSSSATURN_GLOBE_FACE_COUNT,
  CSSSATURN_MOONS,
  CSSSATURN_SCENE_HTML,
} from "../src/csssaturn/sceneMarkup.mjs";

const adapterRoot = resolve(import.meta.dirname, "..");

test("scene retains the pen's layers, faces and moons", () => {
  assert.equal(CSSSATURN_GLOBE_FACE_COUNT, 448);
  assert.equal(CSSSATURN_CAP_FACE_COUNT, 4);
  assert.deepEqual([...CSSSATURN_MOONS], ["Mimas", "Enceladus", "Tethys", "Dione", "Rhea"]);
  assert.equal(CSSSATURN_SCENE_HTML.match(/class="layer"/gu)?.length, 6);
  assert.equal(CSSSATURN_SCENE_HTML.match(/<s><\/s>/gu)?.length, 448 + 4 + 2 + 2);
  assert.equal(CSSSATURN_SCENE_HTML.match(/<s class="(?:fill|limb)"><\/s>/gu)?.length, 2);
  assert.equal(CSSSATURN_SCENE_HTML.match(/class="rings (?:far|near)"/gu)?.length, 2);
  assert.equal(CSSSATURN_SCENE_HTML.match(/<div class="orbit"><i><\/i><div><span>[A-Z][a-z]+<\/span><\/div><\/div>/gu)?.length, 5);
  assert.equal(CSSSATURN_SCENE_HTML.match(/class="zoom"/gu)?.length, 1);
});

test("adapter carries the scene without the pen's header and switches", async () => {
  const [html, css, client, sourceLockText] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssaturn/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/csssaturn/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "notes/source-lock.json"), "utf8"),
  ]);
  const sourceLock = JSON.parse(sourceLockText);

  assert.doesNotMatch(`${html}\n${CSSSATURN_SCENE_HTML}`, /<header|<nav|<label|<input|<canvas|<img|<svg/iu);
  assert.doesNotMatch(css, /:checked|show-|\[for=|prefers-reduced-motion/u);
  assert.match(css, /^\.csssaturn-stage \{$/mu);
  assert.equal(css.match(/^[^\s@/}][^{]*\{$/gmu)?.length, 1);
  for (const [, name] of css.matchAll(/@keyframes ([\w-]+)/gu)) {
    assert.match(name, /^csssaturn-/u, name);
  }
  // The site build's CSS minifier folds an `animation-timeline` into the `animation` declared beside it, which no
  // browser reads, and drops `scale`, `rotate` or `translate` declared beside a `transform` it can parse.
  for (const declarations of css.split(/[{}]/u)) {
    if (/animation-timeline:/u.test(declarations)) assert.doesNotMatch(declarations, /animation:/u, declarations);
    if (/(?:^|[\s;])transform:(?![^;]*var\()/u.test(declarations)) {
      assert.doesNotMatch(declarations, /(?:^|[\s;])(?:scale|rotate|translate):/u, declarations);
    }
  }
  assert.match(client, /runtimeFrameConstruction:\s*false/u);
  assert.equal(sourceLock.schema, "csssaturn-source-lock@1");
  assert.match(sourceLock.pen.url, /^https:\/\/codepen\.io\//u);
  assert.equal(sourceLock.page.url, "https://css.earth/saturn/");
  assert.deepEqual(
    sourceLock.images.map(({ url }) => url).sort(),
    [...new Set([...css.matchAll(/url\("([^"]+)"\)/gu)].map(([, url]) => url))].sort(),
  );
  assert.equal(sourceLock.images.length, 8);
});
