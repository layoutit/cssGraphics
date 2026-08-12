#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const SCHEMA = "cssgraphics-frame-sleuth@1";

const FOCUS_EVENTS = new Set([
  "RunTask",
  "ThreadControllerImpl::RunTask",
  "FireAnimationFrame",
  "TimerFire",
  "FunctionCall",
  "RunMicrotasks",
  "UpdateLayoutTree",
  "RecalculateStyles",
  "Layout",
  "PrePaint",
  "Paint",
  "PaintImage",
  "UpdateLayer",
  "Layerize",
  "Commit",
  "RasterTask",
  "GPUTask",
]);

const HELP = `FrameSleuth — explain the work performed around slow browser frames

Usage:
  pnpm framesleuth -- <trace.json|trace.json.gz> [options]

Options:
  --compare <trace>      Compare the first trace with a second trace
  --format <type>        markdown (default) or json
  --output <path>        Write the report to a file
  --top <count>          Number of slowest compositor DrawFrame intervals (default: 5)
  --frame <index>        Inspect one 1-based DrawFrame interval
  --rank <index>         Inspect the Nth-slowest DrawFrame interval
  --around-ms <number>   Inspect the interval containing this time after window start
  --screenshots <dir>    Extract the screenshot nearest each reported slow interval
  --url <substring>      Prefer a renderer whose traced page URL contains this text
  --start-ms <number>    Trim the inferred active window from its start
  --end-ms <number>      End analysis this many milliseconds after the inferred start
  --question <text>      Put the most relevant evidence first
  --help                 Show this help

Examples:
  pnpm framesleuth -- ~/Downloads/Trace.json.gz
  pnpm framesleuth -- before.json.gz --compare after.json.gz
  pnpm framesleuth -- Trace.json.gz --question "what work did we do on the worst frame?"
  pnpm framesleuth -- Trace.json.gz --format json --output analysis.json
  pnpm framesleuth -- Trace.json.gz --rank 2 --screenshots /tmp/frame-evidence

Question topics:
  worst-frame work; smoothness/scheduler; lighting/paint/raster; drops/artifacts;
  JavaScript; garbage collection; GPU; long tasks; evidence coverage;
  screenshots; and before/after regression (with --compare).
`;

export async function loadTrace(path) {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath);
  const compressed = source[0] === 0x1f && source[1] === 0x8b;
  const decoded = compressed ? gunzipSync(source) : source;
  let parsed;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    throw new Error(`Trace ${absolutePath} is not valid JSON: ${error.message}`);
  }
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;

  if (!Array.isArray(events)) {
    throw new Error(`Trace ${absolutePath} does not contain a traceEvents array.`);
  }

  return {
    path: absolutePath,
    bytes: source.byteLength,
    decodedBytes: decoded.byteLength,
    compressed,
    events,
  };
}

export function analyzeTrace(loaded, options = {}) {
  const metadata = collectMetadata(loaded.events);
  const selection = selectRenderer(loaded.events, metadata, options.url);
  const cpuProfile = collectCpuProfile(loaded.events, selection);
  const baseWindow = inferActiveWindow(loaded.events, selection);
  const window = trimWindow(baseWindow, options.startMs, options.endMs);
  const events = loaded.events.filter((event) => overlapsWindow(event, window));
  const rendererEvents = events.filter((event) => event.pid === selection.pid);
  const mainEvents = rendererEvents.filter((event) => event.tid === selection.mainTid);
  const compositorEvents = rendererEvents.filter((event) => event.tid === selection.compositorTid);
  const rasterTids = new Set(
    rendererEvents.filter((event) => event.name === "RasterTask").map((event) => event.tid),
  );

  const rafEvents = sortedEvents(mainEvents, "FireAnimationFrame");
  const updateEvents = sortedEvents(mainEvents, "UpdateLayoutTree");
  const timerEvents = sortedEvents(mainEvents, "TimerFire");
  const drawEvents = uniqueTimestampEvents(sortedEvents(compositorEvents, "DrawFrame"));
  const presentationEvents = uniqueTimestampEvents(sortedEvents(mainEvents, "AnimationFrame::Presentation"));
  const layerTreeId = dominantValue(drawEvents.map((event) => event.args?.layerTreeId).filter((value) => value != null));
  const pipelineRecords = collectPipelineRecords(compositorEvents, layerTreeId);
  const capabilities = summarizeCapabilities({
    loadedEvents: events,
    mainEvents,
    compositorEvents,
    rendererEvents,
    drawEvents,
    pipelineRecords,
    selection,
    cpuProfile,
  });
  if (layerTreeId == null && pipelineRecords.length > 0) {
    capabilities.warnings.push("DrawFrame events did not identify a dominant layer tree; PipelineReporter records are renderer-process scoped.");
  }
  const cadence = estimateDisplayCadence(compositorEvents, rafEvents, pipelineRecords);
  const rafStats = summarizeTimestamps(rafEvents.map((event) => event.ts));
  const timerStats = summarizeTimestamps(timerEvents.map((event) => event.ts));
  const schedulerCoupling = summarizeSchedulerCoupling(timerStats, rafStats, cadence.ms);
  const timerToRaf = pairTimersWithRaf(timerEvents, rafEvents, cadence.ms);
  const frameIntervals = buildFrameIntervals(drawEvents);
  const drawStats = summarizeTimestamps(drawEvents.map((event) => event.ts));
  const drawBaselineMs = drawStats.p50Ms ?? cadence.ms;
  const indexedFrameEvents = indexCompleteEventsByFrame(events, frameIntervals);
  const frameDetails = frameIntervals.map((frame) =>
    analyzeFrame({
      frame,
      frameEvents: indexedFrameEvents.get(frame.index) ?? [],
      metadata,
      selection,
      rasterTids,
      cadence,
      rafEvents,
      updateEvents,
      timerToRaf,
      pipelineRecords,
      schedulerCoupling,
      drawBaselineMs,
      traceStartTs: window.startTs,
      capabilities,
      cpuProfile,
    }),
  );
  const slowest = [...frameDetails].sort((a, b) => b.intervalMs - a.intervalMs);
  const requestedFrame = selectRequestedFrame(frameDetails, slowest, window, options);
  const longTasks = summarizeLongTasks(mainEvents, window, 50);
  const pipeline = summarizePipeline(pipelineRecords, drawEvents, cadence.ms, drawStats.p50Ms, window.startTs);
  pipeline.available = capabilities.signals.pipelineReporter.available;
  if (!pipeline.available) {
    pipeline.droppedCount = null;
    pipeline.affectsSmoothnessCount = null;
    pipeline.severeDrawStallAlignedCount = null;
  }
  const focus = inferQuestionFocus(options.question);
  const topCount = options.top ?? 5;
  const gc = summarizeGarbageCollection(mainEvents, window);
  const updateStats = summarizeTimestamps(updateEvents.map((event) => event.ts));
  const presentationIntervals = buildFrameIntervals(presentationEvents);
  const timelineIntervals = presentationIntervals.length > 0 ? presentationIntervals : frameIntervals;
  const indexedTimelineEvents = presentationIntervals.length > 0
    ? indexCompleteEventsByFrame(events, timelineIntervals)
    : indexedFrameEvents;
  const timelineFrames = buildTimelineFrames(timelineIntervals, indexedTimelineEvents, selection, window.startTs);
  const timelineStats = {
    eventCount: timelineIntervals.length + Number(timelineIntervals.length > 0),
    ...summarizeNumbers(timelineIntervals.map((frame) => frame.intervalMs)),
  };
  const timelineBaselineMs = timelineStats.p50Ms ?? drawBaselineMs;
  const worstTimelineInterval = [...timelineIntervals].sort((a, b) => b.intervalMs - a.intervalMs)[0] ?? null;
  const worstTimelineFrame = presentationIntervals.length > 0 && worstTimelineInterval
    ? analyzeFrame({
      frame: worstTimelineInterval,
      frameEvents: indexedTimelineEvents.get(worstTimelineInterval.index) ?? [],
      metadata,
      selection,
      rasterTids,
      cadence,
      rafEvents,
      updateEvents,
      timerToRaf,
      pipelineRecords,
      schedulerCoupling,
      drawBaselineMs: timelineBaselineMs,
      traceStartTs: window.startTs,
      capabilities,
      cpuProfile,
      intervalKind: "presented animation frame",
    })
    : slowest[0] ?? null;
  const screenshotEvents = collectScreenshotEvents(events);
  const screenshotTarget = requestedFrame ?? worstTimelineFrame;
  const nearestScreenshot = screenshotTarget ? nearestScreenshotMetadata(screenshotEvents, screenshotTarget, window.startTs) : null;
  if (screenshotEvents.length > 0 && screenshotTarget && !nearestScreenshot) {
    capabilities.warnings.push("Screenshot events were captured, but none matched the selected frame sequence; no temporally-near image from another page was substituted.");
  }

  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    input: {
      path: loaded.path,
      name: basename(loaded.path),
      bytes: loaded.bytes,
      decodedBytes: loaded.decodedBytes,
      compressed: loaded.compressed,
      eventCount: loaded.events.length,
    },
    selection: {
      rendererPid: selection.pid,
      rendererMainTid: selection.mainTid,
      compositorTid: selection.compositorTid,
      layerTreeId,
      urls: selection.urls,
      candidates: selection.candidates,
    },
    window: {
      source: baseWindow.source,
      startTs: window.startTs,
      endTs: window.endTs,
      durationMs: round((window.endTs - window.startTs) / 1000),
    },
    question: options.question || null,
    focus,
    capabilities,
    cadence: {
      display: cadence,
      requestAnimationFrame: rafStats,
      styleAndLayout: updateStats,
      drawFrame: drawStats,
      timer: timerStats,
      timerToNextRafDelay: summarizeNumbers(timerToRaf.map((pair) => pair.delayMs)),
      timerToRafDelay: schedulerCoupling.coupled ? summarizeNumbers(timerToRaf.map((pair) => pair.delayMs)) : summarizeNumbers([]),
      schedulerCoupling,
      drawGapsAboveMs: Object.fromEntries(
        [33.3, 40, 45, 50].map((threshold) => [String(threshold), frameIntervals.filter((frame) => frame.intervalMs > threshold).length]),
      ),
      drawGapsAboveDisplayMultiples: Object.fromEntries(
        [1.5, 2, 3].map((multiple) => [String(multiple), frameIntervals.filter((frame) => frame.intervalMs > cadence.ms * multiple).length]),
      ),
      drawGapsAboveBaselineMultiples: Object.fromEntries(
        [1.25, 1.5, 2].map((multiple) => [String(multiple), frameIntervals.filter((frame) => frame.intervalMs > drawBaselineMs * multiple).length]),
      ),
    },
    workload: summarizeWorkload({ events, mainEvents, selection, metadata, rasterTids, window }),
    cpuProfile: {
      chunkCount: cpuProfile.chunkCount,
      unresolvedSampleCount: cpuProfile.unresolvedSampleCount,
      ...summarizeCpuSamples(cpuProfile.samples, window, cpuProfile.available),
    },
    garbageCollection: gc,
    screenshots: {
      available: screenshotEvents.length > 0,
      count: screenshotEvents.length,
      nearestToSelectedFrame: nearestScreenshot,
      extracted: [],
    },
    pipeline,
    longTasks: {
      available: capabilities.signals.runTask.available,
      thresholdMs: 50,
      count: capabilities.signals.runTask.available ? longTasks.length : null,
      maxMs: nullableMax(longTasks.map((task) => task.durationMs)),
      tasks: longTasks,
    },
    requestedFrame,
    worstFrames: slowest.slice(0, topCount),
    timeline: {
      displayMs: cadence.ms,
      drawBaselineMs,
      baselineMs: timelineBaselineMs,
      source: presentationIntervals.length > 0 ? "AnimationFrame::Presentation" : "DrawFrame fallback",
      stats: timelineStats,
      worstFrame: worstTimelineFrame,
      frames: timelineFrames,
    },
    verdict: buildVerdict({
      slowest,
      timelineWorst: worstTimelineFrame,
      timelineBaselineMs,
      cadence,
      drawStats,
      pipeline,
      longTasks,
      capabilities,
    }),
  };
}

