#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium, firefox } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const capture = process.argv.includes("--capture");
const deploy = process.argv.includes("--deploy");
const useFirefox = process.argv.includes("--firefox");
const presentationExtremeStates = Object.freeze({
  "kent-seed-01": Object.freeze([32_714, 20_382]),
  "kent-seed-02": Object.freeze([62_653, 45_447]),
  "kent-seed-03": Object.freeze([51_954, 55_639]),
  "kent-seed-04": Object.freeze([21_792, 3_144]),
  "kent-seed-05": Object.freeze([17_138, 46_314]),
  "kent-seed-06": Object.freeze([15_623, 18]),
  "kent-seed-07": Object.freeze([39_707, 9_052]),
  "kent-seed-08": Object.freeze([23_311, 28_913]),
});
const port = await freePort();
let output = "";
const server = spawn("pnpm", deploy ? [
  "exec", "vite", "preview",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  "--outDir", `${repositoryRoot}/dist/site`,
] : [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await (useFirefox ? firefox : chromium).launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}${deploy ? "/electropaint/" : "/"}`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      () => window.__cssElectropaint?.status === "ready" || window.__cssElectropaint?.status === "error",
      null,
      { timeout: 120_000 },
    );
    const status = await page.evaluate(() => window.__cssElectropaint.status);
    if (status !== "ready") {
      throw new Error(await page.evaluate(() => window.__cssElectropaint.error || "ElectroPaint client failed"));
    }
    const evidence = await page.evaluate(async () => {
      const api = window.__cssElectropaint;
      api.pause();
      await api.setState(359);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const quads = [...document.querySelectorAll(".polycss-scene > b")];
      const statDelta = (beforeStats, afterStats) => Object.fromEntries(Object.keys(afterStats).map((key) => [
        key,
        typeof afterStats[key] === "number" && typeof beforeStats[key] === "number"
          ? afterStats[key] - beforeStats[key]
          : afterStats[key],
      ]));
      const before = quads[0]?.style.transform;
      const statsBeforeSparseStep = api.stats().player;
      api.step(1);
      const statsAfterSparseStep = api.stats().player;
      const after = quads[0]?.style.transform;
      const sparseStepDelta = statDelta(statsBeforeSparseStep, statsAfterSparseStep);
      await api.setState(63_998);
      const statsBeforeLongRunStep = api.stats().player;
      api.step(1);
      const longRunStepDelta = statDelta(statsBeforeLongRunStep, api.stats().player);
      await api.setState(2_352);
      const statsBeforeMiddleStep = api.stats().player;
      api.step(1);
      const middleStepDelta = statDelta(statsBeforeMiddleStep, api.stats().player);
      await api.setState(499);
      const statsBeforeInnerChunkBoundaryStep = api.stats().player;
      api.step(1);
      const innerChunkBoundaryStepDelta = statDelta(
        statsBeforeInnerChunkBoundaryStep,
        api.stats().player,
      );
      await api.setState(63_999);
      const statsBeforeWrapStep = api.stats().player;
      api.step(1);
      const wrapStepDelta = statDelta(statsBeforeWrapStep, api.stats().player);
      await api.setState(359);
      const rectangles = quads.map((quad) => quad.getBoundingClientRect());
      const host = document.body;
      const hostRectangle = host.getBoundingClientRect();
      const camera = document.querySelector(".polycss-camera");
      const scene = document.querySelector(".polycss-scene");
      const visualBounds = {
        left: Math.min(...rectangles.map((rectangle) => rectangle.left)),
        top: Math.min(...rectangles.map((rectangle) => rectangle.top)),
        right: Math.max(...rectangles.map((rectangle) => rectangle.right)),
        bottom: Math.max(...rectangles.map((rectangle) => rectangle.bottom)),
      };
      return {
        stateIndex: api.stats().player.stateIndex,
        quadCount: quads.length,
        perQuadWrapperCount: document.querySelectorAll(".polycss-scene > div").length,
        nestedQuadCount: document.querySelectorAll(".polycss-scene > * > b").length,
        canvasCount: document.querySelectorAll("canvas").length,
        svgInSceneCount: camera.querySelectorAll("svg").length,
        legacySceneHostCount: document.querySelectorAll("#scene").length,
        directCameraCount: host.querySelectorAll(":scope > .polycss-camera").length,
        bodyBackgroundImage: getComputedStyle(document.body).backgroundImage,
        sceneBackgroundImage: getComputedStyle(host).backgroundImage,
        headerBackgroundColor: getComputedStyle(document.querySelector(".site-header")).backgroundColor,
        headerBackgroundImage: getComputedStyle(document.querySelector(".site-header")).backgroundImage,
        headerPointerEvents: getComputedStyle(document.querySelector(".site-header")).pointerEvents,
        transformChanged: before !== after,
        colorfulLeafCount: quads.filter((quad) => {
          const color = getComputedStyle(quad).backgroundColor;
          return color !== "rgb(0, 0, 0)" && color !== "rgba(0, 0, 0, 0)";
        }).length,
        outlinedLeafCount: quads.filter((quad) => getComputedStyle(quad).outlineStyle === "solid").length,
        visibleLeafCount: rectangles.filter((rectangle) => rectangle.right > 0 && rectangle.bottom > 0 &&
          rectangle.left < innerWidth && rectangle.top < innerHeight).length,
        visualBounds,
        hostBounds: hostRectangle.toJSON(),
        hostInlineStyle: host.getAttribute("style"),
        cameraInlineStyle: camera.getAttribute("style"),
        sceneInlineStyle: scene.getAttribute("style"),
        cameraPerspective: getComputedStyle(camera).perspective,
        cameraScale: getComputedStyle(camera).scale,
        sparseStepDelta,
        longRunStepDelta,
        middleStepDelta,
        innerChunkBoundaryStepDelta,
        wrapStepDelta,
        stable: api.assertStableDomIdentity(),
        stats: api.stats(),
      };
    });
    const selectedVariantId = await page.evaluate(() => window.__cssElectropaint.selectedVariant.id);
    const extremeStates = presentationExtremeStates[selectedVariantId];
    if (!extremeStates) throw new Error(`ElectroPaint variant has no presentation extrema: ${selectedVariantId}`);
    const desktopExtremeBounds = await measureExtremeBounds(page, extremeStates);
    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeExtremeBounds = await measureExtremeBounds(page, extremeStates);
    if (pageErrors.length > 0 || evidence.quadCount !== 40 || evidence.perQuadWrapperCount !== 0 ||
        evidence.nestedQuadCount !== 0 || evidence.legacySceneHostCount !== 0 ||
        evidence.directCameraCount !== 1 ||
        evidence.canvasCount !== 0 || evidence.svgInSceneCount !== 0 ||
        !evidence.bodyBackgroundImage.includes("linear-gradient") ||
        !evidence.sceneBackgroundImage.includes("linear-gradient") || !evidence.transformChanged ||
        evidence.colorfulLeafCount !== 40 || evidence.outlinedLeafCount !== 40 ||
        evidence.visibleLeafCount !== 40 || evidence.hostBounds.top !== 0 ||
        evidence.hostBounds.bottom !== 540 ||
        evidence.headerBackgroundColor !== "rgba(0, 0, 0, 0)" ||
        evidence.headerBackgroundImage !== "none" || evidence.headerPointerEvents !== "none" ||
        evidence.visualBounds.right - evidence.visualBounds.left < 25 ||
        evidence.visualBounds.right - evidence.visualBounds.left > 960 ||
        evidence.visualBounds.bottom - evidence.visualBounds.top < 25 ||
        evidence.visualBounds.bottom - evidence.visualBounds.top > 540 ||
        evidence.visualBounds.top < 0 || evidence.visualBounds.bottom > 540 || !evidence.stable ||
        evidence.hostInlineStyle !== null || evidence.cameraInlineStyle !== null ||
        evidence.sceneInlineStyle !== null ||
        evidence.cameraPerspective !== "1000px" ||
        Math.abs(Number.parseFloat(evidence.cameraScale) - (268 / 311)) > 0.000_01 ||
        desktopExtremeBounds.top < 0 || desktopExtremeBounds.bottom > 540 ||
        landscapeExtremeBounds.top < 0 || landscapeExtremeBounds.bottom > 390 ||
        evidence.stats.player.runtimeGeometryConstructionCount !== 0 ||
        evidence.stats.player.runtimeMatrixCalculationCount !== 0 ||
        evidence.stats.player.runtimeColorCalculationCount !== 0 ||
        evidence.stats.player.runtimeRandomGenerationCount !== 0 ||
        evidence.stats.player.runtimeCameraCalculationCount !== 0 ||
        evidence.stats.player.runtimeCadenceCalculationCount !== 0 ||
        evidence.stats.player.runtimeLeafWideComparisonCount !== 0 ||
        evidence.stats.player.runtimeRingIndexCalculationCount !== 0 ||
        evidence.stats.player.runtimeColorWrites !== 0 ||
        evidence.stats.player.runtimeOutlineWrites !== 0 ||
        evidence.stats.player.runtimeAnimationFrameCallbackCount !== 0 ||
        evidence.stats.player.preparedTimelineStateCount !== 64_000 ||
        evidence.stats.player.preparedTimelineChunkCount !== 128 ||
        evidence.stats.player.preparedFramesPerChunk !== 500 ||
        evidence.stats.player.preparedLoadedChunkCount !== 4 ||
        evidence.stats.player.preparedDecodedChunkCount !== 4 ||
        evidence.stats.player.preparedRetainedChunkRequestCount !== 4 ||
        evidence.stats.player.preparedCadenceScheduleStateCount !== 0 ||
        evidence.sparseStepDelta.runtimeRootTransformWrites !== 0 ||
        evidence.sparseStepDelta.runtimeTransformWrites !== 40 ||
        evidence.sparseStepDelta.runtimeColorClassWrites > 1 ||
        evidence.sparseStepDelta.runtimeColorWrites !== 0 ||
        evidence.sparseStepDelta.runtimeOutlineWrites !== 0 ||
        evidence.sparseStepDelta.runtimeLeafWideComparisonCount !== 0 ||
        evidence.sparseStepDelta.runtimeRingIndexCalculationCount !== 0 ||
        evidence.sparseStepDelta.runtimeMatrixCalculationCount !== 0 ||
        evidence.sparseStepDelta.runtimeCadenceCalculationCount !== 0 ||
        evidence.sparseStepDelta.runtimeCadenceDelayLookupCount !== 0 ||
        evidence.longRunStepDelta.runtimeRootTransformWrites !== 0 ||
        evidence.longRunStepDelta.runtimeTransformWrites !== 40 ||
        evidence.longRunStepDelta.runtimeColorClassWrites > 1 ||
        evidence.longRunStepDelta.runtimeLeafWideComparisonCount !== 0 ||
        evidence.longRunStepDelta.runtimeMatrixCalculationCount !== 0 ||
        evidence.longRunStepDelta.runtimeCadenceDelayLookupCount !== 0 ||
        evidence.middleStepDelta.runtimeRootTransformWrites !== 0 ||
        evidence.middleStepDelta.runtimeTransformWrites !== 40 ||
        evidence.middleStepDelta.runtimeColorClassWrites > 1 ||
        evidence.middleStepDelta.runtimeLeafWideComparisonCount !== 0 ||
        evidence.middleStepDelta.runtimeMatrixCalculationCount !== 0 ||
        evidence.middleStepDelta.runtimeCadenceDelayLookupCount !== 0 ||
        evidence.innerChunkBoundaryStepDelta.runtimeRootTransformWrites !== 0 ||
        evidence.innerChunkBoundaryStepDelta.runtimeTransformWrites !== 40 ||
        evidence.innerChunkBoundaryStepDelta.runtimeColorClassWrites > 1 ||
        evidence.innerChunkBoundaryStepDelta.preparedInnerChunkBoundaryCount !== 1 ||
        evidence.innerChunkBoundaryStepDelta.runtimeInnerChunkBoundaryResetCount !== 0 ||
        evidence.innerChunkBoundaryStepDelta.deterministicBankLoopCount !== 0 ||
        evidence.innerChunkBoundaryStepDelta.runtimeLeafWideComparisonCount !== 0 ||
        evidence.innerChunkBoundaryStepDelta.runtimeMatrixCalculationCount !== 0 ||
        evidence.innerChunkBoundaryStepDelta.runtimeCadenceDelayLookupCount !== 0 ||
        evidence.wrapStepDelta.runtimeRootTransformWrites !== 0 ||
        evidence.wrapStepDelta.runtimeTransformWrites !== 40 ||
        evidence.wrapStepDelta.runtimeColorClassWrites !== 40 ||
        evidence.wrapStepDelta.deterministicBankLoopCount !== 1 ||
        evidence.wrapStepDelta.runtimeLeafWideComparisonCount !== 0 ||
        evidence.wrapStepDelta.runtimeMatrixCalculationCount !== 0 ||
        evidence.wrapStepDelta.runtimeCadenceDelayLookupCount !== 0 ||
        evidence.stats.scene.runtimeDomGrowth !== false ||
        evidence.stats.scene.retainedQuadCount !== 40 ||
        evidence.stats.scene.retainedPerQuadWrapperCount !== 0 ||
        evidence.stats.presentation.verticalCenterOffsetSourcePixels !== -35 ||
        evidence.stats.presentation.resizeCount < 1 ||
        evidence.stats.presentation.runtimeStyleWriteCount !== 0 ||
        evidence.stats.presentation.runtimeStylesheetRuleWriteCount < 1) {
      throw new Error(`ElectroPaint browser smoke failed: ${JSON.stringify({ pageErrors, evidence }, null, 2)}`);
    }
    let screenshotPath = null;
    if (capture) {
      await page.evaluate(() => globalThis.__cssElectropaint.setState(2_353));
      await page.waitForTimeout(100);
      screenshotPath = resolve(repositoryRoot, "captures", "electropaint", "browser-state-2353.png");
      await mkdir(resolve(repositoryRoot, "captures", "electropaint"), { recursive: true });
      await page.screenshot({ path: screenshotPath });
    }
    console.log(JSON.stringify({
      status: "ready",
      deploy,
      pageErrors,
      evidence,
      selectedVariantId,
      desktopExtremeBounds,
      landscapeExtremeBounds,
      screenshotPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function measureExtremeBounds(page, stateIndices) {
  return page.evaluate(async (indices) => {
    const api = window.__cssElectropaint;
    const quads = [...document.querySelectorAll(".polycss-scene > b")];
    let top = Infinity;
    let bottom = -Infinity;
    for (const stateIndex of indices) {
      await api.setState(stateIndex);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const rectangles = quads.map((quad) => quad.getBoundingClientRect());
      top = Math.min(top, ...rectangles.map((rectangle) => rectangle.top));
      bottom = Math.max(bottom, ...rectangles.map((rectangle) => rectangle.bottom));
    }
    return { top, bottom, viewportHeight: innerHeight };
  }, stateIndices);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (!predicate()) {
    onPoll();
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
