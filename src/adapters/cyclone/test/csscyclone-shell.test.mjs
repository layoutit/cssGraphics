import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapter = new URL("../", import.meta.url);

test("uses the cssGraphics shell without product UI or alternate renderers", async () => {
  const [html, client, playback, stream, worker, styles] = await Promise.all([
    readFile(new URL("index.html", adapter), "utf8"),
    readFile(new URL("src/csscyclone/client.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedPlayback.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedStream.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedBlockWorker.mjs", adapter), "utf8"),
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
  assert.match(styles, /body > \.polycss-camera\s*\{[^}]*perspective:\s*var\(--cyclone-perspective\);/su);
  assert.match(
    styles,
    /body > \.polycss-camera > \.polycss-scene\s*\{[^}]*transform:\s*translateZ\(var\(--cyclone-perspective\)\)\s*matrix3d\(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1\);/su,
  );
  assert.doesNotMatch(styles, /background-image/u);
  assert.match(styles, /background-color:\s*transparent/u);
  assert.match(styles, /body > \.polycss-camera :is\(u, b\)/u);
  assert.match(styles, /body > \.polycss-camera u\s*\{[^}]*corner-top-left-shape:\s*bevel;/su);
  assert.doesNotMatch(styles, /body > \.polycss-camera :is\(u, b\)\s*\{[^}]*corner-top-left-shape:/su);
  assert.doesNotMatch(styles, /color-mix|--cyclone-tone/u);
  assert.match(client, /cameraElement\.style\.removeProperty\("perspective"\)/u);
  assert.match(client, /sceneElement\.style\.removeProperty\("transform"\)/u);
  assert.match(playback, /style\.setProperty\("--cyclone-perspective"/u);
  assert.doesNotMatch(playback, /sceneElement\.style\.transform|cameraElement\.style\.perspective/u);
  assert.match(playback, /deadline-setTimeout-requestAnimationFrame-prepared-publication/u);
  assert.match(client, /blockLoader\.prime\(residentBlockIndices\)/u);
  assert.match(client, /await waitForCycloneScenePaint\(\)/u);
  assert.match(
    client,
    /player\.seekFrame\(initialBlockFrameIndex\);\s*await waitForCycloneScenePaint\(\);\s*await waitForCycloneScenePaint\(\);\s*state\.ready = true;\s*document\.body\.classList\.replace\("priming", "ready"\);/u,
  );
  assert.match(styles, /body\.priming::before/u);
  assert.match(stream, /new Worker\(new URL\("\.\/preparedBlockWorker\.mjs"/u);
  assert.match(worker, /decodeCyclonePreparedBlockIncrementally/u);
  assert.match(worker, /data\.incremental/u);
  assert.match(worker, /sliceDelayMilliseconds: 0/u);
  assert.match(stream, /\{ incremental \}/u);
  assert.match(worker, /type: "materialized-chunk"/u);
  assert.match(worker, /TRANSFORM_RESPONSE_CHUNK_TRANSFORMS = 960/u);
  assert.match(worker, /data\.incremental && transformChunkIndex \+ 1 < transformChunkCount/u);
  assert.match(worker, /setTimeout\(resolve, catalog\.frameMilliseconds\)/u);
  assert.doesNotMatch(worker, /new TextDecoder\(\)|new TextEncoder\(\)/u);
  assert.match(stream, /if \(request\.incremental\) \{\s*responseChunkQueue\.push/su);
  assert.match(stream, /acceptResponseChunk\(data, request, response, false\)/u);
  assert.match(stream, /pending\.set\(requestId, \{ resolve, reject, response: null, incremental \}\)/u);
  assert.match(stream, /workerMaterializationMaximumResponseChunkBytes/u);
  assert.match(stream, /requestIdle\(processResponseChunk, \{ timeout: 500 \}\)/u);
  assert.doesNotMatch(stream, /requestAnimationFrame\(processResponseChunk\)/u);
  assert.match(client, /schedulerMode: "continuous-raf"/u);
  assert.doesNotMatch(`${client}\n${playback}\n${stream}\n${worker}`, /WebGL|CanvasRenderingContext/u);
  assert.doesNotMatch(styles, /filter:\s*(?:blur|drop-shadow)|box-shadow|clip-path/u);
});
