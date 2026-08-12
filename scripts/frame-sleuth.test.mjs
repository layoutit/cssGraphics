import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { analyzeTrace, compareAnalyses, extractFrameScreenshots, loadTrace, renderFrameChartSvg, renderMarkdown, SCHEMA } from "./frame-sleuth.mjs";

test("selects the active renderer and attributes a cheap worst frame to timer-to-rAF delay", () => {
  const events = syntheticTrace({ delayedRaf: true });
  const analysis = analyzeTrace(loaded(events), { top: 3, question: "what work did we do on the worst frame?" });

  assert.equal(analysis.schema, SCHEMA);
  assert.equal(analysis.selection.rendererPid, 10);
  assert.equal(analysis.worstFrames[0].intervalMs, 46);
  assert.equal(analysis.worstFrames[0].metrics.maxTimerToRafDelayMs, 16);
  assert.equal(analysis.worstFrames[0].diagnoses[0].id, "timer-to-raf-handoff");
  assert.ok(analysis.worstFrames[0].metrics.paintMaxMs < 1);
  assert.equal(analysis.longTasks.count, 0);
  assert.match(renderMarkdown(analysis), /timer-to-rAF phase delay/);
});

test("follows a renderer navigation instead of retaining the initial about:blank URL", () => {
  const events = syntheticTrace({});
  const started = events.find((event) => event.name === "TracingStartedInBrowser");
  started.args.data.frames[0].url = "about:blank";
  events.push({
    name: "FrameCommittedInBrowser",
    ph: "I",
    pid: 1,
    tid: 1,
    ts: 2_000,
    args: { data: { processId: 10, url: "https://example.test/demo/" } },
  });
  const analysis = analyzeTrace(loaded(events), { url: "/demo/" });
  assert.deepEqual(analysis.selection.urls, ["https://example.test/demo/"]);
});

test("does not mistake after-startup worst-frame wording for a comparison request", () => {
  const analysis = analyzeTrace(loaded(syntheticTrace({ delayedRaf: true })), {
    question: "after startup, what work happened on the worst frame?",
  });
  assert.equal(analysis.focus, "worst-frame");
  assert.doesNotMatch(renderMarkdown(analysis), /requires --compare/);
});

test("does not present an isolated BACKFILL record as a visible stall", () => {
  const events = syntheticTrace({ droppedBackfill: true });
  const duplicate = events.find((event) => event.name === "PipelineReporter");
  events.push({ ...duplicate, ts: duplicate.ts + 1 });
  events.push({
    ...duplicate,
    ts: duplicate.ts + 2,
    args: { frame_reporter: { ...duplicate.args.frame_reporter, layer_tree_host_id: 2, frame_sequence: 100 } },
  });
  const analysis = analyzeTrace(loaded(events));

  assert.equal(analysis.pipeline.droppedCount, 1);
  assert.equal(analysis.pipeline.severeDrawStallAlignedCount, 0);
  assert.equal(analysis.pipeline.dropped[0].classification, "not aligned with a severe DrawFrame stall");
});

test("deduplicates nested long-task wrappers", () => {
  const events = syntheticTrace({});
  events.push(complete("ThreadControllerImpl::RunTask", 10, 11, 20_000, 60_000));
  events.push(complete("RunTask", 10, 11, 21_000, 58_000));
  const analysis = analyzeTrace(loaded(events));
  assert.equal(analysis.longTasks.count, 1);
  assert.equal(analysis.longTasks.maxMs, 60);
});

test("loads raw and gzip DevTools traces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framesleuth-"));
  try {
    const rawPath = join(directory, "trace.json");
    const gzipPath = join(directory, "trace.json.gz");
    const body = JSON.stringify({ traceEvents: syntheticTrace({}) });
    await writeFile(rawPath, body);
    await writeFile(gzipPath, gzipSync(body));

    const raw = await loadTrace(rawPath);
    const gzip = await loadTrace(gzipPath);
    assert.equal(raw.compressed, false);
    assert.equal(gzip.compressed, true);
    assert.equal(raw.events.length, gzip.events.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compares before and after without hiding null metrics", () => {
  const before = analyzeTrace(loaded(syntheticTrace({ delayedRaf: true })));
  const after = analyzeTrace(loaded(syntheticTrace({})));
  const comparison = compareAnalyses(before, after);

  assert.equal(comparison.metrics.worstDrawGapMs.before, 46);
  assert.equal(comparison.metrics.worstDrawGapMs.after, 17);
  assert.equal(comparison.metrics.worstDrawGapMs.delta, -29);
  assert.equal(comparison.metrics.longTaskCount.delta, 0);
});

