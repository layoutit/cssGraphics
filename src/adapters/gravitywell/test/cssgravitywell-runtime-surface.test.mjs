import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");

test("public product slug is gravitywell everywhere", async () => {
  const files = [
    resolve(repositoryRoot, "package.json"),
    resolve(adapterRoot, "index.html"),
    resolve(adapterRoot, "README.md"),
    resolve(adapterRoot, "vite.config.mjs"),
    resolve(adapterRoot, "src/cssgravitywell/client.mjs"),
    resolve(adapterRoot, "src/cssgravitywell/styles.css"),
    resolve(adapterRoot, "tools/prepare-cssgravitywell.mjs"),
    resolve(adapterRoot, "tools/smoke-browser.mjs"),
  ];
  const source = (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /gravity-well/u);
  assert.match(source, /https:\/\/css\.graphics\/gravitywell\//u);
  assert.match(source, /site-wordmark-path">\/gravitywell/u);
  assert.match(source, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/u);
  assert.match(source, /base:\s*deployBuild \? "\/gravitywell\/" : "\/"/u);
  assert.match(source, /identity\.id !== "gravitywell"/u);
  assert.match(source, /<body class="loading">/u);
  assert.match(source, /body\.loading::after/u);
  assert.match(source, /setStatus\("ready"\)/u);
  assert.match(source, /"dev:gravitywell"/u);
  assert.match(source, /prepare:gravitywell:artifact/u);
  assert.match(source, /CSSGRAVITYWELL_DEPLOY_BUILD=1 pnpm build:gravitywell/u);
});

test("proof tools use the canonical gravitywell route", async () => {
  const trace = await readFile(resolve(adapterRoot, "tools/trace-frame-work.mjs"), "utf8");
  const oracle = await readFile(resolve(adapterRoot, "tools/oracle/run-visual-oracle.mjs"), "utf8");
  assert.match(trace, /127\.0\.0\.1:5174\/gravitywell\//u);
  assert.match(trace, /cssgravitywell-steady-playback-start/u);
  assert.match(trace, /analyzeTrace/u);
  assert.match(trace, /noScheduledTransformBlockWait/u);
  assert.match(trace, /untouchedBeforeMeasurement:\s*true/u);
  assert.match(trace, /noUntouchedPlaybackActivationWait/u);
  assert.match(trace, /noUntouchedPlaybackFreezeGap/u);
  assert.match(trace, /noFrameSleuthFreezeGap/u);
  assert.match(oracle, /127\.0\.0\.1:\$\{port\}\/gravitywell\//u);
});

test("product runtime has one retained DOM renderer and no forbidden geometry route", async () => {
  const files = [
    "src/cssgravitywell/client.mjs",
    "src/cssgravitywell/preparedAssets.mjs",
    "src/cssgravitywell/preparedPlayback.mjs",
    "src/cssgravitywell/styles.css",
  ];
  const source = (await Promise.all(files.map((path) => readFile(resolve(adapterRoot, path), "utf8")))).join("\n");
  for (const forbidden of [
    /createElement\(["']canvas["']\)/u,
    /WebGL/u,
    /WebGPU/u,
    /THREE\./u,
    /clip-path\s*:/u,
    /mask-image\s*:/u,
    /requestAnimationFrame[^\n]+(?:geometry|normal|matrix)/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /createPolyMorphPreparedDomTarget/u);
  assert.match(source, /setViewportSize/u);
  assert.match(source, /leafStyles\[leafIndex\]\.transform\s*=/u);
  assert.match(source, /changes\.transformIndices/u);
  assert.match(source, /changes\.colorIndices/u);
  assert.doesNotMatch(source, /backface-visibility:\s*visible\s*!important/u);
  assert.match(source, /runtimeGeometryConstructionCount:\s*0/u);
  assert.match(source, /runtimeAffineEvaluationCount:\s*0/u);
});

test("product frame loop publishes only separately prepared writes", async () => {
  const playback = await readFile(resolve(adapterRoot, "src/cssgravitywell/preparedPlayback.mjs"), "utf8");
  const assets = await readFile(resolve(adapterRoot, "src/cssgravitywell/preparedAssets.mjs"), "utf8");
  const preparer = await readFile(resolve(adapterRoot, "tools/prepare-cssgravitywell.mjs"), "utf8");
  const publishFrame = playback.slice(
    playback.indexOf("function publishFrame"),
    playback.indexOf("function schedule"),
  );
  const schedule = playback.slice(
    playback.indexOf("function requestPaintAlignedPublication"),
    playback.indexOf("function pause"),
  );
  const activate = assets.slice(
    assets.indexOf("activate(frameIndex)"),
    assets.indexOf("selectFrame(frameIndex)"),
  );
  assert.doesNotMatch(publishFrame, /assertStableDomIdentity/u);
  assert.doesNotMatch(publishFrame, /selectedColorRows/u);
  assert.match(schedule, /requestPaintAlignedPublication/u);
  assert.match(schedule, /nextFrameAt - readNow\(\) - schedulerLeadMilliseconds/u);
  assert.match(schedule, /requestFrame\(loop\)/u);
  assert.match(schedule, /nextFrameAt \+= frameMilliseconds/u);
  assert.doesNotMatch(activate, /new Set/u);
  assert.doesNotMatch(assets, /verifyBytes\(decoded/u);
  assert.doesNotMatch(assets, /transforms\.some/u);
  assert.doesNotMatch(preparer, /decodedSha256/u);
  assert.match(schedule, /setDelay\(\(\) =>/u);
  assert.match(playback, /deadline-setTimeout-requestAnimationFrame-prepared-publication/u);
  assert.match(assets, /frame-major-reset-delta-varint-transform-indices-then-color-indices/u);
  assert.match(assets, /decoded\.byteLength !== descriptor\.decodedByteLength/u);
  assert.match(assets, /transforms\.length !== descriptor\.transformCount/u);
  assert.match(assets, /gzip-field-major-delta-varint-fixed2-matrix-and-bank-schedule@2/u);
  assert.match(assets, /decodePreparedTransformBlock\(decoded, descriptor, playback, transformIndices\)/u);
  assert.match(assets, /decodePreparedTransformBlockIncrementally/u);
  assert.doesNotMatch(assets, /requestIdle/u);
  assert.doesNotMatch(assets, /timeRemaining/u);
  assert.match(assets, /setDelay\(resolveDelay, playback\.frameMilliseconds\)/u);
  assert.match(assets, /incrementalSliceBudgetMilliseconds/u);
  assert.match(assets, /incrementalDecodeMaximumSliceMilliseconds/u);
  assert.match(assets, /preparedCompleteBank/u);
  assert.match(assets, /Promise\.all\(remaining\.map/u);
  assert.match(assets, /preparedCssStringByteLength !== descriptor\.preparedCssStringByteLength/u);
  assert.match(assets, /frameView\.mode = "delta"/u);
  assert.match(assets, /activationWaitCount/u);
  assert.match(assets, /rectangular-profile/u);
  assert.match(playback, /lookahead:\s*true[\s\S]*incremental:\s*true[\s\S]*complete:\s*true/u);
  assert.match(preparer, /content-addressed/u);
  assert.match(preparer, /field-major fixed-point varints/u);
  assert.match(preparer, /prepared-transform-block-0/u);
});
