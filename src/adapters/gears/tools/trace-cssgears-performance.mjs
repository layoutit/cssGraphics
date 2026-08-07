#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { cpus, platform, arch, totalmem } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssgears/paths.mjs";

const sampleDurationMs = positiveInt(process.env.CSSGEARS_PERF_DURATION_MS, 6_000);
const mutationTransitionCount = positiveInt(process.env.CSSGEARS_PERF_MUTATION_TICKS, 120);
const configuredUrl = process.env.CSSGEARS_PERF_URL?.trim() || "";
const suppliedTracePath = process.env.CSSGEARS_PERF_SUPPLIED_TRACE?.trim() || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const performanceRoot = join("bench", "results", "cssgears", "performance");
const outDir = join(performanceRoot, runId);
const viewport = Object.freeze({ width: 960, height: 540, deviceScaleFactor: 1 });
const traceCategories = [
  "-*",
  "__metadata",
  "blink",
  "blink.user_timing",
  "cc",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "renderer.scheduler",
  "v8",
].join(",");
const counterFields = Object.freeze([
  "runtimeLogicalRowsEvaluated",
  "runtimePreparedRowLookups",
  "runtimePhysicalPublicationPasses",
  "runtimePreparedBankSwitchCount",
  "runtimeRootClassWrites",
  "runtimeAssemblyTransformComparisons",
  "runtimeGearTransformComparisons",
  "runtimeAssemblyTransformWrites",
  "runtimeGearTransformWrites",
  "runtimeDirtyShapeSetCreations",
  "runtimeShapeIndexSorts",
  "runtimeLightingRowComparisons",
  "runtimeLightingRowWrites",
  "runtimeLightingPublicationCount",
  "runtimeDatasetAttributeWrites",
  "runtimeApplyStableDomIdentityChecks",
  "runtimeLeafTransformWrites",
  "runtimePerFrameLeafStyleWrites",
  "runtimeSchedulerCallbackCount",
  "runtimeSchedulerNoopCallbackCount",
  "runtimeSchedulerDeadlineComparisonCount",
  "runtimeSchedulerRequestCount",
  "runtimeSchedulerCancelCount",
  "runtimeSchedulerDelayRequestCount",
  "runtimeSchedulerDelayCallbackCount",
  "runtimeSchedulerDelayCancelCount",
  "runtimeSchedulerStateTransitions",
  "runtimeSchedulerCatchUpPublicationCount",
  "runtimeSchedulerCoalescedLogicalTickCount",
  "runtimeSchedulerPostPublicationDeadlineResetCount",
  "runtimeSchedulerPostPublicationDelayScheduleCount",
  "runtimeSchedulerSkippedPreparedStateCount",
  "runtimeSchedulerLateResetCount",
  "runtimeGeometryConstructionCount",
  "runtimeCameraCalculationCount",
  "runtimeRatioCalculationCount",
  "runtimeMeshingPhaseCalculationCount",
  "runtimeLightingCalculationCount",
  "runtimeDomCreationCount",
  "runtimeDomRemovalCount",
  "runtimeDomMutationCount",
  "scaleWrites",
]);
const selectedTraceEvents = Object.freeze([
  "RunTask",
  "ThreadControllerImpl::RunTask",
  "FunctionCall",
  "EvaluateScript",
  "RunMicrotasks",
  "FireAnimationFrame",
  "UpdateLayoutTree",
  "RecalculateStyles",
  "Layout",
  "PrePaint",
  "Paint",
  "PaintImage",
  "Layerize",
  "CompositeLayers",
  "Commit",
  "AnimationHost::TickAnimations",
]);

await mkdir(outDir, { recursive: true });
const target = await acquireTarget(configuredUrl);
let browser;