test("reports unavailable evidence as unknown instead of zero", () => {
  const events = syntheticTrace({}).filter(
    (event) => !new Set(["RunTask", "PipelineReporter", "Paint", "RasterTask"]).has(event.name),
  );
  const analysis = analyzeTrace(loaded(events));

  assert.equal(analysis.longTasks.available, false);
  assert.equal(analysis.longTasks.count, null);
  assert.equal(analysis.pipeline.available, false);
  assert.equal(analysis.pipeline.droppedCount, null);
  assert.equal(analysis.capabilities.signals.paint.available, false);
  assert.match(renderMarkdown(analysis), /Long main-thread tasks: not captured/);
});

test("rejects ambiguous and nonexistent frame selectors", () => {
  const trace = loaded(syntheticTrace({}));
  assert.throws(() => analyzeTrace(trace, { frame: 999 }), /does not exist/);
  assert.throws(() => analyzeTrace(trace, { frame: 1, rank: 1 }), /only one/);
  assert.equal(analyzeTrace(trace, { rank: 2 }).requestedFrame.index, 2);
  assert.equal(analyzeTrace(trace, { aroundMs: 20 }).requestedFrame.index, 2);
});

test("uses the observed compositor clock on a 90 Hz trace", () => {
  const analysis = analyzeTrace(loaded(syntheticTrace({ refreshUs: 11_111 })));
  assert.equal(analysis.cadence.display.ms, 11.111);
  assert.equal(analysis.cadence.display.basis, "Compositor BeginFrame");
});

test("attributes renderer-main GC occupancy without double-counting nested slices", () => {
  const analysis = analyzeTrace(loaded(syntheticTrace({ garbageCollection: true })), { frame: 2 });
  assert.equal(analysis.requestedFrame.metrics.gcOccupancyMs, 5);
  assert.equal(analysis.requestedFrame.metrics.gcTotalMs, 7);
  assert.ok(analysis.requestedFrame.diagnoses.some((diagnosis) => diagnosis.id === "garbage-collection"));
});

test("decodes CPU profile chunks to identify work hidden inside microtasks", () => {
  const analysis = analyzeTrace(loaded(syntheticTrace({ cpuProfile: true })), { frame: 2 });
  const sampled = analysis.requestedFrame.cpuProfile;
  assert.equal(analysis.capabilities.signals.cpuProfile.available, true);
  assert.equal(sampled.sampleCount, 2);
  assert.equal(sampled.topSelf[0].label, "decodePreparedTransformBlock — preparedAssets.mjs");
  assert.equal(sampled.topSelf[0].hotLine.line, 670);
  assert.match(renderMarkdown(analysis), /Sampled main-thread self time/);
});

test("renders the standard frame-time chart without an instantaneous FPS axis", () => {
  const analysis = analyzeTrace(loaded(syntheticTrace({ delayedRaf: true })));
  const svg = renderFrameChartSvg(analysis);
  assert.match(svg, /FrameSleuth presented animation-frame times/u);
  assert.match(svg, /p50 17.0 ms \(~58.8 FPS\)/);
  assert.match(svg, /worst 46.0 ms gap/);
  assert.match(svg, /DrawFrame interval \(ms, presentation fallback\)/);
  assert.doesNotMatch(svg, /Pacing equivalent|rolling FPS|Effective frame rate/u);
  assert.doesNotMatch(svg, /Main-thread busy time \(ms\)/);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
  assert.doesNotMatch(svg, /Right axis/u);
  assert.match(svg, /color-scheme: dark/);
  assert.doesNotMatch(svg, /prefers-color-scheme/u);
  assert.doesNotMatch(svg, /NaN|undefined/u);
});

test("prefers renderer presentation timestamps for the frame-time chart", () => {
  const events = syntheticTrace({ delayedRaf: true });
  [11_000, 27_000, 73_000, 90_000, 107_000].forEach((ts) => {
    events.push(instant("AnimationFrame::Presentation", 10, 11, ts));
  });
  const analysis = analyzeTrace(loaded(events));
  assert.equal(analysis.timeline.source, "AnimationFrame::Presentation");
  assert.equal(analysis.timeline.baselineMs, 17);
  assert.equal(analysis.timeline.worstFrame.intervalKind, "presented animation frame");
  assert.equal(analysis.timeline.worstFrame.intervalMs, 46);
  assert.match(renderFrameChartSvg(analysis), /Presented animation-frame interval \(ms\)/);
  assert.match(renderMarkdown(analysis, null, { frameChart: "frame-times.svg" }), /Worst presented animation-frame interval/u);
});

