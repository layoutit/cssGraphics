#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { captureFrameSleuthTrace } from "../../../../scripts/frame-sleuth-trace.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const execFileAsync = promisify(execFile);
const durationMilliseconds = positiveNumberEnvironment("CSSCITYFLOW_PERF_DURATION_MS", 10_000);
const startupMilliseconds = positiveNumberEnvironment("CSSCITYFLOW_PERF_STARTUP_MS", 2_000);
const cpuThrottleRate = positiveNumberEnvironment("CSSCITYFLOW_PERF_CPU_THROTTLE_RATE", 1);
const viewportWidth = positiveIntegerEnvironment("CSSCITYFLOW_PERF_WIDTH", 2027);
const viewportHeight = positiveIntegerEnvironment("CSSCITYFLOW_PERF_HEIGHT", 1236);
const resultRoot = resolve(
  process.env.CSSCITYFLOW_PERF_OUT ?? resolve(
    repositoryRoot,
    "bench/results/csscityflow/performance",
    new Date().toISOString().replaceAll(":", "-"),
  ),
);
let origin = await runningAstroOrigin();
let server = null;
let ownsServer = false;
let serverOutput = "";
if (!origin || !await routeIsReady(`${origin}/cityflow/`)) {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn("pnpm", [
    "exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port),
    "--ignore-lock",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  ownsServer = true;
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
}
const url = `${origin}/cityflow/`;
try {
  await waitForServer(url, server);
  const capture = await captureFrameSleuthTrace({
    output: resolve(resultRoot, "cityflow.json.gz"),
    url,
    durationMs: durationMilliseconds,
    startupMs: startupMilliseconds,
    headless: true,
    screenshots: false,
    width: viewportWidth,
    height: viewportHeight,
  }, {
    activatePage: async (page) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate });
      await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, {
        timeout: 30_000,
      });
      await page.evaluate(() => globalThis.__csscityflow.player.resume());
    },
  });
  const steady = JSON.parse(await readFile(capture.reports.analysis, "utf8")).steady;
  const draw = capture.cadence.drawFrame;
  const presented = steady.timeline?.stats;
  const presentedFrames = steady.timeline?.frames ?? [];
  const worstPresented = steady.timeline?.worstFrame;
  const worstDraw = capture.worstSteadyFrame;
  const presentedGapsAboveMs = Object.freeze({
    "33.3": presentedFrames.filter(({ intervalMs }) => intervalMs > 33.3).length,
    "40": presentedFrames.filter(({ intervalMs }) => intervalMs > 40).length,
  });
  const acceptance = Object.freeze({
    noPageErrors: capture.errors.length === 0,
    presentedTimelineAvailable: steady.timeline?.source === "AnimationFrame::Presentation" &&
      presented?.eventCount > 0,
    presentedCadenceMean: presented?.meanMs <= 18,
    presentedCadenceP95: presented?.p95Ms <= 20,
    boundedPresentedMaximumGap: presented?.maxMs <= 30,
    noPresentedThirtyThreeMillisecondHolds: presentedGapsAboveMs["33.3"] === 0,
    noPresentedFortyMillisecondHolds: presentedGapsAboveMs["40"] === 0,
    drawCadenceP95: draw.p95Ms <= 20,
    boundedDrawMaximumGap: draw.maxMs <= 30,
    noSmoothnessAffectingPipelineDrops: steady.pipeline.affectsSmoothnessCount === 0,
    boundedMainThread: (worstPresented?.metrics.mainBusyMs ?? Infinity) < 20 &&
      (worstPresented?.metrics.maxRunTaskMs ?? Infinity) < 10,
    boundedPaint: (steady.workload.named.Paint?.maxMs ?? Infinity) < 2,
  });
  const accepted = Object.values(acceptance).every(Boolean);
  console.log(JSON.stringify({
    schema: "csscityflow-performance-qualification@2",
    accepted,
    acceptance,
    cpuThrottleRate,
    viewport: { width: viewportWidth, height: viewportHeight },
    route: url,
    routeKind: "integrated-cssgraphics-project-shell",
    rasterEvidence: steady.capabilities.signals.raster.available
      ? "captured"
      : "not-captured-unknown-not-zero",
    capture: capture.reports.analysis,
    browser: capture.browser,
    cadence: capture.cadence,
    presentedAnimationFrame: Object.freeze({
      source: steady.timeline.source,
      ...presented,
      gapsAboveMs: presentedGapsAboveMs,
    }),
    worstPresentedFrame: worstPresented,
    worstSteadyDrawFrame: worstDraw,
  }, null, 2));
  if (!accepted) process.exitCode = 1;
} finally {
  if (ownsServer && server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => server.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
  }
}

function positiveNumberEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function positiveIntegerEnvironment(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? fallback, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function runningAstroOrigin() {
  if (process.env.CSSCITYFLOW_PERF_ORIGIN) {
    return new URL(process.env.CSSCITYFLOW_PERF_ORIGIN).origin;
  }
  try {
    const { stdout, stderr } = await execFileAsync("pnpm", ["exec", "astro", "dev", "status"], {
      cwd: repositoryRoot,
    });
    return `${stdout}\n${stderr}`.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  await new Promise((resolveClose) => probe.close(resolveClose));
  if (!address || typeof address === "string") throw new Error("Cityflow performance port is unavailable");
  return address.port;
}

async function routeIsReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, processHandle) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processHandle && processHandle.exitCode !== null) {
      throw new Error(`Cityflow performance server exited early:\n${serverOutput}`);
    }
    if (await routeIsReady(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Cityflow performance server did not become ready:\n${serverOutput}`);
}
