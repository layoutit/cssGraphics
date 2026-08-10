#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const smokeDir = join("bench", "results", "cssmenger", "smoke");
const screenshotPath = join(smokeDir, "default-route.png");
const mobileScreenshotPath = join(smokeDir, "mobile-default-route.png");
const statePath = join(smokeDir, "state.json");
const port = await freePort();
const route = `http://127.0.0.1:${port}/`;
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
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
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null, { timeout: 30_000 });
    await page.evaluate(() => window.__cssMengerDebug.seek(420));
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(250);
    const evidence = await page.evaluate(() => {
      const debug = window.__cssMengerDebug;
      const scene = document.querySelector(".polycss-camera > .polycss-scene");
      const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b, .polycss-camera > .polycss-scene > i, .polycss-camera > .polycss-scene > s")];
      const visibleSampleCount = leaves.filter((leaf, index) => {
        const rect = leaf.getBoundingClientRect();
        const style = getComputedStyle(leaf);
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
          rect.left < innerWidth && rect.top < innerHeight && style.backgroundImage !== "none";
      }).length;
      const frontFacingSchedule = debug.scene.playback.frontFacingSchedule;
      const expectedAxisAtlasPositions = debug.scene.playback.colorRows[420].map((paletteIndex) =>
        debug.scene.planeAtlas.paletteBackgroundPositionYs[paletteIndex]);
      const selectedLeafPalettePositions = [0, 1, 2].map((axis) => {
        const segmentIndex = 420 * frontFacingSchedule.axisCount + axis;
        const start = frontFacingSchedule.offsets[segmentIndex];
        const end = frontFacingSchedule.offsets[segmentIndex + 1];
        return frontFacingSchedule.leafIndices
          .slice(start, end)
          .map((leafIndex) => ({
          leafIndex,
          actual: leaves[leafIndex]?.style.backgroundPositionY ?? "",
          expected: expectedAxisAtlasPositions[axis],
          }));
      });
      const modelTransform = scene?.style.transform ?? "";
      const expectedTransform = debug.scene.playback.transforms[420];
      const actualMatrix = new DOMMatrix(modelTransform).toFloat64Array();
      const expectedMatrix = new DOMMatrix(expectedTransform).toFloat64Array();
      return {
        status: document.body.dataset.portStatus,
        message: document.querySelector(".cssmenger-error-message")?.textContent ?? "",
        ready: debug.ready,
        state: debug.state(),
        stats: debug.stats(),
        stable: debug.assertStableDomIdentity(),
        retainedLeaves: leaves.length,
        retainedRenderWrappers: document.querySelectorAll("body > .polycss-camera, body > .polycss-camera > .polycss-scene").length,
        retainedModelRoots: document.querySelectorAll(".cssmenger-model").length,
        retainedAxisRoots: document.querySelectorAll(".cssmenger-axis").length,
        forbiddenElements: document.querySelectorAll(".polycss-camera canvas, .polycss-camera svg").length,
        shellWordmarkPath: document.querySelector(".site-wordmark-path")?.textContent ?? "",
        shellHomeHref: document.querySelector(".site-wordmark")?.href ?? "",
        shellGithubHref: document.querySelector(".site-action-icon-only")?.href ?? "",
        visibleSampleCount,
        backfaceVisibility: getComputedStyle(leaves[0]).backfaceVisibility,
        inheritedPublicationProperties: ["--m", "--x", "--y", "--z"].map((property) =>
          scene?.style.getPropertyValue(property) ?? ""),
        selectedLeafPalettePositions,
        modelTransform,
        expectedTransform,
        modelTransformMatrixMaxDelta: Math.max(...actualMatrix.map((value, index) =>
          Math.abs(value - expectedMatrix[index]))),
        viewTranslate: scene?.style.translate ?? "",
        viewScale: scene?.style.scale ?? "",
        geometryPayload: Array.isArray(debug.scene.meshes),
        pageMetadataCount: document.querySelectorAll("[data-poly-index], [data-polycss-leaf]").length,
        renderLeafAttributeCounts: leaves.map((leaf) => leaf.attributes.length),
        shellScaffoldingCount: document.querySelectorAll("#app, #scene, #status, main, section, output").length,
        sceneElementCount: document.querySelectorAll(".polycss-camera, .polycss-camera *").length,
      };
    });
    if (pageErrors.length || evidence.status !== "ready" || !evidence.ready || !evidence.stable ||
        evidence.state.tick !== 420 || !evidence.state.paused || evidence.retainedLeaves !== 84 ||
        evidence.retainedRenderWrappers !== 2 || evidence.retainedModelRoots !== 0 ||
        evidence.retainedAxisRoots !== 0 || evidence.forbiddenElements !== 0 || evidence.visibleSampleCount < 10 ||
        evidence.shellWordmarkPath !== "/menger" || evidence.shellHomeHref !== new URL("/", route).href ||
        evidence.shellGithubHref !== "https://github.com/layoutit/cssGraphics" ||
        evidence.backfaceVisibility !== "hidden" ||
        evidence.inheritedPublicationProperties.some(Boolean) ||
        evidence.selectedLeafPalettePositions.flat().some(({ actual, expected }) => actual !== expected) ||
        evidence.modelTransformMatrixMaxDelta > 1e-5 || evidence.viewTranslate !== "0px 0px -980.385px" ||
        evidence.viewScale !== "1.4" || evidence.geometryPayload || evidence.pageMetadataCount !== 0 ||
        evidence.renderLeafAttributeCounts.some((count) => count !== 1) ||
        evidence.shellScaffoldingCount !== 0 || evidence.sceneElementCount !== 86 ||
        evidence.stats.runtimeInstrumentationEnabled || evidence.stats.preparedStatesApplied !== null ||
        evidence.stats.runtimeHotPathDomStyleReadCount !== 0 ||
        evidence.stats.runtimeAdjacentPublicationComparisonCount !== 0 ||
        evidence.stats.runtimeHotPathProfilingBranchCount !== 0 ||
        evidence.stats.runtimeHotPathDebugCounterWritesPerScheduledTick !== 0 ||
        evidence.stats.preparedSchedulerCatchUpMode !== "coalesced-latest-prepared-state" ||
        evidence.stats.preparedFrontFacingAxisSelectionsPerScheduledTick !== 3 ||
        evidence.stats.preparedFrontFacingLeafWritesPerScheduledTick.minimum !== 41 ||
        evidence.stats.preparedFrontFacingLeafWritesPerScheduledTick.maximum !== 50 ||
        evidence.stats.preparedFrontFacingLeafWritesPerScheduledTick.average !== 42.725 ||
        evidence.stats.runtimeDomMutationCount !== 0 || evidence.stats.runtimeGeometryConstructionCount !== 0 ||
        evidence.stats.runtimeRecursionCount !== 0 || evidence.stats.runtimeMergeCount !== 0 ||
        evidence.stats.runtimeColorGenerationCount !== 0 || evidence.stats.runtimeRotationCalculationCount !== 0 ||
        evidence.stats.runtimeCameraCalculationCount !== 0 || !evidence.stats.preparedSourceFaceCoverageExact) {
      throw new Error(`cssMenger browser smoke contract failed: ${JSON.stringify({ evidence, pageErrors })}`);
    }
    await page.screenshot({ path: screenshotPath });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFrames = [];
    for (const tick of [0, 120, 320, 420, 720, 1080, 1439]) {
      await page.evaluate((nextTick) => globalThis.__cssMengerDebug.seek(nextTick), tick);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      mobileFrames.push(await page.evaluate((frameTick) => {
        const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b, .polycss-camera > .polycss-scene > i, .polycss-camera > .polycss-scene > s")];
        const bounds = leaves.map((leaf) => leaf.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
        return {
          tick: frameTick,
          left: Math.min(...bounds.map((rect) => rect.left)),
          right: Math.max(...bounds.map((rect) => rect.right)),
          top: Math.min(...bounds.map((rect) => rect.top)),
          bottom: Math.max(...bounds.map((rect) => rect.bottom)),
          computedScale: getComputedStyle(document.querySelector(".polycss-scene")).scale,
        };
      }, tick));
    }
    if (mobileFrames.some((frame) => frame.left < 0 || frame.right > 390 || frame.top < 50 || frame.bottom > 844 ||
        frame.computedScale !== "1.2")) {
      throw new Error(`cssMenger mobile framing contract failed: ${JSON.stringify(mobileFrames)}`);
    }
    await page.evaluate(() => globalThis.__cssMengerDebug.seek(120));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: mobileScreenshotPath });
    await writeFile(statePath, `${JSON.stringify({ ...evidence, screenshotPath, mobileScreenshotPath, mobileFrames }, null, 2)}\n`);
    console.log(JSON.stringify({ status: "passed", screenshotPath, mobileScreenshotPath, statePath, mobileFrames, ...evidence }, null, 2));
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