test("attributes the same presentation interval highlighted by the chart", () => {
  const events = syntheticTrace({});
  [11_000, 27_000, 73_000, 90_000, 107_000].forEach((ts) => {
    events.push(instant("AnimationFrame::Presentation", 10, 11, ts));
  });
  [35_000, 52_000, 69_000].forEach((ts, index) => {
    events.push({
      name: "PipelineReporter",
      ph: "b",
      pid: 10,
      tid: 12,
      ts,
      args: { frame_reporter: {
        state: "STATE_PRESENTED_ALL",
        affects_smoothness: false,
        frame_sequence: 200 + index,
        frame_source: 1,
        layer_tree_host_id: 1,
      } },
    });
  });
  events.push(complete("RunMicrotasks", 10, 11, 40_000, 12_000));

  const analysis = analyzeTrace(loaded(events), { question: "what work happened on the worst frame?" });
  const highlighted = analysis.timeline.frames.reduce(
    (worst, frame) => frame.intervalMs > worst.intervalMs ? frame : worst,
    analysis.timeline.frames[0],
  );
  assert.equal(highlighted.intervalMs, 46);
  assert.equal(analysis.timeline.worstFrame.intervalMs, highlighted.intervalMs);
  assert.equal(analysis.timeline.worstFrame.metrics.mainBusyMs, 13.2);
  assert.match(renderMarkdown(analysis), /worst presented animation-frame interval was 46\.000 ms/u);
  assert.match(renderMarkdown(analysis), /RunMicrotasks/u);
});

test("uses temporal next-callback correlation without trusting cross-type ids", () => {
  const events = syntheticTrace({ delayedRaf: true });
  events.push(complete("TimerFire", 10, 11, 105_000, 50, { data: { timerId: 2 } }));
  const analysis = analyzeTrace(loaded(events));
  assert.equal(analysis.worstFrames[0].diagnoses[0].id, "timer-to-raf-handoff");
  assert.equal(analysis.worstFrames[0].diagnoses[0].confidence, "medium");
  assert.equal(analysis.cadence.schedulerCoupling.coupled, true);
  assert.equal(analysis.worstFrames[0].scheduling.timerToRafPairs[0].correlation, "temporal-next-callback");
});

test("does not infer timer-to-rAF handoff when timer and rAF cadences are unrelated", () => {
  const events = syntheticTrace({});
  for (const [index, ts] of [10_500, 40_500, 70_500, 100_500, 110_000].entries()) {
    events.push(complete("TimerFire", 10, 11, ts, 50, { data: { timerId: index } }));
  }
  const analysis = analyzeTrace(loaded(events));
  assert.equal(analysis.cadence.schedulerCoupling.coupled, false);
  assert.ok(analysis.worstFrames.every((frame) => frame.diagnoses.every((diagnosis) => diagnosis.id !== "timer-to-raf-handoff")));
});

