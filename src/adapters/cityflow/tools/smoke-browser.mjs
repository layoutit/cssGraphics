#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = resolve(repositoryRoot, "bench/results/csscityflow/smoke");
const externalUrl = process.env.CSSCITYFLOW_SMOKE_URL;
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
  const desktop = await capture({ profile: "desktop", width: 1280, height: 720, bankId: "desktop", boxes: 200, leaves: 600 });
  const mobile = await capture({ profile: "mobile", width: 390, height: 844, bankId: "desktop", boxes: 200, leaves: 600 });
  const report = { schema: "csscityflow-browser-smoke@1", route, desktop, mobile };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}

async function capture({ profile, width, height, bankId, boxes, leaves }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("ready") ||
    document.body.classList.contains("error"), null, { timeout: 30_000 });
  const before = await page.evaluate(() => {
    const state = globalThis.__csscityflow;
    const shapes = [...document.querySelectorAll(".csscityflow-box")];
    let stable = true;
    try { state?.mounted?.assertStableDomIdentity(); } catch { stable = false; }
    return {
      status: document.body.className,
      ready: state?.ready,
      bankId: state?.bankId,
      errors: state?.errors ?? [],
      stable,
      shapeCount: shapes.length,
      leafCount: document.querySelectorAll(".csscityflow-box > b").length,
      canvasCount: document.querySelectorAll("canvas").length,
      svgSceneCount: document.querySelectorAll(".polycss-camera svg").length,
      animationName: getComputedStyle(shapes[0]).animationName,
      transforms: shapes.slice(0, 40).map((shape) => getComputedStyle(shape).transform),
      atlasConstructions: state?.mounted?.stats?.atlasConstructions,
      atlasRedraws: state?.mounted?.stats?.atlasRedraws ?? 0,
      player: state?.player?.stats(),
    };
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const shapes = [...document.querySelectorAll(".csscityflow-box")];
    return {
      transforms: shapes.slice(0, 40).map((shape) => getComputedStyle(shape).transform),
      player: globalThis.__csscityflow?.player?.stats(),
    };
  });
  const changedTransformCount = before.transforms.reduce((sum, transform, index) =>
    sum + Number(transform !== after.transforms[index]), 0);
  if (errors.length || before.errors.length || before.status !== "ready" || !before.ready ||
      before.bankId !== bankId || !before.stable || before.shapeCount !== boxes ||
      before.leafCount !== leaves || before.canvasCount !== 0 || before.svgSceneCount !== 0 ||
      before.animationName !== "none" || before.player?.catchUpPolicy !== "elapsed" ||
      after.player?.timerCallbackCount < 1 || after.player?.animationFrameCallbackCount < 1 ||
      changedTransformCount === 0 || before.atlasConstructions !== 0 || before.atlasRedraws !== 0) {
    throw new Error(`Cityflow ${profile} browser smoke failed: ${JSON.stringify({ before, after, changedTransformCount, errors })}`);
  }
  const screenshotPath = resolve(outputRoot, `${profile}.png`);
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return Object.freeze({ width, height, boxes, leaves, changedTransformCount, screenshotPath });
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
