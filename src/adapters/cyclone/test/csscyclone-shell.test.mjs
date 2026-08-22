import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapter = new URL("../", import.meta.url);

test("uses the shared css.graphics examples shell without alternate renderers", async () => {
  const [html, client, preparedDom, playback, stream, worker, styles] = await Promise.all([
    readFile(new URL("index.html", adapter), "utf8"),
    readFile(new URL("src/csscyclone/client.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedDom.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedPlayback.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedStream.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/preparedBlockWorker.mjs", adapter), "utf8"),
    readFile(new URL("src/csscyclone/styles.css", adapter), "utf8"),
  ]);
  assert.match(html, /<body class="loading">/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.doesNotMatch(html, /site-header|iframe/iu);
  assert.doesNotMatch(html, /<canvas\b|<svg\b[^>]*class="scene|controls|button/u);
  assert.match(preparedDom, /mountPolyMorphModel/u);
  assert.match(preparedDom, /model\.render\.leaves\.every\(\(leaf\) => leaf\.strategy === "solid-triangle"\)/u);
  assert.match(preparedDom, /host\.append\(mounted\.cameraElement\)/u);
  assert.match(playback, /createPolyMorphPreparedDomTarget/u);
  assert.match(styles, /\.example-stage\s*\{[^}]*background:\s*linear-gradient\(180deg, #0b1119 0%, #000 100%\);/su);
  assert.match(styles, /\.example-stage > \.polycss-camera\s*\{[^}]*background:\s*transparent;/su);
  assert.match(styles, /\.example-stage > \.polycss-camera\s*\{[^}]*perspective:\s*var\(--cyclone-perspective\);/su);
  assert.match(
    styles,
    /\.example-stage > \.polycss-camera > \.polycss-scene\s*\{[^}]*transform:\s*translateZ\(var\(--cyclone-perspective\)\)\s*matrix3d\(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1\);/su,
  );
  assert.doesNotMatch(styles, /background-image/u);
  assert.match(styles, /background-color:\s*transparent/u);
  assert.match(styles, /\.example-stage > \.polycss-camera :is\(u, b\)/u);
  assert.match(styles, /\.example-stage > \.polycss-camera u\s*\{[^}]*corner-top-left-shape:\s*round;/su);
  assert.match(styles, /\.example-stage > \.polycss-camera u\s*\{[^}]*corner-top-right-shape:\s*round;/su);
  assert.doesNotMatch(styles, /\.example-stage > \.polycss-camera :is\(u, b\)\s*\{[^}]*corner-top-left-shape:/su);
  assert.doesNotMatch(styles, /color-mix|--cyclone-tone/u);
  assert.match(preparedDom, /cameraElement\.style\.removeProperty\("perspective"\)/u);
  assert.match(preparedDom, /sceneElement\.style\.removeProperty\("transform"\)/u);
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
