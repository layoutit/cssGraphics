#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const label = process.env.CSSSELECTROPAINT_TRACE_LABEL ?? "current";
const warmupMilliseconds = boundedInteger("CSSSELECTROPAINT_TRACE_WARMUP_MS", 2_000, 500, 20_000);
const phaseMilliseconds = boundedInteger("CSSSELECTROPAINT_TRACE_DURATION_MS", 5_000, 1_000, 30_000);
const outputRoot = resolve(
  process.env.CSSSELECTROPAINT_TRACE_OUTPUT ?? `bench/results/cssselectropaint/performance/${label}`,
);
const summaryPath = resolve(outputRoot, "summary.json");
const tracePath = resolve(outputRoot, "trace.json");

const port = await freePort();
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => globalThis.__cssElectropaint?.status === "ready" || globalThis.__cssElectropaint?.status === "error",
      null,
      { timeout: 120_000 },
    );
    const ready = await page.evaluate(() => globalThis.__cssElectropaint?.status);
    if (ready !== "ready") throw new Error(await page.evaluate(() => globalThis.__cssElectropaint?.error));
    await page.waitForTimeout(warmupMilliseconds);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    const paused = await measurePhase({ page, cdp, durationMilliseconds: phaseMilliseconds, playing: false });
    const playing = await measurePhase({ page, cdp, durationMilliseconds: phaseMilliseconds, playing: true });
    const traced = await measureTracedPhase({ page, cdp, durationMilliseconds: phaseMilliseconds, tracePath });
    const mutationAudit = await measureMutationAudit(page, Math.min(2_000, phaseMilliseconds));
    const boundaryAudit = await measureBoundaryAudit(page);
    const cadenceAudit = await measureCadenceAudit(page);
    const browserIdentity = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
    }));
    const summary = {
      schema: "cssselectropaint-performance-trace@1",
      label,
      capturedAt: new Date().toISOString(),
      browser: chromeVersion(browserIdentity.userAgent),
      viewport: browserIdentity.viewport,
      warmupMilliseconds,
      phaseMilliseconds,
      paused,
      playing,
      traced,
      mutationAudit,
      boundaryAudit,
      cadenceAudit,
      comparison: {
        activeMinusPausedTaskTimeMsPerSecond: perSecond(
          playing.performanceMetricDelta.TaskDuration - paused.performanceMetricDelta.TaskDuration,
          playing.wallDurationMilliseconds,
          1_000,
        ),
        activeScriptTimeMsPerSecond: perSecond(
          playing.performanceMetricDelta.ScriptDuration,
          playing.wallDurationMilliseconds,
          1_000,
        ),
        activeStyleTimeMsPerSecond: perSecond(
          playing.performanceMetricDelta.RecalcStyleDuration,
          playing.wallDurationMilliseconds,
          1_000,
        ),
        activeLayoutTimeMsPerSecond: perSecond(
          playing.performanceMetricDelta.LayoutDuration,
          playing.wallDurationMilliseconds,
          1_000,
        ),
        appWritesPerPublishedState: writesPerState(playing.appCounterDelta),
      },
      tracePath,
    };
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ summaryPath, ...summary }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function measurePhase({ page, cdp, durationMilliseconds, playing }) {
  await page.evaluate(async (shouldPlay) => {
    globalThis.__cssElectropaint.pause();
    await globalThis.__cssElectropaint.setState(0);
    const sample = { frameIntervals: [], longTasks: [], rafId: 0, observer: null };
    let previous;
    const onFrame = (timestamp) => {
      if (previous !== undefined) sample.frameIntervals.push(timestamp - previous);
      previous = timestamp;
      sample.rafId = requestAnimationFrame(onFrame);
    };
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      sample.observer = new PerformanceObserver((list) => {
        sample.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      sample.observer.observe({ type: "longtask", buffered: false });
    }
    sample.rafId = requestAnimationFrame(onFrame);
    globalThis.__cssElectropaintPerformanceSample = sample;
    if (shouldPlay) globalThis.__cssElectropaint.resume();
  }, playing);
  const startingStats = await page.evaluate(() => globalThis.__cssElectropaint.stats().player);
  const startingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const startedAt = performance.now();
  await page.waitForTimeout(durationMilliseconds);
  const wallDurationMilliseconds = performance.now() - startedAt;
  const endingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const ending = await page.evaluate(() => {
    globalThis.__cssElectropaint.pause();
    const sample = globalThis.__cssElectropaintPerformanceSample;
    cancelAnimationFrame(sample.rafId);
    sample.observer?.disconnect();
    return {
      frameIntervals: sample.frameIntervals,
      longTasks: sample.longTasks,
      stats: globalThis.__cssElectropaint.stats().player,
    };
  });
  return {
    playing,
    wallDurationMilliseconds,
    frameIntervals: summarizeSamples(ending.frameIntervals),
    longTasks: summarizeLongTasks(ending.longTasks),
    appCounterDelta: statDelta(startingStats, ending.stats),
    performanceMetricDelta: performanceDelta(startingMetrics, endingMetrics),
  };
}

async function measureTracedPhase({ page, cdp, durationMilliseconds, tracePath: outputTracePath }) {
  await page.evaluate(async () => {
    globalThis.__cssElectropaint.pause();
    await globalThis.__cssElectropaint.setState(450);
  });
  const startingStats = await page.evaluate(() => globalThis.__cssElectropaint.stats().player);
  const startingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const traceComplete = new Promise((resolveTrace) => cdp.once("Tracing.tracingComplete", resolveTrace));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame",
    transferMode: "ReturnAsStream",
  });
  const startedAt = performance.now();
  await page.evaluate(() => globalThis.__cssElectropaint.resume());
  await page.waitForTimeout(durationMilliseconds);
  await page.evaluate(() => globalThis.__cssElectropaint.pause());
  const wallDurationMilliseconds = performance.now() - startedAt;
  const endingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const endingStats = await page.evaluate(() => globalThis.__cssElectropaint.stats().player);
  await cdp.send("Tracing.end");
  const { stream } = await traceComplete;
  const trace = JSON.parse(await readProtocolStream(cdp, stream));
  await mkdir(dirname(outputTracePath), { recursive: true });
  await writeFile(outputTracePath, `${JSON.stringify(trace)}\n`);
  return {
    wallDurationMilliseconds,
    appCounterDelta: statDelta(startingStats, endingStats),
    performanceMetricDelta: performanceDelta(startingMetrics, endingMetrics),
    mainThread: summarizeMainThread(trace.traceEvents),
  };
}

