import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adapterRoot = new URL("../", import.meta.url);

test("Flocks uses the production css.graphics wordmark and repository action shell", async () => {
  const html = await readFile(new URL("index.html", adapterRoot), "utf8");
  assert.match(html, /<body class="loading">/u);
  assert.match(html, /<h1 class="site-wordmark-heading">/u);
  assert.match(html, /class="site-wordmark-svg"/u);
  assert.match(html, /class="site-wordmark-css">css\.<\/tspan><tspan class="site-wordmark-graphics">graphics<\/tspan><tspan class="site-wordmark-path">\/flocks/u);
  assert.match(html, /<nav class="site-actions" aria-label="Scene actions">/u);
  assert.match(html, /class="site-action-icon-only" href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
  assert.match(html, /aria-label="View cssGraphics on GitHub" title="View cssGraphics on GitHub"/u);
  assert.doesNotMatch(html, /site-source|flowerbox/iu);
});

test("Flocks shell CSS matches the production responsive, focus, and stacking contract", async () => {
  const css = await readFile(new URL("src/cssflocks/styles.css", adapterRoot), "utf8");
  assert.match(css, /\.site-header\s*\{[^}]*height:\s*50px;[^}]*padding:\s*0 12px 0 16px;[^}]*pointer-events:\s*none;/su);
  assert.match(css, /\.site-wordmark-svg\s*\{[^}]*width:\s*190px;[^}]*height:\s*30px;/su);
  assert.match(css, /\.site-wordmark-css\s*\{\s*font-weight:\s*500;/u);
  assert.match(css, /\.site-wordmark-graphics\s*\{\s*font-weight:\s*200;/u);
  assert.match(css, /\.site-wordmark-path\s*\{\s*font-weight:\s*100;/u);
  assert.match(css, /\.site-wordmark:focus-visible\s*\{[^}]*outline:\s*1px solid currentColor;[^}]*outline-offset:\s*4px;/su);
  assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*?\.site-wordmark-svg\s*\{\s*width:\s*176px;/u);
  assert.match(css, /@media \(max-width:\s*390px\)[\s\S]*?\.site-wordmark-svg\s*\{\s*width:\s*148px;/u);
  assert.doesNotMatch(css, /site-source|flowerbox/iu);
});

test("Flocks runtime keeps the prepared wrapper temporary and publishes currentColor on roots", async () => {
  const scene = await readFile(new URL("src/cssflocks/polycssScene.mjs", adapterRoot), "utf8");
  const playback = await readFile(new URL("src/cssflocks/preparedPlayback.mjs", adapterRoot), "utf8");
  const css = await readFile(new URL("src/cssflocks/styles.css", adapterRoot), "utf8");
  assert.match(scene, /mounted\.modelElement\.remove\(\)/u);
  assert.match(scene, /mounted\.sceneElement\.append\(element\)/u);
  assert.match(playback, /element\.style\.color = color/u);
  assert.match(css, /background-color: currentColor/u);
  assert.match(css, /body > \.polycss-camera > \.polycss-scene\s*\{[^}]*display:\s*contents;[^}]*transform-style:\s*preserve-3d;/su);
  assert.match(css, /body > \.polycss-camera > \.polycss-scene > div\s*\{[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*translate:\s*0 0 calc\(var\(--flocks-perspective\) - 568px\);[^}]*scale:\s*1 -1 1;[^}]*transform-style:\s*preserve-3d;/su);
  for (const percentage of [78, 90, 82, 96, 86]) {
    assert.match(css, new RegExp(`background-color: color-mix\\(in srgb, currentColor ${percentage}%, black\\)`, "u"));
  }
  assert.doesNotMatch(css, /\.polycss-scene > div > :nth-child\([^)]*\)\s*\{[^}]*opacity:/su);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?\s*:|filter\s*:|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode/iu);
});
