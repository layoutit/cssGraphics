#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const deploy = process.argv.includes("--deploy");
const outputRoot = resolve(repositoryRoot, "bench/results/csscityflow", deploy ? "deploy" : "smoke");
const externalUrl = process.env.CSSCITYFLOW_SMOKE_URL;
const port = externalUrl ? null : await freePort();
const origin = externalUrl ? new URL(externalUrl).origin : `http://127.0.0.1:${port}`;
const route = externalUrl ?? `${origin}/cityflow/`;
let server = null;
let serverOutput = "";
if (!externalUrl) {
  if (deploy) {
    server = createStaticDeployServer(resolve(repositoryRoot, "dist/site"));
    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolveListen);
    });
  } else {
    server = spawn("pnpm", [
      "exec", "vite", "--config", resolve(adapterRoot, "vite.config.mjs"),
      "--host", "127.0.0.1", "--port", String(port), "--strictPort",
    ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
    server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  }
}

let browser;
try {
  await mkdir(outputRoot, { recursive: true });
    if (server && !deploy) await waitFor(() => serverOutput.includes("Local:"), 20_000);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktop = await capture({
    profile: "desktop", width: 1280, height: 720, bankId: "desktop", modelId: "cityflow",
    boxes: 200, leaves: 600, visibleBoxRange: [166, 187], visibleFaceRange: [498, 561],
    initialVisibleBoxes: 170, initialVisibleFaces: 510, initialVisibilityWrites: 90,
    staticSuppressedBoxes: 5, staticSuppressedFaces: 15,
    maximumShapeWrites: 187, maximumColorWrites: 271,
    sideDepthMaximum: 0.28, sideDepthOverrides: 19, url: route,
  });
  const wide = await capture({
    profile: "wide", width: 3200, height: 900, bankId: "desktop", modelId: "cityflow",
    boxes: 200, leaves: 600, visibleBoxRange: [166, 187], visibleFaceRange: [498, 561],
    initialVisibleBoxes: 170, initialVisibleFaces: 510, initialVisibilityWrites: 90,
    staticSuppressedBoxes: 5, staticSuppressedFaces: 15,
    maximumShapeWrites: 187, maximumColorWrites: 271,
    sideDepthMaximum: 0.28, sideDepthOverrides: 19, url: route,
  });
  const mobile = await capture({
    profile: "mobile", width: 390, height: 844, bankId: "mobile", modelId: "cityflow-mobile",
    boxes: 100, leaves: 300, visibleBoxRange: [100, 100], visibleFaceRange: [300, 300],
    initialVisibleBoxes: 100, initialVisibleFaces: 300, initialVisibilityWrites: 0,
    staticSuppressedBoxes: 0, staticSuppressedFaces: 0,
    maximumShapeWrites: 100, maximumColorWrites: 159,
    sideDepthDefault: 0.28, sideDepthMaximum: 0.28, sideDepthOverrides: 0, url: route,
  });
  const home = deploy ? await captureHome({ width: 1280, height: 720, url: `${origin}/` }) : null;
  const report = { schema: "csscityflow-browser-smoke@4", route, deploy, desktop, wide, mobile, home };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (deploy && server) await new Promise((resolveClose) => server.close(resolveClose));
  else server?.kill("SIGTERM");
}

async function capture({
  profile,
  width,
  height,
  bankId,
  modelId,
  boxes,
  leaves,
  visibleBoxRange,
  visibleFaceRange,
  initialVisibleBoxes,
  initialVisibleFaces,
  initialVisibilityWrites,
  staticSuppressedBoxes,
  staticSuppressedFaces,
  maximumShapeWrites,
  maximumColorWrites,
  sideDepthMaximum,
  sideDepthDefault = 0.1,
  sideDepthOverrides,
  url,
}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const requests = [];
  const preparedResponses = [];
  const failedResponses = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/csscityflow/")) {
      preparedResponses.push({
        path: pathname,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? null,
      });
    }
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready ||
    globalThis.__csscityflow?.errors?.length, null, { timeout: 30_000 });
  const before = await page.evaluate(() => {
    const state = globalThis.__csscityflow;
    const shapes = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
    const leaves = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")];
    const camera = document.querySelector(".example-stage>.polycss-camera");
    const stage = document.querySelector(".example-stage");
    const renderNodes = camera ? [camera, ...camera.querySelectorAll("*")] : [];
    const stageBounds = stage?.getBoundingClientRect();
    const cameraStyle = camera ? getComputedStyle(camera) : null;
    const wideProjection = stageBounds ? stageBounds.width > stageBounds.height * 2 : false;
    const expectedCameraHeight = stageBounds ?
      (wideProjection ? stageBounds.width : stageBounds.height) : null;
    const expectedCameraTop = stageBounds ?
      (wideProjection ? stageBounds.height - stageBounds.width / 2 : 0) : null;
    const expectedPerspective = expectedCameraHeight === null ? null :
      expectedCameraHeight / (2 * Math.tan(Math.PI / 12));
    const actualCameraHeight = cameraStyle ? Number.parseFloat(cameraStyle.height) : null;
    const actualCameraTop = cameraStyle ? Number.parseFloat(cameraStyle.top) : null;
    const actualPerspective = cameraStyle ? Number.parseFloat(cameraStyle.perspective) : null;
    let stable = true;
    try { state?.dom?.assertStableDomIdentity(); } catch { stable = false; }
    return {
      status: document.body.className,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      ready: state?.ready,
      bankId: state?.bankId,
      errors: state?.errors ?? [],
      stable,
      shapeCount: shapes.length,
      leafCount: leaves.length,
      renderNodeCount: renderNodes.length,
      classAttributeCount: renderNodes.filter((element) => element.hasAttribute("class")).length,
      dataAttributeCount: renderNodes.reduce((count, element) => count +
        [...element.attributes].filter(({ name }) => name.startsWith("data-")).length, 0),
      ariaAttributeCount: renderNodes.reduce((count, element) => count +
        [...element.attributes].filter(({ name }) => name.startsWith("aria-")).length, 0),
      cameraInlineStyleAttributeCount: camera?.hasAttribute("style") ? 1 : 0,
      cameraInlineCustomPropertyCount: camera ? [...camera.style]
        .filter((name) => name.startsWith("--")).length : 0,
      sceneInlineStyleAttributeCount: camera?.firstElementChild?.hasAttribute("style") ? 1 : 0,
      sceneInlineTransformCount: camera?.firstElementChild?.style.transform === "" ? 0 : 1,
      morphClassCount: renderNodes.filter((element) =>
        [...element.classList].some((name) => name.startsWith("polycss-morph") ||
          name === "polycss-mesh")).length,
      modelRootCount: document.querySelectorAll(
        ".example-stage>.polycss-camera>.polycss-scene>.polycss-morph-model",
      ).length,
      projection: {
        wide: wideProjection,
        expectedCameraHeight,
        expectedCameraTop,
        expectedPerspective,
        actualCameraHeight,
        actualCameraTop,
        actualPerspective,
        matches: expectedCameraHeight !== null &&
          Math.abs(actualCameraHeight - expectedCameraHeight) < 0.02 &&
          Math.abs(actualCameraTop - expectedCameraTop) < 0.02 &&
          Math.abs(actualPerspective - expectedPerspective) < 0.02,
      },
      backfaceInlineStyleCount: leaves.filter((leaf) =>
        leaf.style.backfaceVisibility !== "" || leaf.style.webkitBackfaceVisibility !== "").length,
      topBackfaceVisibleCount: shapes.filter((shape) =>
        getComputedStyle(shape.children[0]).backfaceVisibility === "visible").length,
      sideBackfaceHiddenCount: shapes.reduce((count, shape) => count +
        [...shape.children].slice(1).filter((leaf) =>
          getComputedStyle(leaf).backfaceVisibility === "hidden").length, 0),
      hiddenShapeCount: shapes.filter((shape) => getComputedStyle(shape).visibility === "hidden").length,
      hiddenLeafCount: leaves.filter((leaf) => getComputedStyle(leaf).visibility === "hidden").length,
      displayNoneShapeCount: shapes.filter((shape) => getComputedStyle(shape).display === "none").length,
      zeroOpacityShapeCount: shapes.filter((shape) => getComputedStyle(shape).opacity === "0").length,
      zeroOpacityLeafCount: leaves.filter((leaf) => getComputedStyle(leaf).opacity === "0").length,
      firstLeafColor: leaves[0] ? getComputedStyle(leaves[0]).backgroundColor : null,
      whiteLeafCount: leaves.filter((leaf) =>
        getComputedStyle(leaf).backgroundColor === "rgb(255, 255, 255)").length,
      canvasCount: document.querySelectorAll("canvas").length,
      svgSceneCount: document.querySelectorAll(".polycss-camera svg").length,
      animationName: shapes[0] ? getComputedStyle(shapes[0]).animationName : null,
      transformAnimationCount: shapes.reduce((sum, shape) =>
        sum + shape.getAnimations().filter(({ effect }) =>
          effect instanceof KeyframeEffect && effect.target === shape).length, 0),
      transforms: shapes.slice(0, 40).map((shape) => getComputedStyle(shape).transform),
      atlasConstructions: state?.mounted?.stats?.atlasConstructions,
      atlasRedraws: state?.mounted?.stats?.atlasRedraws ?? 0,
      player: state?.player?.stats(),
      orbitStatePresent: Object.hasOwn(state ?? {}, "orbit"),
      orbitDataset: document.querySelector(".example-stage")?.dataset.csscityflowOrbit ?? null,
      draggingDataset: document.querySelector(".example-stage")?.dataset.csscityflowDragging ?? null,
      camera: { ...state?.mounted?.camera?.state },
      metadata: state?.metadata,
    };
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const shapes = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
    return {
      transforms: shapes.slice(0, 40).map((shape) => getComputedStyle(shape).transform),
      player: globalThis.__csscityflow?.player?.stats(),
      camera: { ...globalThis.__csscityflow?.mounted?.camera?.state },
    };
  });
  const motion = await page.evaluate(async () => {
    const player = globalThis.__csscityflow?.player;
    if (!player) return {
      missingPlayer: true,
      state: globalThis.__csscityflow ?? null,
      bodyClass: document.body.className,
    };
    const samples = [];
    for (let index = 0; index < 90; index += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      const stats = player.stats();
      samples.push({
        frameIndex: stats.frameIndex,
        frameCount: stats.frameCount,
        publicationCount: stats.publicationCount,
        shapeStyleWrites: stats.lastPublication.shapeStyleWrites,
      });
    }
    const transitions = samples.slice(1).map((sample, index) => ({
      delta: (sample.frameIndex - samples[index].frameIndex + sample.frameCount) % sample.frameCount,
      publicationDelta: sample.publicationCount - samples[index].publicationCount,
      shapeStyleWrites: sample.shapeStyleWrites,
    }));
    const publishedTransitions = transitions.filter(({ publicationDelta }) => publicationDelta > 0);
    return {
      callbackCount: samples.length,
      publishedTransitionCount: publishedTransitions.length,
      stationaryCallbackCount: transitions.length - publishedTransitions.length,
      skippedTransitionCount: publishedTransitions.filter(({ delta, publicationDelta }) =>
        delta !== 1 || publicationDelta !== 1).length,
      zeroShapeStylePublicationCount: publishedTransitions.filter(({ shapeStyleWrites }) =>
        shapeStyleWrites === 0).length,
      finalPlayer: player.stats(),
    };
  });
  const changedTransformCount = before.transforms.reduce((sum, transform, index) =>
    sum + Number(transform !== after.transforms[index]), 0);
  const movingFrameBefore = await page.screenshot();
  await page.waitForTimeout(250);
  const movingFrameAfter = await page.screenshot();
  const movingFrameBytesIdentical = movingFrameBefore.equals(movingFrameAfter);
  const inputCameraBefore = await page.evaluate(() => ({
    ...globalThis.__csscityflow?.mounted?.camera?.state,
  }));
  const stageBox = await page.locator(".example-stage").boundingBox();
  if (!stageBox) throw new Error(`Cityflow ${profile} stage has no pointer target`);
  await page.mouse.move(stageBox.x + stageBox.width * 0.5, stageBox.y + stageBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.8, stageBox.y + stageBox.height * 0.5,
    { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -160);
  const inputResult = await page.evaluate(() => ({
    camera: { ...globalThis.__csscityflow?.mounted?.camera?.state },
    player: globalThis.__csscityflow?.player?.stats(),
    orbitStatePresent: Object.hasOwn(globalThis.__csscityflow ?? {}, "orbit"),
    orbitDataset: document.querySelector(".example-stage")?.dataset.csscityflowOrbit ?? null,
    draggingDataset: document.querySelector(".example-stage")?.dataset.csscityflowDragging ?? null,
    shapeCount: document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div").length,
    leafCount: document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b").length,
  }));
  const sourceRoundTrip = await page.evaluate(async () => {
    const player = globalThis.__csscityflow?.player;
    player.pause();
    const sourcePlayer = player.seekSourceFrame(0);
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const source = {
      player: sourcePlayer,
      hiddenShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).visibility === "hidden").length,
      hiddenLeafCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")]
        .filter((leaf) => getComputedStyle(leaf).visibility === "hidden").length,
      displayNoneShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).display === "none").length,
      zeroOpacityShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).opacity === "0").length,
      zeroOpacityLeafCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")]
        .filter((leaf) => getComputedStyle(leaf).opacity === "0").length,
    };
    const presentationPlayer = player.seekFrame(0);
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const presentation = {
      player: presentationPlayer,
      hiddenShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).visibility === "hidden").length,
      hiddenLeafCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")]
        .filter((leaf) => getComputedStyle(leaf).visibility === "hidden").length,
      displayNoneShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).display === "none").length,
      zeroOpacityShapeCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")]
        .filter((shape) => getComputedStyle(shape).opacity === "0").length,
      zeroOpacityLeafCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")]
        .filter((leaf) => getComputedStyle(leaf).opacity === "0").length,
    };
    return { source, presentation, resumed: player.resume() };
  });
  const expectedCanonical = profile === "home" ? "https://css.graphics/" :
    "https://css.graphics/cityflow/";
  const preparedRequests = requests.filter((path) => path.startsWith("/csscityflow/"));
  const preparedStylesheet = preparedResponses.find(({ path }) =>
    path === `/csscityflow/${modelId}.css`);
  if (errors.length || failedResponses.length || before.errors.length || before.status !== "ready" || !before.ready ||
      before.canonical !== expectedCanonical ||
      before.bankId !== bankId || !before.stable || before.shapeCount !== boxes ||
      before.leafCount !== leaves || before.renderNodeCount !== boxes + leaves + 2 ||
      before.classAttributeCount !== 2 || before.dataAttributeCount !== 0 ||
      before.ariaAttributeCount !== 0 || before.cameraInlineStyleAttributeCount !== 0 ||
      before.cameraInlineCustomPropertyCount !== 0 ||
      before.sceneInlineStyleAttributeCount !== 0 || before.sceneInlineTransformCount !== 0 ||
      !before.projection.matches || before.projection.wide !== (profile === "wide") ||
      before.morphClassCount !== 0 || before.modelRootCount !== 0 ||
      before.backfaceInlineStyleCount !== 0 || before.topBackfaceVisibleCount !== boxes ||
      before.sideBackfaceHiddenCount !== boxes * 2 ||
      before.canvasCount !== 0 || before.svgSceneCount !== 0 ||
      !before.firstLeafColor || before.whiteLeafCount === leaves ||
      !preparedStylesheet?.contentType?.startsWith("text/css") ||
      before.animationName !== "none" ||
      before.player?.paused !== false || before.orbitStatePresent ||
      before.orbitDataset !== null || before.draggingDataset !== null ||
      before.camera?.rotX !== 0 || before.camera?.rotY !== 0 || before.camera?.zoom !== 50 ||
      before.player?.catchUpPolicy !== "adjacent-state-late-deadline-reset" ||
      before.player?.preparedStateSkipCount !== 0 ||
      before.player?.resumePublicationPolicy !==
        "first-animation-frame-immediate-then-deadline-paced" ||
      before.player?.schedulerEarlyDeadlineToleranceMilliseconds !== 50 / 12 ||
      before.player?.schedulerMinimumDistinctPublicationSpacingMilliseconds !== 12.5 ||
      !Number.isSafeInteger(before.player?.schedulerDisplayPhaseResyncCount) ||
      before.player.schedulerDisplayPhaseResyncCount < 0 ||
      !Number.isSafeInteger(before.player?.schedulerLateDeadlineResetCount) ||
      before.player.schedulerLateDeadlineResetCount < 0 ||
      before.player?.preparedTimelineAuthority !==
        "sequential-prepared-state-index" ||
      before.player?.transformPresentationMode !==
        "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication" ||
      before.player?.preparedTransformAnimationCount !== 0 ||
      before.player?.preparedTransformStateCount !== 301 ||
      before.player?.retainedModelRootCount !== 0 ||
      before.player?.retainedDomClassAttributeCount !== 2 ||
      before.player?.retainedDomDataAttributeCount !== 0 ||
      before.player?.retainedDomAriaAttributeCount !== 0 ||
      before.player?.retainedCameraInlineStyleAttributeCount !== 0 ||
      before.player?.retainedSceneInlineStyleAttributeCount !== 0 ||
      before.player?.retainedSceneInlineTransformCount !== 0 ||
      before.player?.retainedBackfaceInlineStyleCount !== 0 ||
      before.player?.runtimeDomMutationCount !== 0 ||
      before.player?.runtimeShapeStyleWriteUpperBound !== maximumShapeWrites ||
      before.player?.runtimeLeafColorStyleWriteUpperBound !== maximumColorWrites ||
      !Number.isSafeInteger(before.player?.runtimeLeafColorStyleWrites) ||
      before.player.runtimeLeafColorStyleWrites < 0 ||
      before.player?.initialShapeStyleWrites !== initialVisibleBoxes ||
      before.player?.initialLeafColorStyleWrites !== initialVisibleFaces ||
      before.player?.initialVisibilityWrites !== initialVisibilityWrites ||
      before.player?.staticSuppressionBindingWrites !== staticSuppressedFaces ||
      before.player?.staticSuppressedFaceCount !== staticSuppressedFaces ||
      before.player?.staticSuppressedBoxCount !== staticSuppressedBoxes ||
      before.player?.pseudoElementSideFacePublication !== false ||
      before.player?.pseudoElementFaceColorOverlay !== false ||
      before.player?.retainedSideLeafPaintOwners !== 1 ||
      before.player?.sideLeafPreparedHeight !== 1 ||
      before.player?.sideLeafPreparedDefaultDepthScale !== sideDepthDefault ||
      before.player?.sideLeafPreparedMaximumDepthScale !== sideDepthMaximum ||
      before.player?.sideLeafPreparedOverrideCount !== sideDepthOverrides ||
      before.player?.sideLeafPreparedDefaultTopOffset !== 1 - sideDepthDefault ||
      before.player?.sideLeafPreparedMinimumTopOffset !== 1 - sideDepthMaximum ||
      before.player?.sideLeafLayoutSubpixelFree !== true ||
      before.player?.retainedFaceCount !== leaves || before.player?.retainedBoxCount !== boxes ||
      before.player?.visibleFaceCount !== before.player.visibleBoxCount * 3 ||
      before.player.visibleFaceCount < visibleFaceRange[0] ||
      before.player.visibleFaceCount > visibleFaceRange[1] ||
      before.player.visibleBoxCount < visibleBoxRange[0] ||
      before.player.visibleBoxCount > visibleBoxRange[1] ||
      before.hiddenShapeCount !== 0 ||
      before.hiddenLeafCount !== leaves - before.player.visibleFaceCount ||
      before.displayNoneShapeCount !== 0 ||
      before.zeroOpacityShapeCount !== 0 ||
      before.zeroOpacityLeafCount !== 0 ||
      !Number.isSafeInteger(before.player?.visibilityStyleWrites) ||
      before.player.visibilityStyleWrites < 0 ||
      !Number.isSafeInteger(before.player?.visibilityWrites) || before.player.visibilityWrites < 0 ||
      before.player?.visibilityCullingPolicy !==
        "prepared-viewport-independent-whole-box-direct-leaf-visibility-no-face-culling" ||
      before.transformAnimationCount !== 0 ||
      before.metadata?.schema !== "csscityflow-prepared-product@2" ||
      after.player?.timerCallbackCount !== 0 ||
      after.player?.animationFrameCallbackCount <= before.player.animationFrameCallbackCount ||
      after.player?.frameIndex === before.player.frameIndex ||
      after.player?.publicationCount <= before.player.publicationCount ||
      JSON.stringify(after.camera) !== JSON.stringify(before.camera) ||
      motion.callbackCount !== 90 || motion.publishedTransitionCount <= 0 ||
      motion.skippedTransitionCount !== 0 ||
      motion.zeroShapeStylePublicationCount !== 0 ||
      motion.finalPlayer?.paused !== false ||
      motion.finalPlayer?.preparedStateSkipCount !== 0 ||
      changedTransformCount <= 0 || movingFrameBytesIdentical ||
      JSON.stringify(inputResult.camera) !== JSON.stringify(inputCameraBefore) ||
      inputResult.orbitStatePresent || inputResult.orbitDataset !== null ||
      inputResult.draggingDataset !== null || inputResult.player?.paused !== false ||
      inputResult.player?.visibleFaceCount !== inputResult.player?.visibleBoxCount * 3 ||
      inputResult.player?.visibleFaceCount < visibleFaceRange[0] ||
      inputResult.player?.visibleFaceCount > visibleFaceRange[1] ||
      inputResult.player?.visibleBoxCount < visibleBoxRange[0] ||
      inputResult.player?.visibleBoxCount > visibleBoxRange[1] ||
      inputResult.shapeCount !== boxes || inputResult.leafCount !== leaves ||
      sourceRoundTrip.source.player?.activeVisibilityVariant !==
        "exact-source-seek-all-retained-faces" ||
      sourceRoundTrip.source.player?.visibleFaceCount !== leaves ||
      sourceRoundTrip.source.player?.visibleBoxCount !== boxes ||
      sourceRoundTrip.source.hiddenShapeCount !== 0 ||
      sourceRoundTrip.source.hiddenLeafCount !== 0 ||
      sourceRoundTrip.source.displayNoneShapeCount !== 0 ||
      sourceRoundTrip.source.zeroOpacityShapeCount !== 0 ||
      sourceRoundTrip.source.zeroOpacityLeafCount !== 0 ||
      sourceRoundTrip.presentation.player?.activeVisibilityVariant !==
        "prepared-whole-box-visibility" ||
      sourceRoundTrip.presentation.player?.visibleFaceCount !== initialVisibleFaces ||
      sourceRoundTrip.presentation.player?.visibleBoxCount !== initialVisibleBoxes ||
      sourceRoundTrip.presentation.hiddenShapeCount !== 0 ||
      sourceRoundTrip.presentation.hiddenLeafCount !== leaves - initialVisibleFaces ||
      sourceRoundTrip.presentation.displayNoneShapeCount !== 0 ||
      sourceRoundTrip.presentation.zeroOpacityShapeCount !== 0 ||
      sourceRoundTrip.presentation.zeroOpacityLeafCount !== 0 ||
      sourceRoundTrip.resumed?.paused !== false ||
      before.atlasConstructions !== 0 || before.atlasRedraws !== 0) {
    throw new Error(`Cityflow ${profile} browser smoke failed: ${JSON.stringify({ before, after, motion, movingFrameBytesIdentical, inputCameraBefore, inputResult, sourceRoundTrip, changedTransformCount, errors, failedResponses, preparedRequests, preparedResponses })}`);
  }
  const screenshotPath = resolve(outputRoot, `${profile}.png`);
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return Object.freeze({ width, height, boxes, leaves, changedTransformCount, motion, movingFrameBytesIdentical, inputCameraBefore, inputResult, sourceRoundTrip, preparedRequests, preparedResponses, screenshotPath });
}