async function measureMutationAudit(page, durationMilliseconds) {
  return page.evaluate(async (duration) => {
    globalThis.__cssElectropaint.pause();
    await globalThis.__cssElectropaint.setState(0);
    const counts = { records: 0, style: 0, class: 0, childList: 0, addedNodes: 0, removedNodes: 0 };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        counts.records += 1;
        if (record.type === "attributes") counts[record.attributeName] += 1;
        if (record.type === "childList") {
          counts.childList += 1;
          counts.addedNodes += record.addedNodes.length;
          counts.removedNodes += record.removedNodes.length;
        }
      }
    });
    observer.observe(document.querySelector("#scene"), {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
    });
    const before = globalThis.__cssElectropaint.stats().player;
    globalThis.__cssElectropaint.resume();
    await new Promise((resolveWait) => setTimeout(resolveWait, duration));
    globalThis.__cssElectropaint.pause();
    observer.disconnect();
    const after = globalThis.__cssElectropaint.stats().player;
    return { durationMilliseconds: duration, counts, appCounterDelta: statDeltaInPage(before, after) };

    function statDeltaInPage(start, end) {
      return Object.fromEntries(Object.keys(end)
        .filter((key) => typeof end[key] === "number" && typeof start[key] === "number")
        .map((key) => [key, end[key] - start[key]]));
    }
  }, durationMilliseconds);
}

async function measureBoundaryAudit(page) {
  return page.evaluate(async () => {
    const api = globalThis.__cssElectropaint;
    api.pause();
    return {
      ordinaryLate: await stepFrom(63_998),
      ordinaryMiddle: await stepFrom(2_352),
      innerChunkBoundary: await stepFrom(499),
      deterministicBankWrap: await stepFrom(63_999),
    };

    async function stepFrom(stateIndex) {
      await api.setState(stateIndex);
      const before = api.stats().player;
      api.step(1);
      return statDeltaInPage(before, api.stats().player);
    }

    function statDeltaInPage(start, end) {
      return Object.fromEntries(Object.keys(end)
        .filter((key) => typeof end[key] === "number" && typeof start[key] === "number")
        .map((key) => [key, end[key] - start[key]]));
    }
  });
}

async function measureCadenceAudit(page) {
  return page.evaluate(async () => {
    const api = globalThis.__cssElectropaint;
    return {
      contract: api.scene.playback.presentationCadence,
      opening: await sample(0, 400),
      innerChunkBoundary: await sample(450, 2_000),
      middle: await sample(32_000, 2_000),
      late: await sample(62_000, 2_000),
    };

    async function sample(stateIndex, durationMilliseconds) {
      api.pause();
      await api.setState(stateIndex);
      const before = api.stats().player;
      const startedAt = performance.now();
      api.resume();
      await new Promise((resolveWait) => setTimeout(resolveWait, durationMilliseconds));
      api.pause();
      const wallDurationMilliseconds = performance.now() - startedAt;
      const delta = statDeltaInPage(before, api.stats().player);
      return {
        startingStateIndex: stateIndex,
        wallDurationMilliseconds,
        observedStatesPerSecond: delta.preparedStatesApplied * 1_000 / wallDurationMilliseconds,
        appCounterDelta: delta,
      };
    }

    function statDeltaInPage(start, end) {
      return Object.fromEntries(Object.keys(end)
        .filter((key) => typeof end[key] === "number" && typeof start[key] === "number")
        .map((key) => [key, end[key] - start[key]]));
    }
  });
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
}