export function compareAnalyses(before, after) {
  const metrics = {
    worstDrawGapMs: [before.cadence.drawFrame.maxMs, after.cadence.drawFrame.maxMs],
    drawGapsAbove45Ms: [before.cadence.drawGapsAboveMs["45"], after.cadence.drawGapsAboveMs["45"]],
    drawGapsAbove1_5xBaseline: [before.cadence.drawGapsAboveBaselineMultiples["1.5"], after.cadence.drawGapsAboveBaselineMultiples["1.5"]],
    drawGapP95Ms: [before.cadence.drawFrame.p95Ms, after.cadence.drawFrame.p95Ms],
    maxRafGapMs: [before.cadence.requestAnimationFrame.maxMs, after.cadence.requestAnimationFrame.maxMs],
    maxTimerToRafDelayMs: [before.cadence.timerToRafDelay.maxMs, after.cadence.timerToRafDelay.maxMs],
    longTaskCount: [before.longTasks.count, after.longTasks.count],
    droppedPipelineRecords: [before.pipeline.droppedCount, after.pipeline.droppedCount],
    maxPaintMs: [before.workload.named.Paint?.maxMs ?? null, after.workload.named.Paint?.maxMs ?? null],
    maxRasterMs: [before.workload.named.RasterTask?.maxMs ?? null, after.workload.named.RasterTask?.maxMs ?? null],
    maxGcMs: [before.garbageCollection.maxMs, after.garbageCollection.maxMs],
  };

  return {
    before: before.input.name,
    after: after.input.name,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([key, [beforeValue, afterValue]]) => [
        key,
        {
          before: beforeValue,
          after: afterValue,
          delta: beforeValue == null || afterValue == null ? null : round(afterValue - beforeValue),
        },
      ]),
    ),
  };
}

