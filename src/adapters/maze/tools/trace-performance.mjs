#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withCssmazeBrowser } from "./browser-runner.mjs";

const durationMilliseconds = Number.parseInt(process.env.CSSMAZE_TRACE_DURATION_MS ?? "12000", 10);
if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 1000 || durationMilliseconds > 60000) {
  throw new RangeError("CSSMAZE_TRACE_DURATION_MS must be an integer from 1000 through 60000");
}
const outputPath = resolve(
  process.env.CSSMAZE_PERFORMANCE_SUMMARY ?? "bench/results/cssmaze/performance/raster-merged-summary.json",
);
const tracePath = resolve(
  process.env.CSSMAZE_PERFORMANCE_TRACE ?? "bench/results/cssmaze/performance/raster-merged-trace.json",
);

const summary = await withCssmazeBrowser(async ({ page, port }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    window.__cssMazeDebug.pause();
    window.__cssMazeDebug.seek(0);
  });
  const startingStats = await page.evaluate(() => window.__cssMazeDebug.stats());
  const startingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const traceComplete = new Promise((resolveTrace) => cdp.once("Tracing.tracingComplete", resolveTrace));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame",
    transferMode: "ReturnAsStream",
  });
  await page.evaluate(() => {
    const sample = { frameIntervals: [], longTasks: [], rafId: 0, observer: null };
    let previous;
    const onFrame = (timestamp) => {
      if (previous !== undefined) sample.frameIntervals.push(timestamp - previous);
      previous = timestamp;
      sample.rafId = requestAnimationFrame(onFrame);
    };
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      sample.observer = new PerformanceObserver((list) => {
        sample.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      sample.observer.observe({ type: "longtask", buffered: true });
    }
    sample.rafId = requestAnimationFrame(onFrame);
    window.__cssMazePerformanceSample = sample;
    window.__cssMazeDebug.resume();
  });
  await page.waitForTimeout(durationMilliseconds);
  const ending = await page.evaluate(() => {
    window.__cssMazeDebug.pause();
    const sample = window.__cssMazePerformanceSample;
    cancelAnimationFrame(sample.rafId);
    sample.observer?.disconnect();
    const leaves = [...document.querySelectorAll(".cssmaze-world b, .cssmaze-world i, .cssmaze-world s, .cssmaze-world u")];
    const widths = leaves.map((leaf) => Number.parseFloat(getComputedStyle(leaf).width));
    const heights = leaves.map((leaf) => Number.parseFloat(getComputedStyle(leaf).height));
    return {
      frameIntervals: sample.frameIntervals,
      longTasks: sample.longTasks,
      stats: window.__cssMazeDebug.stats(),
      state: window.__cssMazeDebug.state(),
      atlas: {
        backend: window.__cssMazeDebug.scene.renderer.textureBackend,
        sizing: window.__cssMazeDebug.scene.renderer.textureLeafSizing,
        metadataCount: [...document.querySelectorAll("#scene *")].reduce(
          (count, element) => count + [...element.attributes]
            .filter((attribute) => attribute.name.startsWith("data-")).length,
          0,
        ),
        minWidth: Math.min(...widths),
        maxWidth: Math.max(...widths),
        minHeight: Math.min(...heights),
        maxHeight: Math.max(...heights),
      },
    };
  });
  const endingMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  await cdp.send("Tracing.end");
  const { stream } = await traceComplete;
  const traceText = await readProtocolStream(cdp, stream);
  const trace = JSON.parse(traceText);
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, `${JSON.stringify(trace)}\n`);

  const version = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
  }));
  return {
    schema: "cssmaze-performance-trace@1",
    capturedAt: new Date().toISOString(),
    browser: chromeVersion(version.userAgent),
    url: `http://127.0.0.1:${port}/?scene=default-maze`,
    viewport: version.viewport,
    durationMs: durationMilliseconds,
    atlas: ending.atlas,
    frameIntervals: summarizeSamples(ending.frameIntervals),
    longTasks: {
      count: ending.longTasks.length,
      maxMs: ending.longTasks.length === 0 ? 0 : Math.max(...ending.longTasks),
    },
    statsDelta: statDelta(startingStats, ending.stats),
    endingState: ending.state,
    performanceMetricDelta: performanceDelta(startingMetrics, endingMetrics),
    traceMain: summarizeMainThread(trace.traceEvents),
    tracePath,
  };
}, { path: "/?scene=default-maze" });

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...summary }, null, 2));

function metricMap(result) {
  return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
}

function performanceDelta(before, after) {
  const names = [
    "TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration",
    "DevToolsCommandDuration", "JSHeapUsedSize", "Nodes",
  ];
  return Object.fromEntries(names.map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)]));
}

function statDelta(before, after) {
  const names = [
    "preparedStatesApplied", "runtimeCameraTransformWrites", "runtimeWallTransformWrites",
    "runtimeLeafVisibilityWrites", "preparedLeafVisibilitySelections", "runtimeSchedulerCallbackCount",
    "runtimeDomMutationCount", "runtimeGeometryConstructionCount", "runtimeMazeGenerationCount",
    "runtimeSceneGenerationCount", "runtimeRotationScoringCount", "runtimeCameraCalculationCount",
    "runtimeVisibilityCalculationCount", "runtimeCameraInterpolationCalculationCount",
    "runtimeLeafVisibilityComparisonCount", "runtimeTimerCallbackCount",
    "runtimeAnimationFrameCallbackCount",
  ];
  return Object.fromEntries(names.map((name) => [name, after[name] - before[name]]));
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    count: samples.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: samples.length === 0 ? 0 : Math.max(...samples),
    atLeast25Ms: samples.filter((value) => value >= 25).length,
    atLeast33Ms: samples.filter((value) => value >= 33).length,
    atLeast50Ms: samples.filter((value) => value >= 50).length,
  };
}

function summarizeMainThread(events) {
  const mainThread = events.find((event) => event.ph === "M" && event.name === "thread_name" &&
    event.args?.name === "CrRendererMain");
  const names = ["FunctionCall", "FireAnimationFrame", "UpdateLayoutTree", "PrePaint", "Layerize", "Paint"];
  return Object.fromEntries(names.map((name) => {
    const matches = events.filter((event) => event.pid === mainThread?.pid && event.tid === mainThread?.tid &&
      event.ph === "X" && event.name === name && Number.isFinite(event.dur));
    return [name, {
      count: matches.length,
      totalMs: matches.reduce((sum, event) => sum + event.dur, 0) / 1000,
      maxMs: matches.length === 0 ? 0 : Math.max(...matches.map((event) => event.dur)) / 1000,
    }];
  }));
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

function chromeVersion(userAgent) {
  const match = /Chrome\/([^ ]+)/u.exec(userAgent);
  return { name: "Google Chrome", version: match?.[1] ?? "unknown", headless: true };
}
