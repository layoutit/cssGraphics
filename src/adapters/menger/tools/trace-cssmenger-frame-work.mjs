#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const outputDir = join(repositoryRoot, "bench", "results", "cssmenger", "performance");
const tracePath = join(outputDir, "frame-work-chrome-trace.json");
const summaryPath = join(outputDir, "frame-work-summary.json");
const viewport = { width: 960, height: 600 };
const sampleTick = 320;
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.__cssMengerDebug?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(async (tick) => {
    globalThis.__cssMengerDebug.pause();
    globalThis.__cssMengerDebug.seek(tick);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  }, sampleTick);

  await cdp.send("Performance.enable");
  const traceEvents = [];
  cdp.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
  const tracingComplete = new Promise((resolveComplete) => cdp.once("Tracing.tracingComplete", resolveComplete));
  await cdp.send("Tracing.start", {
    categories: [
      "toplevel",
      "benchmark",
      "blink",
      "blink.user_timing",
      "cc",
      "gpu",
      "viz",
      "renderer.scheduler",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.invalidationTracking",
      "disabled-by-default-devtools.timeline.layers",
      "disabled-by-default-devtools.timeline.paint",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReportEvents",
  });

  // Enabling paint/raster trace categories itself schedules a full layer-tree
  // inspection. Let that diagnostic work drain before measuring the paused
  // control window or the single publication window.
  await page.waitForTimeout(1_000);
  await page.evaluate(() => new Promise((resolveFrames) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrames))));
  await page.waitForTimeout(250);

  const metricsBefore = metricMap(await cdp.send("Performance.getMetrics"));
  const result = await page.evaluate(async (tick) => {
    const debug = globalThis.__cssMengerDebug;
    const scene = debug.scene;
    const publicationRoot = document.querySelector(".polycss-camera > .polycss-scene");
    const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b, .polycss-camera > .polycss-scene > i, .polycss-camera > .polycss-scene > s")];
    if (!(publicationRoot instanceof HTMLElement) ||
        scene?.playback?.transforms?.length <= tick + 1 ||
        scene?.playback?.colorRows?.length <= tick + 1) {
      throw new Error("Single-frame work probe could not bind the prepared runtime graph");
    }
    const originalTransform = scene.playback.transforms[tick];
    const nextTransform = scene.playback.transforms[tick + 1];
    const originalColorRow = scene.playback.colorRows[tick];
    const nextColorRow = scene.playback.colorRows[tick + 1];
    const atlasPositions = scene.planeAtlas.paletteBackgroundPositionYs;
    const beforeStats = debug.stats();
    performance.mark("cssmenger-baseline-start");
    await fourFrames("cssmenger-baseline");
    performance.mark("cssmenger-baseline-end");
    await settle();

    const transformOnly = await measuredCase("cssmenger-transform-only", () => {
      publicationRoot.style.transform = nextTransform;
      return { writeCount: 1, property: "transform", targetCount: 1 };
    });
    publicationRoot.style.transform = originalTransform;
    await settle();

    const paletteOnly = await measuredCase("cssmenger-palette-only", () => {
      const writeCount = writeSelectedColors(tick + 1, nextColorRow);
      return { writeCount, property: "background-position-y", targetCount: writeCount };
    });
    writeSelectedColors(tick, originalColorRow);
    await settle();

    performance.mark("cssmenger-frame-work-start");
    const publication = debug.profileStep();
    performance.mark("cssmenger-publication-complete");
    await fourFrames("cssmenger-frame-work");
    performance.mark("cssmenger-frame-work-end");
    const afterStats = debug.stats();
    return {
      publication,
      isolatedPublications: { transformOnly, paletteOnly },
      statsDelta: Object.freeze({
        preparedStatesApplied: publication.after.tick - publication.before.tick,
        runtimeModelTransformWrites: Number(publication.modelTransform.changed),
        runtimeAxisColorWrites: publication.axes.reduce((count, axis) => count + axis.targetCount, 0),
        runtimeSchedulerCallbackCount: 0,
        runtimeDomMutationCount: afterStats.runtimeDomMutationCount - beforeStats.runtimeDomMutationCount,
        runtimeGeometryConstructionCount: afterStats.runtimeGeometryConstructionCount - beforeStats.runtimeGeometryConstructionCount,
        runtimeMergeCount: afterStats.runtimeMergeCount - beforeStats.runtimeMergeCount,
      }),
      stableDom: debug.assertStableDomIdentity(),
      finalState: debug.state(),
    };

    function writeSelectedColors(stateIndex, colorRow) {
      const schedule = scene.playback.frontFacingSchedule;
      let writeCount = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        const backgroundPositionY = atlasPositions[colorRow[axis]];
        const segmentIndex = stateIndex * schedule.axisCount + axis;
        const start = schedule.offsets[segmentIndex];
        const end = schedule.offsets[segmentIndex + 1];
        for (let index = start; index < end; index += 1) {
          leaves[schedule.leafIndices[index]].style.backgroundPositionY = backgroundPositionY;
          writeCount += 1;
        }
      }
      return writeCount;
    }

    async function measuredCase(prefix, publish) {
      performance.mark(`${prefix}-start`);
      const startedAt = performance.now();
      const details = publish();
      const publicationMilliseconds = performance.now() - startedAt;
      performance.mark(`${prefix}-publication-complete`);
      await fourFrames(prefix);
      performance.mark(`${prefix}-end`);
      return { ...details, publicationMilliseconds };
    }

    async function settle() {
      await fourFrames("cssmenger-settle");
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
    }

    async function fourFrames(prefix) {
      for (let index = 1; index <= 4; index += 1) {
        await new Promise((resolveFrame) => requestAnimationFrame((timestamp) => {
          performance.mark(`${prefix}-raf-${index}`, { detail: { timestamp } });
          resolveFrame();
        }));
      }
    }
  }, sampleTick);
  const metricsAfter = metricMap(await cdp.send("Performance.getMetrics"));
  await page.waitForTimeout(100);
  await cdp.send("Tracing.end");
  await tracingComplete;

  const threadNames = traceThreadNames(traceEvents);
  const marks = userTimingMarks(traceEvents);
  const baselineWindow = traceWindow(marks, "cssmenger-baseline-start", "cssmenger-baseline-end");
  const transformWindow = traceWindow(marks, "cssmenger-transform-only-start", "cssmenger-transform-only-end");
  const paletteWindow = traceWindow(marks, "cssmenger-palette-only-start", "cssmenger-palette-only-end");
  const workWindow = traceWindow(marks, "cssmenger-frame-work-start", "cssmenger-frame-work-end");
  const baseline = summarizeWindow(traceEvents, threadNames, baselineWindow);
  const transformOnly = summarizeWindow(traceEvents, threadNames, transformWindow);
  const paletteOnly = summarizeWindow(traceEvents, threadNames, paletteWindow);
  const frameWork = summarizeWindow(traceEvents, threadNames, workWindow);
  const summary = {
    schema: "cssmenger-single-runtime-frame-work-trace@1",
    capturedAt: new Date().toISOString(),
    route,
    build: "vite-production-preview",
    browser: { name: "Google Chrome", version: browserVersion, channel: "chrome", headless: true },
    viewport,
    sampleTick,
    publication: result.publication,
    isolatedPublications: result.isolatedPublications,
    runtime: {
      statsDelta: result.statsDelta,
      stableDom: result.stableDom,
      finalState: result.finalState,
    },
    windows: { baseline, transformOnly, paletteOnly, frameWork },
    incrementalBrowserWork: {
      transformOnly: subtractSummaries(baseline, transformOnly),
      paletteOnly: subtractSummaries(baseline, paletteOnly),
      completeTick: subtractSummaries(baseline, frameWork),
    },
    performanceMetricDelta: {
      taskMilliseconds: metricDelta(metricsBefore, metricsAfter, "TaskDuration", 1000),
      scriptMilliseconds: metricDelta(metricsBefore, metricsAfter, "ScriptDuration", 1000),
      styleRecalcMilliseconds: metricDelta(metricsBefore, metricsAfter, "RecalcStyleDuration", 1000),
      layoutMilliseconds: metricDelta(metricsBefore, metricsAfter, "LayoutDuration", 1000),
      styleRecalcCount: metricDelta(metricsBefore, metricsAfter, "RecalcStyleCount"),
      layoutCount: metricDelta(metricsBefore, metricsAfter, "LayoutCount"),
    },
    trace: {
      path: tracePath,
      eventCount: traceEvents.length,
      marks,
    },
    errors,
  };
  await writeFile(tracePath, `${JSON.stringify({ traceEvents })}\n`);
  summary.trace.sizeBytes = (await stat(tracePath)).size;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ summaryPath, tracePath, ...summary }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) server.kill("SIGTERM");
}