export function renderMarkdown(analysis, comparison = null, artifacts = {}) {
  const targetFrame = analysis.requestedFrame ?? analysis.timeline.worstFrame ?? analysis.worstFrames[0];
  const lines = [
    `# FrameSleuth: ${analysis.input.name}`,
    "",
    analysis.question ? `Question: **${analysis.question}**` : "",
    analysis.question ? "" : "",
    `**Answer:** ${answerQuestion(analysis, targetFrame, comparison)}`,
    "",
    `Renderer PID ${analysis.selection.rendererPid}; analyzed ${formatMs(analysis.window.durationMs)} from ${analysis.window.source}.`,
    analysis.selection.urls.length ? `Traced target URL: ${analysis.selection.urls.join(", ")}.` : "Traced target URL: unavailable.",
    `Estimated display cadence: ${formatMs(analysis.cadence.display.ms)} (${analysis.cadence.display.basis}).`,
    "",
    "## Cadence",
    "",
    "| Signal | Count | p50 | p95 | Max |",
    "| --- | ---: | ---: | ---: | ---: |",
    cadenceRow("requestAnimationFrame", analysis.cadence.requestAnimationFrame),
    cadenceRow("Style/layout publication", analysis.cadence.styleAndLayout),
    ...(analysis.timeline.source === "AnimationFrame::Presentation"
      ? [cadenceRow("Presented animation frame", analysis.timeline.stats)]
      : []),
    cadenceRow("DrawFrame", analysis.cadence.drawFrame),
    cadenceRow("Timer", analysis.cadence.timer),
    cadenceRow("Timer → next rAF (handoff-compatible only)", analysis.cadence.timerToRafDelay),
    `| Timer/rAF handoff pattern | ${analysis.cadence.schedulerCoupling.coupled ? "yes" : "no"} | ${formatMs(analysis.cadence.schedulerCoupling.cadenceDeltaMs)} cadence delta | ${formatMetric(analysis.cadence.schedulerCoupling.timerToRafCountRatio)} count ratio | ${analysis.cadence.schedulerCoupling.confidence} |`,
    "",
    `Draw gaps: ${analysis.cadence.drawGapsAboveMs["33.3"]} >33.3 ms; ${analysis.cadence.drawGapsAboveMs["40"]} >40 ms; ${analysis.cadence.drawGapsAboveMs["45"]} >45 ms; ${analysis.cadence.drawGapsAboveMs["50"]} >50 ms.`,
    `Display-relative gaps: ${analysis.cadence.drawGapsAboveDisplayMultiples["1.5"]} >1.5×; ${analysis.cadence.drawGapsAboveDisplayMultiples["2"]} >2×; ${analysis.cadence.drawGapsAboveDisplayMultiples["3"]} >3× the inferred display interval.`,
    `DrawFrame-baseline outliers: ${analysis.cadence.drawGapsAboveBaselineMultiples["1.25"]} >1.25×; ${analysis.cadence.drawGapsAboveBaselineMultiples["1.5"]} >1.5×; ${analysis.cadence.drawGapsAboveBaselineMultiples["2"]} >2× the trace's DrawFrame p50.`,
    `Long main-thread tasks: ${formatAvailabilityCount(analysis.longTasks.available, analysis.longTasks.count)}. Pipeline drops: ${formatAvailabilityCount(analysis.pipeline.available, analysis.pipeline.droppedCount)}${analysis.pipeline.available ? ` (${analysis.pipeline.severeDrawStallAlignedCount} aligned with a severe DrawFrame stall)` : ""}.`,
    `Renderer-main GC: ${analysis.garbageCollection.eventCount} slices, ${formatMs(analysis.garbageCollection.occupancyMs)} occupancy, ${formatMs(analysis.garbageCollection.totalMs)} inclusive nested time, ${formatMs(analysis.garbageCollection.maxMs)} max slice.`,
  ];

  if (artifacts.frameChart) {
    lines.push(
      "",
      "## Frame-time timeline",
      "",
      `![Presented frame time over time](${artifacts.frameChart})`,
      "",
      `The chart plots each ${analysis.timeline.source === "AnimationFrame::Presentation" ? "presented animation-frame interval from Chromium's presentation-feedback timestamp" : "DrawFrame fallback interval"} directly in milliseconds; slower frames rise upward. Re-presenting unchanged compositor content is deliberately not counted as a new animation frame. The dashed line is the trace's p50 cadence and the dotted line is the inferred display interval. Highlighted points exceed 1.5× the p50 frame interval. FPS is reported only as a cadence summary, not as an instantaneous per-event claim. The work table below analyzes the same highlighted interval.`,
    );
  }

  if (targetFrame) {
    const intervalHeading = analysis.requestedFrame
      ? `Frame interval ${targetFrame.index}`
      : targetFrame.intervalKind === "presented animation frame"
        ? "Worst presented animation-frame interval"
        : "Worst compositor DrawFrame interval";
    lines.push("", `## ${intervalHeading}`, "");
    lines.push(
      `Interval ${targetFrame.index} lasted **${formatMs(targetFrame.intervalMs)}** at +${formatMs(targetFrame.startMs)} to +${formatMs(targetFrame.endMs)}.`,
      "",
      "### Work overlapping the interval",
      "",
      "| Execution role | Trace-slice occupancy |",
      "| --- | ---: |",
      ...Object.entries(targetFrame.roleBusyMs).map(([role, value]) => `| ${role} | ${formatMs(value)} |`),
      "",
      "| Execution role | Trace event | Count | Inclusive time | Max event |",
      "| --- | --- | ---: | ---: | ---: |",
      ...targetFrame.namedWork.slice(0, 12).map(
        (event) => `| ${event.role} | ${event.name} | ${event.count} | ${formatMs(event.totalMs)} | ${formatMs(event.maxMs)} |`,
      ),
    );

    if (targetFrame.topMainFunctions.length > 0) {
      lines.push(
        "",
        "### Top main-thread functions",
        "",
        "| Function | Inclusive time | Calls |",
        "| --- | ---: | ---: |",
        ...targetFrame.topMainFunctions.slice(0, 8).map(
          (entry) => `| ${escapeTable(entry.label)} | ${formatMs(entry.totalMs)} | ${entry.count} |`,
        ),
      );
    }

    const actionableCpuSamples = targetFrame.cpuProfile.topSelf.filter(
      (entry) => entry.codeType === "JS" || entry.functionName === "(garbage collector)",
    );
    if (targetFrame.cpuProfile.available && actionableCpuSamples.length > 0) {
      lines.push(
        "",
        "### Sampled main-thread self time",
        "",
        "| Function | Estimated self time | Samples | Hottest source line |",
        "| --- | ---: | ---: | ---: |",
        ...actionableCpuSamples.slice(0, 8).map(
          (entry) => `| ${escapeTable(entry.label)} | ${formatMs(entry.sampledMs)} | ${entry.sampleCount} | ${entry.hotLine?.line ?? "n/a"} |`,
        ),
        "",
        "CPU-profile values are sampling estimates, not exact wall-clock durations. Idle and unsymbolized program samples are excluded from this source-function table.",
      );
    }

    lines.push("", "### Attribution", "");
    for (const diagnosis of targetFrame.diagnoses) {
      lines.push(`- **${diagnosis.label}** (${diagnosis.confidence}): ${diagnosis.evidence}`);
    }
  }

  lines.push("", "## Slowest intervals", "", "| Rank | Interval | Gap | Main busy | Paint max | Raster max |", "| ---: | ---: | ---: | ---: | ---: | ---: |");
  analysis.worstFrames.forEach((frame, index) => {
    lines.push(
      `| ${index + 1} | ${frame.index} | ${formatMs(frame.intervalMs)} | ${formatMs(frame.roleBusyMs["renderer-main"] ?? 0)} | ${formatMs(frame.metrics.paintMaxMs)} | ${formatMs(frame.metrics.rasterMaxMs)} |`,
    );
  });

  if (analysis.pipeline.dropped.length > 0) {
    lines.push("", "## Pipeline drop records", "");
    for (const drop of analysis.pipeline.dropped.slice(0, 12)) {
      lines.push(
        `- +${formatMs(drop.atMs)}: ${drop.state}${drop.frameType ? ` (${drop.frameType})` : ""}; surrounding DrawFrame gap ${formatMs(drop.surroundingDrawGapMs)}; ${drop.classification}.`,
      );
    }
    if (analysis.pipeline.dropped.length > 12) lines.push(`- … ${analysis.pipeline.dropped.length - 12} additional records are available in JSON output.`);
  }

  if (analysis.screenshots.nearestToSelectedFrame) {
    const screenshot = analysis.screenshots.nearestToSelectedFrame;
    lines.push(
      "",
      "## Screenshot evidence",
      "",
      `Nearest captured screenshot: +${formatMs(screenshot.atMs)}, ${formatMs(screenshot.deltaFromFrameEndMs)} from the selected interval end${screenshot.exactFrameSequence ? ", exact frame-sequence match" : ""}.`,
    );
    for (const extracted of analysis.screenshots.extracted) lines.push(`- ${extracted.path}`);
  }

  if (comparison) {
    lines.push("", `## Comparison: ${comparison.before} → ${comparison.after}`, "", "| Metric | Before | After | Delta |", "| --- | ---: | ---: | ---: |");
    for (const [name, metric] of Object.entries(comparison.metrics)) {
      lines.push(`| ${name} | ${formatMetric(metric.before)} | ${formatMetric(metric.after)} | ${formatSigned(metric.delta)} |`);
    }
  }

  if (analysis.capabilities.warnings.length > 0) {
    lines.push("", "## Evidence limits", "", ...analysis.capabilities.warnings.map((warning) => `- ${warning}`));
  }
  lines.push("", "Inclusive event totals may contain nested work. Execution-role occupancy is interval-unioned and does not double-count nesting; it is traced slice occupancy, not CPU utilization.", "");
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

export function renderFrameChartSvg(analysis) {
  const frames = analysis.timeline?.frames ?? [];
  if (frames.length === 0) throw new Error("A frame-time chart requires at least one frame interval.");
  const width = 1200;
  const height = 370;
  const margin = { right: 30, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const framePlot = { top: 66, height: 240 };
  const xMin = Math.min(...frames.map((frame) => frame.startMs));
  const xMax = Math.max(...frames.map((frame) => frame.endMs));
  const baseline = analysis.timeline.baselineMs ?? analysis.timeline.drawBaselineMs;
  const displayMs = analysis.timeline.displayMs;
  const outlierThreshold = baseline * 1.5;
  const rawFrameMax = Math.max(...frames.map((frame) => frame.intervalMs));
  const frameStep = rawFrameMax <= 20 ? 5 : rawFrameMax <= 60 ? 10 : 20;
  const frameMax = Math.max(frameStep, Math.ceil(rawFrameMax / frameStep) * frameStep);
  const x = (value) => margin.left + ((value - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const frameY = (value) => framePlot.top + framePlot.height - (value / frameMax) * framePlot.height;
  const oneDecimal = (value) => Number(value).toFixed(1);
  const secondsPrecision = (xMax - xMin) / 1000 < 1 ? 2 : (xMax - xMin) / 1000 < 10 ? 1 : 0;
  const secondsLabel = (value) => `${Number(value).toFixed(secondsPrecision)}s`;
  const framePoints = frames.map((frame) => `${round(x(frame.endMs))},${round(frameY(frame.intervalMs))}`).join(" ");
  const worst = frames.reduce((current, frame) => frame.intervalMs > current.intervalMs ? frame : current, frames[0]);
  const frameTicks = Array.from({ length: frameMax / frameStep + 1 }, (_, index) => index * frameStep);
  const xTickCount = 6;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, index) => xMin + ((xMax - xMin) * index) / xTickCount);
  const outliers = frames.filter((frame) => frame.intervalMs > outlierThreshold);
  const sourceLabel = analysis.timeline.source === "AnimationFrame::Presentation"
    ? "Presented animation-frame interval (ms)"
    : "DrawFrame interval (ms, presentation fallback)";
  const p50Text = `p50 ${oneDecimal(baseline)} ms (~${oneDecimal(1000 / baseline)} FPS)`;
  const displayText = `display interval ${oneDecimal(displayMs)} ms`;
  const worstText = `worst ${oneDecimal(worst.intervalMs)} ms gap`;
  const worstTextAnchor = x(worst.endMs) > margin.left + plotWidth * 0.8 ? "end" : "start";
  const worstTextX = worstTextAnchor === "end" ? margin.left + plotWidth - 6 : round(x(worst.endMs) + 8);
  const worstPointY = frameY(worst.intervalMs);
  const worstTextY = Math.max(framePlot.top + 18, Math.min(framePlot.top + framePlot.height - 6, worstPointY + 20));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">FrameSleuth presented animation-frame times</title>
  <desc id="description">The blue line shows ${sourceLabel.toLowerCase()}, with slower frames rising upward. The p50 frame interval is ${oneDecimal(baseline)} milliseconds and the worst interval is ${oneDecimal(worst.intervalMs)} milliseconds.</desc>
  <style>
    :root { color-scheme: dark; --bg: #0b1020; --fg: #f1f5f9; --muted: #a6b2c5; --grid: #29364d; --draw: #60a5fa; --main: #fbbf24; --outlier: #fb7185; }
    text { fill: var(--fg); font: 12px ui-sans-serif, system-ui, sans-serif; }
    .muted { fill: var(--muted); }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .frame { fill: var(--bg); stroke: var(--grid); }
    .annotation { font-weight: 500; }
  </style>
  <rect width="${width}" height="${height}" fill="var(--bg)"/>
  <text x="${margin.left}" y="25" font-size="17" font-weight="500">Presented animation-frame times</text>
  <line x1="${margin.left}" y1="42" x2="${margin.left + 24}" y2="42" stroke="var(--draw)" stroke-width="2.5"/><text x="${margin.left + 32}" y="46">${sourceLabel}</text>
  <circle cx="${margin.left + 300}" cy="42" r="4" fill="var(--outlier)"/><text x="${margin.left + 311}" y="46">Frame pacing outlier</text>
  <rect class="frame" x="${margin.left}" y="${framePlot.top}" width="${plotWidth}" height="${framePlot.height}" fill="none"/>
  ${frameTicks.map((tick) => `<line class="grid" x1="${margin.left}" y1="${round(frameY(tick))}" x2="${margin.left + plotWidth}" y2="${round(frameY(tick))}"/><text class="muted" x="${margin.left - 10}" y="${round(frameY(tick) + 4)}" text-anchor="end">${tick}</text>`).join("\n  ")}
  ${xTicks.map((tick) => `<line class="grid" x1="${round(x(tick))}" y1="${framePlot.top}" x2="${round(x(tick))}" y2="${framePlot.top + framePlot.height}"/><text class="muted" x="${round(x(tick))}" y="${framePlot.top + framePlot.height + 22}" text-anchor="middle">${secondsLabel((tick - xMin) / 1000)}</text>`).join("\n  ")}
  <line x1="${margin.left}" y1="${round(frameY(baseline))}" x2="${margin.left + plotWidth}" y2="${round(frameY(baseline))}" stroke="var(--muted)" stroke-dasharray="7 5"/>
  <line x1="${margin.left}" y1="${round(frameY(displayMs))}" x2="${margin.left + plotWidth}" y2="${round(frameY(displayMs))}" stroke="var(--grid)" stroke-dasharray="2 4"/>
  <polyline fill="none" stroke="var(--draw)" stroke-width="2.3" stroke-linejoin="round" points="${framePoints}"/>
  ${outliers.map((frame) => `<circle cx="${round(x(frame.endMs))}" cy="${round(frameY(frame.intervalMs))}" r="4" fill="var(--outlier)"><title>+${round(frame.endMs)} ms: ${round(frame.intervalMs)} ms presented-frame interval</title></circle>`).join("\n  ")}
  <rect x="${margin.left + plotWidth - 252}" y="${round(frameY(baseline) - 21)}" width="246" height="18" fill="var(--bg)" fill-opacity="0.92"/><text class="muted annotation" x="${margin.left + plotWidth - 8}" y="${round(frameY(baseline) - 7)}" text-anchor="end">${p50Text}</text>
  <rect x="${margin.left + 6}" y="${round(frameY(displayMs) - 18)}" width="156" height="18" fill="var(--bg)" fill-opacity="0.92"/><text class="muted annotation" x="${margin.left + 10}" y="${round(frameY(displayMs) - 4)}">${displayText}</text>
  <line x1="${round(x(worst.endMs))}" y1="${framePlot.top}" x2="${round(x(worst.endMs))}" y2="${framePlot.top + framePlot.height}" stroke="var(--outlier)" stroke-dasharray="3 4"/>
  <rect x="${worstTextAnchor === "end" ? worstTextX - 266 : worstTextX - 4}" y="${round(worstTextY - 15)}" width="270" height="20" fill="var(--bg)" fill-opacity="0.92"/><text class="annotation" x="${worstTextX}" y="${round(worstTextY)}" text-anchor="${worstTextAnchor}">${worstText}</text>
  <text class="axis-title" data-axis="y" x="18" y="${framePlot.top + framePlot.height / 2}" text-anchor="middle" transform="rotate(-90 18 ${framePlot.top + framePlot.height / 2})">Presented animation-frame interval (ms)</text>
  <text class="axis-title" data-axis="x" x="${margin.left + plotWidth / 2}" y="${height - 10}" text-anchor="middle">Time after analysis-window start (seconds)</text>
</svg>
`;
}

function collectMetadata(events) {
  const processNames = new Map();
  const threadNames = new Map();
  const urlsByPid = new Map();

  function addUrl(pidValue, url) {
    const pid = Number(pidValue);
    if (!Number.isFinite(pid) || typeof url !== "string" || url.length === 0) return;
    const urls = urlsByPid.get(pid) ?? new Set();
    urls.add(url);
    urlsByPid.set(pid, urls);
  }

  for (const event of events) {
    if (event.ph === "M" && event.name === "process_name") processNames.set(event.pid, event.args?.name ?? "");
    if (event.ph === "M" && event.name === "thread_name") threadNames.set(threadKey(event.pid, event.tid), event.args?.name ?? "");
    const frames = event.name === "TracingStartedInBrowser" ? event.args?.data?.frames : null;
    if (Array.isArray(frames)) {
      for (const frame of frames) {
        addUrl(frame.processId, frame.url);
      }
    }
    if (event.name === "FrameCommittedInBrowser") {
      addUrl(event.args?.data?.processId ?? event.pid, event.args?.data?.url);
    }
    if (event.name === "CommitLoad" && event.args?.data?.isMainFrame !== false) {
      addUrl(event.pid, event.args?.data?.url);
    }
    if (event.name === "FrameLoader:state_snapshot" && event.args?.snapshot?.isOutermostMainFrame !== false) {
      addUrl(event.pid, event.args?.snapshot?.documentLoaderURL);
    }
  }

  return { processNames, threadNames, urlsByPid };
}

function selectRenderer(events, metadata, urlFilter) {
  const mains = [];
  for (const [key, name] of metadata.threadNames) {
    if (name !== "CrRendererMain") continue;
    const [pidText, tidText] = key.split(":");
    const pid = Number(pidText);
    const tid = Number(tidText);
    const capturedUrls = [...(metadata.urlsByPid.get(pid) ?? [])];
    const urls = capturedUrls.some((url) => url !== "about:blank")
      ? capturedUrls.filter((url) => url !== "about:blank")
      : capturedUrls;
    const mainEvents = events.filter((event) => event.pid === pid && event.tid === tid);
    const compositorTids = [...metadata.threadNames]
      .filter(([thread, threadName]) => thread.startsWith(`${pid}:`) && threadName === "Compositor")
      .map(([thread]) => Number(thread.split(":")[1]));
    const rafCount = countNamed(mainEvents, "FireAnimationFrame");
    const updateCount = countNamed(mainEvents, "UpdateLayoutTree");
    const drawCount = events.filter(
      (event) => event.pid === pid && compositorTids.includes(event.tid) && event.name === "DrawFrame",
    ).length;
    const urlMatch = Boolean(urlFilter && urls.some((url) => url.includes(urlFilter)));
    const score = rafCount * 10 + updateCount * 4 + drawCount * 2 + (urlMatch ? 1_000_000 : 0);
    mains.push({ pid, tid, compositorTids, urls, rafCount, updateCount, drawCount, urlMatch, score });
  }

  mains.sort((a, b) => b.score - a.score);
  const selected = mains[0];
  if (!selected || selected.score === 0) throw new Error("FrameSleuth could not find an active CrRendererMain thread.");
  if (urlFilter && !selected.urlMatch) throw new Error(`No active renderer URL contains ${JSON.stringify(urlFilter)}.`);

  const compositorTid = selected.compositorTids
    .map((tid) => ({ tid, draws: events.filter((event) => event.pid === selected.pid && event.tid === tid && event.name === "DrawFrame").length }))
    .sort((a, b) => b.draws - a.draws)[0]?.tid;
  if (compositorTid == null) throw new Error(`Renderer PID ${selected.pid} has no Compositor thread.`);

  return {
    pid: selected.pid,
    mainTid: selected.tid,
    compositorTid,
    urls: selected.urls,
    candidates: mains.map(({ pid, tid, urls, rafCount, updateCount, drawCount, urlMatch, score }) => ({
      pid,
      tid,
      urls,
      rafCount,
      updateCount,
      drawCount,
      urlMatch,
      score,
    })),
  };
}

function inferActiveWindow(events, selection) {
  const selectedEvents = events.filter((event) => event.pid === selection.pid);
  const startMarks = selectedEvents.filter((event) => /steady.*(?:animation|playback).*start|(?:animation|playback).*steady.*start/iu.test(event.name));
  const endMarks = selectedEvents.filter((event) => /steady.*(?:animation|playback).*end|(?:animation|playback).*steady.*end/iu.test(event.name));
  if (startMarks.length > 0 && endMarks.length > 0) {
    const startTs = Math.min(...startMarks.map((event) => event.ts));
    const endTs = Math.max(...endMarks.map((event) => event.ts));
    if (endTs > startTs) return { startTs, endTs, source: "steady-playback user timing marks" };
  }

  const active = selectedEvents.filter(
    (event) =>
      (event.tid === selection.mainTid && (event.name === "FireAnimationFrame" || event.name === "UpdateLayoutTree")) ||
      (event.tid === selection.compositorTid && event.name === "DrawFrame"),
  );
  if (active.length < 2) throw new Error("Selected renderer has too few animation events to infer an active window.");
  return {
    startTs: Math.min(...active.map((event) => event.ts)),
    endTs: Math.max(...active.map(eventEnd)),
    source: "active renderer animation events",
  };
}

function trimWindow(window, startMs, endMs) {
  const requestedStart = window.startTs + (startMs ?? 0) * 1000;
  const requestedEnd = endMs == null ? window.endTs : window.startTs + endMs * 1000;
  if (requestedEnd <= requestedStart) throw new Error("The requested analysis window is empty.");
  return { startTs: requestedStart, endTs: Math.min(requestedEnd, window.endTs) };
}

function estimateDisplayCadence(compositorEvents, rafEvents, pipelineRecords) {
  const candidates = [];
  const beginFrames = uniqueTimestampEvents(sortedEvents(compositorEvents, "BeginFrame"));
  const presented = pipelineRecords.filter((record) => record.state === "STATE_PRESENTED_ALL");
  addCadenceCandidate(candidates, "Compositor BeginFrame", beginFrames.map((event) => event.ts));
  addCadenceCandidate(candidates, "presented PipelineReporter", presented.map((record) => record.ts));
  addCadenceCandidate(candidates, "requestAnimationFrame", rafEvents.map((event) => event.ts));
  const plausible = candidates.filter((candidate) => candidate.count >= 5 && candidate.p50Ms >= 4 && candidate.p50Ms <= 40);
  // Prefer the compositor clock. Matching only common 60/120 Hz periods gives
  // wrong answers on 75/90/144 Hz and variable-refresh displays.
  const best = plausible[0] ?? candidates[0];
  return best
    ? { ms: round(best.p50Ms), basis: best.basis, sampleCount: best.count, inferred: true }
    : { ms: 16.667, basis: "60 Hz fallback", sampleCount: 0, inferred: false };
}

function addCadenceCandidate(candidates, basis, timestamps) {
  const stats = summarizeTimestamps(timestamps);
  if (stats.count > 0 && stats.p50Ms != null) candidates.push({ basis, count: stats.count, p50Ms: stats.p50Ms });
}

function collectPipelineRecords(events, layerTreeId) {
  const records = [];
  const seen = new Set();
  for (const event of events) {
    const reporter = event.name === "PipelineReporter" ? event.args?.frame_reporter : null;
    if (!reporter?.state) continue;
    if (layerTreeId != null && reporter.layer_tree_host_id != null && reporter.layer_tree_host_id !== layerTreeId) continue;
    const identity = reporter.frame_sequence == null
      ? `${event.ts}`
      : `${reporter.frame_source ?? "?"}:${reporter.frame_sequence}`;
    const key = `${identity}:${reporter.state}:${reporter.frame_type ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      ts: event.ts,
      state: reporter.state,
      affectsSmoothness: reporter.affects_smoothness === true,
      frameType: reporter.frame_type ?? null,
      frameSequence: reporter.frame_sequence ?? null,
      frameSource: reporter.frame_source ?? null,
      layerTreeHostId: reporter.layer_tree_host_id ?? null,
    });
  }
  return records.sort((a, b) => a.ts - b.ts);
}

function summarizePipeline(records, drawEvents, displayMs, drawBaselineMs, startTs) {
  const states = {};
  for (const record of records) states[record.state] = (states[record.state] ?? 0) + 1;
  const drops = records.filter((record) => record.state.includes("DROPPED") || record.affectsSmoothness);
  const severeThresholdMs = Math.max(displayMs * 2.4, (drawBaselineMs ?? displayMs) * 1.5);
  const dropped = drops.map((record) => {
    const surroundingDrawGapMs = surroundingGap(drawEvents, record.ts);
    const severe = surroundingDrawGapMs != null && surroundingDrawGapMs > severeThresholdMs;
    return {
      atMs: offsetMs(record.ts, startTs),
      state: record.state,
      frameType: record.frameType,
      affectsSmoothness: record.affectsSmoothness,
      surroundingDrawGapMs,
      classification: severe ? "aligned with a severe DrawFrame stall" : "not aligned with a severe DrawFrame stall",
      severeDrawStallAligned: severe,
    };
  });
  return {
    recordCount: records.length,
    states,
    droppedCount: dropped.length,
    affectsSmoothnessCount: records.filter((record) => record.affectsSmoothness).length,
    severeDrawStallAlignedCount: dropped.filter((record) => record.severeDrawStallAligned).length,
    severeDrawStallThresholdMs: round(severeThresholdMs),
    dropped,
  };
}

function pairTimersWithRaf(timers, rafEvents, displayMs) {
  return timers.flatMap((timer) => {
    const raf = rafEvents.find((event) => event.ts >= timer.ts);
    if (!raf || (raf.ts - timer.ts) / 1000 > Math.max(50, displayMs * 3)) return [];
    return [{
      timerTs: timer.ts,
      rafTs: raf.ts,
      delayMs: round((raf.ts - timer.ts) / 1000),
      correlation: "temporal-next-callback",
    }];
  });
}

function summarizeSchedulerCoupling(timerStats, rafStats, displayMs) {
  if (timerStats.eventCount < 5 || rafStats.eventCount < 5 || timerStats.p50Ms == null || rafStats.p50Ms == null) {
    return { coupled: false, confidence: "insufficient-samples", timerToRafCountRatio: null, cadenceDeltaMs: null };
  }
  const countRatio = timerStats.eventCount / rafStats.eventCount;
  const cadenceDeltaMs = Math.abs(timerStats.p50Ms - rafStats.p50Ms);
  const coupled = countRatio >= 0.75 && countRatio <= 1.25 && cadenceDeltaMs <= displayMs;
  return {
    coupled,
    confidence: coupled ? "medium" : "high",
    timerToRafCountRatio: round(countRatio),
    cadenceDeltaMs: round(cadenceDeltaMs),
    evidence: coupled
      ? "timer and rAF event counts/cadences are compatible with a handoff pattern"
      : "timer and rAF counts/cadences do not support a one-to-one handoff pattern",
  };
}

function buildFrameIntervals(drawEvents) {
  const intervals = [];
  for (let index = 1; index < drawEvents.length; index += 1) {
    const previous = drawEvents[index - 1];
    const current = drawEvents[index];
    intervals.push({
      index,
      startTs: previous.ts,
      endTs: current.ts,
      intervalMs: round((current.ts - previous.ts) / 1000),
      previousFrameSeqId: previous.args?.frameSeqId ?? null,
      frameSeqId: current.args?.frameSeqId ?? null,
    });
  }
  return intervals;
}

function buildTimelineFrames(intervals, indexedEvents, selection, traceStartTs) {
  return intervals.map((frame) => {
    const mainThreadIntervals = (indexedEvents.get(frame.index) ?? [])
      .filter((event) => event.pid === selection.pid && event.tid === selection.mainTid)
      .map((event) => clipInterval(event, frame.startTs, frame.endTs));
    return {
      index: frame.index,
      startMs: offsetMs(frame.startTs, traceStartTs),
      endMs: offsetMs(frame.endTs, traceStartTs),
      intervalMs: frame.intervalMs,
      mainBusyMs: round(unionDuration(mainThreadIntervals) / 1000),
    };
  });
}

function indexCompleteEventsByFrame(events, frames) {
  const indexed = new Map(frames.map((frame) => [frame.index, []]));
  if (frames.length === 0) return indexed;
  for (const event of events) {
    if (!isComplete(event)) continue;
    let index = firstFrameEndingAfter(frames, event.ts);
    const endTs = eventEnd(event);
    while (index < frames.length && frames[index].startTs < endTs) {
      indexed.get(frames[index].index).push(event);
      index += 1;
    }
  }
  return indexed;
}

function firstFrameEndingAfter(frames, timestamp) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].endTs <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

