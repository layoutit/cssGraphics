#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssplatonicfolding/smoke");
const externalUrl = process.env.CSSPLATONICFOLDING_SMOKE_URL;
const port = externalUrl ? null : await freePort();
const route = externalUrl ?? `http://127.0.0.1:${port}/`;
let server = null;
let serverOutput = "";
if (!externalUrl) {
  server = spawn("pnpm", [
    "exec", "vite", "--config", resolve(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
}

let browser;
try {
  await mkdir(outputRoot, { recursive: true });
  if (server) await waitFor(() => serverOutput.includes("Local:"), 20_000);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktop = await capture({ profile: "desktop", width: 1280, height: 800, bankId: "desktop" });
  const mobile = await capture({ profile: "mobile", width: 390, height: 844, bankId: "mobile" });
  const report = { schema: "cssplatonicfolding-browser-smoke@1", route, desktop, mobile };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}

async function capture({ profile, width, height, bankId }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("ready") ||
    document.body.classList.contains("error"), null, { timeout: 30_000 });
  const before = await page.evaluate(() => ({
    status: document.body.className,
    ready: window.__cssPlatonicFoldingDebug?.ready,
    errors: window.__cssPlatonicFoldingDebug?.errors ?? [],
    stats: window.__cssPlatonicFoldingDebug?.stats(),
    modelTransform: document.querySelector(".polycss-scene > div")?.style.transform,
    leafCount: document.querySelectorAll(".polycss-scene s").length,
    canvasCount: document.querySelectorAll("canvas").length,
    svgSceneCount: document.querySelectorAll(".polycss-camera svg").length,
  }));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    stats: window.__cssPlatonicFoldingDebug?.stats(),
    modelTransform: document.querySelector(".polycss-scene > div")?.style.transform,
  }));
  await page.evaluate(() => {
    window.__cssPlatonicFoldingDebug.pause();
    window.__cssPlatonicFoldingDebug.seekFrame(270);
  });
  const visibleLeaves = await page.evaluate(() => [...document.querySelectorAll(".polycss-scene s")]
    .filter((leaf) => getComputedStyle(leaf).visibility !== "hidden").length);
  const loop = await page.evaluate(() => {
    window.__cssPlatonicFoldingDebug.seekFrame(2709);
    window.__cssPlatonicFoldingDebug.seekFrame(0);
    return {
      stats: window.__cssPlatonicFoldingDebug.stats(),
      visibleLeaves: [...document.querySelectorAll(".polycss-scene s")]
        .filter((leaf) => getComputedStyle(leaf).visibility !== "hidden").length,
    };
  });
  if (errors.length || before.errors.length || before.status !== "ready" || !before.ready ||
      before.stats?.selectedPreparedBank !== bankId || before.stats?.retainedFaceRootCount !== 50 ||
      before.leafCount !== 50 || visibleLeaves !== 20 || before.canvasCount !== 0 ||
      before.svgSceneCount !== 0 || before.stats?.runtimeGeometryConstructionCount !== 0 ||
      before.stats?.runtimeAtlasRasterizationCount !== 0 || before.stats?.runtimeDomGrowth !== false ||
      before.stats?.preparedStateMaterializationCount !== 0 ||
      before.stats?.runtimeFullStateDiffCount !== 0 ||
      before.stats?.runtimeMatrixFormattingCount !== 0 ||
      before.stats?.runtimeIdLookupCount !== 0 ||
      before.stats?.runtimeNormalFullStateScanCount !== 0 ||
      before.stats?.runtimeHiddenShapeTransformWrites !== 0 ||
      before.stats?.runtimeHiddenAtlasRowWrites !== 0 ||
      before.stats?.retainedDomStable !== true ||
      loop.visibleLeaves !== 20 || loop.stats?.frameIndex !== 0 ||
      loop.stats?.runtimeNormalFullStateScanCount !== 0 ||
      loop.stats?.runtimeHiddenShapeTransformWrites !== 0 ||
      loop.stats?.runtimeHiddenAtlasRowWrites !== 0 ||
      after.stats?.timerCallbackCount <= before.stats?.timerCallbackCount ||
      after.stats?.applyCount <= before.stats?.applyCount ||
      before.modelTransform === after.modelTransform) {
    throw new Error(`Platonic Folding ${profile} browser smoke failed: ${JSON.stringify({ before, after, loop, visibleLeaves, errors })}`);
  }
  await page.evaluate(() => window.__cssPlatonicFoldingDebug.seekFrame(270));
  const screenshotPath = resolve(outputRoot, `${profile}.png`);
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return Object.freeze({ width, height, bankId, leaves: 50, visibleLeaves, screenshotPath });
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
    if (Date.now() - started > timeoutMilliseconds) {
      throw new Error(`Platonic Folding server did not start:\n${serverOutput}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