try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
  });
  const page = await context.newPage();
  const browserErrors = [];
  const failedResponses = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/^Failed to load resource:/u.test(message.text())) browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.matches(".ready,.error"), null, { timeout: 20_000 });
  const initial = await page.evaluate(() => {
    const api = globalThis.__cssGearsDebug;
    if (!api?.ready) throw new Error(document.getElementById("status")?.textContent || "cssGears did not become ready");
    return {
      status: document.body.classList.contains("ready") ? "ready" : "error",
      route: api.route,
      sourceProfile: api.scene?.sourceProfile ?? null,
      oracle: api.scene?.oracle ?? null,
      stats: api.stats(),
      errors: api.errors(),
      stableDom: api.assertStableDomIdentity(),
    };
  });
  // Warm the exact product animation path before collecting matched samples.
  await page.evaluate(() => {
    const api = globalThis.__cssGearsDebug;
    api.setTick(0);
    api.resume();
  });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => globalThis.__cssGearsDebug.pause());
  await settle(page);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const phases = [];
  phases.push(await measurePhase({ page, cdp, label: "paused-a", playing: false }));
  phases.push(await measurePhase({ page, cdp, label: "paused-b", playing: false }));
  phases.push(await measurePhase({ page, cdp, label: "playing", playing: true }));
  const untracedPhases = [];
  untracedPhases.push(await measureUntracedPhase({ page, cdp, label: "paused", playing: false }));
  untracedPhases.push(await measureUntracedPhase({ page, cdp, label: "playing", playing: true }));
  const mutationAudit = await auditMutations(page, mutationTransitionCount);
  await cdp.detach();

  for (const phase of phases) {
    phase.trace = await analyzeTrace(phase.tracePath);
  }
  const supplementalTrace = suppliedTracePath ? {
    sourcePath: suppliedTracePath,
    conditions: "User-supplied DevTools recording; kept separate from controlled headless samples",
    analysis: await analyzeTrace(suppliedTracePath),
  } : null;

  const report = buildReport({
    runId,
    capturedAt: new Date().toISOString(),
    browser: {
      name: "Google Chrome",
      version: browserVersion,
      channel: "chrome",
      headless: true,
    },
    machine: machineSummary(),
    target: {
      url: target.url,
      server: target.owned ? "one-shot repo Vite server" : "existing loopback server",
      viewport,
      freshBrowserContext: true,
    },
    configuration: {
      sampleDurationMs,
      mutationTransitionCount,
      warmupMs: 1_500,
      traceCategories: traceCategories.split(","),
      appSidePerFrameSampler: false,
      schedulerCadenceDerivedFromChromeFunctionCallEvents: true,
      preparedDisplayListPublication: true,
      sourcePostDrawDelayNoCatchUp: true,
      untracedPerformanceCalibration: true,
      mutationObserverExcludedFromPerformancePhases: true,
    },
    initial,
    browserErrors,
    failedResponses,
    phases,
    untracedPhases,
    supplementalTrace,
    mutationAudit,
  });
  const reportPath = join(outDir, "report.json");
  const markdownPath = join(outDir, "report.md");
  const chartPath = join(outDir, "runtime-work.svg");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdown(report));
  await writeFile(chartPath, renderChart(report));
  await writeFile(join(performanceRoot, "latest.json"), `${JSON.stringify({
    schema: "cssgears-performance-latest@1",
    runId,
    reportPath,
    markdownPath,
    chartPath,
  }, null, 2)}\n`);

  const materialFailedResponses = failedResponses.filter((response) => !/\/favicon\.ico(?:[?#]|$)/u.test(response.url));
  if (browserErrors.length > 0 || materialFailedResponses.length > 0) {
    throw new Error(`Browser errors during performance run: ${JSON.stringify({ browserErrors, failedResponses: materialFailedResponses })}`);
  }
  assertMutationAudit(mutationAudit);
  assertTransformOnlyTrace(report);
  console.log(JSON.stringify({
    schema: report.schema,
    runId,
    browser: report.browser,
    target: report.target,
    summary: report.summary,
    mutationAudit: report.mutationAudit.summary,
    reportPath,
    markdownPath,
    chartPath,
    tracePaths: phases.map((phase) => phase.tracePath),
  }, null, 2));
} finally {
  await browser?.close();
  await target.close();
}

async function measurePhase({ page, cdp, label, playing }) {
  await page.evaluate(() => {
    const api = globalThis.__cssGearsDebug;
    api.pause();
    api.setTick(0);
  });
  await settle(page);
  const beforeStats = await page.evaluate(() => globalThis.__cssGearsDebug.stats());
  const beforeTick = await page.evaluate(() => globalThis.__cssGearsDebug.tick());
  const beforeMetrics = metricsObject(await cdp.send("Performance.getMetrics"));
  const tracePath = join(outDir, `${label}.trace.json`);
  await startTrace(cdp);
  await page.evaluate(({ phaseLabel, shouldPlay }) => {
    performance.mark(`cssgears-perf-${phaseLabel}-start`);
    if (shouldPlay) globalThis.__cssGearsDebug.resume();
  }, { phaseLabel: label, shouldPlay: playing });
  const wallStartedAt = performance.now();
  await page.waitForTimeout(sampleDurationMs);
  const wallDurationMs = performance.now() - wallStartedAt;
  await page.evaluate(({ phaseLabel, shouldPlay }) => {
    if (shouldPlay) globalThis.__cssGearsDebug.pause();
    performance.mark(`cssgears-perf-${phaseLabel}-end`);
    performance.measure(`cssgears-perf-${phaseLabel}`, `cssgears-perf-${phaseLabel}-start`, `cssgears-perf-${phaseLabel}-end`);
  }, { phaseLabel: label, shouldPlay: playing });
  const afterMetrics = metricsObject(await cdp.send("Performance.getMetrics"));
  await stopTrace(cdp, tracePath);
  const afterStats = await page.evaluate(() => globalThis.__cssGearsDebug.stats());
  const afterTick = await page.evaluate(() => globalThis.__cssGearsDebug.tick());
  return {
    label,
    playing,
    requestedDurationMs: sampleDurationMs,
    wallDurationMs,
    appCounterDelta: numericDelta(beforeStats, afterStats, counterFields),
    tickDelta: afterTick - beforeTick,
    performanceMetricDelta: numericDelta(beforeMetrics, afterMetrics, Object.keys(afterMetrics)),
    beforeStats,
    afterStats,
    tracePath,
  };
}

async function measureUntracedPhase({ page, cdp, label, playing }) {
  await page.evaluate(() => {
    const api = globalThis.__cssGearsDebug;
    api.pause();
    api.setTick(0);
  });
  await settle(page);
  const beforeStats = await page.evaluate(() => globalThis.__cssGearsDebug.stats());
  const beforeTick = await page.evaluate(() => globalThis.__cssGearsDebug.tick());
  const beforeMetrics = metricsObject(await cdp.send("Performance.getMetrics"));
  if (playing) await page.evaluate(() => globalThis.__cssGearsDebug.resume());
  const wallStartedAt = performance.now();
  await page.waitForTimeout(sampleDurationMs);
  const wallDurationMs = performance.now() - wallStartedAt;
  if (playing) await page.evaluate(() => globalThis.__cssGearsDebug.pause());
  const afterMetrics = metricsObject(await cdp.send("Performance.getMetrics"));
  const afterStats = await page.evaluate(() => globalThis.__cssGearsDebug.stats());
  const afterTick = await page.evaluate(() => globalThis.__cssGearsDebug.tick());
  return {
    label,
    playing,
    requestedDurationMs: sampleDurationMs,
    wallDurationMs,
    appCounterDelta: numericDelta(beforeStats, afterStats, counterFields),
    tickDelta: afterTick - beforeTick,
    performanceMetricDelta: numericDelta(beforeMetrics, afterMetrics, Object.keys(afterMetrics)),
    beforeStats,
    afterStats,
  };
}

async function auditMutations(page, transitionCount) {
  return page.evaluate(async (expectedTransitions) => {
    const api = globalThis.__cssGearsDebug;
    api.pause();
    api.setTick(0);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const beforeStats = api.stats();
    const startTick = api.tick();
    const scene = document.getElementById("scene");
    const mutations = {
      attributeCount: 0,
      attributesByName: {},
      attributesByTarget: { modelRoot: 0, gearRoot: 0, lightingGroup: 0, polygonLeaf: 0, other: 0 },
      childListCount: 0,
      addedNodeCount: 0,
      removedNodeCount: 0,
      characterDataCount: 0,
    };
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const timeout = setTimeout(() => rejectDone(new Error("Timed out waiting for mutation audit transitions")), 15_000);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          mutations.attributeCount += 1;
          mutations.attributesByName[record.attributeName] = (mutations.attributesByName[record.attributeName] ?? 0) + 1;
          if (record.target.classList.contains("polycss-scene")) mutations.attributesByTarget.modelRoot += 1;
          else if (record.target.classList.contains("g")) mutations.attributesByTarget.gearRoot += 1;
          else if (record.target.classList.contains("l")) mutations.attributesByTarget.lightingGroup += 1;
          else if (record.target.localName === "b") mutations.attributesByTarget.polygonLeaf += 1;
          else mutations.attributesByTarget.other += 1;
        } else if (record.type === "childList") {
          mutations.childListCount += 1;
          mutations.addedNodeCount += record.addedNodes.length;
          mutations.removedNodeCount += record.removedNodes.length;
        } else if (record.type === "characterData") {
          mutations.characterDataCount += 1;
        }
      }
    });
    observer.observe(scene, { attributes: true, childList: true, characterData: true, subtree: true });
    const startedAt = performance.now();
    api.resume();
    function checkProgress() {
      if (api.tick() - startTick >= expectedTransitions) {
        api.pause();
        resolveDone();
        return;
      }
      setTimeout(checkProgress, 5);
    }
    checkProgress();
    try {
      await done;
      await Promise.resolve();
    } finally {
      clearTimeout(timeout);
      observer.disconnect();
      api.pause();
    }
    const afterStats = api.stats();
    return {
      transitionCount: expectedTransitions,
      elapsedMs: performance.now() - startedAt,
      appCounterDelta: Object.fromEntries(Object.keys(afterStats)
        .filter((key) => typeof beforeStats[key] === "number" && typeof afterStats[key] === "number")
        .map((key) => [key, afterStats[key] - beforeStats[key]])),
      mutations,
      stableDom: api.assertStableDomIdentity(),
      startTick,
      finalTick: api.stats().globalTick,
    };
  }, transitionCount);
}