function selectRequestedFrame(frameDetails, slowest, window, options) {
  const selectors = [options.frame != null, options.rank != null, options.aroundMs != null].filter(Boolean).length;
  if (selectors > 1) throw new Error("Use only one of --frame, --rank, or --around-ms.");
  if (options.frame != null) {
    const selected = frameDetails.find((frame) => frame.index === options.frame);
    if (!selected) throw new Error(`DrawFrame interval ${options.frame} does not exist; valid range is 1-${frameDetails.at(-1)?.index ?? 0}.`);
    return selected;
  }
  if (options.rank != null) {
    const selected = slowest[options.rank - 1];
    if (!selected) throw new Error(`Slow-frame rank ${options.rank} does not exist; only ${slowest.length} intervals were captured.`);
    return selected;
  }
  if (options.aroundMs != null) {
    const timestamp = window.startTs + options.aroundMs * 1000;
    const selected = frameDetails.find((frame, index) =>
      frame.startTs <= timestamp && (timestamp < frame.endTs || (index === frameDetails.length - 1 && timestamp === frame.endTs)),
    );
    if (!selected) throw new Error(`No DrawFrame interval contains +${options.aroundMs} ms.`);
    return selected;
  }
  return null;
}

function summarizeCapabilities({ loadedEvents, mainEvents, compositorEvents, rendererEvents, drawEvents, pipelineRecords, selection, cpuProfile }) {
  const screenshotCount = loadedEvents.filter((event) => event.name === "Screenshot" && screenshotPayload(event)).length;
  const capabilities = {
    drawFrame: capability(drawEvents.length, "compositor frame-spacing analysis", 2),
    beginFrame: capability(countNamed(compositorEvents, "BeginFrame"), "display-cadence estimation"),
    requestAnimationFrame: capability(countNamed(mainEvents, "FireAnimationFrame"), "callback-cadence analysis"),
    runTask: capability(mainEvents.filter((event) => isComplete(event) && isTask(event)).length, "main-thread long-task exclusion"),
    pipelineReporter: capability(pipelineRecords.length, "dropped-frame marker analysis"),
    paint: capability(countNamed(rendererEvents, "Paint"), "paint-cost analysis"),
    raster: capability(countNamed(rendererEvents, "RasterTask"), "raster-cost analysis"),
    functionCall: capability(countNamed(mainEvents, "FunctionCall"), "JavaScript function attribution"),
    cpuProfile: capability(cpuProfile.samples.length, "sampled JavaScript self-time attribution"),
    screenshots: capability(screenshotCount, "visual evidence extraction"),
  };
  const warnings = [];
  if (!capabilities.drawFrame.available) warnings.push("At least two DrawFrame events are required for frame-spacing analysis.");
  if (!capabilities.runTask.available) warnings.push("RunTask slices were not captured; absence of long tasks cannot be established.");
  if (!capabilities.pipelineReporter.available) warnings.push("PipelineReporter was not captured; dropped-frame marker conclusions are unavailable.");
  if (!capabilities.paint.available) warnings.push("Paint events were not captured; paint cost is unknown, not zero.");
  if (!capabilities.raster.available) warnings.push("RasterTask events were not captured; raster cost is unknown, not zero.");
  if (!capabilities.cpuProfile.available) warnings.push("V8 CPU profile samples were not captured; JavaScript inside task and microtask envelopes may be opaque.");
  if (!capabilities.beginFrame.available) warnings.push("BeginFrame was not captured; display cadence uses a weaker fallback signal.");
  if (!capabilities.screenshots.available) warnings.push("Screenshot events were not captured; FrameSleuth cannot provide visual evidence for this trace.");
  const activeCandidates = selection.candidates.filter((candidate) => candidate.score > 0);
  if (selection.urls.length === 0) warnings.push("The selected renderer has no traced URL metadata; PID selection is activity-based only.");
  if (activeCandidates.length > 1 && !activeCandidates[0].urlMatch) {
    warnings.push(`${activeCandidates.length} active renderer candidates were found; use --url when the automatically selected page is not the target.`);
  }
  warnings.push("GPU and browser-process slices are global to the trace and cannot be attributed exclusively to the selected page.");
  return { signals: capabilities, warnings };
}

