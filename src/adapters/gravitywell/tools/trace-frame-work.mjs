#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/cssgravitywell");
const preparedWorstTransition = await findPreparedWorstTransition(generatedRoot);
const routeUrl = new URL(process.env.CSSGRAVITYWELL_TRACE_URL ?? "http://127.0.0.1:5174/gravitywell/");
routeUrl.searchParams.set("bank", String(preparedWorstTransition.bankIndex));
routeUrl.searchParams.set("cycle", "0");
const route = routeUrl.href;
const viewport = Object.freeze({
  width: positiveIntegerEnvironment("CSSGRAVITYWELL_TRACE_WIDTH", 960),
  height: positiveIntegerEnvironment("CSSGRAVITYWELL_TRACE_HEIGHT", 600),
  deviceScaleFactor: positiveNumberEnvironment("CSSGRAVITYWELL_TRACE_DPR", 1),
});
const outputRoot = resolve(repositoryRoot, "bench/results/cssgravitywell/performance");
const tracePath = resolve(outputRoot, "worst-frame-chrome-trace.json");
const summaryPath = resolve(outputRoot, "worst-frame-summary.json");
await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__cssGravityWellDebug?.ready === true, null, { timeout: 30_000 });
  const steadyStatePublication = await page.evaluate(async () => {
    const debug = globalThis.__cssGravityWellDebug;
    debug.pause();
    await debug.seekSourceTick(100);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const samples = [];
    for (let index = 0; index < 29; index += 1) {
      const before = debug.stats();
      const startedAt = performance.now();
      await debug.step(1);
      const after = debug.stats();
      samples.push({
        fromFrameIndex: before.frameIndex,
        toFrameIndex: after.frameIndex,
        fromSourceFrameIndex: before.sourceFrameIndex,
        toSourceFrameIndex: after.sourceFrameIndex,
        durationMilliseconds: performance.now() - startedAt,
        transformWrites: after.leafTransformWrites - before.leafTransformWrites,
        colorWrites: after.leafColorWrites - before.leafColorWrites,
        transformBlockLoads: after.transformBlocks.loadCount - before.transformBlocks.loadCount,
      });
    }
    const ordered = [...samples].sort((left, right) => left.durationMilliseconds - right.durationMilliseconds);
    return {
      sampleCount: samples.length,
      minimumMilliseconds: ordered[0].durationMilliseconds,
      medianMilliseconds: ordered[Math.floor(ordered.length / 2)].durationMilliseconds,
      p95Milliseconds: ordered[Math.floor(ordered.length * 0.95)].durationMilliseconds,
      maximumMilliseconds: ordered.at(-1).durationMilliseconds,
      meanMilliseconds: ordered.reduce((sum, row) => sum + row.durationMilliseconds, 0) / ordered.length,
      slowestSample: ordered.at(-1),
      samples,
    };
  });
  const worstTransitionPublication = await page.evaluate(async ({ previousFrameIndex, frameIndex }) => {
    const debug = globalThis.__cssGravityWellDebug;
    debug.pause();
    const leaves = [...document.querySelectorAll(".polycss-morph-leaf")];
    const visibleBackfaceLeafCount = leaves.filter(
      (leaf) => getComputedStyle(leaf).backfaceVisibility === "visible",
    ).length;
    const samples = [];
    let actualTransformChanges = null;
    let actualColorChanges = null;
    for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
      await debug.seek(previousFrameIndex);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const beforeStyles = sampleIndex === 0
        ? leaves.map((leaf) => ({ transform: leaf.style.transform, color: leaf.style.color }))
        : null;
      const before = debug.stats();
      const startedAt = performance.now();
      await debug.step(1);
      const durationMilliseconds = performance.now() - startedAt;
      const after = debug.stats();
      if (debug.state().frameIndex !== frameIndex) throw new Error("Worst-frame verification landed on the wrong frame");
      samples.push({
        durationMilliseconds,
        transformWrites: after.leafTransformWrites - before.leafTransformWrites,
        colorWrites: after.leafColorWrites - before.leafColorWrites,
        transformBlockLoads: after.transformBlocks.loadCount - before.transformBlocks.loadCount,
      });
      if (beforeStyles) {
        actualTransformChanges = 0;
        actualColorChanges = 0;
        for (let index = 0; index < leaves.length; index += 1) {
          if (leaves[index].style.transform !== beforeStyles[index].transform) actualTransformChanges += 1;
          if (leaves[index].style.color !== beforeStyles[index].color) actualColorChanges += 1;
        }
      }
    }
    await debug.seek(previousFrameIndex);
    const ordered = [...samples].sort((left, right) => left.durationMilliseconds - right.durationMilliseconds);
    return {
      sampleCount: samples.length,
      minimumMilliseconds: ordered[0].durationMilliseconds,
      medianMilliseconds: ordered[Math.floor(ordered.length / 2)].durationMilliseconds,
      p95Milliseconds: ordered[Math.floor(ordered.length * 0.95)].durationMilliseconds,
      maximumMilliseconds: ordered.at(-1).durationMilliseconds,
      actualTransformChanges,
      actualColorChanges,
      retainedLeafCount: leaves.length,
      visibleBackfaceLeafCount,
      transformBlockLoads: samples.reduce((sum, sample) => sum + sample.transformBlockLoads, 0),
      stableDom: debug.assertStableDomIdentity(),
      samples,
    };
  }, preparedWorstTransition);
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  await cdp.send("Performance.enable");
  const events = [];
  cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  const tracingComplete = new Promise((resolveComplete) => cdp.once("Tracing.tracingComplete", resolveComplete));
  await cdp.send("Tracing.start", {
    categories: [
      "toplevel", "blink", "blink.user_timing", "cc", "gpu", "viz",
      "renderer.scheduler", "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.invalidationTracking",
      "disabled-by-default-devtools.timeline.paint",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReportEvents",
  });
  await page.waitForTimeout(500);
  const beforeMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  const publication = await page.evaluate(async () => {
    const debug = globalThis.__cssGravityWellDebug;
    const before = debug.stats();
    performance.mark("cssgravitywell-frame-start");
    const startedAt = performance.now();
    await debug.step(1);
    const publicationMilliseconds = performance.now() - startedAt;
    performance.mark("cssgravitywell-publication-complete");
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }
    performance.mark("cssgravitywell-frame-end");
    const after = debug.stats();
    return {
      publicationMilliseconds,
      before,
      after,
      delta: {
        preparedFramesApplied: after.preparedFramesApplied - before.preparedFramesApplied,
        leafTransformAttempts: after.leafTransformAttempts - before.leafTransformAttempts,
        leafTransformWrites: after.leafTransformWrites - before.leafTransformWrites,
        leafColorAttempts: after.leafColorAttempts - before.leafColorAttempts,
        leafColorWrites: after.leafColorWrites - before.leafColorWrites,
        schedulerCallbacks: after.schedulerCallbacks - before.schedulerCallbacks,
        runtimeGeometryConstructionCount: after.runtimeGeometryConstructionCount - before.runtimeGeometryConstructionCount,
        runtimeTopologyConstructionCount: after.runtimeTopologyConstructionCount - before.runtimeTopologyConstructionCount,
        runtimeAffineEvaluationCount: after.runtimeAffineEvaluationCount - before.runtimeAffineEvaluationCount,
        runtimeColorCalculationCount: after.runtimeColorCalculationCount - before.runtimeColorCalculationCount,
        runtimeDomMutationCount: (after.runtimeDomCreationCount + after.runtimeDomRemovalCount) -
          (before.runtimeDomCreationCount + before.runtimeDomRemovalCount),
        transformBlockLoads: after.transformBlocks.loadCount - before.transformBlocks.loadCount,
      },
      stableDom: debug.assertStableDomIdentity(),
      state: debug.state(),
    };
  });
  const afterMetrics = metricMap(await cdp.send("Performance.getMetrics"));
  await page.waitForTimeout(100);
  await cdp.send("Tracing.end");
  await tracingComplete;
  const schedulerBefore = await page.evaluate(() => {
    const debug = globalThis.__cssGravityWellDebug;
    const stats = debug.stats();
    const recorder = {
      intervals: [],
      longTasks: [],
      lastFrameAt: null,
      running: true,
      observer: null,
      startedAt: performance.now(),
    };
    const sampleFrame = (timestamp) => {
      if (recorder.lastFrameAt !== null) recorder.intervals.push(timestamp - recorder.lastFrameAt);
      recorder.lastFrameAt = timestamp;
      if (recorder.running) requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      recorder.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= recorder.startedAt) {
            recorder.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        }
      });
      recorder.observer.observe({ type: "longtask" });
    }
    globalThis.__cssGravityWellTraceRecorder = recorder;
    debug.resume();
    return stats;
  });
  await page.waitForTimeout(1_800);
  const schedulerResult = await page.evaluate(() => {
    const debug = globalThis.__cssGravityWellDebug;
    debug.pause();
    const recorder = globalThis.__cssGravityWellTraceRecorder;
    recorder.running = false;
    recorder.observer?.disconnect();
    return { stats: debug.stats(), intervals: recorder.intervals, longTasks: recorder.longTasks };
  });
  const schedulerAfter = schedulerResult.stats;
  const schedulerTrial = {
    durationMilliseconds: 1_800,
    preparedFrameCount: schedulerAfter.preparedFramesApplied - schedulerBefore.preparedFramesApplied,
    callbackCount: schedulerAfter.schedulerCallbacks - schedulerBefore.schedulerCallbacks,
    transformBlockLoads: schedulerAfter.transformBlocks.loadCount - schedulerBefore.transformBlocks.loadCount,
    frameIntervals: summarizeNumbers(schedulerResult.intervals),
    longTasks: schedulerResult.longTasks,
  };
  schedulerTrial.emptyCallbackCount = schedulerTrial.callbackCount - schedulerTrial.preparedFrameCount - 1;
  const marks = Object.fromEntries(events
    .filter((event) => event.cat?.includes("blink.user_timing") && event.name?.startsWith("cssgravitywell-"))
    .map((event) => [event.name, event.ts]));
  const start = marks["cssgravitywell-frame-start"];
  const publicationEnd = marks["cssgravitywell-publication-complete"];
  const end = marks["cssgravitywell-frame-end"];
  const costs = summarizeCosts(events, start, end);
  const summary = {
    schema: "cssgravitywell-worst-runtime-frame-trace@1",
    capturedAt: new Date().toISOString(),
    route,
    browser: { name: "Google Chrome", version: browser.version(), headless: true },
    viewport,
    preparedWorstTransition,
    worstTransitionPublication,
    steadyStatePublication,
    schedulerTrial,
    publication,
    traceWindowMilliseconds: (end - start) / 1000,
    focusedBrowserCosts: costs,
    focusedPublicationCosts: summarizeCosts(events, start, publicationEnd),
    focusedPresentationCosts: summarizeCosts(events, publicationEnd, end),
    performanceMetricDelta: {
      taskMilliseconds: delta(beforeMetrics, afterMetrics, "TaskDuration", 1000),
      scriptMilliseconds: delta(beforeMetrics, afterMetrics, "ScriptDuration", 1000),
      styleRecalcMilliseconds: delta(beforeMetrics, afterMetrics, "RecalcStyleDuration", 1000),
      layoutMilliseconds: delta(beforeMetrics, afterMetrics, "LayoutDuration", 1000),
      styleRecalcCount: delta(beforeMetrics, afterMetrics, "RecalcStyleCount"),
      layoutCount: delta(beforeMetrics, afterMetrics, "LayoutCount"),
    },
    proof: {
      noTransformBlockLoad: publication.delta.transformBlockLoads === 0,
      onePreparedState: publication.delta.preparedFramesApplied === 1,
      stableDom: publication.stableDom,
      noRuntimeGeometry: publication.delta.runtimeGeometryConstructionCount === 0,
      noRuntimeTopology: publication.delta.runtimeTopologyConstructionCount === 0,
      noRuntimeAffineEvaluation: publication.delta.runtimeAffineEvaluationCount === 0,
      noRuntimeColorCalculation: publication.delta.runtimeColorCalculationCount === 0,
      noRuntimeDomMutation: publication.delta.runtimeDomMutationCount === 0,
      noRedundantTransformAttempts:
        publication.delta.leafTransformAttempts === publication.delta.leafTransformWrites,
      noRedundantColorAttempts:
        publication.delta.leafColorAttempts === publication.delta.leafColorWrites,
      noEmptySchedulerCallbacks: schedulerTrial.emptyCallbackCount === 0,
      exactPreparedSelectedTransformPublication:
        worstTransitionPublication.actualTransformChanges === worstTransitionPublication.samples[0].transformWrites,
      exactPreparedSelectedColorPublication:
        worstTransitionPublication.actualColorChanges === worstTransitionPublication.samples[0].colorWrites,
      selectedTransformPublicationDoesNotExceedSourceSchedule:
        worstTransitionPublication.actualTransformChanges <= preparedWorstTransition.transformWrites,
      selectedColorPublicationDoesNotExceedSourceSchedule:
        worstTransitionPublication.actualColorChanges <= preparedWorstTransition.colorWrites,
      noWorstTransitionBlockLoad: worstTransitionPublication.transformBlockLoads === 0,
      allRetainedLeavesKeepPreparedBackfaceVisibility:
        worstTransitionPublication.visibleBackfaceLeafCount === worstTransitionPublication.retainedLeafCount,
      worstTransitionPublished:
        publication.before.frameIndex === preparedWorstTransition.previousFrameIndex &&
        publication.after.frameIndex === preparedWorstTransition.frameIndex,
    },
    errors,
    trace: { path: tracePath, eventCount: events.length, marks },
  };
  await writeFile(tracePath, `${JSON.stringify({ traceEvents: events })}\n`);
  summary.trace.sizeBytes = (await stat(tracePath)).size;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length || Object.values(summary.proof).some((value) => value !== true)) {
    throw new Error(`Gravity Well frame trace contract failed: ${JSON.stringify(summary)}`);
  }
  console.log(JSON.stringify({ summaryPath, tracePath, ...summary }, null, 2));
} finally {
  await browser.close();
}

