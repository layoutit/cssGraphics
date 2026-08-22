import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adapterRoot = new URL("../", import.meta.url);

test("Flocks uses the shared css.graphics examples shell", async () => {
  const html = await readFile(new URL("index.html", adapterRoot), "utf8");
  assert.match(html, /<body class="loading">/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.doesNotMatch(html, /site-header|iframe/iu);
});

test("Flocks CSS targets only the shared shell stage", async () => {
  const css = await readFile(new URL("src/cssflocks/styles.css", adapterRoot), "utf8");
  assert.match(css, /\.example-stage\s*\{[^}]*background:\s*#000;/su);
  assert.match(css, /\.example-stage > \.polycss-camera/u);
  assert.doesNotMatch(css, /body > \.polycss-camera|site-header|site-wordmark|site-action/iu);
});

test("Flocks runtime keeps the prepared wrapper temporary and publishes currentColor on roots", async () => {
  const scene = await readFile(new URL("src/cssflocks/polycssScene.mjs", adapterRoot), "utf8");
  const playback = await readFile(new URL("src/cssflocks/preparedPlayback.mjs", adapterRoot), "utf8");
  const css = await readFile(new URL("src/cssflocks/styles.css", adapterRoot), "utf8");
  assert.match(scene, /mounted\.modelElement\.remove\(\)/u);
  assert.match(scene, /mounted\.sceneElement\.append\(element\)/u);
  assert.match(playback, /element\.style\.color = color/u);
  assert.match(css, /background-color: currentColor/u);
  assert.match(css, /\.example-stage > \.polycss-camera > \.polycss-scene\s*\{[^}]*display:\s*contents;[^}]*transform-style:\s*preserve-3d;/su);
  assert.match(css, /\.example-stage > \.polycss-camera > \.polycss-scene > div\s*\{[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*translate:\s*0 0 calc\(var\(--flocks-perspective\) - 568px\);[^}]*scale:\s*1 -1 1;[^}]*transform-style:\s*preserve-3d;/su);
  for (const percentage of [78, 90, 82, 96, 86]) {
    assert.match(css, new RegExp(`background-color: color-mix\\(in srgb, currentColor ${percentage}%, black\\)`, "u"));
  }
  assert.doesNotMatch(css, /\.polycss-scene > div > :nth-child\([^)]*\)\s*\{[^}]*opacity:/su);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?\s*:|filter\s*:|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode/iu);
});