function collectCpuProfile(events, selection) {
  const profiles = events.filter((event) =>
    event.name === "Profile" && event.ph === "P" && event.pid === selection.pid &&
    event.tid === selection.mainTid && Number.isFinite(event.args?.data?.startTime),
  );
  if (profiles.length === 0) {
    return { available: false, chunkCount: 0, unresolvedSampleCount: 0, samples: [] };
  }
  const profile = profiles[0];
  const chunks = events
    .filter((event) => event.name === "ProfileChunk" && event.ph === "P" && event.pid === selection.pid &&
      (profile.id == null || event.id == null || event.id === profile.id))
    .sort((a, b) => a.ts - b.ts);
  const nodes = new Map();
  const rawSamples = [];
  let timestamp = profile.args.data.startTime;
  for (const chunk of chunks) {
    const data = chunk.args?.data ?? {};
    for (const node of data.cpuProfile?.nodes ?? []) nodes.set(node.id, node);
    const samples = data.cpuProfile?.samples ?? [];
    const deltas = data.timeDeltas ?? [];
    for (let index = 0; index < samples.length; index += 1) {
      const deltaUs = Number.isFinite(deltas[index]) ? deltas[index] : 0;
      timestamp += deltaUs;
      rawSamples.push({
        ts: timestamp,
        deltaUs,
        nodeId: samples[index],
        line: Number.isFinite(data.lines?.[index]) && data.lines[index] > 0 ? data.lines[index] : null,
        column: Number.isFinite(data.columns?.[index]) && data.columns[index] > 0 ? data.columns[index] : null,
      });
    }
  }
  let unresolvedSampleCount = 0;
  const samples = [];
  for (const sample of rawSamples) {
    const node = nodes.get(sample.nodeId);
    if (!node?.callFrame) {
      unresolvedSampleCount += 1;
      continue;
    }
    const frame = node.callFrame;
    const functionName = frame.functionName || "(anonymous)";
    const file = frame.url ? basenameFromUrl(frame.url) : frame.codeType || "unknown";
    const line = sample.line ?? (Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null);
    samples.push({
      ts: sample.ts,
      sampledMs: round(Math.max(0, sample.deltaUs) / 1000),
      functionName,
      file,
      line,
      column: sample.column,
      codeType: frame.codeType || null,
      label: `${functionName} — ${file}`,
      location: line == null ? file : `${file}:${line}`,
    });
  }
  return {
    available: samples.length > 0,
    chunkCount: chunks.length,
    unresolvedSampleCount,
    samples,
  };
}

function summarizeCpuSamples(samples, range, available = samples.length > 0) {
  const selected = samples.filter((sample) => sample.ts >= range.startTs && sample.ts < range.endTs);
  const groups = new Map();
  for (const sample of selected) {
    const group = groups.get(sample.label) ?? {
      label: sample.label,
      functionName: sample.functionName,
      file: sample.file,
      codeType: sample.codeType,
      sampleCount: 0,
      sampledMs: 0,
      lines: new Map(),
    };
    group.sampleCount += 1;
    group.sampledMs += sample.sampledMs;
    if (sample.line != null) {
      const line = group.lines.get(sample.line) ?? { line: sample.line, sampleCount: 0, sampledMs: 0 };
      line.sampleCount += 1;
      line.sampledMs += sample.sampledMs;
      group.lines.set(sample.line, line);
    }
    groups.set(sample.label, group);
  }
  const topSelf = [...groups.values()]
    .map((group) => {
      const hotLine = [...group.lines.values()].sort((a, b) => b.sampledMs - a.sampledMs || b.sampleCount - a.sampleCount)[0] ?? null;
      return {
        label: group.label,
        functionName: group.functionName,
        file: group.file,
        codeType: group.codeType,
        sampleCount: group.sampleCount,
        sampledMs: round(group.sampledMs),
        hotLine: hotLine ? { ...hotLine, sampledMs: round(hotLine.sampledMs) } : null,
      };
    })
    .sort((a, b) => b.sampledMs - a.sampledMs || b.sampleCount - a.sampleCount)
    .slice(0, 20);
  return {
    available,
    sampleCount: selected.length,
    sampledMs: round(selected.reduce((sum, sample) => sum + sample.sampledMs, 0)),
    topSelf,
  };
}

function capability(eventCount, supports, minimum = 1) {
  return { available: eventCount >= minimum, eventCount, minimum, supports };
}

function summarizeGarbageCollection(mainEvents, window) {
  const events = mainEvents.filter((event) => isComplete(event) && isGcEvent(event.name));
  const durations = events.map((event) => clippedDuration(event, window.startTs, window.endTs) / 1000);
  return {
    available: events.length > 0,
    eventCount: events.length,
    totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
    occupancyMs: round(unionDuration(events.map((event) => clipInterval(event, window.startTs, window.endTs))) / 1000),
    maxMs: nullableMax(durations),
    events: events
      .map((event) => ({ name: event.name, atMs: offsetMs(event.ts, window.startTs), durationMs: round(event.dur / 1000) }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 20),
  };
}

function summarizeLongTasks(mainEvents, window, thresholdMs) {
  const intervals = mainEvents
    .filter((event) => isComplete(event) && isTask(event) && event.dur / 1000 >= thresholdMs)
    .map((event) => clipInterval(event, window.startTs, window.endTs))
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] < previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged.map(([start, end]) => ({
    atMs: offsetMs(start, window.startTs),
    durationMs: round((end - start) / 1000),
  }));
}

function collectScreenshotEvents(events) {
  return events
    .filter((event) => event.name === "Screenshot" && screenshotPayload(event))
    .sort((a, b) => screenshotTimestamp(a) - screenshotTimestamp(b));
}

function nearestScreenshotMetadata(screenshots, frame, traceStartTs) {
  const screenshot = nearestScreenshot(screenshots, frame);
  if (!screenshot) return null;
  return {
    atMs: offsetMs(screenshotTimestamp(screenshot), traceStartTs),
    deltaFromFrameEndMs: round(Math.abs(screenshotTimestamp(screenshot) - frame.endTs) / 1000),
    frameSequence: screenshot.args?.frame_sequence ?? null,
    exactFrameSequence: screenshot.args?.frame_sequence != null && screenshot.args.frame_sequence === frame.frameSeqId,
    mimeType: screenshotMimeType(screenshotPayload(screenshot)),
  };
}

function nearestScreenshot(screenshots, frame) {
  const exact = screenshots.find(
    (event) => frame.frameSeqId != null && event.args?.frame_sequence != null && event.args.frame_sequence === frame.frameSeqId,
  );
  if (exact) return exact;
  const legacy = screenshots.filter((event) => event.args?.frame_sequence == null);
  if (frame.frameSeqId != null && legacy.length === 0) return null;
  const candidates = legacy.length > 0 ? legacy : screenshots;
  return candidates.reduce((best, event) => {
    if (!best) return event;
    return Math.abs(screenshotTimestamp(event) - frame.endTs) < Math.abs(screenshotTimestamp(best) - frame.endTs) ? event : best;
  }, null);
}

function screenshotTimestamp(event) {
  return Number.isFinite(event.args?.expected_display_time) ? event.args.expected_display_time : event.ts;
}

function screenshotMimeType(snapshot) {
  const bytes = Buffer.from(normalizeBase64(snapshot).slice(0, 32), "base64");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return "application/octet-stream";
}

