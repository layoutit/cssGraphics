// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapterRoot = new URL("../", import.meta.url);

test("Luminet owns the shared css.graphics shell at its canonical route", async () => {
  const [html, config, main] = await Promise.all([
    readFile(new URL("index.html", adapterRoot), "utf8"),
    readFile(new URL("vite.config.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/main.mjs", adapterRoot), "utf8"),
  ]);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /https:\/\/css\.graphics\/luminet\//u);
  assert.match(html, /<meta name="robots" content="index, follow">/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.match(config, /createExamplesShellPlugin\("luminet"\)/u);
  assert.match(config, /deployBuild \? "\/luminet\/" : "\/"/u);
  assert.match(main, /site\/examples-shell-client\.mjs/u);
});

test("Luminet keeps one retained point topology and no alternate renderer", async () => {
  const [css, scene, client, presentation, stream] = await Promise.all([
    readFile(new URL("src/cssblackhole/styles.css", adapterRoot), "utf8"),
    readFile(new URL("src/cssblackhole/polycssScene.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/cssblackhole/client.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/cssblackhole/stagePresentation.mjs", adapterRoot), "utf8"),
    readFile(new URL("src/cssblackhole/preparedStream.mjs", adapterRoot), "utf8"),
  ]);
  assert.match(css, /\.polycss-scene > b/u);
  assert.doesNotMatch(css, /\.example-stage\s*\{/u);
  assert.match(css, /--cssblackhole-presentation-scale/u);
  assert.match(css, /--cssblackhole-presentation-offset-x/u);
  assert.match(css, /--cssblackhole-presentation-offset-y/u);
  assert.match(css, /--cssblackhole-point-size:\s*2px/u);
  assert.match(css,
    /width:\s*calc\(var\(--cssblackhole-point-size\) \/ var\(--cssblackhole-presentation-scale\)\)/u);
  assert.match(css,
    /height:\s*calc\(var\(--cssblackhole-point-size\) \/ var\(--cssblackhole-presentation-scale\)\)/u);
  assert.match(css, /transform-origin:\s*0 0/u);
  assert.doesNotMatch(css, /--cssblackhole-cover-scale|100cqw|100cqh/u);
  assert.doesNotMatch(css, /clip-path|mask(?:-image)?\s*:|gradient\(/iu);
  assert.doesNotMatch(`${scene}\n${client}`,
    /createElement\(["']canvas|createElementNS|<svg|webgl/iu);
  assert.match(client, /installBlackHoleStagePresentation/u);
  assert.match(presentation, /CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS = 90/u);
  assert.match(presentation, /Math\.min\(width \/ paddedWidth, height \/ paddedHeight\)/u);
  assert.match(presentation, /new ResizeObserverImpl\(refresh\)/u);
  assert.match(presentation, /presentationFit: "prepared-content-bounds-contain"/u);
  assert.match(presentation, /observer\?\.disconnect\(\)/u);
  assert.match(scene, /retainedPointLeafCount/u);
  assert.match(client, /runtimePhysicsCount: 0/u);
  assert.match(client, /export function mountBlackHoleClient\(host\)/u);
  assert.doesNotMatch(client, /export async function mountBlackHoleClient/u);
  assert.match(client, /main\(\)\.catch/u);
  assert.match(client, /return controller/u);
  assert.match(client, /const initialBlockPromise = loader\.load\(0, \{ eager: true \}\)/u);
  assert.match(client, /const snapshotHtml = await loadBlackHolePreparedSnapshot\(catalog\)/u);
  assert.match(client, /cssblackhole-snapshot-mounted/u);
  assert.match(client, /const initialBlock = await initialBlockPromise/u);
  assert.match(client, /pause\(\)/u);
  assert.match(client, /resume\(\)/u);
  assert.match(client, /destroy\(\)/u);
  assert.doesNotMatch(stream, /requestIdleCallback|processResponseChunk|responseChunkQueue/u);
});
