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
    await loadingPage.route("**/cssmenger/assets/lighting-grid-*.avif", async (request) => {
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
    await loadingPage.close();
    if (loadingIndicator.content === "none" || loadingIndicator.width !== "18px" ||
        loadingIndicator.height !== "18px" || loadingIndicator.borderRadius !== "50%") {
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
      const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b")];
      const importantRules = [];
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...(sheet.cssRules ?? [])]) {
          if (rule.cssText?.includes("!important")) importantRules.push(rule.cssText);
        }
      }
      const firstStyle = getComputedStyle(leaves[0]);
      return {
        status: document.body.classList.contains("ready") ? "ready" :
          document.body.classList.contains("error") ? "error" : "loading",
        bodyDataAttributes: [...document.body.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => attribute.name),
        ready: debug?.ready === true,
        stable: debug?.assertStableDomIdentity?.() === true,
        errors: debug?.errors?.() ?? [],
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
        },
        expectedBackgroundSize: `${debug.scene.planeAtlas.width}px ${debug.scene.planeAtlas.height}px`,
        atlasUrl: debug.scene.planeAtlas.assetUrl,
        atlasWidth: debug.scene.planeAtlas.width,
        atlasHeight: debug.scene.planeAtlas.height,
        atlasPageCount: debug.scene.metrics.atlasPageCount,
        sceneVariableWidth: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-width"),
        sceneVariableHeight: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-height"),
      };
    });

    const sampledStates = [];
    for (const tick of [0, 36, 420, 1_439]) {
      sampledStates.push(await page.evaluate((stateIndex) => {
        const debug = globalThis.__cssMengerDebug;
        debug.seek(stateIndex);
        const scene = document.querySelector(".polycss-camera > .polycss-scene");
        const actual = new DOMMatrix(scene.style.transform).toFloat64Array();
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
      debug.seek(1_439);
      debug.resume();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const state = debug.state();
      debug.pause();
      return state;
    });
    const atlasRequests = requests.filter((path) => /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(path));
    const pageRequests = requests.filter((path) => /(?:page|frame)-\d+/u.test(path));

    if (pageErrors.length || evidence.status !== "ready" || evidence.bodyDataAttributes.length !== 0 ||
        !evidence.ready || !evidence.stable ||
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
        !evidence.computed.backgroundImage.includes(evidence.atlasUrl) ||
        evidence.computed.backgroundSize !== evidence.expectedBackgroundSize ||
        evidence.sceneVariableWidth !== `${evidence.atlasWidth}px` ||
        evidence.sceneVariableHeight !== `${evidence.atlasHeight}px` || evidence.atlasPageCount !== 2 ||
        new Set(atlasRequests).size !== 1 || pageRequests.length !== 0 ||
        sampledStates.some((sample, index) => sample.tick !== [0, 36, 420, 1_439][index] ||
          !sample.paused || sample.matrixMaxDelta > 1e-5) ||
        playbackProgress.tick < 25 || playbackProgress.tick > 45 || !playbackProgress.paused ||
        loopProgress.tick < 0 || loopProgress.tick > 3 || loopProgress.paused ||
        evidence.stats.runtimeDomMutationCount !== 0 || evidence.stats.runtimeDomGrowth !== false ||
        evidence.stats.runtimeLightingCalculationCount !== 0 || evidence.stats.runtimeGeometryConstructionCount !== 0) {
      throw new Error(`cssMenger browser smoke failed: ${JSON.stringify({
        evidence, sampledStates, playbackProgress, loopProgress, atlasRequests, pageRequests, pageErrors,
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
      for (const tick of [0, 320, 720, 1_439]) {
        mobileFraming.push(await page.evaluate(({ stateIndex, expectedScale }) => {
          const debug = globalThis.__cssMengerDebug;
          debug.seek(stateIndex);
          const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b")];
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
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
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
        selectedDecodedBytes: debug.stats().preparedPlaneAtlasDecodedBytes,
        selectedAssetBytes: debug.stats().preparedPlaneAtlasAssetBytes,
        selectedLightingIntervalTicks: debug.stats().preparedColorPublicationIntervalTicks,
        selectedLightingAddressUpdateCount: debug.stats().preparedLightingAddressUpdateCount,
        desktopUrl: debug.scene.planeAtlas.assetUrl,
        mobileUrl: atlas.assetUrl,
        backgroundImage: getComputedStyle(firstLeaf).backgroundImage,
        backgroundSize: getComputedStyle(firstLeaf).backgroundSize,
        expectedBackgroundSize: `${atlas.width}px ${atlas.height}px`,
        tick: debug.state().tick,
      };
    });
    await mobilePage.screenshot({ path: mobileScreenshotPath });
    await mobilePage.close();
    const requestedDesktopAtlases = mobileRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(path));
    const requestedMobileAtlases = mobileRequests.filter((path) =>
      /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.avif$/u.test(path));
    if (mobileErrors.length || !mobileEvidence.ready || mobileEvidence.errors.length ||
        mobileEvidence.bodyDataAttributes.length !== 0 || mobileEvidence.selectedProfile !== "mobile" ||
        mobileEvidence.selectedDecodedBytes !== 44_177_400 || mobileEvidence.selectedAssetBytes !== 3_299_290 ||
        mobileEvidence.selectedLightingIntervalTicks !== 4 ||
        mobileEvidence.selectedLightingAddressUpdateCount !== 15_750 || mobileEvidence.tick !== 720 ||
        !mobileEvidence.backgroundImage.includes(mobileEvidence.mobileUrl) ||
        mobileEvidence.backgroundSize !== mobileEvidence.expectedBackgroundSize ||
        requestedDesktopAtlases.length !== 0 || new Set(requestedMobileAtlases).size !== 1) {
      throw new Error(`cssMenger responsive mobile atlas failed: ${JSON.stringify({
        mobileEvidence, requestedDesktopAtlases, requestedMobileAtlases, mobileErrors,
      })}`);
    }
    const result = {
      route,
      loadingIndicator,
      evidence,
      sampledStates,
      playbackProgress,
      loopProgress,
      mobileFraming,
      mobileEvidence,
      requestedDesktopAtlases,
      requestedMobileAtlases,
      atlasRequests,
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