function screenshotPayload(event) {
  const snapshot = event.args?.snapshot ?? event.args?.data?.snapshot;
  return typeof snapshot === "string" && snapshot.length > 0 ? snapshot : null;
}

function normalizeBase64(snapshot) {
  const comma = snapshot.indexOf(",");
  return snapshot.startsWith("data:") && comma >= 0 ? snapshot.slice(comma + 1) : snapshot;
}

export async function extractFrameScreenshots(loaded, analysis, directory) {
  const screenshots = collectScreenshotEvents(loaded.events).filter((event) => {
    const timestamp = screenshotTimestamp(event);
    return timestamp >= analysis.window.startTs && timestamp <= analysis.window.endTs;
  });
  if (screenshots.length === 0) throw new Error("This trace contains no Screenshot events to extract.");
  const absoluteDirectory = resolve(directory);
  await mkdir(absoluteDirectory, { recursive: true });
  const frames = analysis.requestedFrame
    ? [analysis.requestedFrame]
    : [analysis.timeline.worstFrame ?? analysis.worstFrames[0]].filter(Boolean);
  const extracted = [];
  const used = new Set();
  for (const [rank, frame] of frames.entries()) {
    const screenshot = nearestScreenshot(screenshots, frame);
    if (!screenshot) continue;
    const key = `${screenshot.ts}:${screenshot.args?.frame_sequence ?? "?"}`;
    if (used.has(key)) continue;
    used.add(key);
    const payload = screenshotPayload(screenshot);
    const mimeType = screenshotMimeType(payload);
    if (mimeType === "application/octet-stream") throw new Error(`Screenshot nearest interval ${frame.index} has an unsupported image encoding.`);
    const extension = mimeType === "image/png" ? "png" : "jpg";
    const path = resolve(absoluteDirectory, `rank-${String(rank + 1).padStart(2, "0")}-interval-${frame.index}.${extension}`);
    await writeFile(path, Buffer.from(normalizeBase64(payload), "base64"));
    extracted.push({ rank: rank + 1, frameIndex: frame.index, path, mimeType });
  }
  if (extracted.length === 0) throw new Error("Screenshot events were captured, but none matched the selected frame sequence.");
  return extracted;
}

function analyzeFrame(context) {
  const { frame, frameEvents, metadata, selection, rasterTids, cadence, rafEvents, updateEvents, timerToRaf, pipelineRecords, traceStartTs, capabilities, schedulerCoupling, drawBaselineMs, cpuProfile, intervalKind = "DrawFrame" } = context;
  const attributed = frameEvents.filter((event) => {
    if (!isFocusEvent(event.name)) return false;
    const role = roleFor(event, selection, metadata, rasterTids);
    return role.startsWith("renderer-") || (role === "gpu-global" && event.name === "GPUTask");
  });
  const namedWork = aggregateRoleNamedWork(attributed, frame, (event) => roleFor(event, selection, metadata, rasterTids));
  const roleIntervals = new Map();
  for (const event of frameEvents) {
    const role = roleFor(event, selection, metadata, rasterTids);
    if (role === "other-global") continue;
    const clipped = clipInterval(event, frame.startTs, frame.endTs);
    const intervals = roleIntervals.get(role) ?? [];
    intervals.push(clipped);
    roleIntervals.set(role, intervals);
  }
  const roleBusyMs = Object.fromEntries(
    [...roleIntervals]
      .map(([role, intervals]) => [role, round(unionDuration(intervals) / 1000)])
      .filter(([, duration]) => duration > 0)
      .sort((a, b) => b[1] - a[1]),
  );
  const functions = aggregateFunctions(
    frameEvents.filter((event) => event.pid === selection.pid && event.tid === selection.mainTid && event.name === "FunctionCall"),
    frame,
  );
  const rafInRange = rafEvents.filter((event) => event.ts >= frame.startTs - cadence.ms * 1000 && event.ts <= frame.endTs);
  const updateInRange = updateEvents.filter((event) => event.ts >= frame.startTs - cadence.ms * 1000 && event.ts <= frame.endTs);
  const timerPairs = timerToRaf.filter((pair) => pair.rafTs >= frame.startTs && pair.rafTs <= frame.endTs);
  const framePipeline = pipelineRecords.filter((record) => record.ts >= frame.startTs && record.ts <= frame.endTs);
  const frameGcEvents = frameEvents.filter(
    (event) => event.pid === selection.pid && event.tid === selection.mainTid && isGcEvent(event.name),
  );
  const mainGcWork = namedWork.filter((entry) => entry.role === "renderer-main" && isGcEvent(entry.name));
  const frameCpuProfile = summarizeCpuSamples(cpuProfile.samples, frame, cpuProfile.available);
  const metrics = {
    mainBusyMs: roleBusyMs["renderer-main"] ?? 0,
    maxRunTaskMs: namedWork.find((entry) => entry.name === "RunTask" && entry.role === "renderer-main")?.maxMs ?? 0,
    paintTotalMs: namedWork.find((entry) => entry.name === "Paint")?.totalMs ?? 0,
    paintMaxMs: namedWork.find((entry) => entry.name === "Paint")?.maxMs ?? 0,
    rasterTotalMs: namedWork.find((entry) => entry.name === "RasterTask")?.totalMs ?? 0,
    rasterMaxMs: namedWork.find((entry) => entry.name === "RasterTask")?.maxMs ?? 0,
    gcTotalMs: mainGcWork.reduce((sum, entry) => sum + entry.totalMs, 0),
    gcOccupancyMs: round(unionDuration(frameGcEvents.map((event) => clipInterval(event, frame.startTs, frame.endTs))) / 1000),
    gcMaxMs: nullableMax(mainGcWork.map((entry) => entry.maxMs)) ?? 0,
    maxRafGapMs: summarizeTimestamps(rafInRange.map((event) => event.ts)).maxMs,
    maxUpdateGapMs: summarizeTimestamps(updateInRange.map((event) => event.ts)).maxMs,
    maxTimerToRafDelayMs: schedulerCoupling.coupled ? nullableMax(timerPairs.map((pair) => pair.delayMs)) : null,
  };
  return {
    index: frame.index,
    intervalMs: frame.intervalMs,
    startTs: frame.startTs,
    endTs: frame.endTs,
    startMs: offsetMs(frame.startTs, traceStartTs),
    endMs: offsetMs(frame.endTs, traceStartTs),
    frameSeqId: frame.frameSeqId,
    previousFrameSeqId: frame.previousFrameSeqId,
    intervalKind,
    roleBusyMs,
    namedWork,
    topMainFunctions: functions.slice(0, 12),
    cpuProfile: frameCpuProfile,
    scheduling: {
      rafCallbacks: rafInRange.length,
      styleAndLayoutUpdates: updateInRange.length,
      timerToRafPairs: timerPairs,
      pipelineStates: framePipeline.map((record) => ({ state: record.state, affectsSmoothness: record.affectsSmoothness, frameType: record.frameType })),
    },
    metrics,
    diagnoses: diagnoseFrame({ frame, metrics, cadence, timerPairs, framePipeline, capabilities, schedulerCoupling, drawBaselineMs, cpuProfile: frameCpuProfile, intervalKind }),
  };
}

function diagnoseFrame({ frame, metrics, cadence, timerPairs, framePipeline, capabilities, schedulerCoupling, drawBaselineMs, cpuProfile, intervalKind }) {
  const diagnoses = [];
  const budget = cadence.ms;
  const topCpuSamples = cpuProfile.topSelf.filter((entry) => entry.codeType === "JS").slice(0, 3);
  const sampledApplicationMs = round(topCpuSamples.reduce((sum, entry) => sum + entry.sampledMs, 0));
  if (metrics.maxRunTaskMs > Math.max(12, budget * 0.8) || metrics.mainBusyMs > frame.intervalMs * 0.7) {
    diagnoses.push({
      id: "main-thread-blocking",
      label: "main-thread blocking",
      confidence: "high",
      evidence: `renderer-main was busy ${formatMs(metrics.mainBusyMs)}; its longest RunTask was ${formatMs(metrics.maxRunTaskMs)}.${topCpuSamples.length ? ` CPU samples attribute ${formatMs(sampledApplicationMs)} of estimated self time to ${topCpuSamples.map((entry) => `${entry.functionName} (${formatMs(entry.sampledMs)})`).join(", ")}${topCpuSamples[0].hotLine ? `; the hottest source line is ${topCpuSamples[0].file}:${topCpuSamples[0].hotLine.line}` : ""}.` : ""}`,
    });
  }
  if (schedulerCoupling.coupled && (metrics.maxTimerToRafDelayMs ?? 0) > budget * 0.75 && (metrics.maxRafGapMs ?? 0) > budget * 1.6 && metrics.mainBusyMs < budget * 0.6) {
    diagnoses.push({
      id: "timer-to-raf-handoff",
      label: "timer-to-rAF phase delay",
      confidence: "medium",
      evidence: `timer → next-rAF correlation reached ${formatMs(metrics.maxTimerToRafDelayMs)} while rAF spacing reached ${formatMs(metrics.maxRafGapMs)}; timer/rAF counts and cadence support a handoff pattern, and captured main-thread work remained cheap.`,
    });
  }
  if (!schedulerCoupling.coupled && (metrics.maxRafGapMs ?? 0) > budget * 1.25 && metrics.mainBusyMs < budget * 0.7) {
    diagnoses.push({
      id: "raf-delivery-jitter",
      label: "rAF delivery jitter",
      confidence: "medium",
      evidence: `rAF spacing reached ${formatMs(metrics.maxRafGapMs)} against a ${formatMs(budget)} display cadence without a long captured main-thread task.`,
    });
  }
  if (metrics.paintTotalMs > budget * 0.35 || metrics.paintMaxMs > budget * 0.25) {
    diagnoses.push({
      id: "paint-heavy",
      label: "paint pressure",
      confidence: "high",
      evidence: `Paint consumed ${formatMs(metrics.paintTotalMs)} inclusive, with a ${formatMs(metrics.paintMaxMs)} maximum event.`,
    });
  }
  if (metrics.rasterTotalMs > budget * 0.6 || metrics.rasterMaxMs > budget * 0.3) {
    diagnoses.push({
      id: "raster-heavy",
      label: "raster pressure",
      confidence: "high",
      evidence: `RasterTask consumed ${formatMs(metrics.rasterTotalMs)} inclusive, with a ${formatMs(metrics.rasterMaxMs)} maximum event.`,
    });
  }
  if (metrics.gcOccupancyMs > budget * 0.2 || metrics.gcMaxMs > Math.max(2, budget * 0.15)) {
    diagnoses.push({
      id: "garbage-collection",
      label: "garbage collection pressure",
      confidence: "high",
      evidence: `GC occupied ${formatMs(metrics.gcOccupancyMs)} on renderer-main (${formatMs(metrics.gcTotalMs)} inclusive nested slices), with a ${formatMs(metrics.gcMaxMs)} maximum event.`,
    });
  }
  const dropped = framePipeline.filter((record) => record.state.includes("DROPPED") || record.affectsSmoothness);
  if (dropped.length > 0) {
    diagnoses.push({
      id: "pipeline-drop-marker",
      label: "pipeline drop marker",
      confidence: frame.intervalMs >= Math.max(budget * 2.4, drawBaselineMs * 1.5) ? "high" : "low",
      evidence: `${dropped.length} drop/affects-smoothness marker(s) overlap this ${formatMs(frame.intervalMs)} ${intervalKind} interval.`,
    });
  }
  if (diagnoses.length === 0) {
    const missing = [
      !capabilities.signals.runTask.available && "RunTask",
      !capabilities.signals.paint.available && "Paint",
      !capabilities.signals.raster.available && "RasterTask",
    ].filter(Boolean);
    diagnoses.push({
      id: "no-dominant-cpu-work",
      label: "no dominant captured CPU work",
      confidence: missing.length === 0 ? "medium" : "low",
      evidence: `the ${formatMs(frame.intervalMs)} ${intervalKind} interval contains ${formatMs(metrics.mainBusyMs)} of renderer-main work, Paint max ${formatMs(metrics.paintMaxMs)}, and RasterTask max ${formatMs(metrics.rasterMaxMs)}.${missing.length ? ` Missing evidence: ${missing.join(", ")}.` : ""}`,
    });
  }
  return diagnoses;
}

