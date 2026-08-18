import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapterRoot = new URL("../", import.meta.url);

test("product shell stays retained-DOM and fast-path clean", async () => {
  const [html, client, styles] = await Promise.all([
    readFile(new URL("index.html", adapterRoot), "utf8"),
    readFile(new URL("src/cssplatonicfolding/client.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/cssplatonicfolding/styles.css", adapterRoot), "utf8"),
  ]);
  assert.doesNotMatch(html, /<(?:main|canvas)\b/u);
  assert.doesNotMatch(client, /(?:WebGL|WebGPU|CanvasRenderingContext|createElement\(["']canvas)/u);
  assert.doesNotMatch(styles, /(?:clip-path|mask-image|filter:|box-shadow|text-shadow|gradient\()/u);
  assert.match(client, /mountPolyMorphModel/u);
  assert.match(client, /createPolyMorphPlaybackRuntime/u);
  assert.match(client, /setTimeout\(wake/u);
  assert.doesNotMatch(client, /requestAnimationFrame/u);
});