function performanceDelta(before, after) {
  const names = [
    "TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration",
    "JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount",
  ];
  return Object.fromEntries(names.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]));
}

function statDelta(before, after) {
  const names = [
    "preparedStatesApplied", "runtimeRootTransformWrites", "runtimeTransformWrites",
    "runtimeColorWrites", "runtimeColorClassWrites", "runtimeOutlineWrites",
    "runtimePreparedTransformAssignments", "runtimePreparedColorAssignments",
    "runtimeLeafWideComparisonCount", "runtimeSchedulerCallbackCount",
    "runtimeAnimationFrameCallbackCount", "deterministicBankLoopCount",
    "preparedInnerChunkBoundaryCount", "runtimeInnerChunkBoundaryResetCount",
    "runtimeRingIndexCalculationCount", "runtimeGeometryConstructionCount",
    "runtimeMatrixCalculationCount", "runtimeColorCalculationCount",
    "runtimeRandomGenerationCount", "runtimeCameraCalculationCount",
    "runtimeCadenceCalculationCount", "runtimeCadenceDelayLookupCount",
    "runtimeHorizonMaintenanceRequestCount", "runtimeHorizonMaintenanceCallbackCount",
    "runtimeHorizonIncrementalDecodeSliceCount", "runtimeHorizonIncrementalDecodeDelayCount",
    "runtimeHorizonIncrementalDecodeDelayCallbackCount",
    "runtimeHorizonIncrementalDecodedTransformCount",
  ];
  return Object.fromEntries(names.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]));
}

function writesPerState(delta) {
  const states = Math.max(1, delta.preparedStatesApplied);
  const names = [
    "runtimeRootTransformWrites", "runtimeTransformWrites", "runtimeColorWrites",
    "runtimeColorClassWrites", "runtimeOutlineWrites",
  ];
  return Object.fromEntries(names.map((name) => [name, delta[name] / states]));
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    count: samples.length,
    p50Milliseconds: percentile(0.5),
    p95Milliseconds: percentile(0.95),
    p99Milliseconds: percentile(0.99),
    maxMilliseconds: sorted.at(-1) ?? 0,
    atLeast25Milliseconds: samples.filter((value) => value >= 25).length,
    atLeast50Milliseconds: samples.filter((value) => value >= 50).length,
  };
}

function summarizeLongTasks(samples) {
  return { count: samples.length, totalMilliseconds: sum(samples), maxMilliseconds: Math.max(0, ...samples) };
}

function summarizeMainThread(events) {
  const mainThread = events.find((event) => event.ph === "M" && event.name === "thread_name" &&
    event.args?.name === "CrRendererMain");
  const names = ["TimerFire", "FunctionCall", "FireAnimationFrame", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize"];
  const summary = Object.fromEntries(names.map((name) => {
    const matches = events.filter((event) => event.pid === mainThread?.pid && event.tid === mainThread?.tid &&
      event.ph === "X" && event.name === name && Number.isFinite(event.dur));
    return [name, {
      count: matches.length,
      totalMilliseconds: sum(matches.map((event) => event.dur)) / 1_000,
      maxMilliseconds: Math.max(0, ...matches.map((event) => event.dur)) / 1_000,
    }];
  }));
  for (const [label, functionName] of [
    ["PublicationLoop", "loop"],
    ["HorizonIdleCallback", "requestIdle.timeout"],
  ]) {
    const matches = events.filter((event) => event.pid === mainThread?.pid && event.tid === mainThread?.tid &&
      event.ph === "X" && event.name === "FunctionCall" && Number.isFinite(event.dur) &&
      event.args?.data?.functionName === functionName);
    summary[label] = {
      count: matches.length,
      totalMilliseconds: sum(matches.map((event) => event.dur)) / 1_000,
      maxMilliseconds: Math.max(0, ...matches.map((event) => event.dur)) / 1_000,
    };
  }
  return summary;
}

async function readProtocolStream(cdp, handle) {
  let result = "";
  while (true) {
    const chunk = await cdp.send("IO.read", { handle });
    result += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle });
  return result;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function perSecond(value, durationMilliseconds, unitScale = 1) {
  return value * unitScale * 1_000 / durationMilliseconds;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function chromeVersion(userAgent) {
  const match = /Chrome\/([^ ]+)/u.exec(userAgent);
  return { name: "Google Chrome", version: match?.[1] ?? "unknown", headless: true };
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const candidate = createServer();
    candidate.listen(0, "127.0.0.1", () => {
      const address = candidate.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      candidate.close(() => resolvePort(selected));
    });
    candidate.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds) {
  const started = Date.now();
  while (!predicate()) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${serverOutput}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}