test("extracts screenshot evidence nearest the selected frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framesleuth-shots-"));
  try {
    const trace = loaded(syntheticTrace({ screenshot: true }));
    const analysis = analyzeTrace(trace, { frame: 2, question: "show visual evidence for this frame" });
    const extracted = await extractFrameScreenshots(trace, analysis, directory);
    analysis.screenshots.extracted = extracted;
    assert.equal(analysis.screenshots.nearestToSelectedFrame.exactFrameSequence, true);
    assert.equal(extracted.length, 1);
    const bytes = await readFile(extracted[0].path);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.match(renderMarkdown(analysis), /Extracted:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("answers before-and-after questions from comparison evidence", () => {
  const before = analyzeTrace(loaded(syntheticTrace({ delayedRaf: true })), { question: "is this better?" });
  const after = analyzeTrace(loaded(syntheticTrace({})));
  const markdown = renderMarkdown(before, compareAnalyses(before, after));
  assert.match(markdown, /Worst DrawFrame gap changed 46 → 17 ms/);
});

test("answers aggregate questions when no DrawFrame interval exists", () => {
  const events = syntheticTrace({}).filter((event) => event.name !== "DrawFrame");
  events.push({ ...instant("DrawFrame", 10, 12, 44_000), args: { frameSeqId: 3, layerTreeId: 1 } });
  const coverage = analyzeTrace(loaded(events), { question: "what evidence is missing?" });
  const rendering = analyzeTrace(loaded(events), { question: "is paint the bottleneck?" });
  assert.match(renderMarkdown(coverage), /Missing trace evidence: drawFrame/);
  assert.match(renderMarkdown(rendering), /No DrawFrame interval was available for frame-local attribution/);
});

function loaded(events) {
  return {
    path: "/tmp/synthetic-trace.json",
    bytes: 1,
    decodedBytes: 1,
    compressed: false,
    events,
  };
}

function syntheticTrace({ delayedRaf = false, droppedBackfill = false, refreshUs = 16_667, garbageCollection = false, screenshot = false, cpuProfile = false }) {
  const events = [
    metadata("process_name", 10, 0, "Renderer"),
    metadata("thread_name", 10, 11, "CrRendererMain"),
    metadata("thread_name", 10, 12, "Compositor"),
    metadata("thread_name", 10, 13, "CompositorTileWorker1"),
    metadata("process_name", 20, 0, "Renderer"),
    metadata("thread_name", 20, 21, "CrRendererMain"),
    metadata("thread_name", 20, 22, "Compositor"),
    {
      name: "TracingStartedInBrowser",
      ph: "I",
      pid: 1,
      tid: 1,
      ts: 1,
      args: { data: { frames: [
        { processId: 10, url: "https://example.test/demo/" },
        { processId: 20, url: "https://example.test/idle/" },
      ] } },
    },
  ];

  const beginFrames = Array.from({ length: 10 }, (_, index) => 1_000 + index * refreshUs);
  for (const ts of beginFrames) events.push(instant("BeginFrame", 10, 12, ts));

  const drawFrames = delayedRaf
    ? [10_000, 27_000, 73_000, 90_000, 107_000]
    : [10_000, 27_000, 44_000, 61_000, 78_000, 95_000, 112_000];
  drawFrames.forEach((ts, index) => events.push({ ...instant("DrawFrame", 10, 12, ts), args: { frameSeqId: index + 1, layerTreeId: 1 } }));

  const rafTimes = delayedRaf ? [11_000, 27_000, 73_000, 90_000, 107_000] : [11_000, 28_000, 45_000, 62_000, 79_000, 96_000, 113_000];
  const timerTimes = delayedRaf ? [10_000, 26_000, 57_000, 89_000, 106_000] : [];
  rafTimes.forEach((ts, index) => {
    if (delayedRaf) events.push(complete("TimerFire", 10, 11, timerTimes[index], 50, { data: { timerId: index } }));
    events.push(complete("FireAnimationFrame", 10, 11, ts, 100, { data: { id: index } }));
    events.push(complete("UpdateLayoutTree", 10, 11, ts + 150, 120));
    events.push(complete("Paint", 10, 11, ts + 300, 200));
    events.push(complete("RunTask", 10, 11, ts - 50, 600));
    events.push(complete("RasterTask", 10, 13, ts + 600, 100));
  });

  if (droppedBackfill) {
    events.push({
      name: "PipelineReporter",
      ph: "b",
      pid: 10,
      tid: 12,
      ts: 52_000,
      args: { frame_reporter: {
        state: "STATE_DROPPED",
        affects_smoothness: true,
        frame_type: "BACKFILL",
        frame_sequence: 99,
        layer_tree_host_id: 1,
      } },
    });
  }
  if (garbageCollection) {
    events.push(complete("MinorGC", 10, 11, 30_000, 5_000));
    events.push(complete("V8.GC_SCAVENGER", 10, 11, 31_000, 2_000));
  }
  if (cpuProfile) {
    events.push({
      name: "Profile",
      ph: "P",
      id: "0x1",
      pid: 10,
      tid: 11,
      ts: 1,
      args: { data: { source: "Internal", startTime: 0 } },
    });
    events.push({
      name: "ProfileChunk",
      ph: "P",
      id: "0x1",
      pid: 10,
      tid: 14,
      ts: 40_000,
      args: { data: {
        source: "Internal",
        cpuProfile: {
          nodes: [{
            id: 30,
            parent: 1,
            callFrame: {
              codeType: "JS",
              functionName: "decodePreparedTransformBlock",
              lineNumber: 573,
              scriptId: 14,
              url: "https://example.test/src/cssgravitywell/preparedAssets.mjs",
            },
          }],
          samples: [30, 30],
        },
        timeDeltas: [30_000, 5_000],
        lines: [670, 670],
        columns: [23, 23],
      } },
    });
  }
  if (screenshot) {
    events.push({
      name: "Screenshot",
      ph: "I",
      pid: 1,
      tid: 1,
      ts: 43_500,
      args: {
        expected_display_time: 44_000,
        frame_sequence: 3,
        snapshot: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    });
  }
  return events;
}

function metadata(name, pid, tid, value) {
  return { name, ph: "M", pid, tid, ts: 0, args: { name: value } };
}

function instant(name, pid, tid, ts) {
  return { name, ph: "I", pid, tid, ts, args: {} };
}

function complete(name, pid, tid, ts, dur, args = {}) {
  return { name, ph: "X", pid, tid, ts, dur, args };
}