async function captureHome({ width, height, url }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
  const errors = [];
  const failedResponses = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a.project-thumbnail[href="/cityflow/"]', { timeout: 30_000 });
  const result = await page.evaluate(() => {
    const card = document.querySelector('a.project-thumbnail[href="/cityflow/"]');
    return {
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      title: card?.querySelector(".project-title")?.textContent?.trim() ?? null,
      number: card?.querySelector(".project-number")?.textContent?.trim() ?? null,
      image: card?.querySelector("img")?.getAttribute("src") ?? null,
      sceneCount: document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div").length,
    };
  });
  if (errors.length || failedResponses.length || result.canonical !== "https://css.graphics/" ||
      result.title !== "Cityflow" || result.number !== "#012" ||
      result.image !== "/landing/sidebar/cityflow.webp" || result.sceneCount !== 0) {
    throw new Error(`Cityflow home browser smoke failed: ${JSON.stringify({ result, errors, failedResponses })}`);
  }
  const screenshotPath = resolve(outputRoot, "home.png");
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return Object.freeze({ width, height, ...result, screenshotPath });
}

function createStaticDeployServer(root) {
  const rootPrefix = `${root}${sep}`;
  return createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", route).pathname);
      const normalized = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const path = resolve(root, `.${normalized}`);
      if (!path.startsWith(rootPrefix)) return response.writeHead(403).end();
      const bytes = await readFile(path);
      response.statusCode = 200;
      response.setHeader("Content-Type", mediaType(path));
      response.setHeader("Content-Length", bytes.byteLength);
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (error?.code === "ENOENT") return response.writeHead(404).end();
      response.writeHead(500).end();
    }
  });
}

function mediaType(path) {
  return new Map([
    [".css", "text/css"], [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"], [".webp", "image/webp"],
  ]).get(extname(path)) ?? "application/octet-stream";
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.unref();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolvePort(address.port));
    });
  });
}

async function waitFor(predicate, timeoutMilliseconds) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Cityflow server did not start:\n${serverOutput}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