async function findPreparedWorstTransition(generatedRoot) {
  const catalog = JSON.parse(await readFile(resolve(generatedRoot, "catalog.json"), "utf8"));
  let worst = null;
  let transitionCount = 0;
  for (const entry of catalog.entries) {
    const scene = JSON.parse(await readFile(
      resolve(generatedRoot, "banks", entry.id, "scene.json"),
      "utf8",
    ));
    const schedule = scene.playback.changeAsset;
    for (let frameIndex = 1; frameIndex < scene.playback.frameCount; frameIndex += 1) {
      const transformWrites = schedule.transformOffsets[frameIndex + 1] - schedule.transformOffsets[frameIndex];
      const colorWrites = schedule.colorOffsets[frameIndex + 1] - schedule.colorOffsets[frameIndex];
      const totalWrites = transformWrites + colorWrites;
      transitionCount += 1;
      if (worst && totalWrites <= worst.totalWrites) continue;
      const sourceFrameIndex = frameIndex - scene.timeline.sourceFrameStartIndex;
      worst = {
        transitionCount,
        bankCount: catalog.bankCount,
        bankIndex: entry.index,
        seed: entry.seed,
        previousFrameIndex: frameIndex - 1,
        frameIndex,
        sourceFrameIndex: sourceFrameIndex >= 0 && sourceFrameIndex < scene.source.frameCount
          ? sourceFrameIndex
          : null,
        phase: frameIndex < scene.timeline.sourceFrameStartIndex
          ? "rise"
          : frameIndex <= scene.timeline.sourceFrameEndIndex
            ? "source"
            : frameIndex <= scene.timeline.allWellsCompleteFrameIndex ? "drain" : "flat-out",
        transformWrites,
        colorWrites,
        totalWrites,
        transformBlockIndex: Math.trunc(frameIndex / scene.playback.blockFrameCount),
      };
    }
  }
  if (!worst) throw new Error("Gravity Well prepared bank catalog has no transitions");
  return Object.freeze({ ...worst, transitionCount });
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}

