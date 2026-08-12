#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const smokeDir = join("bench", "results", "cssmenger", "smoke");
const screenshotPath = join(smokeDir, "default-route.png");
const narrowMobileScreenshotPath = join(smokeDir, "mobile-360-default-route.png");
const mobileScreenshotPath = join(smokeDir, "mobile-390-default-route.png");
const mobileDesktopAtlasScreenshotPath = join(smokeDir, "mobile-390-desktop-atlas-baseline.png");
const statePath = join(smokeDir, "state.json");
const port = await freePort();
const route = `http://127.0.0.1:${port}/`;
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(smokeDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const loadingPage = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    let releaseAtlasRequest;
    const atlasRequestGate = new Promise((resolve) => { releaseAtlasRequest = resolve; });
    await loadingPage.route("**/cssmenger/assets/lighting-grid-*.webp", async (request) => {
      await atlasRequestGate;
      await request.continue();
    });
    await loadingPage.goto(route, { waitUntil: "domcontentloaded" });
    await loadingPage.waitForFunction(() => document.body.classList.contains("loading"));
    const loadingIndicator = await loadingPage.evaluate(() => {
      const style = getComputedStyle(document.body, "::after");
      return { content: style.content, width: style.width, height: style.height, borderRadius: style.borderRadius };
    });
    releaseAtlasRequest();
    await loadingPage.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 30_000 });
    const canonicalizedSearch = await loadingPage.evaluate(() => location.search);
    await loadingPage.close();
    if (loadingIndicator.content === "none" || loadingIndicator.width !== "18px" ||
        loadingIndicator.height !== "18px" || loadingIndicator.borderRadius !== "50%" ||
        canonicalizedSearch !== "") {
      throw new Error(`cssMenger loading indicator failed: ${JSON.stringify(loadingIndicator)}`);
    }
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const requests = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("ready") || document.body.classList.contains("error"), null,
      { timeout: 30_000 });

    const evidence = await page.evaluate(() => {
      const debug = globalThis.__cssMengerDebug;
      const scene = document.querySelector(".polycss-camera > .polycss-scene");
      const leaves = [...scene.querySelectorAll(":scope > b")];
      const atlas = debug.scene.planeAtlas;
      const importantRules = [];
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...(sheet.cssRules ?? [])]) {
          if (rule.cssText?.includes("!important")) importantRules.push(rule.cssText);
        }
      }
      const firstStyle = getComputedStyle(leaves[0]);
      const transformAngles = debug.scene.playback.transforms.map((transform) =>
        [...transform.matchAll(/rotate[XYZ]\((-?[0-9.]+)deg\)/gu)].map((match) => Number(match[1])));
      let maximumAdjacentTransformDegrees = 0;
      let internalTransformWrapCount = 0;
      for (let stateIndex = 1; stateIndex < transformAngles.length; stateIndex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const delta = Math.abs(transformAngles[stateIndex][axis] - transformAngles[stateIndex - 1][axis]);
          maximumAdjacentTransformDegrees = Math.max(maximumAdjacentTransformDegrees, delta);
          if (delta >= 180) internalTransformWrapCount += 1;
        }
      }
      return {
        status: document.body.classList.contains("ready") ? "ready" :
          document.body.classList.contains("error") ? "error" : "loading",
        bodyDataAttributes: [...document.body.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => attribute.name),
        ready: debug?.ready === true,
        stable: debug?.assertStableDomIdentity?.() === true,
        errors: debug?.errors?.() ?? [],
        selectedDeviceProfile: debug.route.selectedDeviceProfile,
        selectedLightingMode: debug.route.selectedLightingMode,
        selectedLightingPresentation: debug.route.selectedLightingPresentation,
        locationSearch: location.search,
        maximumAdjacentTransformDegrees,
        internalTransformWrapCount,
        stats: debug?.stats?.() ?? null,
        bCount: leaves.length,
        iCount: document.querySelectorAll(".polycss-camera > .polycss-scene > i").length,
        sCount: document.querySelectorAll(".polycss-camera > .polycss-scene > s").length,
        forbiddenRendererCount: document.querySelectorAll("canvas, svg:not(.site-wordmark-svg):not(.site-action-icon)").length,
        leafImportantInlineCount: leaves.filter((leaf) => leaf.getAttribute("style")?.includes("important")).length,
        leafBackgroundSizeInlineCount: leaves.filter((leaf) => leaf.style.backgroundSize).length,
        leafImageRenderingInlineCount: leaves.filter((leaf) => leaf.style.imageRendering).length,
        leafInlineProperties: [...new Set(leaves.flatMap((leaf) => [...leaf.style]))].sort(),
        sceneInlineProperties: [...scene.style].sort(),
        cameraInlineProperties: [...document.querySelector(".polycss-camera").style].sort(),
        importantRules,
        computed: {
          width: firstStyle.width,
          height: firstStyle.height,
          imageRendering: firstStyle.imageRendering,
          backfaceVisibility: firstStyle.backfaceVisibility,
          backgroundSize: firstStyle.backgroundSize,
          backgroundImage: firstStyle.backgroundImage,
          filter: firstStyle.filter,
          maskImage: firstStyle.maskImage,
          backgroundBlendMode: firstStyle.backgroundBlendMode,
        },
        expectedBackgroundSize: `${atlas.width}px ${atlas.height}px`,
        expectedBackgroundUrl: atlas.assetUrl,
        expectedAssetBytes: atlas.byteLength,
        atlasWidth: atlas.width,
        atlasHeight: atlas.height,
        atlasPageCount: debug.scene.metrics.atlasPageCount,
        sceneVariableWidth: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-width"),
        sceneVariableHeight: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-height"),
      };
    });

    const sampledStates = [];
    for (const tick of [0, 36, 420, 1_535]) {
      sampledStates.push(await page.evaluate((stateIndex) => {
        const debug = globalThis.__cssMengerDebug;
        debug.seek(stateIndex);
        const rotationRoot = document.querySelector(".polycss-camera > .polycss-scene");
        const actual = new DOMMatrix(getComputedStyle(rotationRoot).transform).toFloat64Array();
        const expected = new DOMMatrix(debug.scene.playback.transforms[stateIndex]).toFloat64Array();
        return {
          tick: debug.state().tick,
          paused: debug.state().paused,
          matrixMaxDelta: Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))),
        };
      }, tick));
    }
    const playbackProgress = await page.evaluate(async () => {
      const debug = globalThis.__cssMengerDebug;
      debug.seek(0);
      debug.resume();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      debug.pause();
      return debug.state();
    });
    const loopProgress = await page.evaluate(async () => {
      const debug = globalThis.__cssMengerDebug;
      debug.seek(1_535);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      debug.resume();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const state = debug.state();
      debug.pause();
      return state;
    });
    const seamEvidence = await page.evaluate(() => {
      const debug = globalThis.__cssMengerDebug;
      const scene = document.querySelector(".polycss-camera > .polycss-scene");
      const animation = scene.getAnimations()
        .find((candidate) => candidate.animationName === "cssmenger-prepared-rotation");
      const frameMilliseconds = debug.scene.playback.sourceFrameDelayMilliseconds;
      const finalStateIndex = debug.scene.playback.stateCount - 1;
      const cycleMilliseconds = debug.scene.playback.stateCount * frameMilliseconds;
      debug.pause();
      const matrixAt = (currentTime) => {
        animation.currentTime = currentTime;
        return [...new DOMMatrix(getComputedStyle(scene).transform).toFloat64Array()];
      };
      const zero = matrixAt(0);
      const before = matrixAt(cycleMilliseconds - frameMilliseconds);
      const boundary = matrixAt(cycleMilliseconds);
      const after = matrixAt(cycleMilliseconds + frameMilliseconds);
      const incomingVelocity = boundary.map((value, index) => value - before[index]);
      const outgoingVelocity = after.map((value, index) => value - boundary[index]);
      const incomingMagnitude = Math.hypot(...incomingVelocity);
      const outgoingMagnitude = Math.hypot(...outgoingVelocity);
      const velocityCosine = incomingVelocity.reduce((sum, value, index) =>
        sum + value * outgoingVelocity[index], 0) / (incomingMagnitude * outgoingMagnitude);
      const schedule = debug.scene.playback.frontFacingSchedule;
      const visibleStateZeroLeaves = schedule.leafIndices.slice(schedule.offsets[0], schedule.offsets[3]);
      debug.seek(0);
      const expectedLightingAddresses = visibleStateZeroLeaves.map((leafIndex) =>
        scene.children[leafIndex].style.backgroundPosition);
      debug.seek(finalStateIndex);
      debug.step();
      const actualLightingAddresses = visibleStateZeroLeaves.map((leafIndex) =>
        scene.children[leafIndex].style.backgroundPosition);
      const wrappedTick = debug.state().tick;
      debug.seek(0);
      return {
        boundaryOrientationMatrixMaxDelta: Math.max(...boundary.map((value, index) =>
          Math.abs(value - zero[index]))),
        incomingMagnitude,
        outgoingMagnitude,
        velocityCosine,
        velocityMagnitudeRatio: outgoingMagnitude / incomingMagnitude,
        visibleLightingAddressMismatchCount: actualLightingAddresses.reduce((count, value, index) =>
          count + Number(value !== expectedLightingAddresses[index]), 0),
        wrappedTick,
      };
    });
    const desktopAtlasRequests = requests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.webp$/u.test(path));
    const frozenAtlasRequests = requests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.webp$/u.test(path));
    const shadowAtlasRequests = requests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-shadow-grid-[a-f0-9]{64}\.avif$/u.test(path));
    const baseAtlasRequests = requests.filter((path) =>
      /^\/cssmenger\/assets\/planes-opacity-base-[a-f0-9]{64}\.png$/u.test(path));
    const pageRequests = requests.filter((path) => /(?:page|frame)-\d+/u.test(path));

    if (pageErrors.length || evidence.status !== "ready" || evidence.bodyDataAttributes.length !== 0 ||
        !evidence.ready || !evidence.stable || evidence.selectedDeviceProfile !== "desktop" ||
        evidence.selectedLightingMode !== "dynamic" ||
        evidence.selectedLightingPresentation !== "atlas" || evidence.locationSearch !== "" ||
        evidence.internalTransformWrapCount !== 0 || evidence.maximumAdjacentTransformDegrees >= 2 ||
        evidence.errors.length || evidence.bCount !== 84 || evidence.iCount !== 0 || evidence.sCount !== 0 ||
        evidence.forbiddenRendererCount !== 0 || evidence.leafImportantInlineCount !== 0 ||
        evidence.leafBackgroundSizeInlineCount !== 0 || evidence.leafImageRenderingInlineCount !== 0 ||
        evidence.leafInlineProperties.some((property) =>
          !["background-position", "background-position-x", "background-position-y", "transform"].includes(property)) ||
        evidence.sceneInlineProperties.some((property) => property !== "transform") ||
        evidence.cameraInlineProperties.length !== 0 ||
        evidence.importantRules.length !== 0 || evidence.computed.width !== "27px" ||
        evidence.computed.height !== "27px" || evidence.computed.imageRendering !== "pixelated" ||
        evidence.computed.backfaceVisibility !== "hidden" ||
        !evidence.computed.backgroundImage.includes(evidence.expectedBackgroundUrl) ||
        evidence.computed.filter !== "none" || evidence.computed.maskImage !== "none" ||
        !["normal", "normal, normal"].includes(evidence.computed.backgroundBlendMode) ||
        evidence.computed.backgroundSize !== evidence.expectedBackgroundSize ||
        evidence.sceneVariableWidth !== `${evidence.atlasWidth}px` ||
        evidence.sceneVariableHeight !== `${evidence.atlasHeight}px` || evidence.atlasPageCount !== 2 ||
        desktopAtlasRequests.length !== 1 || frozenAtlasRequests.length !== 0 ||
        shadowAtlasRequests.length !== 0 || baseAtlasRequests.length !== 0 ||
        pageRequests.length !== 0 ||
        sampledStates.some((sample, index) => sample.tick !== [0, 36, 420, 1_535][index] ||
          !sample.paused || sample.matrixMaxDelta > 5e-5) ||
        playbackProgress.tick < 25 || playbackProgress.tick > 45 || !playbackProgress.paused ||
        loopProgress.tick < 0 || loopProgress.tick > 5 || loopProgress.paused ||
        seamEvidence.boundaryOrientationMatrixMaxDelta > 5e-5 ||
        seamEvidence.velocityCosine < 0.995 || seamEvidence.velocityMagnitudeRatio < 0.95 ||
        seamEvidence.velocityMagnitudeRatio > 1.05 ||
        seamEvidence.visibleLightingAddressMismatchCount !== 0 || seamEvidence.wrappedTick !== 0 ||
        evidence.stats.runtimeDomMutationCount !== 0 || evidence.stats.runtimeDomGrowth !== false ||
        evidence.stats.preparedPlaneAtlasProfile !== "desktop" ||
        evidence.stats.preparedPlaneAtlasAssetBytes !== evidence.expectedAssetBytes ||
        evidence.stats.preparedPlaneAtlasDecodedBytes !== 89_812_800 ||
        evidence.stats.preparedPlaneAtlasCssImageBinding !== "prepared-direct-stylesheet-url" ||
        evidence.stats.preparedPlaneAtlasDecodeReadiness !== "awaited-image-decode-before-mount" ||
        evidence.stats.preparedPlaneAtlasDecodedImageRetention !==
          "javascript-image-object-no-dom-node" ||
        evidence.stats.preparedColorPublicationMode !==
          "prepared-held-lighting-sample-plus-per-state-front-face-address" ||
        evidence.stats.preparedLightingAddressPublicationIntervalTicks !== 1 ||
        evidence.stats.preparedLightingAtlasAssetCount !== 1 ||
        evidence.stats.preparedCssOpacityWriteCountPerScheduledTick !== 0 ||
        evidence.stats.preparedSchedulerCatchUpMode !==
          "compositor-clock-adjacent-or-collapsed-prepared-resync" ||
        evidence.stats.preparedLoopPresentationMode !== "prepared-forward-cyclic-c2-no-turnaround-no-reset" ||
        evidence.stats.preparedCompositorRotationMode !==
          "prepared-css-keyframes-on-existing-scene-node" ||
        evidence.stats.runtimeRotationStyleWriteCountPerScheduledTick !== 0 ||
        evidence.stats.preparedCompositorRotationAnimationCount !== 1 ||
        evidence.stats.preparedFlatSceneLeafLightingSeparation !== true ||
        evidence.stats.retainedRotationRootCount !== 0 || evidence.stats.retainedLightingRootCount !== 0 ||
        evidence.stats.runtimeLightingCalculationCount !== 0 || evidence.stats.runtimeGeometryConstructionCount !== 0) {
      throw new Error(`cssMenger browser smoke failed: ${JSON.stringify({
        evidence, sampledStates, playbackProgress, loopProgress, seamEvidence,
        desktopAtlasRequests, frozenAtlasRequests, shadowAtlasRequests, baseAtlasRequests,
        pageRequests, pageErrors,
      })}`);
    }
    await page.evaluate(() => globalThis.__cssMengerDebug.seek(36));
    await page.screenshot({ path: screenshotPath });
    const mobileFraming = [];
    for (const viewport of [
      { width: 360, height: 780, expectedScale: "0.82", screenshotPath: narrowMobileScreenshotPath },
      { width: 390, height: 844, expectedScale: "0.88", screenshotPath: mobileDesktopAtlasScreenshotPath },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tick of [0, 320, 720, 1_535]) {
        mobileFraming.push(await page.evaluate(({ stateIndex, expectedScale }) => {
          const debug = globalThis.__cssMengerDebug;
          debug.seek(stateIndex);
          const leaves = [...document.querySelectorAll(
            ".polycss-camera > .polycss-scene > b",
          )];
          const bounds = leaves.map((leaf) => leaf.getBoundingClientRect())
            .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0);
          return {
            tick: debug.state().tick,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            expectedScale,
            computedScale: getComputedStyle(document.querySelector(".polycss-scene")).scale,
            left: Math.min(...bounds.map((rectangle) => rectangle.left)),
            right: Math.max(...bounds.map((rectangle) => rectangle.right)),
            top: Math.min(...bounds.map((rectangle) => rectangle.top)),
            bottom: Math.max(...bounds.map((rectangle) => rectangle.bottom)),
          };
        }, { stateIndex: tick, expectedScale: viewport.expectedScale }));
      }
      await page.evaluate(() => globalThis.__cssMengerDebug.seek(720));
      await page.screenshot({ path: viewport.screenshotPath });
    }
    if (mobileFraming.some((frame) => frame.tick === null || frame.computedScale !== frame.expectedScale ||
        frame.left < 0 || frame.right > frame.viewportWidth || frame.top < 50 ||
        frame.bottom > frame.viewportHeight)) {
      throw new Error(`cssMenger mobile framing failed: ${JSON.stringify(mobileFraming)}`);
    }
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const mobileRequests = [];
    const mobileErrors = [];
    mobilePage.on("request", (request) => mobileRequests.push(new URL(request.url()).pathname));
    mobilePage.on("pageerror", (error) => mobileErrors.push(error.stack || error.message));
    mobilePage.on("console", (message) => { if (message.type() === "error") mobileErrors.push(message.text()); });
    await mobilePage.goto(route, { waitUntil: "networkidle" });
    await mobilePage.waitForFunction(() => document.body.classList.contains("ready") || document.body.classList.contains("error"), null,
      { timeout: 30_000 });
    const mobileEvidence = await mobilePage.evaluate(async () => {
      const debug = globalThis.__cssMengerDebug;
      debug.pause();
      const lightingAddresses = [0, 1, 2, 186, 720, 1_535].map((stateIndex) => {
        debug.seek(stateIndex);
        return [...document.querySelectorAll(
          ".polycss-camera > .polycss-scene > b",
        )]
          .map((leaf) => leaf.style.backgroundPosition);
      });
      debug.seek(720);
      const lightingSteps = [debug.profileStep(), debug.profileStep()];
      debug.seek(720);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scene = document.querySelector(".polycss-camera > .polycss-scene");
      const firstLeaf = scene.querySelector(":scope > b");
      const atlas = debug.scene.mobilePlaneAtlas;
      return {
        ready: debug.ready,
        errors: debug.errors(),
        bodyDataAttributes: [...document.body.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => attribute.name),
        selectedProfile: debug.stats().preparedPlaneAtlasProfile,
        devicePixelRatio,
        selectedScene: debug.state().scene,
        leafCount: scene.querySelectorAll(":scope > b").length,
        selectedDecodedBytes: debug.stats().preparedPlaneAtlasDecodedBytes,
        selectedAssetBytes: debug.stats().preparedPlaneAtlasAssetBytes,
        selectedDecodeReadiness: debug.stats().preparedPlaneAtlasDecodeReadiness,
        selectedDecodedImageRetention: debug.stats().preparedPlaneAtlasDecodedImageRetention,
        selectedLightingIntervalTicks: debug.stats().preparedColorPublicationIntervalTicks,
        selectedLightingAddressUpdateCount: debug.stats().preparedLightingAddressUpdateCount,
        lightingAddressesChange: lightingAddresses.slice(1).some((addresses) =>
          addresses.some((address, index) => address !== lightingAddresses[0][index])),
        lightingSteps,
        desktopUrl: debug.scene.planeAtlas.assetUrl,
        mobileUrl: atlas.assetUrl,
        backgroundImage: getComputedStyle(firstLeaf).backgroundImage,
        backgroundSize: getComputedStyle(firstLeaf).backgroundSize,
        expectedBackgroundSize: `${atlas.width}px ${atlas.height}px`,
        expectedBackgroundUrl: atlas.assetUrl,
        expectedAssetBytes: atlas.byteLength,
        transformAnimationName: getComputedStyle(scene).animationName,
        transformAnimationDuration: getComputedStyle(scene).animationDuration,
        transformAnimationTimingFunction: getComputedStyle(scene).animationTimingFunction,
        transformAnimationDirection: getComputedStyle(scene).animationDirection,
        transformAnimationCount: scene.getAnimations()
          .filter((animation) => animation.animationName === "cssmenger-prepared-rotation").length,
        transformAnimationPlayState: scene.getAnimations()
          .find((animation) => animation.animationName === "cssmenger-prepared-rotation")?.playState,
        tick: debug.state().tick,
      };
    });
    await mobilePage.screenshot({ path: mobileScreenshotPath });
    await mobilePage.close();
    const requestedDesktopAtlases = mobileRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.webp$/u.test(path));
    const requestedMobileAtlases = mobileRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.webp$/u.test(path));
    if (mobileErrors.length || !mobileEvidence.ready || mobileEvidence.errors.length ||
        mobileEvidence.bodyDataAttributes.length !== 0 || mobileEvidence.selectedProfile !== "mobile" ||
        mobileEvidence.devicePixelRatio !== 3 ||
        mobileEvidence.selectedScene !== "depth-2" || mobileEvidence.leafCount !== 30 ||
        mobileEvidence.selectedDecodedBytes !== 3_572_100 ||
        mobileEvidence.selectedAssetBytes !== mobileEvidence.expectedAssetBytes ||
        mobileEvidence.selectedDecodeReadiness !== "awaited-image-decode-before-mount" ||
        mobileEvidence.selectedDecodedImageRetention !== "javascript-image-object-no-dom-node" ||
        mobileEvidence.selectedLightingIntervalTicks !== 2 ||
        mobileEvidence.selectedLightingAddressUpdateCount !== 11_680 ||
        !mobileEvidence.lightingAddressesChange ||
        mobileEvidence.lightingSteps?.length !== 2 ||
        mobileEvidence.lightingSteps.some((step) => step.preparedLightingAddressWriteCount > 18) ||
        !mobileEvidence.lightingSteps.some((step) => step.preparedLightingAddressWriteCount > 0) ||
        mobileEvidence.tick !== 720 ||
        !mobileEvidence.backgroundImage.includes(mobileEvidence.expectedBackgroundUrl) ||
        mobileEvidence.backgroundSize !== mobileEvidence.expectedBackgroundSize ||
        mobileEvidence.transformAnimationName !== "cssmenger-prepared-rotation" ||
        mobileEvidence.transformAnimationDuration !== "46.08s" ||
        mobileEvidence.transformAnimationTimingFunction !== "linear" ||
        mobileEvidence.transformAnimationDirection !== "normal" ||
        mobileEvidence.transformAnimationCount !== 1 ||
        mobileEvidence.transformAnimationPlayState !== "paused" ||
        requestedDesktopAtlases.length !== 0 || requestedMobileAtlases.length !== 1) {
      throw new Error(`cssMenger responsive mobile atlas failed: ${JSON.stringify({
        mobileEvidence, requestedDesktopAtlases, requestedMobileAtlases, mobileErrors,
      })}`);
    }
    const widePhoneContext = await browser.newContext({
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    });
    const widePhonePage = await widePhoneContext.newPage();
    const widePhoneRequests = [];
    const widePhoneErrors = [];
    widePhonePage.on("request", (request) => widePhoneRequests.push(new URL(request.url()).pathname));
    widePhonePage.on("pageerror", (error) => widePhoneErrors.push(error.stack || error.message));
    widePhonePage.on("console", (message) => {
      if (message.type() === "error") widePhoneErrors.push(message.text());
    });
    await widePhonePage.goto(route, { waitUntil: "networkidle" });
    await widePhonePage.waitForFunction(() =>
      document.body.classList.contains("ready") || document.body.classList.contains("error"), null,
    { timeout: 30_000 });
    const widePhoneEvidence = await widePhonePage.evaluate(() => ({
      profile: globalThis.__cssMengerDebug.stats().preparedPlaneAtlasProfile,
      scene: globalThis.__cssMengerDebug.state().scene,
      leaves: document.querySelectorAll(
        ".polycss-camera > .polycss-scene > b",
      ).length,
      assetBytes: globalThis.__cssMengerDebug.stats().preparedPlaneAtlasAssetBytes,
      expectedAssetBytes: globalThis.__cssMengerDebug.scene.mobilePlaneAtlas.byteLength,
      colorMode: globalThis.__cssMengerDebug.stats().preparedColorPublicationMode,
      viewportWidth: innerWidth,
      errors: globalThis.__cssMengerDebug.errors(),
    }));
    await widePhoneContext.close();
    const widePhoneDesktopAtlases = widePhoneRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.webp$/u.test(path));
    const widePhoneMobileAtlases = widePhoneRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.webp$/u.test(path));
    if (widePhoneErrors.length || widePhoneEvidence.errors.length || widePhoneEvidence.viewportWidth <= 430 ||
        widePhoneEvidence.profile !== "mobile" || widePhoneEvidence.scene !== "depth-2" ||
        widePhoneEvidence.leaves !== 30 ||
        widePhoneEvidence.assetBytes !== widePhoneEvidence.expectedAssetBytes ||
        widePhoneEvidence.colorMode !== "prepared-held-lighting-sample-plus-per-state-front-face-address" ||
        widePhoneDesktopAtlases.length !== 0 || widePhoneMobileAtlases.length !== 1) {
      throw new Error(`cssMenger wide-phone profile selection failed: ${JSON.stringify({
        widePhoneEvidence, widePhoneDesktopAtlases, widePhoneMobileAtlases, widePhoneErrors,
      })}`);
    }
    const result = {
      route,
      loadingIndicator,
      evidence,
      sampledStates,
      playbackProgress,
      loopProgress,
      seamEvidence,
      mobileFraming,
      mobileEvidence,
      requestedDesktopAtlases,
      requestedMobileAtlases,
      widePhoneEvidence,
      widePhoneDesktopAtlases,
      widePhoneMobileAtlases,
      desktopAtlasRequests,
      frozenAtlasRequests,
      pageRequests,
      pageErrors,
    };
    await writeFile(statePath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({
      status: "pass",
      screenshotPath,
      narrowMobileScreenshotPath,
      mobileScreenshotPath,
      mobileDesktopAtlasScreenshotPath,
      statePath,
      ...result,
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const instance = createServer();
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      instance.close(() => resolvePort(selected));
    });
    instance.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
