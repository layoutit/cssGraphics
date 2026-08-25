// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const adapterRoot = resolve(import.meta.dirname, "..");

test("integrates Galaxy into the public landing and deploy build", async () => {
  const [projects, packageJson] = await Promise.all([
    readFile(resolve(adapterRoot, "../../../site/public/projects.json"), "utf8"),
    readFile(resolve(adapterRoot, "../../../package.json"), "utf8"),
  ]);
  const manifest = JSON.parse(projects);
  const project = manifest.projects.find(({ id }) => id === "galaxy");
  assert.equal(project?.number, 9);
  assert.equal(project?.route, "/galaxy/");
  assert.equal(project?.preview, "/landing/galaxy.webp");
  assert.match(project?.credits?.[0]?.url ?? "",
    /906693799e4fb7581436590cf84ecb2d3c9186ba\/hacks\/galaxy\.c$/u);
  assert.match(packageJson, /pnpm prepare:galaxy:artifact/u);
  assert.match(packageJson,
    /node scripts\/copy-deploy-products\.mjs[^\n]+CSSGRAPHICS_DEPLOY_BUILD=1 pnpm build:site/u);
});

test("mounts a prepared flat point graph and uses no paint-heavy runtime effects", async () => {
  const [html, main, config, client, styles, worker, stream, playback, transport, snapshotMount, prepare] =
    await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/main.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "vite.config.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/client.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/styles.css"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/preparedBlockWorker.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/preparedStream.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/preparedPlayback.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/shared/cssgalaxy/preparedBlockTransport.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "src/cssgalaxy/polycssScene.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "tools/prepare-cssgalaxy.mjs"), "utf8"),
  ]);
  assert.match(html, /<!-- cssgraphics-examples-sidebar -->/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.doesNotMatch(html, /site-header|<canvas\b|controls|button/iu);
  assert.match(main, /requireExamplesStage/u);
  assert.match(main, /mountGalaxyClient\(requireExamplesStage\(\)\)/u);
  assert.match(config, /createExamplesShellPlugin\("galaxy"\)/u);
  assert.match(config, /deployBuild \? "\/galaxy\/" : "\/"/u);
  assert.match(config, /deployBuild \? "dist\/site\/galaxy" : "dist\/galaxy-local"/u);
  assert.match(config, /cp\(resolve\(generatedPublicDir, "cssgalaxy"\), deployAssets/u);
  assert.match(config, /createGalaxyPreparedBrotliPlugin/u);
  assert.match(config, /Content-Encoding", "br"/u);
  assert.match(styles, /\.example-stage > \.polycss-camera/u);
  assert.doesNotMatch(client, /createElement|createDocumentFragment|\.dataset\b|\.id\s*=/u);
  assert.match(client, /mountPreparedGalaxySnapshot/u);
  assert.match(snapshotMount, /DOMParser/u);
  assert.match(snapshotMount, /querySelectorAll\(":scope > b"\)/u);
  assert.match(snapshotMount, /node !== stableNodes\[index\]/u);
  assert.match(snapshotMount, /createGalaxyPreparedTransformPublisher/u);
  assert.match(snapshotMount,
    /styles\[leafIndex\]\.transform = transform/u);
  assert.doesNotMatch(snapshotMount, /attributeStyleMap|CSSTransformValue|CSSTranslate/u);
  assert.doesNotMatch(snapshotMount, /createElement|createDocumentFragment/u);
  assert.match(prepare, /"<b><\/b>"\.repeat\(count\)/u);
  assert.match(prepare, /retainedPerPointWrapperCount:\s*0/u);
  assert.match(styles, /\.polycss-scene > b/u);
  assert.doesNotMatch(styles, /\.polycss-galaxy|> u/u);
  assert.match(styles,
    /--cssgalaxy-cover-scale:\s*max\(calc\(100cqw \/ 800px\), calc\(100cqh \/ 600px\)\)/u);
  assert.match(client, /selectGalaxyPreparedProfileForWindow/u);
  assert.match(client, /const galaxyCount = profile\?\.galaxyCount/u);
  assert.match(client, /const starCount = profile\?\.starCount/u);
  assert.match(client, /const pointSize = 1/u);
  assert.match(client, /const viewZoom = 1/u);
  assert.doesNotMatch(client, /URLSearchParams|location\.search|route\.(?:has|get)/u);
  assert.match(client, /cameraMode = "fixed"/u);
  assert.doesNotMatch(client, /opacityElement|colorPublicationRoot|colorProperties/u);
  assert.doesNotMatch(client, /cameraFollow|cameraTranslationElement/u);
  assert.match(prepare, /fixed-retained-camera-source-projection-in-point-transforms/u);
  assert.match(client, /const seed = profile\?\.comparisonSeed/u);
  assert.doesNotMatch(client, /crypto\.getRandomValues|cryptoRandomIndex/u);
  assert.match(prepare, /id: "desktop", galaxyCount: 3, starCount: 1500/u);
  assert.match(prepare, /id: "mobile", galaxyCount: 2, starCount: CSSGALAXY_MOBILE_STAR_COUNT/u);
  assert.match(prepare, /defaultProfile: "desktop"/u);
  assert.doesNotMatch(prepare, /sceneOpacities\.push|colors\.push/u);
  assert.doesNotMatch(prepare, /FrozenFrame|createFrozen/u);
  assert.doesNotMatch(prepare, /cameraTransforms|prepareCameraTransform/u);
  assert.match(styles, /--cssgalaxy-point-size:\s*1px/u);
  assert.match(styles, /@media \(min-resolution:\s*2dppx\)/u);
  assert.match(styles, /--cssgalaxy-point-size:\s*2px/u);
  assert.match(styles,
    /width:\s*calc\(var\(--cssgalaxy-point-size\) \/ var\(--cssgalaxy-cover-scale\)\)/u);
  assert.match(styles,
    /height:\s*calc\(var\(--cssgalaxy-point-size\) \/ var\(--cssgalaxy-cover-scale\)\)/u);
  assert.doesNotMatch(styles, /\.polycss-scene > b\s*\{[^}]*\bscale\s*:/su);
  assert.doesNotMatch(styles, /clip-path|mask(?:-image)?|filter|shadow|gradient|blend-mode/iu);
  assert.doesNotMatch(worker, /matrix3d|Math\.(?:sin|cos|sqrt|exp)/u);
  assert.match(worker, /formatGalaxyPreparedTransform/u);
  assert.match(worker, /TRANSFORM_RESPONSE_CHUNK_SIZE = 60_000/u);
  assert.match(worker, /type:\s*"materialized-transform-chunk"/u);
  assert.doesNotMatch(worker, /JSON\.parse|atob/u);
  assert.match(worker, /scheduler\?\.yield/u);
  assert.match(worker, /MAXIMUM_MATERIALIZATION_SLICE_MILLISECONDS = 2/u);
  assert.doesNotMatch(stream, /requestIdleCallback|processResponseChunk|responseChunkQueue/u);
  assert.match(stream, /createGalaxyPreparedStreamLoader/u);
  assert.match(stream, /retainedMaterializedBlockCount/u);
  assert.match(stream, /retainedMaterializedTransformBytes/u);
  assert.doesNotMatch(client, /loader\.prime\(startupWindow\)/u);
  assert.match(client, /performance\.mark\("cssgalaxy-ready"\)/u);
  assert.match(client,
    /state\.pause = \(\) =>[\s\S]*state\.resume = \(\) =>[\s\S]*state\.destroy = \(\) =>/u);
  assert.match(client, /player\.destroy\(\);\s*loader\.destroy\(\);\s*dom\.destroy\(\)/u);
  assert.match(client,
    /performance\.mark\("cssgalaxy-ready"\);\s*if \(shouldPlay\) player\.resume\(\);\s*player\.startLookahead\(\)/u);
  assert.doesNotMatch(client, /lookaheadPrefetcher/u);
  assert.doesNotMatch(stream, /transportPack|encodedPack|transportByteOffset/u);
  assert.match(transport, /const MAGIC = "CSGLXYB9"/u);
  assert.doesNotMatch(transport, /"uint24-le"/u);
  assert.doesNotMatch(transport, /matrix3d|formatMatrix|Math\.(?:sin|cos|sqrt|exp)/u);
  assert.match(prepare, /CSSGALAXY_BANK_ENCODING/u);
  assert.match(prepare, /ensureGalaxySourceFile/u);
  assert.match(prepare, /encodeGalaxyPreparedBank/u);
  assert.match(prepare, /twenty-four-second-banks/u);
  assert.doesNotMatch(prepare, /blocksPerTransportPack|transportPack|concatenated-content/u);
  assert.match(stream, /transformChunks|materialized-transform-chunk/u);
  assert.match(stream, /decodedBankTransferCopyCount/u);
  assert.match(stream, /fetchHttpExpandedBank/u);
  assert.doesNotMatch(stream, /transformDictionary/u);
  assert.match(client, /cssgalaxy-prepared-scene@5/u);
  assert.doesNotMatch(styles, /--cssgalaxy-leaf-color/u);
  assert.match(playback, /transformPublisher\.publishTransform/u);
  assert.doesNotMatch(playback, /--cssgalaxy-leaf-color|style\.translate\s*=/u);
  assert.doesNotMatch(styles, /--cssgalaxy-position/u);
  assert.doesNotMatch(playback, /Math\.floor\(\(now - baseNow\)/u);
  assert.match(playback, /publishedStreamFrame \+ 1/u);
  assert.match(playback, /isReformationFrame && reformationOffset === 0/u);
  assert.doesNotMatch(playback, /-step-/u);
});