function delta(before, after, name, multiplier = 1) {
  return ((after[name] ?? 0) - (before[name] ?? 0)) * multiplier;
}

function summarizeNumbers(values) {
  if (!values.length) return { count: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  return {
    count: ordered.length,
    minimumMilliseconds: ordered[0],
    medianMilliseconds: ordered[Math.floor(ordered.length / 2)],
    p95Milliseconds: ordered[Math.floor(ordered.length * 0.95)],
    maximumMilliseconds: ordered.at(-1),
    over25Milliseconds: ordered.filter((value) => value >= 25).length,
    over33Milliseconds: ordered.filter((value) => value >= 33).length,
    over50Milliseconds: ordered.filter((value) => value >= 50).length,
  };
}

function summarizeCosts(events, windowStart = -Infinity, windowEnd = Infinity) {
  const focus = new Set([
    "RunTask", "FunctionCall", "FireAnimationFrame", "UpdateLayoutTree", "Layout",
    "PrePaint", "Paint", "Layerize", "Commit", "CompositeLayers", "RasterTask",
    "DrawFrame", "SubmitCompositorFrame",
  ]);
  const totals = new Map();
  for (const event of events) {
    if (event.ph !== "X" || !Number.isFinite(event.dur) || !focus.has(event.name)) continue;
    const eventEnd = event.ts + event.dur;
    if (eventEnd <= windowStart || event.ts >= windowEnd) continue;
    const row = totals.get(event.name) ?? { name: event.name, count: 0, totalDurationMilliseconds: 0, maximumDurationMilliseconds: 0 };
    const milliseconds = (Math.min(eventEnd, windowEnd) - Math.max(event.ts, windowStart)) / 1000;
    row.count += 1;
    row.totalDurationMilliseconds += milliseconds;
    row.maximumDurationMilliseconds = Math.max(row.maximumDurationMilliseconds, milliseconds);
    totals.set(event.name, row);
  }
  return [...totals.values()].sort((left, right) => right.totalDurationMilliseconds - left.totalDurationMilliseconds);
}

function positiveIntegerEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function positiveNumberEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
}