async function startTrace(cdp) {
  await cdp.send("Tracing.start", {
    categories: traceCategories,
    options: "record-continuously",
    transferMode: "ReturnAsStream",
  });
}

async function stopTrace(cdp, path) {
  const complete = new Promise((resolveComplete) => cdp.once("Tracing.tracingComplete", resolveComplete));
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  if (!stream) throw new Error("Chrome trace did not return a stream");
  const chunks = [];
  try {
    while (true) {
      const result = await cdp.send("IO.read", { handle: stream });
      chunks.push(result.base64Encoded ? Buffer.from(result.data, "base64").toString("utf8") : result.data);
      if (result.eof) break;
    }
  } finally {
    await cdp.send("IO.close", { handle: stream });
  }
  await writeFile(path, chunks.join(""));
}

async function analyzeTrace(path) {
  const bytes = await readFile(path);
  const trace = JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"));
  const events = Array.isArray(trace.traceEvents) ? trace.traceEvents : [];
  const durationsByThread = new Map();
  for (const event of events) {
    if (event.ph !== "X" || !Number.isFinite(event.dur)) continue;
    const key = `${event.pid}:${event.tid}`;
    const list = durationsByThread.get(key) ?? [];
    list.push(event);
    durationsByThread.set(key, list);
  }
  const mainThread = pickRendererMainThread(events);
  const durations = durationsByThread.get(`${mainThread.pid}:${mainThread.tid}`) ?? [];
  const selected = Object.fromEntries(selectedTraceEvents.map((name) => [name, eventDistribution(durations.filter((event) => event.name === name))]));
  const functionCalls = [...groupFunctionCalls(durations.filter((event) => event.name === "FunctionCall")).entries()]
    .map(([key, values]) => {
      const call = JSON.parse(key);
      const timestamps = values.map((event) => event.ts / 1_000).sort((left, right) => left - right);
      const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
      return {
        ...call,
        durationMs: eventDistribution(values),
        intervalMs: distribution(intervals),
      };
    })
    .sort((left, right) => right.durationMs.total - left.durationMs.total);
  const topDurationEvents = [...groupByName(durations).entries()]
    .map(([name, values]) => ({ name, ...distribution(values.map((event) => event.dur / 1_000)) }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 20);
  const taskEvents = durations.filter((event) => event.name === "RunTask" || event.name === "ThreadControllerImpl::RunTask");
  const [startUs, endUs] = eventExtent(durations);
  const threadWork = namedTraceThreads(events).map((thread) => {
    const threadDurations = durationsByThread.get(`${thread.pid}:${thread.tid}`) ?? [];
    const runTasks = threadDurations.filter((event) => event.name === "RunTask");
    const fallbackTasks = runTasks.length > 0 ? runTasks : threadDurations.filter((event) => event.name === "ThreadControllerImpl::RunTask");
    const [threadStartUs, threadEndUs] = eventExtent(threadDurations);
    return {
      ...thread,
      spanMs: (threadEndUs - threadStartUs) / 1_000,
      runTasks: eventDistribution(fallbackTasks),
      selectedEvents: Object.fromEntries(selectedTraceEvents.map((name) => [name, eventDistribution(threadDurations.filter((event) => event.name === name))])),
      topDurationEvents: [...groupByName(threadDurations).entries()]
        .map(([name, values]) => ({ name, ...distribution(values.map((event) => event.dur / 1_000)) }))
        .sort((left, right) => right.total - left.total)
        .slice(0, 12),
    };
  }).sort((left, right) => right.runTasks.total - left.runTasks.total);
  return {
    metadata: trace.metadata ?? null,
    eventCount: events.length,
    mainThreadSpanMs: (endUs - startUs) / 1_000,
    mainThread,
    selectedEvents: selected,
    functionCalls,
    topDurationEvents,
    threadWork,
    longMainThreadTasks: taskEvents.filter((event) => event.dur >= 50_000).map((event) => ({
      name: event.name,
      timestampUs: event.ts,
      durationMs: event.dur / 1_000,
    })),
  };
}

function eventExtent(events) {
  let startUs = Infinity;
  let endUs = -Infinity;
  for (const event of events) {
    startUs = Math.min(startUs, event.ts);
    endUs = Math.max(endUs, event.ts + event.dur);
  }
  return events.length > 0 ? [startUs, endUs] : [0, 0];
}

function namedTraceThreads(events) {
  const threads = new Map();
  for (const event of events) {
    if (event.ph !== "M" || event.name !== "thread_name" || typeof event.args?.name !== "string") continue;
    threads.set(`${event.pid}:${event.tid}`, { pid: event.pid, tid: event.tid, name: event.args.name });
  }
  return [...threads.values()];
}

function pickRendererMainThread(events) {
  const candidates = events.filter((event) => event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain");
  if (candidates.length === 0) throw new Error("Chrome trace has no CrRendererMain metadata");
  const scored = candidates.map((candidate) => ({
    pid: candidate.pid,
    tid: candidate.tid,
    name: candidate.args.name,
    durationUs: events
      .filter((event) => event.ph === "X" && event.pid === candidate.pid && event.tid === candidate.tid && Number.isFinite(event.dur))
      .reduce((sum, event) => sum + event.dur, 0),
  })).sort((left, right) => right.durationUs - left.durationUs);
  return scored[0];
}

function eventDistribution(events) {
  return distribution(events.map((event) => event.dur / 1_000));
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  };
  return {
    count: sorted.length,
    total: sorted.reduce((sum, value) => sum + value, 0),
    min: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? 0,
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0,
    countOver33ms: sorted.filter((value) => value > 33.34).length,
    countOver50ms: sorted.filter((value) => value >= 50).length,
  };
}

function buildReport(input) {
  const pausedPhases = input.phases.filter((phase) => !phase.playing);
  const playing = input.phases.find((phase) => phase.playing);
  const untracedPaused = input.untracedPhases.find((phase) => !phase.playing);
  const untracedPlaying = input.untracedPhases.find((phase) => phase.playing);
  const baseline = averagePhase(pausedPhases);
  const preparedPlaybackCalls = playing.trace?.functionCalls?.filter((call) =>
    /\/src\/cssgears\/preparedPlayback\.mjs/u.test(call.url)) ?? [];
  const appLoop = preparedPlaybackCalls.find((call) => call.functionName === "loop") ??
    preparedPlaybackCalls
      .filter((call) => call.durationMs.count === playing.appCounterDelta.runtimeSchedulerCallbackCount)
      .sort((left, right) => right.durationMs.total - left.durationMs.total)[0];
  const summary = {
    sampleSeconds: untracedPlaying.wallDurationMs / 1_000,
    preparedTransitions: untracedPlaying.tickDelta,
    logicalRowsEvaluated: untracedPlaying.appCounterDelta.runtimeLogicalRowsEvaluated,
    physicalPublicationPasses: untracedPlaying.appCounterDelta.runtimePhysicalPublicationPasses,
    catchUpPublicationPasses: untracedPlaying.appCounterDelta.runtimeSchedulerCatchUpPublicationCount,
    coalescedLogicalTicks: untracedPlaying.appCounterDelta.runtimeSchedulerCoalescedLogicalTickCount,
    postPublicationDelaySchedules: untracedPlaying.appCounterDelta.runtimeSchedulerPostPublicationDelayScheduleCount,
    schedulerCallbacks: untracedPlaying.appCounterDelta.runtimeSchedulerCallbackCount,
    schedulerNoopCallbacks: untracedPlaying.appCounterDelta.runtimeSchedulerNoopCallbackCount,
    schedulerDelayRequests: untracedPlaying.appCounterDelta.runtimeSchedulerDelayRequestCount,
    schedulerDelayCallbacks: untracedPlaying.appCounterDelta.runtimeSchedulerDelayCallbackCount,
    schedulerDelayCancels: untracedPlaying.appCounterDelta.runtimeSchedulerDelayCancelCount,
    gearRootTransformWrites: untracedPlaying.appCounterDelta.runtimeGearTransformWrites,
    lightingRowWrites: untracedPlaying.appCounterDelta.runtimeLightingRowWrites,
    datasetAttributeWrites: untracedPlaying.appCounterDelta.runtimeDatasetAttributeWrites,
    leafStyleWrites: untracedPlaying.appCounterDelta.runtimePerFrameLeafStyleWrites,
    domNodesAdded: untracedPlaying.appCounterDelta.runtimeDomCreationCount,
    domNodesRemoved: untracedPlaying.appCounterDelta.runtimeDomRemovalCount,
    runtimeGeometryConstructions: untracedPlaying.appCounterDelta.runtimeGeometryConstructionCount,
    transitionRateHz: perSecond(untracedPlaying.tickDelta, untracedPlaying.wallDurationMs),
    schedulerCallbackRateHz: perSecond(untracedPlaying.appCounterDelta.runtimeSchedulerCallbackCount, untracedPlaying.wallDurationMs),
    rendererProcessTaskTimeMsPerSecond: perSecond(untracedPlaying.performanceMetricDelta.TaskDuration * 1_000, untracedPlaying.wallDurationMs),
    baselineRendererProcessTaskTimeMsPerSecond: perSecond(untracedPaused.performanceMetricDelta.TaskDuration * 1_000, untracedPaused.wallDurationMs),
    scriptTimeMsPerSecond: perSecond(untracedPlaying.performanceMetricDelta.ScriptDuration * 1_000, untracedPlaying.wallDurationMs),
    baselineScriptTimeMsPerSecond: perSecond(untracedPaused.performanceMetricDelta.ScriptDuration * 1_000, untracedPaused.wallDurationMs),
    styleTimeMsPerSecond: perSecond(untracedPlaying.performanceMetricDelta.RecalcStyleDuration * 1_000, untracedPlaying.wallDurationMs),
    baselineStyleTimeMsPerSecond: perSecond(untracedPaused.performanceMetricDelta.RecalcStyleDuration * 1_000, untracedPaused.wallDurationMs),
    layoutTimeMsPerSecond: perSecond(untracedPlaying.performanceMetricDelta.LayoutDuration * 1_000, untracedPlaying.wallDurationMs),
    baselineLayoutTimeMsPerSecond: perSecond(untracedPaused.performanceMetricDelta.LayoutDuration * 1_000, untracedPaused.wallDurationMs),
    tracedPreparedTransitions: playing.tickDelta,
    tracedSchedulerCallbacks: playing.appCounterDelta.runtimeSchedulerCallbackCount,
    tracedAppLoopTotalMs: appLoop?.durationMs.total ?? 0,
    tracedAppLoopMeanMs: appLoop?.durationMs.mean ?? 0,
    tracedAppLoopP95Ms: appLoop?.durationMs.p95 ?? 0,
    tracedAppLoopP99Ms: appLoop?.durationMs.p99 ?? 0,
    tracedAppLoopMaxMs: appLoop?.durationMs.max ?? 0,
    schedulerIntervalP95Ms: appLoop?.intervalMs.p95 ?? 0,
    schedulerIntervalP99Ms: appLoop?.intervalMs.p99 ?? 0,
    schedulerIntervalMaxMs: appLoop?.intervalMs.max ?? 0,
    schedulerIntervalsOver50ms: appLoop?.intervalMs ? appLoop.intervalMs.countOver50ms ?? 0 : 0,
    longTaskCount: playing.trace?.longMainThreadTasks?.length ?? 0,
    traceLongTaskCount: playing.trace?.longMainThreadTasks?.length ?? 0,
    tracedTaskTimeMsPerSecond: perSecond(playing.performanceMetricDelta.TaskDuration * 1_000, playing.wallDurationMs),
    tracedBaselineTaskTimeMsPerSecond: perSecond(baseline.performanceMetricDelta.TaskDuration * 1_000, baseline.wallDurationMs),
    rendererMainRunTaskMsPerSecond: traceThreadTaskRate(playing, "CrRendererMain"),
    baselineRendererMainRunTaskMsPerSecond: mean(pausedPhases.map((phase) => traceThreadTaskRate(phase, "CrRendererMain"))),
    compositorRunTaskMsPerSecond: traceThreadTaskRate(playing, "Compositor"),
    baselineCompositorRunTaskMsPerSecond: mean(pausedPhases.map((phase) => traceThreadTaskRate(phase, "Compositor"))),
    vizCompositorRunTaskMsPerSecond: traceThreadTaskRate(playing, "VizCompositorThread"),
    baselineVizCompositorRunTaskMsPerSecond: mean(pausedPhases.map((phase) => traceThreadTaskRate(phase, "VizCompositorThread"))),
    gpuMainRunTaskMsPerSecond: traceThreadTaskRate(playing, "CrGpuMain"),
    baselineGpuMainRunTaskMsPerSecond: mean(pausedPhases.map((phase) => traceThreadTaskRate(phase, "CrGpuMain"))),
    pausedCalibrationTaskSpreadPercent: percentSpread(
      pausedPhases[0].performanceMetricDelta.TaskDuration,
      pausedPhases[1].performanceMetricDelta.TaskDuration,
    ),
  };
  return {
    schema: "cssgears-runtime-performance-trace@5",
    ...input,
    baseline,
    summary,
    mutationAudit: {
      ...input.mutationAudit,
      summary: mutationSummary(input.mutationAudit),
    },
  };
}

function traceThreadTaskRate(phase, name) {
  const thread = traceThreadWork(phase.trace, name);
  return perSecond(thread?.runTasks?.total ?? 0, phase.wallDurationMs);
}

function traceThreadWork(trace, name) {
  return (trace?.threadWork ?? [])
    .filter((thread) => thread.name === name)
    .sort((left, right) => right.runTasks.total - left.runTasks.total)[0] ?? null;
}

function averagePhase(phases) {
  return {
    label: "paused-mean",
    wallDurationMs: mean(phases.map((phase) => phase.wallDurationMs)),
    appCounterDelta: averageObjects(phases.map((phase) => phase.appCounterDelta)),
    performanceMetricDelta: averageObjects(phases.map((phase) => phase.performanceMetricDelta)),
    trace: {
      selectedEvents: averageObjects(phases.map((phase) => phase.trace.selectedEvents)),
    },
  };
}

function averageObjects(objects) {
  const keys = new Set(objects.flatMap((object) => Object.keys(object ?? {})));
  return Object.fromEntries([...keys].map((key) => {
    const values = objects.map((object) => object?.[key]).filter((value) => value !== undefined);
    if (values.every((value) => typeof value === "number")) return [key, mean(values)];
    if (values.every((value) => value && typeof value === "object" && !Array.isArray(value))) return [key, averageObjects(values)];
    return [key, values[0] ?? null];
  }));
}

function mutationSummary(audit) {
  const delta = audit.appCounterDelta;
  const attrs = audit.mutations.attributesByName;
  return {
    transitions: audit.finalTick - audit.startTick,
    schedulerCallbacks: delta.runtimeSchedulerCallbackCount,
    observedAttributeMutations: audit.mutations.attributeCount,
    observedStyleMutations: attrs.style ?? 0,
    observedModelRootStyleMutations: audit.mutations.attributesByTarget.modelRoot,
    observedGearStyleMutations: audit.mutations.attributesByTarget.gearRoot,
    observedLightingGroupStyleMutations: audit.mutations.attributesByTarget.lightingGroup,
    observedTickAttributeMutations: (attrs["data-cssgears-global-tick"] ?? 0) + (attrs["data-cssgears-timeline-state"] ?? 0),
    observedPolygonLeafAttributeMutations: audit.mutations.attributesByTarget.polygonLeaf,
    observedChildListMutations: audit.mutations.childListCount,
    addedNodes: audit.mutations.addedNodeCount,
    removedNodes: audit.mutations.removedNodeCount,
    appGearTransformWrites: delta.runtimeGearTransformWrites,
    appLightingRowWrites: delta.runtimeLightingRowWrites,
    appDatasetAttributeWrites: delta.runtimeDatasetAttributeWrites,
    stableDom: audit.stableDom,
  };
}

function assertMutationAudit(audit) {
  const summary = mutationSummary(audit);
  const failures = [];
  if (summary.transitions < audit.transitionCount) failures.push(`expected at least ${audit.transitionCount} transitions, got ${summary.transitions}`);
  if (summary.observedGearStyleMutations !== summary.appGearTransformWrites) {
    failures.push(`observed ${summary.observedGearStyleMutations} gear style mutations but the guarded publisher recorded ${summary.appGearTransformWrites} writes`);
  }
  if (summary.observedLightingGroupStyleMutations !== 0 || summary.observedModelRootStyleMutations !== 0 ||
      summary.observedAttributeMutations !== summary.observedGearStyleMutations ||
      summary.observedAttributeMutations !== summary.observedStyleMutations) {
    failures.push("runtime mutated attributes outside the three retained gear roots");
  }
  if (summary.observedTickAttributeMutations !== 0) failures.push("runtime published tick/state debug attributes");
  if (summary.appLightingRowWrites !== 0) failures.push("runtime published a lighting row");
  if (summary.appDatasetAttributeWrites !== 0) failures.push("runtime published debug attributes");
  if (summary.observedPolygonLeafAttributeMutations !== 0) failures.push("polygon leaves mutated");
  if (summary.observedChildListMutations !== 0 || summary.addedNodes !== 0 || summary.removedNodes !== 0) failures.push("retained DOM topology mutated");
  if (!summary.stableDom) failures.push("retained DOM identity check failed");
  if (failures.length > 0) throw new Error(`Mutation audit failed: ${failures.join("; ")}`);
}

function assertTransformOnlyTrace(report) {
  const active = report.phases.find((phase) => phase.playing);
  const failures = [];
  for (const eventName of ["Layout", "Paint", "PaintImage"]) {
    const count = active?.trace?.selectedEvents?.[eventName]?.count ?? 0;
    if (count !== 0) failures.push(`${eventName} ran ${count} times`);
  }
  for (const field of [
    "runtimeLightingRowComparisons",
    "runtimeLightingRowWrites",
    "runtimeLightingPublicationCount",
    "runtimeApplyStableDomIdentityChecks",
    "runtimeLeafTransformWrites",
    "runtimePerFrameLeafStyleWrites",
    "runtimeGeometryConstructionCount",
    "runtimeDomMutationCount",
  ]) {
    const value = active?.appCounterDelta?.[field] ?? 0;
    if (value !== 0) failures.push(`${field} advanced by ${value}`);
  }
  if ((active?.appCounterDelta?.runtimeSchedulerNoopCallbackCount ?? 0) !== 0) {
    failures.push("runtime scheduler executed a no-op delay callback");
  }
  if ((active?.appCounterDelta?.runtimeSchedulerCallbackCount ?? 0) !==
      (active?.appCounterDelta?.runtimeSchedulerStateTransitions ?? 0)) {
    failures.push("runtime scheduler callback count did not equal its prepared state transitions");
  }
  if ((active?.appCounterDelta?.runtimeSchedulerRequestCount ?? 0) !==
      (active?.appCounterDelta?.runtimeSchedulerStateTransitions ?? 0)) {
    failures.push("runtime scheduler animation-frame requests did not equal its prepared state transitions");
  }
  if (failures.length > 0) throw new Error(`Transform-only trace gate failed: ${failures.join("; ")}`);
}

function renderMarkdown(report) {
  const active = report.phases.find((phase) => phase.playing);
  const baseline = report.baseline;
  const mutation = report.mutationAudit.summary;
  const supplemental = report.supplementalTrace?.analysis ?? null;
  const supplementalLoop = supplemental?.functionCalls?.find((call) => call.functionName === "loop" && /\/src\/cssgears\/preparedPlayback\.mjs/u.test(call.url));
  const traceRows = ["FireAnimationFrame", "FunctionCall", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit"]
    .map((name) => {
      const paused = baseline.trace.selectedEvents[name];
      const playing = active.trace.selectedEvents[name];
      return `| ${name} | ${format(paused.total)} | ${format(playing.total)} | ${playing.count} | ${format(playing.p95)} | ${format(playing.max)} |`;
    }).join("\n");
  const threadRows = [
    ["Renderer main", report.summary.baselineRendererMainRunTaskMsPerSecond, report.summary.rendererMainRunTaskMsPerSecond],
    ["Compositor", report.summary.baselineCompositorRunTaskMsPerSecond, report.summary.compositorRunTaskMsPerSecond],
    ["Viz compositor", report.summary.baselineVizCompositorRunTaskMsPerSecond, report.summary.vizCompositorRunTaskMsPerSecond],
    ["GPU main", report.summary.baselineGpuMainRunTaskMsPerSecond, report.summary.gpuMainRunTaskMsPerSecond],
  ].map(([name, paused, playing]) => `| ${name} | ${format(paused)} ms/s | ${format(playing)} ms/s |`).join("\n");
  const supplementalThreads = supplemental ? [
    ["renderer main", traceThreadWork(supplemental, "CrRendererMain")],
    ["compositor", traceThreadWork(supplemental, "Compositor")],
    ["Viz compositor", traceThreadWork(supplemental, "VizCompositorThread")],
    ["GPU main", traceThreadWork(supplemental, "CrGpuMain")],
  ].map(([name, thread]) => `${name} ${format(thread?.runTasks?.total ?? 0)} ms`).join(", ") : "";
  const supplementalSection = supplemental ?
    `## User-supplied pre-compiled-publisher trace\n\n` +
    `Kept separate because its capture conditions do not match the controlled samples. Its renderer-main span is ${format(supplemental.mainThreadSpanMs / 1_000)} seconds. The earlier publisher ran ${supplementalLoop?.durationMs.count ?? 0} cssGears scheduler callbacks (${format(supplementalLoop?.durationMs.total ?? 0)} ms total JS; p95 ${format(supplementalLoop?.durationMs.p95 ?? 0)} ms; max ${format(supplementalLoop?.durationMs.max ?? 0)} ms). RunTask totals by thread were ${supplementalThreads}. Renderer-main work included ${supplemental.selectedEvents.UpdateLayoutTree.count} style updates, ${supplemental.selectedEvents.Layerize.count} Layerize events (${format(supplemental.selectedEvents.Layerize.total)} ms total; p95 ${format(supplemental.selectedEvents.Layerize.p95)} ms), ${supplemental.selectedEvents.Layout.count} layouts, ${supplemental.selectedEvents.Paint.count} paints, and ${supplemental.longMainThreadTasks.length} long tasks.\n\n` : "";
  return `# cssGears runtime performance trace\n\n` +
    `Captured ${report.capturedAt} with ${report.browser.name} ${report.browser.version} (${report.browser.channel}, headless) at ${report.target.url}, ${viewport.width}x${viewport.height}@1.\n\n` +
    `## Exact measured runtime work\n\n` +
    `During ${format(report.summary.sampleSeconds)} seconds of playback, cssGears evaluated ${report.summary.logicalRowsEvaluated} logical rows from the prepared ${report.initial.stats.preparedTransformTableCount}-entry transform table and advanced ${report.summary.preparedTransitions} source states. ${report.summary.physicalPublicationPasses} publication passes performed ${report.summary.gearRootTransformWrites} guarded writes to the three retained gear roots. The paint-aligned scheduler armed ${report.summary.postPublicationDelaySchedules} deadline wake-ups and performed ${report.summary.catchUpPublicationPasses} catch-up passes: missed draws are never coalesced or replayed.\n\n` +
    `The product scheduler ran ${report.summary.schedulerDelayCallbacks} delay callbacks and ${report.summary.schedulerCallbacks} animation-frame-aligned prepared-state publications (${report.summary.schedulerNoopCallbacks} with no prepared tick due). Runtime work outside the compiled display list was ${report.summary.datasetAttributeWrites} debug data-attribute writes, ${report.summary.leafStyleWrites} polygon-leaf writes, ${report.summary.domNodesAdded} nodes added, ${report.summary.domNodesRemoved} nodes removed, and ${report.summary.runtimeGeometryConstructions} geometry constructions.\n\n` +
    `The independent ${mutation.transitions}-transition mutation audit observed ${mutation.appLightingRowWrites} prepared stylesheet lighting-row writes, ${mutation.observedGearStyleMutations} gear-root style mutations, ${mutation.observedTickAttributeMutations} tick/state data-attribute mutations, ${mutation.observedPolygonLeafAttributeMutations} polygon-leaf mutations, and ${mutation.observedChildListMutations} child-list mutations.\n\n` +
    `## Browser cost per wall-clock second\n\n` +
    `| Metric | Paused baseline | Playing |\n| --- | ---: | ---: |\n` +
    `| Renderer-process task metric | ${format(report.summary.baselineRendererProcessTaskTimeMsPerSecond)} ms/s | ${format(report.summary.rendererProcessTaskTimeMsPerSecond)} ms/s |\n` +
    `| Script time | ${format(report.summary.baselineScriptTimeMsPerSecond)} ms/s | ${format(report.summary.scriptTimeMsPerSecond)} ms/s |\n` +
    `| Style recalculation | ${format(report.summary.baselineStyleTimeMsPerSecond)} ms/s | ${format(report.summary.styleTimeMsPerSecond)} ms/s |\n` +
    `| Layout | ${format(report.summary.baselineLayoutTimeMsPerSecond)} ms/s | ${format(report.summary.layoutTimeMsPerSecond)} ms/s |\n\n` +
    `These Performance-domain samples are untraced. Playback advanced at ${format(report.summary.transitionRateHz)} source draws/s with ${format(report.summary.schedulerCallbackRateHz)} app scheduler callbacks/s. The controlled trace found ${report.summary.tracedSchedulerCallbacks} app scheduler callbacks and ${format(report.summary.tracedAppLoopTotalMs)} ms of app loop work. Long main-thread tasks: ${report.summary.traceLongTaskCount}.\n\n` +
    `## Chrome trace thread task occupancy\n\n` +
    `RunTask durations are measured independently on each named Chrome thread and are not added to nested event durations.\n\n` +
    `| Thread | Paused mean | Playing |\n| --- | ---: | ---: |\n${threadRows}\n\n` +
    `## Chrome trace main-thread events\n\n` +
    `Durations are total milliseconds over each matched sample.\n\n` +
    `| Event | Paused mean total | Playing total | Playing count | Playing p95 | Playing max |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${traceRows}\n\n` +
    supplementalSection +
    `## Measurement boundary\n\n` +
    `The product path was warmed for ${report.configuration.warmupMs} ms. Paused A and paused B calibrate trace overhead. No app-side sampler or per-tick dump ran. The measured product path preserves XScreenSaver's one-draw/no-catch-up cadence with a deadline timer and paint-aligned animation-frame publication, plus logical row evaluation, guarded root publication, and the browser rendering work those transforms cause. Separate untraced paused/playing samples calibrate Performance-domain totals. The polling MutationObserver audit ran afterward and is excluded from every performance phase. Raw Chrome traces and all reports are local ignored artifacts.\n`;
}

function renderChart(report) {
  const active = report.phases.find((phase) => phase.playing);
  const baseline = report.baseline;
  const untracedActive = report.untracedPhases.find((phase) => phase.playing);
  const untracedBaseline = report.untracedPhases.find((phase) => !phase.playing);
  const metrics = [
    ["Renderer process", perSecond(untracedBaseline.performanceMetricDelta.TaskDuration * 1_000, untracedBaseline.wallDurationMs), perSecond(untracedActive.performanceMetricDelta.TaskDuration * 1_000, untracedActive.wallDurationMs)],
    ["Renderer main", report.summary.baselineRendererMainRunTaskMsPerSecond, report.summary.rendererMainRunTaskMsPerSecond],
    ["Compositor", report.summary.baselineCompositorRunTaskMsPerSecond, report.summary.compositorRunTaskMsPerSecond],
    ["Viz compositor", report.summary.baselineVizCompositorRunTaskMsPerSecond, report.summary.vizCompositorRunTaskMsPerSecond],
    ["GPU main", report.summary.baselineGpuMainRunTaskMsPerSecond, report.summary.gpuMainRunTaskMsPerSecond],
    ["Script", perSecond(untracedBaseline.performanceMetricDelta.ScriptDuration * 1_000, untracedBaseline.wallDurationMs), perSecond(untracedActive.performanceMetricDelta.ScriptDuration * 1_000, untracedActive.wallDurationMs)],
    ["Style", perSecond(untracedBaseline.performanceMetricDelta.RecalcStyleDuration * 1_000, untracedBaseline.wallDurationMs), perSecond(untracedActive.performanceMetricDelta.RecalcStyleDuration * 1_000, untracedActive.wallDurationMs)],
  ];
  const maximum = Math.max(1, ...metrics.flatMap(([, paused, playing]) => [paused, playing]));
  const chartLeft = 220;
  const chartWidth = 820;
  const rowHeight = 64;
  const top = 138;
  const bars = metrics.map(([label, paused, playing], index) => {
    const y = top + index * rowHeight;
    const pausedWidth = paused / maximum * chartWidth;
    const playingWidth = playing / maximum * chartWidth;
    return `<text x="28" y="${y + 25}" fill="#d8e0e6" font-size="18">${escapeXml(label)}</text>` +
      `<rect x="${chartLeft}" y="${y + 5}" width="${pausedWidth}" height="17" rx="4" fill="#657481"/>` +
      `<rect x="${chartLeft}" y="${y + 31}" width="${playingWidth}" height="17" rx="4" fill="#43d39e"/>` +
      `<text x="${Math.min(1115, chartLeft + pausedWidth + 8)}" y="${y + 19}" fill="#aebbc4" font-size="14">${format(paused)}</text>` +
      `<text x="${Math.min(1115, chartLeft + playingWidth + 8)}" y="${y + 45}" fill="#dffbf0" font-size="14">${format(playing)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">` +
    `<rect width="1200" height="680" fill="#0b1014"/>` +
    `<text x="28" y="46" fill="#f3f7fa" font-family="ui-sans-serif,system-ui" font-size="28" font-weight="700">cssGears runtime work</text>` +
    `<text x="28" y="77" fill="#9aabb6" font-family="ui-sans-serif,system-ui" font-size="16">Google Chrome ${escapeXml(report.browser.version)} · ${format(report.summary.sampleSeconds)} s matched samples · ms per wall-clock second</text>` +
    `<rect x="28" y="99" width="18" height="12" rx="3" fill="#657481"/><text x="54" y="110" fill="#aebbc4" font-family="ui-sans-serif,system-ui" font-size="14">paused mean</text>` +
    `<rect x="164" y="99" width="18" height="12" rx="3" fill="#43d39e"/><text x="190" y="110" fill="#dffbf0" font-family="ui-sans-serif,system-ui" font-size="14">playing</text>` +
    `<g font-family="ui-sans-serif,system-ui">${bars}</g>` +
    `<text x="28" y="615" fill="#f3f7fa" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="600">${report.summary.logicalRowsEvaluated} logical rows · ${report.summary.physicalPublicationPasses} physical passes · ${report.summary.gearRootTransformWrites} guarded root writes · ${report.summary.leafStyleWrites} leaf writes</text>` +
    `<text x="28" y="646" fill="#9aabb6" font-family="ui-sans-serif,system-ui" font-size="15">${report.summary.domNodesAdded + report.summary.domNodesRemoved} DOM topology changes · ${report.summary.longTaskCount} long tasks · ${format(report.summary.transitionRateHz)} source draws/s</text>` +
    `</svg>\n`;
}

function metricsObject(result) {
  return Object.fromEntries((result.metrics ?? []).map((metric) => [metric.name, metric.value]));
}

function numericDelta(before, after, fields) {
  return Object.fromEntries(fields
    .filter((field) => typeof before?.[field] === "number" && typeof after?.[field] === "number")
    .map((field) => [field, after[field] - before[field]]));
}

function groupByName(events) {
  const grouped = new Map();
  for (const event of events) {
    const list = grouped.get(event.name) ?? [];
    list.push(event);
    grouped.set(event.name, list);
  }
  return grouped;
}

function groupFunctionCalls(events) {
  const grouped = new Map();
  for (const event of events) {
    const data = event.args?.data ?? {};
    const key = JSON.stringify({
      functionName: data.functionName ?? "",
      url: data.url ?? "",
      lineNumber: data.lineNumber ?? null,
      columnNumber: data.columnNumber ?? null,
    });
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }
  return grouped;
}

function machineSummary() {
  const processorList = cpus();
  return {
    platform: platform(),
    architecture: arch(),
    cpu: processorList[0]?.model ?? "unknown",
    logicalCpuCount: processorList.length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function perSecond(value, durationMs) {
  return durationMs > 0 ? value / (durationMs / 1_000) : 0;
}

function percentSpread(left, right) {
  const average = (Math.abs(left) + Math.abs(right)) / 2;
  return average > 0 ? Math.abs(left - right) / average * 100 : 0;
}

function format(value) {
  return Number(value ?? 0).toFixed(3).replace(/\.000$/, "");
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character]);
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function acquireTarget(url) {
  if (url) {
    const resolvedUrl = new URL(url).toString();
    await waitForHttp(resolvedUrl, 10_000);
    return { url: resolvedUrl, owned: false, close: async () => undefined };
  }
  const port = await freePort();
  let output = "";
  const server = spawn("pnpm", [
    "exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const serverUrl = `http://127.0.0.1:${port}/`;
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
    try {
      const response = await fetch(serverUrl, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }, 20_000, `Timed out waiting for Vite at ${serverUrl}\n${output}`);
  return {
    url: serverUrl,
    owned: true,
    async close() {
      if (server.exitCode === null) server.kill("SIGTERM");
    },
  };
}

async function waitForHttp(url, timeoutMs) {
  await waitFor(async () => {
    try {
      const response = await fetch(url, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }, timeoutMs, `Timed out waiting for ${url}`);
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(message);
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