function traceThreadNames(events) {
  return new Map(events
    .filter((event) => event.ph === "M" && event.name === "thread_name")
    .map((event) => [`${event.pid}:${event.tid}`, event.args?.name ?? "unnamed"]));
}

function userTimingMarks(events) {
  return Object.fromEntries(events
    .filter((event) => event.cat?.includes("blink.user_timing") && event.name?.startsWith("cssmenger-"))
    .map((event) => [event.name, event.ts]));
}

function traceWindow(marks, startName, endName) {
  const startMicroseconds = marks[startName];
  const endMicroseconds = marks[endName];
  if (!Number.isFinite(startMicroseconds) || !Number.isFinite(endMicroseconds) || endMicroseconds <= startMicroseconds) {
    throw new Error(`Trace marks for ${startName}..${endName} are missing or invalid`);
  }
  return { startMicroseconds, endMicroseconds, durationMilliseconds: (endMicroseconds - startMicroseconds) / 1000 };
}

function summarizeWindow(events, threadNames, window) {
  const selected = events.filter((event) => Number.isFinite(event.ts) && event.ts >= window.startMicroseconds && event.ts <= window.endMicroseconds);
  const byThreadAndName = new Map();
  for (const event of selected) {
    if (event.ph !== "X" || !Number.isFinite(event.dur)) continue;
    const thread = threadNames.get(`${event.pid}:${event.tid}`) ?? "unnamed";
    const key = `${thread}\u0000${event.name}`;
    const row = byThreadAndName.get(key) ?? { thread, name: event.name, count: 0, totalDurationMilliseconds: 0, maximumDurationMilliseconds: 0 };
    const durationMilliseconds = event.dur / 1000;
    row.count += 1;
    row.totalDurationMilliseconds += durationMilliseconds;
    row.maximumDurationMilliseconds = Math.max(row.maximumDurationMilliseconds, durationMilliseconds);
    byThreadAndName.set(key, row);
  }
  const eventsByCost = [...byThreadAndName.values()]
    .sort((left, right) => right.totalDurationMilliseconds - left.totalDurationMilliseconds);
  const focusNames = new Set([
    "RunTask", "FunctionCall", "FireAnimationFrame", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize",
    "Commit", "CompositeLayers", "RasterTask", "ImageDecodeTask", "Decode Image", "DrawFrame", "SubmitCompositorFrame",
    "BeginMainThreadFrame", "BeginFrame", "ActivateLayerTree", "AnimationFrame",
  ]);
  return {
    ...window,
    traceEventCount: selected.length,
    focusedEvents: eventsByCost.filter((row) => focusNames.has(row.name)),
    topEventsByCost: eventsByCost.slice(0, 80),
    invalidations: selected.filter((event) => /InvalidationTracking$/.test(event.name)).map((event) => ({
      name: event.name,
      thread: threadNames.get(`${event.pid}:${event.tid}`) ?? "unnamed",
      args: event.args,
    })),
  };
}

function subtractSummaries(baseline, frameWork) {
  const baselineByKey = new Map(baseline.focusedEvents.map((row) => [`${row.thread}\u0000${row.name}`, row]));
  return frameWork.focusedEvents.map((row) => {
    const base = baselineByKey.get(`${row.thread}\u0000${row.name}`);
    return {
      thread: row.thread,
      name: row.name,
      count: row.count - (base?.count ?? 0),
      totalDurationMilliseconds: row.totalDurationMilliseconds - (base?.totalDurationMilliseconds ?? 0),
    };
  }).filter((row) => row.count !== 0 || Math.abs(row.totalDurationMilliseconds) >= 0.001)
    .sort((left, right) => right.totalDurationMilliseconds - left.totalDurationMilliseconds);
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name, scale = 1) {
  if (!Number.isFinite(before[name]) || !Number.isFinite(after[name])) return null;
  return (after[name] - before[name]) * scale;
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
