#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const deploy = process.argv.includes("--deploy");
const evidenceRoot = join(repositoryRoot, ".local", "evidence", deploy
  ? "flowerbox-deploy-smoke"
  : "flowerbox-public-smoke");
const screenshotPath = join(evidenceRoot, "flowerbox.png");
const reportPath = join(evidenceRoot, "report.json");
const port = await freePort();
let serverOutput = "";
const server = spawn("pnpm", deploy ? [
  "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  "--outDir", resolve(repositoryRoot, "dist/site"),
] : [
  "exec", "vite", "--config", "src/adapters/flowerbox/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await mkdir(evidenceRoot, { recursive: true });
  await waitFor(() => serverOutput.includes("Local:"), 20_000);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/${deploy ? "flower/" : ""}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null, { timeout: 30_000 });
    const proof = await page.evaluate(async () => {
      const debug = globalThis.__cssFlowerDebug;
      if (!debug?.ready) throw new Error(document.getElementById("status")?.textContent || "Flower Box debug API missing");
      debug.pause();
      const initial = debug.nodes();
      const root = initial.rotationRoot;
      const leaves = [...initial.leaves];
      const rows = [];
      for (const tick of [0, 102, 831, 9_330, 9_331]) {
        await debug.setTick(tick);
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        const current = debug.nodes();
        rows.push({
          tick,
          sameRoot: current.rotationRoot === root,
          sameLeaves: current.leaves.every((leaf, index) => leaf === leaves[index]),
          stats: debug.stats(),
        });
      }
      await debug.setTick(0);
      const schedulerBefore = debug.stats();
      debug.resume();
      await new Promise((resolveWait) => setTimeout(resolveWait, 3_200));
      debug.pause();
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const schedulerAfter = debug.stats();
      debug.assertStableDomIdentity();
      return {
        portStatus: document.body.dataset.portStatus,
        stagePresentation: document.body.dataset.stagePresentation,
        retainedLeafCount: document.querySelectorAll("[data-cssflower-retained-leaf]").length,
        retainedRootCount: document.querySelectorAll("[data-cssflower-rotation-root]").length,
        canvasCount: document.querySelectorAll("canvas").length,
        svgCount: document.querySelectorAll("svg").length,
        oraclePaneCount: document.querySelectorAll("#native-pane, #diff-pane").length,
        rows,
        schedulerProof: {
          startTick: schedulerBefore.globalTick,
          endTick: schedulerAfter.globalTick,
          tickDelta: schedulerAfter.globalTick - schedulerBefore.globalTick,
          transitionDelta: schedulerAfter.runtimeSchedulerStateTransitions -
            schedulerBefore.runtimeSchedulerStateTransitions,
          skippedPreparedStateCount: schedulerAfter.runtimeSchedulerSkippedPreparedStateCount,
          visualPackLoadDelta: schedulerAfter.projectedPageLoader.packLoadCount -
            schedulerBefore.projectedPageLoader.packLoadCount,
          visualPackReleaseDelta: schedulerAfter.projectedPageLoader.packReleaseCount -
            schedulerBefore.projectedPageLoader.packReleaseCount,
        },
        finalStats: schedulerAfter,
      };
    });
    await page.screenshot({ path: screenshotPath });
    const visibility = inspectVisibility(PNG.sync.read(await page.screenshot()));
    const report = { schema: "cssgraphics-flowerbox-browser-smoke@1", deploy, ...proof, visibility, errors, screenshotPath };
    assertProof(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: "pass", reportPath, screenshotPath, ...visibility, finalStats: report.finalStats }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function assertProof(report) {
  const stats = report.finalStats;
  if (report.portStatus !== "ready" || report.stagePresentation !== "product" || report.errors.length ||
      report.retainedLeafCount !== 1_200 || report.retainedRootCount !== 1 || report.canvasCount || report.svgCount ||
      report.oraclePaneCount || report.visibility.chromaticPixelCount < 1_000 ||
      report.rows.some((row) => !row.sameRoot || !row.sameLeaves) ||
      stats.runtimeGeometryConstructionCount !== 0 || stats.runtimeProjectionCalculationCount !== 0 ||
      stats.runtimeRasterizationCount !== 0 || stats.runtimeNormalCalculationCount !== 0 ||
      stats.runtimeLightingCalculationCount !== 0 || stats.runtimeDomGrowth !== false ||
      stats.runtimeSchedulerSkippedPreparedStateCount !== 0 ||
      report.schedulerProof?.startTick !== 0 || report.schedulerProof.tickDelta < 75 ||
      report.schedulerProof.tickDelta !== report.schedulerProof.transitionDelta ||
      report.schedulerProof.visualPackLoadDelta !== 1 || report.schedulerProof.visualPackReleaseDelta > 1 ||
      stats.projectedPageLoader?.residentPageCount > 2 ||
      stats.projectedPageLoader?.residentPackCount > 2 ||
      stats.projectedPageLoader?.peakResidentPackCount > 2 ||
      stats.projectedPageLoader?.errors?.length) {
    throw new Error(`Flower Box browser smoke failed:\n${JSON.stringify(report, null, 2)}`);
  }
}

function inspectVisibility(png) {
  let nonBlackPixelCount = 0;
  let chromaticPixelCount = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    if (red || green || blue) nonBlackPixelCount += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 12) chromaticPixelCount += 1;
  }
  return { nonBlackPixelCount, chromaticPixelCount };
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

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for Vite:\n${serverOutput}`);
}