function summarizeWorkload({ events, mainEvents, selection, metadata, rasterTids, window }) {
  const named = {};
  const attributable = events.filter((event) => {
    if (!isComplete(event) || !isFocusEvent(event.name)) return false;
    const role = roleFor(event, selection, metadata, rasterTids);
    return role.startsWith("renderer-") || (role === "gpu-global" && event.name === "GPUTask");
  });
  for (const entry of aggregateNamedWork(attributable, window)) {
    named[entry.name] = entry;
  }
  const roles = {};
  const byRole = new Map();
  for (const event of events.filter(isComplete)) {
    const role = roleFor(event, selection, metadata, rasterTids);
    if (role === "other-global") continue;
    const intervals = byRole.get(role) ?? [];
    intervals.push(clipInterval(event, window.startTs, window.endTs));
    byRole.set(role, intervals);
  }
  for (const [role, intervals] of byRole) roles[role] = round(unionDuration(intervals) / 1000);
  return {
    roles,
    named,
    mainThreadFunctions: aggregateFunctions(mainEvents.filter((event) => event.name === "FunctionCall"), window).slice(0, 20),
  };
}

function aggregateNamedWork(events, window) {
  const groups = new Map();
  for (const event of events) {
    const duration = clippedDuration(event, window.startTs, window.endTs) / 1000;
    const group = groups.get(event.name) ?? { name: event.name, count: 0, totalMs: 0, maxMs: 0 };
    group.count += 1;
    group.totalMs += duration;
    group.maxMs = Math.max(group.maxMs, duration);
    groups.set(event.name, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, totalMs: round(group.totalMs), maxMs: round(group.maxMs) }))
    .sort((a, b) => b.totalMs - a.totalMs || b.maxMs - a.maxMs);
}

function aggregateRoleNamedWork(events, window, getRole) {
  const groups = new Map();
  for (const event of events) {
    const role = getRole(event);
    const key = `${role}:${event.name}`;
    const duration = clippedDuration(event, window.startTs, window.endTs) / 1000;
    const group = groups.get(key) ?? { role, name: event.name, count: 0, totalMs: 0, maxMs: 0 };
    group.count += 1;
    group.totalMs += duration;
    group.maxMs = Math.max(group.maxMs, duration);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, totalMs: round(group.totalMs), maxMs: round(group.maxMs) }))
    .sort((a, b) => b.totalMs - a.totalMs || b.maxMs - a.maxMs);
}

function aggregateFunctions(events, window) {
  const groups = new Map();
  for (const event of events) {
    const data = event.args?.data ?? {};
    const functionName = data.functionName || "(anonymous)";
    const url = data.url ? `${basenameFromUrl(data.url)}:${data.lineNumber ?? "?"}` : "";
    const label = url ? `${functionName} — ${url}` : functionName;
    const group = groups.get(label) ?? { label, count: 0, totalMs: 0, maxMs: 0 };
    const duration = clippedDuration(event, window.startTs, window.endTs) / 1000;
    group.count += 1;
    group.totalMs += duration;
    group.maxMs = Math.max(group.maxMs, duration);
    groups.set(label, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, totalMs: round(group.totalMs), maxMs: round(group.maxMs) }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

function buildVerdict({ slowest, timelineWorst, timelineBaselineMs, cadence, drawStats, pipeline, longTasks, capabilities }) {
  const worst = timelineWorst ?? slowest[0];
  if (!worst) return "No consecutive DrawFrame events were captured.";
  const primary = worst.diagnoses[0];
  const qualification = !capabilities.signals.runTask.available
    ? "RunTask evidence was not captured, so long tasks are unknown."
    : longTasks.length === 0
      ? "No 50 ms main-thread long tasks were captured."
      : `${longTasks.length} main-thread long task(s) were captured.`;
  const drops = !pipeline.available
    ? "PipelineReporter evidence was not captured, so dropped-frame markers are unknown."
    : pipeline.droppedCount === 0
      ? "No pipeline drop markers were captured."
      : `${pipeline.droppedCount} pipeline drop marker(s) were captured; ${pipeline.severeDrawStallAlignedCount} align with a severe DrawFrame gap.`;
  const intervalLabel = worst.intervalKind === "presented animation frame"
    ? "presented animation-frame interval"
    : "DrawFrame gap";
  const baseline = worst.intervalKind === "presented animation frame"
    ? timelineBaselineMs == null ? "unknown" : `${round(worst.intervalMs / timelineBaselineMs)}× presented-animation p50`
    : drawStats.p50Ms == null ? "unknown" : `${round(worst.intervalMs / drawStats.p50Ms)}× DrawFrame p50`;
  return `Worst ${intervalLabel} ${formatMs(worst.intervalMs)} (${round(worst.intervalMs / cadence.ms)}× display interval; ${baseline}). Primary evidence: ${primary.label}. ${qualification} ${drops}`;
}

function answerQuestion(analysis, frame, comparison) {
  if (analysis.focus === "comparison") {
    if (!comparison) return "A before/after answer requires --compare <trace>.";
    const worst = comparison.metrics.worstDrawGapMs;
    const stalls = comparison.metrics.drawGapsAbove1_5xBaseline;
    return `Worst DrawFrame gap changed ${formatMetric(worst.before)} → ${formatMetric(worst.after)} ms (${formatSigned(worst.delta)} ms); gaps above 1.5× each trace's DrawFrame p50 changed ${formatMetric(stalls.before)} → ${formatMetric(stalls.after)} (${formatSigned(stalls.delta)}).`;
  }
  if (analysis.focus === "pipeline") {
    if (!analysis.pipeline.available) return "PipelineReporter was not captured, so this trace cannot answer whether Chrome marked frames dropped.";
    const cadenceQualification = analysis.cadence.drawFrame.p50Ms > analysis.cadence.display.ms * 1.5
      ? ` The app's DrawFrame p50 is ${formatMs(analysis.cadence.drawFrame.p50Ms)} against a ${formatMs(analysis.cadence.display.ms)} display interval, so missed-vsync markers are expected even without application-cadence outliers.`
      : "";
    return `${analysis.pipeline.droppedCount} drop/affects-smoothness records were captured; ${analysis.pipeline.severeDrawStallAlignedCount} align with a severe DrawFrame stall.${cadenceQualification}`;
  }
  if (analysis.focus === "rendering") {
    const paint = analysis.capabilities.signals.paint.available ? formatMs(analysis.workload.named.Paint?.maxMs) : "not captured";
    const raster = analysis.capabilities.signals.raster.available ? formatMs(analysis.workload.named.RasterTask?.maxMs) : "not captured";
    const lightingConclusion = frame && /lighting/iu.test(analysis.question ?? "")
      ? frame.metrics.paintMaxMs < analysis.cadence.display.ms * 0.1 && frame.metrics.rasterMaxMs < analysis.cadence.display.ms * 0.1
        ? `Captured paint/raster evidence does not implicate lighting in this performance stall; the interval's primary evidence is ${frame.diagnoses[0].label}. `
        : "Lighting-related publication may be contributing to the captured rendering pressure. "
      : "";
    const selected = frame
      ? ` On the selected interval they maxed at ${formatMs(frame.metrics.paintMaxMs)} and ${formatMs(frame.metrics.rasterMaxMs)}.`
      : " No DrawFrame interval was available for frame-local attribution.";
    return `${lightingConclusion}Style/layout published ${analysis.cadence.styleAndLayout.eventCount} times at p50 ${formatMs(analysis.cadence.styleAndLayout.p50Ms)}. Across the trace, Paint max was ${paint} and RasterTask max was ${raster}.${selected}`;
  }
  if (analysis.focus === "scheduler") {
    return `rAF p50/max were ${formatMs(analysis.cadence.requestAnimationFrame.p50Ms)}/${formatMs(analysis.cadence.requestAnimationFrame.maxMs)}. Timer/rAF handoff pattern: ${analysis.cadence.schedulerCoupling.coupled ? "compatible" : "not supported"}; correlated timer → next-rAF delay max ${formatMs(analysis.cadence.timerToRafDelay.maxMs)}.${frame ? ` ${frame.diagnoses[0].evidence}` : " No DrawFrame interval was available for local attribution."}`;
  }
  if (analysis.focus === "worst-frame") {
    if (!frame) return analysis.verdict;
    const top = frame.namedWork.find((entry) => entry.role === "renderer-main" && !isTaskName(entry.name));
    const topCpuSamples = frame.cpuProfile.topSelf.filter((entry) => entry.codeType === "JS").slice(0, 3);
    const sampledApplicationMs = round(topCpuSamples.reduce((sum, entry) => sum + entry.sampledMs, 0));
    const intervalLabel = frame.intervalKind === "presented animation frame"
      ? "presented animation-frame interval"
      : "DrawFrame interval";
    return `The worst ${intervalLabel} was ${formatMs(frame.intervalMs)}. Renderer-main was busy ${formatMs(frame.metrics.mainBusyMs)}${top ? `, including ${formatMs(top.totalMs)} inclusive in ${top.name}` : ""}; its longest RunTask was ${formatMs(frame.metrics.maxRunTaskMs)}.${topCpuSamples.length ? ` CPU samples attribute ${formatMs(sampledApplicationMs)} of estimated self time to ${topCpuSamples.map((entry) => entry.functionName).join(", ")}, led by ${topCpuSamples[0].file}:${topCpuSamples[0].hotLine?.line ?? "?"}.` : ""}`;
  }
  if (analysis.focus === "garbage-collection") {
    return analysis.garbageCollection.available
      ? `${analysis.garbageCollection.eventCount} renderer-main GC slices occupied ${formatMs(analysis.garbageCollection.occupancyMs)} (${formatMs(analysis.garbageCollection.totalMs)} inclusive nested time); the maximum slice was ${formatMs(analysis.garbageCollection.maxMs)}${frame ? `, and the selected interval contains ${formatMs(frame.metrics.gcOccupancyMs)} occupancy` : ""}.`
      : "No renderer-main GC slices were captured. This excludes captured GC work, not uninstrumented memory pressure.";
  }
  if (analysis.focus === "long-tasks") {
    return analysis.longTasks.available
      ? `${analysis.longTasks.count} renderer-main RunTask slices reached the 50 ms long-task threshold; maximum ${formatMs(analysis.longTasks.maxMs)}.`
      : "RunTask slices were not captured, so this trace cannot establish whether long main-thread tasks occurred.";
  }
  if (analysis.focus === "javascript") {
    const sampled = (frame?.cpuProfile ?? analysis.cpuProfile).topSelf.slice(0, 3);
    if (sampled.length > 0) {
      return `Top sampled main-thread self time: ${sampled.map((entry) => `${entry.label} ${formatMs(entry.sampledMs)}${entry.hotLine ? ` (line ${entry.hotLine.line})` : ""}`).join("; ")}. CPU-profile durations are sampling estimates.`;
    }
    const functions = (frame?.topMainFunctions ?? analysis.workload.mainThreadFunctions).slice(0, 3);
    return functions.length
      ? `Top captured main-thread functions in the selected interval: ${functions.map((entry) => `${entry.label} ${formatMs(entry.totalMs)}`).join("; ")}.`
      : "No FunctionCall slices were captured in the selected interval; JavaScript attribution is unavailable there.";
  }
  if (analysis.focus === "gpu") {
    if (!frame) return `The global GPU process occupied ${formatMs(analysis.workload.roles["gpu-global"] ?? 0)} in the analysis window. Chrome traces do not scope this global process work exclusively to the selected page.`;
    return `The global GPU process had ${formatMs(frame.roleBusyMs["gpu-global"] ?? 0)} of trace-slice occupancy during the interval, including ${formatMs(frame.namedWork.find((entry) => entry.role === "gpu-global" && entry.name === "GPUTask")?.totalMs)} of GPUTask slices. Chrome traces do not scope this global process work exclusively to the selected page.`;
  }
  if (analysis.focus === "coverage") {
    const missing = Object.entries(analysis.capabilities.signals).filter(([, signal]) => !signal.available).map(([name]) => name);
    return missing.length ? `Missing trace evidence: ${missing.join(", ")}. Conclusions depending on those signals are reported as unavailable.` : "All FrameSleuth evidence channels were captured.";
  }
  if (analysis.focus === "screenshots") {
    const nearest = analysis.screenshots.nearestToSelectedFrame;
    if (!nearest) return "Screenshot events were not captured in the selected analysis window.";
    const extracted = analysis.screenshots.extracted.length
      ? ` Extracted: ${analysis.screenshots.extracted.map((entry) => entry.path).join(", ")}.`
      : " Use --screenshots <directory> to extract the image bytes.";
    return `The nearest screenshot is ${formatMs(nearest.deltaFromFrameEndMs)} from the selected interval end${nearest.exactFrameSequence ? " with an exact frame-sequence match" : ""}.${extracted}`;
  }
  if (!frame) return analysis.verdict;
  return analysis.verdict;
}

function inferQuestionFocus(question) {
  if (!question) return "summary";
  if (/worst|slowest|work.*frame|frame.*work/iu.test(question)) return "worst-frame";
  if (/compar|regress|better|worse|improv|fixed|difference/iu.test(question)) return "comparison";
  if (/drop|pipeline|present|flicker|flash|artifact/iu.test(question)) return "pipeline";
  if (/garbage|\bgc\b|memory/iu.test(question)) return "garbage-collection";
  if (/long.?task|blocked|blocking/iu.test(question)) return "long-tasks";
  if (/javascript|function|script|\bjs\b/iu.test(question)) return "javascript";
  if (/\bgpu\b|compositor/iu.test(question)) return "gpu";
  if (/screenshot|visual|image|show.*frame/iu.test(question)) return "screenshots";
  if (/coverage|captur|missing|trust|evidence/iu.test(question)) return "coverage";
  if (/paint|raster|render|lighting|style|layout/iu.test(question)) return "rendering";
  if (/timer|scheduler|raf|cadence|jitter|stutter|smooth/iu.test(question)) return "scheduler";
  return "summary";
}

function roleFor(event, selection, metadata, rasterTids) {
  if (event.pid === selection.pid && event.tid === selection.mainTid) return "renderer-main";
  if (event.pid === selection.pid && event.tid === selection.compositorTid) return "renderer-compositor";
  if (event.pid === selection.pid && (rasterTids.has(event.tid) || event.name === "RasterTask")) return "renderer-raster";
  const processName = metadata.processNames.get(event.pid) ?? "";
  const threadName = metadata.threadNames.get(threadKey(event.pid, event.tid)) ?? "";
  if (processName === "GPU Process") return "gpu-global";
  if (processName === "Browser" && threadName === "CrBrowserMain") return "browser-main-global";
  if (event.pid === selection.pid) return "renderer-other";
  return "other-global";
}

function summarizeTimestamps(timestamps) {
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  const intervals = [];
  for (let index = 1; index < sorted.length; index += 1) intervals.push((sorted[index] - sorted[index - 1]) / 1000);
  return { eventCount: sorted.length, ...summarizeNumbers(intervals) };
}

function summarizeNumbers(numbers) {
  const values = numbers.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: values.length,
    p50Ms: quantile(values, 0.5),
    p95Ms: quantile(values, 0.95),
    p99Ms: quantile(values, 0.99),
    maxMs: values.length ? round(values.at(-1)) : null,
    meanMs: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
  };
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return round(value);
}

function surroundingGap(events, timestamp) {
  const before = lastAtOrBefore(events, timestamp);
  const after = events.find((event) => event.ts > timestamp);
  return before && after ? round((after.ts - before.ts) / 1000) : null;
}

function lastAtOrBefore(events, timestamp) {
  let result = null;
  for (const event of events) {
    if (event.ts > timestamp) break;
    result = event;
  }
  return result;
}

function unionDuration(intervals) {
  if (intervals.length === 0) return 0;
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length === 0) return 0;
  let total = 0;
  let [start, end] = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const [nextStart, nextEnd] = sorted[index];
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      [start, end] = [nextStart, nextEnd];
    }
  }
  return total + end - start;
}

