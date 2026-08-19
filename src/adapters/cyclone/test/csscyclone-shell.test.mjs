import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapter = new URL("../", import.meta.url);

test("uses the cssGraphics shell without product UI or alternate renderers", async () => {
  const [html, client, playback, styles] = await Promise.all([
    readFile(new URL("index.html", adapter), "utf8"),
    readFile(new URL("src/csscyclone/client.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedPlayback.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/styles.css", adapter), "utf8"),
  ]);
  assert.match(html, /class="site-wordmark-svg" viewBox="0 0 190 30"/u);
  assert.match(html, /<nav class="site-actions" aria-label="Scene actions">/u);
  assert.doesNotMatch(html, /<main\b/u);
  assert.doesNotMatch(html, /<canvas\b|<svg\b[^>]*class="scene|controls|button/u);
  assert.match(client, /mountPolyMorphModel/u);
  assert.match(playback, /createPolyMorphPreparedDomTarget/u);
  assert.match(styles, /\.site-wordmark-svg\s*\{[^}]*width:\s*190px;/su);
  assert.match(styles, /\.site-actions\s*\{/u);
  assert.equal(
    [...styles.matchAll(/background: linear-gradient\(180deg, #0b1119 0%, #000 100%\);/gu)].length,
    2,
  );
  assert.match(styles, /body > \.polycss-camera\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /background-image:\s*var\(--cyclone-lighting-atlas\)/u);
  assert.doesNotMatch(styles, /color-mix|--cyclone-tone/u);
  assert.match(playback, /deadline-setTimeout-requestAnimationFrame-prepared-publication/u);
  assert.doesNotMatch(`${client}\n${playback}`, /WebGL|CanvasRenderingContext/u);
  assert.doesNotMatch(styles, /filter:\s*(?:blur|drop-shadow)|box-shadow|clip-path/u);
});
