#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const outputDir = join(repositoryRoot, "bench", "results", "cssmenger", "performance");
const tracePath = join(outputDir, "chrome-trace.json");
const summaryPath = join(outputDir, "summary.json");
const durationMilliseconds = 10_000;
const calibrationDurationMilliseconds = 5_000;
const viewport = { width: 960, height: 600 };
const port = await freePort();
const route = `http://127.0.0.1:${port}/`;
let serverOutput = "";
const server = spawn("pnpm", ["exec", "vite", "preview", "--config", join(adapterRoot, "vite.config.mjs"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

let browser;
try {
  await mkdir(outputDir, { recursive: true });
  await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite preview exited early:\n${serverOutput}`);
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const sample = { active: false, previousFrame: null, frameIntervals: [], longTasks: [] };
    const observer = typeof PerformanceObserver === "function"
      ? new PerformanceObserver((list) => {
          if (!sample.active) return;
          for (const entry of list.getEntries()) {
            sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        })
      : null;
    try { observer?.observe({ type: "longtask", buffered: true }); } catch {}
    function frame(timestamp) {
      if (sample.active) {
        if (sample.previousFrame !== null) sample.frameIntervals.push(timestamp - sample.previousFrame);
        sample.previousFrame = timestamp;
      } else {
        sample.previousFrame = null;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    globalThis.__cssMengerPerformanceSample = Object.freeze({
      start() {
        sample.frameIntervals.length = 0;
        sample.longTasks.length = 0;
        sample.previousFrame = null;
        sample.active = true;
      },
      stop() {
        sample.active = false;
        return {
          frameIntervals: [...sample.frameIntervals],
          longTasks: [...sample.longTasks],
        };
      },
    });
  });
  await cdp.send("Performance.enable");
  const traceEvents = [];
  cdp.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
  const tracingComplete = new Promise((resolveComplete) => cdp.once("Tracing.tracingComplete", resolveComplete));
  await cdp.send("Tracing.start", {
    categories: [
      "devtools.timeline",
      "blink.user_timing",
      "loading",
      "disabled-by-default-devtools.timeline.frame",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReportEvents",
  });

  const navigationStarted = performance.now();
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__cssMengerDebug?.ready === true, null, { timeout: 30_000 });
  const readyWallMilliseconds = performance.now() - navigationStarted;
  await page.evaluate(() => {
    globalThis.__cssMengerDebug.pause();
    globalThis.__cssMengerDebug.seek(0);
  });
  await page.waitForTimeout(250);

  const startup = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
    return {
      readyPerformanceNowMilliseconds: performance.now(),
      domContentLoadedMilliseconds: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMilliseconds: navigation?.loadEventEnd ?? null,
      responseEndMilliseconds: navigation?.responseEnd ?? null,
      firstPaintMilliseconds: paints["first-paint"] ?? null,
      firstContentfulPaintMilliseconds: paints["first-contentful-paint"] ?? null,
      domElementCount: document.querySelectorAll("*").length,
      retainedLeafCount: document.querySelectorAll(".polycss-camera > .polycss-scene > b, .polycss-camera > .polycss-scene > i, .polycss-camera > .polycss-scene > s").length,
      transfer: performance.getEntriesByType("resource").map((entry) => ({
        name: new URL(entry.name).pathname,
        durationMilliseconds: entry.duration,
        transferSizeBytes: entry.transferSize,
        decodedBodySizeBytes: entry.decodedBodySize,
      })),
      sceneMetrics: globalThis.__cssMengerDebug.scene.metrics,
      stableDom: globalThis.__cssMengerDebug.assertStableDomIdentity(),
      errors: globalThis.__cssMengerDebug.errors(),
    };
  });
  const calibrationBeforeMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  await page.evaluate(() => globalThis.__cssMengerPerformanceSample.start());
  await page.waitForTimeout(calibrationDurationMilliseconds);
  const calibrationSample = await page.evaluate(() => globalThis.__cssMengerPerformanceSample.stop());
  const calibrationAfterMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const beforeMetrics = calibrationAfterMetrics;
  const beforeState = await page.evaluate(() => ({
    state: globalThis.__cssMengerDebug.state(),
    stats: globalThis.__cssMengerDebug.stats(),
  }));
  await page.evaluate(() => {
    globalThis.__cssMengerPerformanceSample.start();
    globalThis.__cssMengerDebug.resume();
  });
  await page.waitForTimeout(durationMilliseconds);
  const sample = await page.evaluate(() => {
    globalThis.__cssMengerDebug.pause();
    return globalThis.__cssMengerPerformanceSample.stop();
  });
  const afterState = await page.evaluate(() => ({
    state: globalThis.__cssMengerDebug.state(),
    stats: globalThis.__cssMengerDebug.stats(),
    stableDom: globalThis.__cssMengerDebug.assertStableDomIdentity(),
    errors: globalThis.__cssMengerDebug.errors(),
  }));
  const afterMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  await cdp.send("Tracing.end");
  await tracingComplete;

  const frameIntervals = sample.frameIntervals.filter((value) => Number.isFinite(value) && value >= 0);
  const longTasks = sample.longTasks.filter((entry) => Number.isFinite(entry.duration));
  const calibrationFrameIntervals = calibrationSample.frameIntervals.filter((value) => Number.isFinite(value) && value >= 0);
  const calibrationLongTasks = calibrationSample.longTasks.filter((entry) => Number.isFinite(entry.duration));
  const summary = {
    schema: "cssmenger-browser-performance-trace@1",
    capturedAt: new Date().toISOString(),
    route,
    build: "vite-production-preview",
    browser: { name: "Google Chrome", version: browserVersion, channel: "chrome", headless: true },
    viewport,
    startup: {
      ...startup,
      readyWallMilliseconds,
    },
    pausedCalibration: {
      durationMilliseconds: calibrationDurationMilliseconds,
      requestAnimationFrame: summarizeDurations(calibrationFrameIntervals),
      overBudgetFrameCount: {
        above16_7Milliseconds: calibrationFrameIntervals.filter((value) => value > 16.7).length,
        above33_3Milliseconds: calibrationFrameIntervals.filter((value) => value > 33.3).length,
        atLeast50Milliseconds: calibrationFrameIntervals.filter((value) => value >= 50).length,
      },
      longTasks: {
        count: calibrationLongTasks.length,
        totalDurationMilliseconds: sum(calibrationLongTasks.map((entry) => entry.duration)),
        maximumDurationMilliseconds: maximum(calibrationLongTasks.map((entry) => entry.duration)),
      },
      mainThread: {
        taskDurationMilliseconds: metricDelta(calibrationBeforeMetrics, calibrationAfterMetrics, "TaskDuration", 1000),
        scriptDurationMilliseconds: metricDelta(calibrationBeforeMetrics, calibrationAfterMetrics, "ScriptDuration", 1000),
        layoutDurationMilliseconds: metricDelta(calibrationBeforeMetrics, calibrationAfterMetrics, "LayoutDuration", 1000),
        styleRecalcDurationMilliseconds: metricDelta(calibrationBeforeMetrics, calibrationAfterMetrics, "RecalcStyleDuration", 1000),
      },
    },
    steadyAnimation: {
      durationMilliseconds,
      tickStart: beforeState.state.tick,
      tickEnd: afterState.state.tick,
      preparedStateAdvanceCount: afterState.state.tick - beforeState.state.tick,
      modelTransformWriteCount: afterState.state.tick - beforeState.state.tick,
      axisColorWriteCount: (afterState.state.tick - beforeState.state.tick) * 3,
      schedulerCallbackCount: afterState.state.tick - beforeState.state.tick,
      runtimeInstrumentationEnabled: afterState.stats.runtimeInstrumentationEnabled,
      runtimeHotPathDomStyleReadCount: afterState.stats.runtimeHotPathDomStyleReadCount,
      runtimeAdjacentPublicationComparisonCount: afterState.stats.runtimeAdjacentPublicationComparisonCount,
      runtimeHotPathProfilingBranchCount: afterState.stats.runtimeHotPathProfilingBranchCount,
      runtimeHotPathDebugCounterWritesPerScheduledTick: afterState.stats.runtimeHotPathDebugCounterWritesPerScheduledTick,
      requestAnimationFrame: summarizeDurations(frameIntervals),
      overBudgetFrameCount: {
        above16_7Milliseconds: frameIntervals.filter((value) => value > 16.7).length,
        above33_3Milliseconds: frameIntervals.filter((value) => value > 33.3).length,
        atLeast50Milliseconds: frameIntervals.filter((value) => value >= 50).length,
      },
      longTasks: {
        count: longTasks.length,
        totalDurationMilliseconds: sum(longTasks.map((entry) => entry.duration)),
        maximumDurationMilliseconds: maximum(longTasks.map((entry) => entry.duration)),
        entries: longTasks,
      },
      mainThread: {
        taskDurationMilliseconds: metricDelta(beforeMetrics, afterMetrics, "TaskDuration", 1000),
        scriptDurationMilliseconds: metricDelta(beforeMetrics, afterMetrics, "ScriptDuration", 1000),
        layoutDurationMilliseconds: metricDelta(beforeMetrics, afterMetrics, "LayoutDuration", 1000),
        styleRecalcDurationMilliseconds: metricDelta(beforeMetrics, afterMetrics, "RecalcStyleDuration", 1000),
        layoutCount: metricDelta(beforeMetrics, afterMetrics, "LayoutCount"),
        styleRecalcCount: metricDelta(beforeMetrics, afterMetrics, "RecalcStyleCount"),
      },
      heap: {
        beforeBytes: beforeMetrics.JSHeapUsedSize ?? null,
        afterBytes: afterMetrics.JSHeapUsedSize ?? null,
        deltaBytes: metricDelta(beforeMetrics, afterMetrics, "JSHeapUsedSize"),
      },
      stableDom: afterState.stableDom,
      runtimeDomMutationCount: afterState.stats.runtimeDomMutationCount,
      runtimeGeometryConstructionCount: afterState.stats.runtimeGeometryConstructionCount,
      runtimeMergeCount: afterState.stats.runtimeMergeCount,
    },
    trace: {
      path: tracePath,
      eventCount: traceEvents.length,
      rendererMainThread: summarizeRendererMainThread(traceEvents),
    },
    errors: [...pageErrors, ...startup.errors, ...afterState.errors],
  };
  summary.assessment = {
    validProductRoute: startup.sceneMetrics.preparedLeafCount === 84 &&
      startup.sceneMetrics.coplanarPartitionOptimal === true &&
      startup.sceneMetrics.sourceFaceCoverageExact === true,
    noRuntimeDomOrGeometryWork: summary.steadyAnimation.runtimeDomMutationCount === 0 &&
      summary.steadyAnimation.runtimeGeometryConstructionCount === 0 &&
      summary.steadyAnimation.runtimeMergeCount === 0,
    noRuntimeInstrumentationWork: summary.steadyAnimation.runtimeInstrumentationEnabled === false &&
      summary.steadyAnimation.runtimeHotPathDomStyleReadCount === 0 &&
      summary.steadyAnimation.runtimeAdjacentPublicationComparisonCount === 0 &&
      summary.steadyAnimation.runtimeHotPathProfilingBranchCount === 0 &&
      summary.steadyAnimation.runtimeHotPathDebugCounterWritesPerScheduledTick === 0,
    noLongTasksDuringSteadyAnimation: summary.steadyAnimation.longTasks.count === 0,
    noFiftyMillisecondFrames: summary.steadyAnimation.overBudgetFrameCount.atLeast50Milliseconds === 0,
    noErrors: summary.errors.length === 0,
  };
  await writeFile(tracePath, `${JSON.stringify({ traceEvents }, null, 0)}\n`);
  summary.trace.sizeBytes = (await stat(tracePath)).size;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ summaryPath, tracePath, ...summary }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill("SIGTERM");
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name, scale = 1) {
  if (!Number.isFinite(before[name]) || !Number.isFinite(after[name])) return null;
  return (after[name] - before[name]) * scale;
}

function summarizeDurations(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    meanMilliseconds: sorted.length ? sum(sorted) / sorted.length : null,
    p50Milliseconds: percentile(sorted, 0.5),
    p95Milliseconds: percentile(sorted, 0.95),
    p99Milliseconds: percentile(sorted, 0.99),
    maximumMilliseconds: maximum(sorted),
  };
}

function summarizeRendererMainThread(events) {
  const mainThreads = new Set(events
    .filter((event) => event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain")
    .map((event) => `${event.pid}:${event.tid}`));
  const names = new Set(["RunTask", "FunctionCall", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "CompositeLayers", "FireAnimationFrame"]);
  const totals = {};
  for (const event of events) {
    if (event.ph !== "X" || !Number.isFinite(event.dur) || !mainThreads.has(`${event.pid}:${event.tid}`) || !names.has(event.name)) continue;
    const row = totals[event.name] ?? { count: 0, totalDurationMilliseconds: 0, maximumDurationMilliseconds: 0 };
    const durationMilliseconds = event.dur / 1000;
    row.count += 1;
    row.totalDurationMilliseconds += durationMilliseconds;
    row.maximumDurationMilliseconds = Math.max(row.maximumDurationMilliseconds, durationMilliseconds);
    totals[event.name] = row;
  }
  return { threadCount: mainThreads.size, events: totals };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function maximum(values) {
  return values.length ? Math.max(...values) : null;
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
  throw new Error(`Timed out waiting for Vite preview.\n${serverOutput}`);
}
