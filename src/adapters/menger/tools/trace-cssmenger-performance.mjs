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
const durationMilliseconds = positiveNumber("CSSMENGER_PERF_DURATION_MS", 10_000);
const calibrationDurationMilliseconds = positiveNumber("CSSMENGER_PERF_CALIBRATION_MS", 5_000);
const viewport = {
  width: positiveInteger("CSSMENGER_PERF_VIEWPORT_WIDTH", 960),
  height: positiveInteger("CSSMENGER_PERF_VIEWPORT_HEIGHT", 600),
};
const deviceScaleFactor = positiveNumber("CSSMENGER_PERF_DEVICE_SCALE_FACTOR", 1);
const cpuThrottlingRate = positiveNumber("CSSMENGER_PERF_CPU_THROTTLE", 1);
const steadyTraceStartMark = "cssmenger-steady-animation-start";
const steadyTraceEndMark = "cssmenger-steady-animation-end";
const routeQuery = process.env.CSSMENGER_PERF_ROUTE_QUERY ?? "";
if (routeQuery && !/^\?[a-z0-9=&-]+$/u.test(routeQuery)) {
  throw new Error("CSSMENGER_PERF_ROUTE_QUERY must be a safe query string beginning with ?");
}
const port = await freePort();
const route = `http://127.0.0.1:${port}/${routeQuery}`;
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
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (cpuThrottlingRate !== 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottlingRate });
  }
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
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.paint",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReportEvents",
  });

  const navigationStarted = performance.now();
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__cssMengerDebug?.ready === true, null, { timeout: 30_000 });
  const readyWallMilliseconds = performance.now() - navigationStarted;
  await page.evaluate(async () => {
    globalThis.__cssMengerDebug.pause();
    await globalThis.__cssMengerDebug.seek(0);
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
      retainedLeafCount: document.querySelectorAll(
        ".polycss-camera > .polycss-scene > b",
      ).length,
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
  await page.evaluate((traceStartMark) => {
    performance.mark(traceStartMark);
    globalThis.__cssMengerPerformanceSample.start();
    globalThis.__cssMengerDebug.resume();
  }, steadyTraceStartMark);
  await page.waitForTimeout(durationMilliseconds);
  const sampledState = await page.evaluate((traceEndMark) => {
    performance.mark(traceEndMark);
    const sample = globalThis.__cssMengerPerformanceSample.stop();
    return {
      sample,
      state: globalThis.__cssMengerDebug.state(),
      stats: globalThis.__cssMengerDebug.stats(),
      stableDom: globalThis.__cssMengerDebug.assertStableDomIdentity(),
      errors: globalThis.__cssMengerDebug.errors(),
    };
  }, steadyTraceEndMark);
  const afterMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  await cdp.send("Tracing.end");
  await tracingComplete;
  await page.evaluate(() => globalThis.__cssMengerDebug.pause());

  const sample = sampledState.sample;
  const afterState = sampledState;
  const frameIntervals = sample.frameIntervals.filter((value) => Number.isFinite(value) && value >= 0);
  const longTasks = sample.longTasks.filter((entry) => Number.isFinite(entry.duration));
  const calibrationFrameIntervals = calibrationSample.frameIntervals.filter((value) => Number.isFinite(value) && value >= 0);
  const calibrationLongTasks = calibrationSample.longTasks.filter((entry) => Number.isFinite(entry.duration));
  const steadyImageDecodes = summarizeTraceWindowEvents(
    traceEvents,
    steadyTraceStartMark,
    steadyTraceEndMark,
    "ImageDecodeTask",
  );
  const summary = {
    schema: "cssmenger-browser-performance-trace@2",
    capturedAt: new Date().toISOString(),
    route,
    build: "vite-production-preview",
    browser: { name: "Google Chrome", version: browserVersion, channel: "chrome", headless: true },
    viewport: { ...viewport, deviceScaleFactor },
    cpuThrottlingRate,
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
      modelTransformWriteUpperBound:
        (afterState.state.tick - beforeState.state.tick) *
        afterState.stats.runtimeRotationStyleWriteCountPerScheduledTick,
      lightingAddressWriteUpperBound:
        (afterState.state.tick - beforeState.state.tick) *
        afterState.stats.preparedLightingAddressWritesPerScheduledTick.maximum,
      lightingAddressWriteExpectedFromPreparedAverage:
        (afterState.state.tick - beforeState.state.tick) *
        afterState.stats.preparedLightingAddressWritesPerScheduledTick.average,
      schedulerCallbackCount: null,
      preparedLightingAddressUpdateCount: afterState.stats.preparedLightingAddressUpdateCount,
      preparedRedundantLightingAddressWriteCountRemoved:
        afterState.stats.preparedRedundantLightingAddressWriteCountRemoved,
      runtimeHotPathDomStyleReadCount: afterState.stats.runtimeHotPathDomStyleReadCount,
      runtimeLightingAddressComparisonCount: afterState.stats.runtimeLightingAddressComparisonCount,
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
      steadyImageDecodes,
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
    noRuntimeInstrumentationWork: summary.steadyAnimation.runtimeHotPathDomStyleReadCount === 0 &&
      summary.steadyAnimation.runtimeLightingAddressComparisonCount === 0,
    noLongTasksDuringSteadyAnimation: summary.steadyAnimation.longTasks.count === 0,
    noFiftyMillisecondFrames: summary.steadyAnimation.overBudgetFrameCount.atLeast50Milliseconds === 0,
    noImageDecodesDuringSteadyAnimation: summary.trace.steadyImageDecodes.count === 0,
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
  const names = new Set([
    "RunTask", "FunctionCall", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "PaintImage",
    "CompositeLayers", "FireAnimationFrame", "ImageDecodeTask", "RasterTask",
  ]);
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

function summarizeTraceWindowEvents(events, startMark, endMark, eventName) {
  const start = events.find((event) => event.name === startMark)?.ts;
  const end = events.find((event) => event.name === endMark)?.ts;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`Trace is missing the ${startMark}..${endMark} measurement window`);
  }
  const durations = events
    .filter((event) => {
      if (event.name !== eventName || event.ph !== "X" || !Number.isFinite(event.ts) || !Number.isFinite(event.dur)) return false;
      return event.ts < end && event.ts + event.dur > start;
    })
    .map((event) => event.dur / 1000);
  return {
    count: durations.length,
    totalDurationMilliseconds: sum(durations),
    maximumDurationMilliseconds: maximum(durations),
  };
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

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = positiveNumber(name, fallback);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a positive integer`);
  return value;
}
