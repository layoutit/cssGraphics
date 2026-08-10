#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const capture = process.argv.includes("--capture");
const deploy = process.argv.includes("--deploy");
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
  const browser = await chromium.launch({ headless: true });
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
        svgInSceneCount: document.querySelectorAll("#scene svg").length,
        bodyBackgroundImage: getComputedStyle(document.body).backgroundImage,
        sceneBackgroundImage: getComputedStyle(document.querySelector("#scene")).backgroundImage,
        transformChanged: before !== after,
        colorfulLeafCount: quads.filter((quad) => {
          const color = getComputedStyle(quad).backgroundColor;
          return color !== "rgb(0, 0, 0)" && color !== "rgba(0, 0, 0, 0)";
        }).length,
        outlinedLeafCount: quads.filter((quad) => getComputedStyle(quad).outlineStyle === "solid").length,
        visibleLeafCount: rectangles.filter((rectangle) => rectangle.right > 0 && rectangle.bottom > 0 &&
          rectangle.left < innerWidth && rectangle.top < innerHeight).length,
        visualBounds,
        sparseStepDelta,
        longRunStepDelta,
        middleStepDelta,
        innerChunkBoundaryStepDelta,
        wrapStepDelta,
        stable: api.assertStableDomIdentity(),
        stats: api.stats(),
      };
    });
    if (pageErrors.length > 0 || evidence.quadCount !== 40 || evidence.perQuadWrapperCount !== 0 ||
        evidence.nestedQuadCount !== 0 ||
        evidence.canvasCount !== 0 || evidence.svgInSceneCount !== 0 ||
        !evidence.bodyBackgroundImage.includes("linear-gradient") ||
        !evidence.sceneBackgroundImage.includes("linear-gradient") || !evidence.transformChanged ||
        evidence.colorfulLeafCount !== 40 || evidence.outlinedLeafCount !== 40 ||
        evidence.visibleLeafCount !== 40 || evidence.visualBounds.right - evidence.visualBounds.left < 25 ||
        evidence.visualBounds.right - evidence.visualBounds.left > 960 ||
        evidence.visualBounds.bottom - evidence.visualBounds.top < 25 ||
        evidence.visualBounds.bottom - evidence.visualBounds.top > 540 || !evidence.stable ||
        Math.abs((evidence.visualBounds.top + evidence.visualBounds.bottom) / 2 - 270) > 30 ||
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
        evidence.stats.presentation.verticalCenterOffsetSourcePixels !== -45) {
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
    console.log(JSON.stringify({ status: "ready", deploy, pageErrors, evidence, screenshotPath }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
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