function clipInterval(event, startTs, endTs) {
  return [Math.max(event.ts, startTs), Math.min(eventEnd(event), endTs)];
}

function clippedDuration(event, startTs, endTs) {
  const [start, end] = clipInterval(event, startTs, endTs);
  return Math.max(0, end - start);
}

function overlaps(event, startTs, endTs) {
  return event.ts < endTs && eventEnd(event) > startTs;
}

function overlapsWindow(event, window) {
  if (!Number.isFinite(event.ts)) return false;
  if (isComplete(event)) return overlaps(event, window.startTs, window.endTs);
  return event.ts >= window.startTs && event.ts <= window.endTs;
}

function isComplete(event) {
  return event.ph === "X" && Number.isFinite(event.dur) && event.dur >= 0;
}

function isTask(event) {
  return isTaskName(event.name);
}

function isTaskName(name) {
  return name === "RunTask" || name === "ThreadControllerImpl::RunTask";
}

function isFocusEvent(name) {
  return FOCUS_EVENTS.has(name) || isGcEvent(name);
}

function isGcEvent(name) {
  return /^(?:MinorGC|MajorGC|V8\.GC)/u.test(name);
}

function eventEnd(event) {
  return event.ts + (Number.isFinite(event.dur) ? event.dur : 0);
}

function sortedEvents(events, name) {
  return events.filter((event) => event.name === name && Number.isFinite(event.ts)).sort((a, b) => a.ts - b.ts);
}

function uniqueTimestampEvents(events) {
  const result = [];
  let previous = null;
  for (const event of events) {
    if (event.ts === previous) continue;
    result.push(event);
    previous = event.ts;
  }
  return result;
}

function countNamed(events, name) {
  return events.reduce((count, event) => count + Number(event.name === name), 0);
}

function dominantValue(values) {
  if (values.length === 0) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function threadKey(pid, tid) {
  return `${pid}:${tid}`;
}

function offsetMs(timestamp, startTs) {
  return round((timestamp - startTs) / 1000);
}

function nullableMax(values) {
  return values.length ? round(Math.max(...values)) : null;
}

function round(value) {
  return Number(value.toFixed(3));
}

function formatMs(value) {
  return value == null ? "n/a" : `${round(value).toFixed(3)} ms`;
}

function formatMetric(value) {
  return value == null ? "n/a" : String(round(value));
}

function formatSigned(value) {
  if (value == null) return "n/a";
  return `${value > 0 ? "+" : ""}${round(value)}`;
}

function formatAvailabilityCount(available, value) {
  return available ? String(value) : "not captured";
}

function cadenceRow(label, stats) {
  return `| ${label} | ${stats.eventCount ?? stats.count ?? 0} | ${formatMs(stats.p50Ms)} | ${formatMs(stats.p95Ms)} | ${formatMs(stats.maxMs)} |`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|");
}

function basenameFromUrl(value) {
  try {
    return basename(new URL(value).pathname) || new URL(value).hostname;
  } catch {
    return basename(value);
  }
}

function parseCli(argv) {
  const options = { format: "markdown", top: 5 };
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--compare") options.compare = requiredValue(argv, ++index, argument);
    else if (argument === "--format") options.format = requiredValue(argv, ++index, argument);
    else if (argument === "--output") options.output = requiredValue(argv, ++index, argument);
    else if (argument === "--top") options.top = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--frame") options.frame = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--rank") options.rank = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--around-ms") options.aroundMs = nonNegativeNumber(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--screenshots") options.screenshots = requiredValue(argv, ++index, argument);
    else if (argument === "--url") options.url = requiredValue(argv, ++index, argument);
    else if (argument === "--start-ms") options.startMs = nonNegativeNumber(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--end-ms") options.endMs = nonNegativeNumber(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--question") options.question = requiredValue(argv, ++index, argument);
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}.`);
    else paths.push(argument);
  }
  if (!options.help && paths.length !== 1) throw new Error("Provide exactly one trace path.");
  if (!new Set(["markdown", "json"]).has(options.format)) throw new Error("--format must be markdown or json.");
  return { path: paths[0], ...options };
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (value == null || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${option} requires a positive integer.`);
  return number;
}

function nonNegativeNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${option} requires a non-negative number.`);
  return number;
}

async function main(argv) {
  const options = parseCli(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const beforeTrace = await loadTrace(options.path);
  const before = analyzeTrace(beforeTrace, options);
  let after = null;
  let comparison = null;
  if (options.compare) {
    after = analyzeTrace(await loadTrace(options.compare), options);
    comparison = compareAnalyses(before, after);
  }
  if (options.screenshots) before.screenshots.extracted = await extractFrameScreenshots(beforeTrace, before, options.screenshots);
  const output = options.format === "json"
    ? `${JSON.stringify({ analysis: before, comparedAnalysis: after, comparison }, null, 2)}\n`
    : renderMarkdown(before, comparison);
  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
  }
  else process.stdout.write(output);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`FrameSleuth: ${error.message}\n`);
    process.exitCode = 1;
  });
}
