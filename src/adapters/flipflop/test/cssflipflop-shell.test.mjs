import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapterRoot = new URL("../", import.meta.url);

test("product shell stays renderer-clean", async () => {
  const [html, client, styles] = await Promise.all([
    readFile(new URL("index.html", adapterRoot), "utf8"),
    readFile(new URL("src/cssflipflop/client.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/cssflipflop/styles.css", adapterRoot), "utf8"),
  ]);
  assert.doesNotMatch(html, /<(?:main|canvas)\b/u);
  assert.doesNotMatch(client, /(?:WebGL|WebGPU|CanvasRenderingContext|createElement\(["']canvas)/u);
  assert.doesNotMatch(client, /requestAnimationFrame/u);
  assert.doesNotMatch(styles, /(?:clip-path|mask-image|filter:|box-shadow|text-shadow)/u);
  assert.match(client, /mountPolyMorphModel/u);
  assert.match(client, /createPolyMorphPlaybackRuntime/u);
  assert.match(client, /setTimeout\(tick, Math\.max\(1, Math\.ceil\(nextFrameTime - elapsed\)\)\)/u);
});
