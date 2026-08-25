#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const traceProfileId = process.env.CSSBLACKHOLE_TRACE_PROFILE ?? "desktop";
if (traceProfileId !== "desktop" && traceProfileId !== "mobile") {
  throw new Error("BlackHole trace profile is invalid");
}
const traceVariant = process.env.CSSBLACKHOLE_TRACE_VARIANT ?? "translate";
if (!/^[a-z][a-z0-9-]*$/u.test(traceVariant)) throw new Error("BlackHole trace variant is invalid");
const port = 4202;
const baseUrl = `http://127.0.0.1:${port}/`;
const prepared = JSON.parse(await readFile(resolve(repositoryRoot,
  "build/generated/public/cssblackhole/prepared.json"), "utf8"));
const candidateConfigurationCount = 3;
const candidateStarCount = prepared.renderer.retainedPointLeafCount;
const candidateTransportSeed = 6477;
const traceViewport = traceProfileId === "mobile"
  ? { width: 390, height: 844 }
  : { width: 800, height: 600 };
const resultRoot = resolve(repositoryRoot,
  `bench/results/cssblackhole/performance/${traceProfileId}`);
const reportPath = resolve(resultRoot, `report-${traceVariant}.json`);
const tracePath = resolve(resultRoot, `chrome-trace-${traceVariant}.json.gz`);
const serverLogPath = resolve(resultRoot, `vite-server-${traceVariant}.log`);
const measurementMilliseconds = 16_000;
const presentationSlotHoldSeconds = prepared.presentation.slotHoldSeconds;
const presentationSlotDurationSeconds = prepared.presentation.slotDurationSeconds;
const expectedConfigurationTransitions = countTransitionStarts(
  measurementMilliseconds / 1_000,
  presentationSlotHoldSeconds,
  presentationSlotDurationSeconds,
);
const route = baseUrl;
const traceCategories = [
  "-*",
  "devtools.timeline",
  "blink.user_timing",
  "toplevel",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-v8.gc",
].join(",");

await mkdir(resultRoot, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/blackhole/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverOutput = "";
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });

let browser;
let traceStarted = false;
let cdp;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport: traceViewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    let deterministicRandomIndex = 0;
    const nativeGetRandomValues = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value(values) {
        if (values instanceof Uint32Array && values.length === 1) {
          values[0] = (0x9e3779b9 * ++deterministicRandomIndex) >>> 0;
          return values;
        }
        return nativeGetRandomValues(values);
      },
    });
    window.__cssBlackHoleObservedLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__cssBlackHoleObservedLongTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
            attribution: Array.from(entry.attribution ?? [], (item) => ({
              name: item.name,
              containerType: item.containerType,
              containerName: item.containerName,
              containerSrc: item.containerSrc,
            })),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {}
  });

  cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Performance.enable");
  const networkRequests = new Map();
  const networkTransfers = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    networkRequests.set(event.requestId, {
      url: event.request.url,
      type: event.type,
      startedAtSeconds: event.timestamp,
      response: null,
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    const request = networkRequests.get(event.requestId);
    if (request) request.response = {
      status: event.response.status,
      mimeType: event.response.mimeType,
      fromDiskCache: event.response.fromDiskCache ?? false,
      fromPrefetchCache: event.response.fromPrefetchCache ?? false,
    };
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = networkRequests.get(event.requestId);
    if (!request) return;
    networkTransfers.push({ ...request, finishedAtSeconds: event.timestamp,
      encodedDataLength: event.encodedDataLength });
    networkRequests.delete(event.requestId);
  });

  await cdp.send("Tracing.start", {
    categories: traceCategories,
    options: "record-as-much-as-possible",
    transferMode: "ReturnAsStream",
  });
  traceStarted = true;
  const traceWallStartedAt = performance.now();
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__cssBlackHoleDebug?.ready === true, null, { timeout: 30_000 });
  const readyMetrics = await cdp.send("Performance.getMetrics");
  const readyCdpSeconds = metricValue(readyMetrics.metrics, "Timestamp");
  const initial = await page.evaluate(() => {
    performance.mark("cssblackhole-trace-measurement-start");
    const nodes = Array.from(document.querySelectorAll(".polycss-scene > b"));
    window.__cssBlackHoleTraceIdentityNodes = nodes;
    return {
      stats: window.__cssBlackHoleDebug.stats(),
      debugIdentityAssertion: window.__cssBlackHoleDebug.assertStableDomIdentity(),
      domNodeCount: document.getElementsByTagName("*").length,
      leafCount: nodes.length,
      inlineTranslateCount: nodes.filter((node) => node.style.translate).length,
      inlineTransformCount: nodes.filter((node) => node.style.transform).length,
      inlinePositionCount: nodes.filter((node) =>
        node.style.getPropertyValue("--cssblackhole-position")).length,
      measurementStartTime: performance.getEntriesByName("cssblackhole-trace-measurement-start").at(-1).startTime,
    };
  });
  process.stdout.write(`BlackHole trace ready: ${initial.leafCount} retained points; measuring ${measurementMilliseconds} ms\n`);
  await page.waitForTimeout(measurementMilliseconds);
  const final = await page.evaluate(() => {
    performance.mark("cssblackhole-trace-measurement-end");
    const current = Array.from(document.querySelectorAll(".polycss-scene > b"));
    const retained = window.__cssBlackHoleTraceIdentityNodes;
    const marks = performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("cssblackhole-"))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    return {
      stats: window.__cssBlackHoleDebug.stats(),
      errors: window.__cssBlackHoleDebug.errors,
      debugIdentityAssertion: window.__cssBlackHoleDebug.assertStableDomIdentity(),
      domNodeCount: document.getElementsByTagName("*").length,
      leafCount: current.length,
      inlineTranslateCount: current.filter((node) => node.style.translate).length,
      inlineTransformCount: current.filter((node) => node.style.transform).length,
      inlinePositionCount: current.filter((node) =>
        node.style.getPropertyValue("--cssblackhole-position")).length,
      stableNodeReferences: retained.length === current.length &&
        retained.every((node, index) => node === current[index]),
      wrapperCount: document.querySelectorAll(".polycss-scene > div").length,
      leafIdCount: document.querySelectorAll(".polycss-scene > b[id]").length,
      leafDataAttributeCount: current.reduce((sum, leaf) => sum +
        [...leaf.attributes].filter((attribute) => attribute.name.startsWith("data-")).length, 0),
      marks,
      longTasks: window.__cssBlackHoleObservedLongTasks,
    };
  });
  const finalMetrics = await cdp.send("Performance.getMetrics");
  const finalCdpSeconds = metricValue(finalMetrics.metrics, "Timestamp");
  const trace = await stopAndReadTrace(cdp);
  traceStarted = false;
  const traceWallMilliseconds = performance.now() - traceWallStartedAt;
  const analysis = analyzeTrace(trace.data.traceEvents ?? [], final.marks);
  const network = analyzeNetwork(networkTransfers, readyCdpSeconds, finalCdpSeconds);
  const domStable = initial.domNodeCount === final.domNodeCount && initial.leafCount === final.leafCount &&
    initial.debugIdentityAssertion && final.debugIdentityAssertion && final.stableNodeReferences &&
    initial.inlineTransformCount === candidateStarCount && final.inlineTransformCount === candidateStarCount &&
    initial.inlinePositionCount === 0 && final.inlinePositionCount === 0 &&
    final.wrapperCount === 0 && final.leafIdCount === 0 && final.leafDataAttributeCount === 0;
  const transitionPresentationGapMaximumMilliseconds = Math.max(0,
    ...final.stats.transitions.map((transition) => transition.presentationGapMilliseconds));
  const transitionPublishDurationMaximumMilliseconds = Math.max(0,
    ...final.stats.transitions.map((transition) => transition.publishDurationMilliseconds));
  const transitionMainThreadTaskMaximumMilliseconds = Math.max(0,
    ...analysis.configurationTransitions.map(
      (transition) => transition.enclosingMainThreadTaskMilliseconds ?? 0));
  const refreshIntervalEstimateMilliseconds = final.stats.cadence.p50Milliseconds;
  const cadenceP95RefreshMultiples = refreshIntervalEstimateMilliseconds === 0 ? null :
    final.stats.cadence.p95Milliseconds / refreshIntervalEstimateMilliseconds;
  const measuredPublicationCount = final.stats.appliedFrameCount - initial.stats.appliedFrameCount;
  const presentationPublicationDelta =
    analysis.presentation.distinctFrameCount - measuredPublicationCount;
  const appLongTasksDuringMeasurement = final.longTasks.filter((task) =>
    task.startTime >= initial.measurementStartTime);
  const acceptance = Object.freeze({
    atLeastOneBankTransition: final.stats.preparedBankSwitchCount >= 1,
    tracesEveryConfigurationTransition:
      final.stats.preparedConfigurationSwitchCount >= expectedConfigurationTransitions &&
      final.stats.transitions.length === final.stats.preparedConfigurationSwitchCount,
    noTransitionMainThreadTaskAbove20Milliseconds: transitionMainThreadTaskMaximumMilliseconds <= 20,
    noTransitionPresentationGapAboveTwoRefreshIntervals:
      transitionPresentationGapMaximumMilliseconds <= prepared.cadence.frameMilliseconds * 2.1,
    cadenceP95NearOneRefreshInterval: cadenceP95RefreshMultiples !== null && cadenceP95RefreshMultiples <= 1.5,
    noDomGrowthOrIdentityChange: domStable,
    noPlaybackFrameOrLookaheadBookkeepingAllocations: final.stats.runtimeFrameAllocationCount === 0 &&
      final.stats.runtimeLoaderBookkeepingAllocationCount === 0,
    preparedSnapshotAvoidedInitialDomRewrite: initial.stats.initialSnapshotReuseCount === 1 &&
      initial.stats.initialSnapshotDomWriteCount === 0,
    noNoopSchedulerCallbacks: final.stats.schedulerNoopCallbackCount === 0,
    noCoalescedPresentationFeedback: analysis.presentation.duplicateTimestampCount === 0 &&
      analysis.presentation.nearZeroIntervalCount === 0 &&
      analysis.presentation.inconsistentDuplicateFrameTimestampCount === 0,
    oneDistinctPresentationPerPublication: Math.abs(presentationPublicationDelta) <= 2,
    noRuntimePhysicsRasterizationMatrixFormattingOrDomReconstruction: [
      final.stats.runtimePhysicsCount,
      final.stats.runtimeRasterizationCount,
      final.stats.runtimeMatrixFormattingCount,
      final.stats.animationPathTransformFormattingCount,
      final.stats.runtimeDomReconstructionCount,
    ].every((value) => value === 0),
    noPreparedStreamingWaits: final.stats.preparedBlockWaitCount === 0 &&
      final.stats.preparedBankWaitCount === 0,
    traceReportedNoDataLoss: trace.completion.dataLossOccurred === false,
    noBrowserErrors: errors.length === 0 && final.errors.length === 0,
  });
  const report = Object.freeze({
    schema: "cssblackhole-headless-performance-trace@1",
    capturedAt: new Date().toISOString(),
    route,
    candidate: Object.freeze({ traceVariant, profileId: traceProfileId,
      configurationCount: candidateConfigurationCount, starCount: candidateStarCount,
      transportSeed: candidateTransportSeed,
      viewport: traceViewport }),
    environment: Object.freeze({ browser: "Google Chrome", channel: "chrome", version: browserVersion,
      headless: true, deviceScaleFactor: 1 }),
    duration: Object.freeze({ requestedMeasurementMilliseconds: measurementMilliseconds,
      observedTraceWallMilliseconds: Number(traceWallMilliseconds.toFixed(3)),
      presentationSlotHoldSeconds,
      presentationSlotDurationSeconds,
      coveredConfigurationTransitions: final.stats.preparedConfigurationSwitchCount,
      bankSeconds: prepared.cadence.bankSeconds, coveredBankTransitions: final.stats.preparedBankSwitchCount }),
    dom: Object.freeze({ initialDomNodeCount: initial.domNodeCount, finalDomNodeCount: final.domNodeCount,
      initialLeafCount: initial.leafCount, finalLeafCount: final.leafCount,
      perPointWrapperCount: final.wrapperCount, pointIdCount: final.leafIdCount,
      pointDataAttributeCount: final.leafDataAttributeCount,
      initialInlineTranslateCount: initial.inlineTranslateCount,
      finalInlineTranslateCount: final.inlineTranslateCount,
      initialInlineTransformCount: initial.inlineTransformCount,
      finalInlineTransformCount: final.inlineTransformCount,
      initialInlinePositionCount: initial.inlinePositionCount,
      finalInlinePositionCount: final.inlinePositionCount,
      debugIdentityAssertion: final.debugIdentityAssertion,
      stableNodeReferences: final.stableNodeReferences, stable: domStable }),
    playback: final.stats,
    publicationEfficiency: Object.freeze({
      measuredPublicationCount,
      ...analysis.presentation,
      presentationPublicationDelta,
      distinctPresentationsPerPublication: measuredPublicationCount === 0 ? null :
        Number((analysis.presentation.distinctFrameCount / measuredPublicationCount).toFixed(6)),
    }),
    cadenceInterpretation: Object.freeze({ estimatedRefreshIntervalMilliseconds: refreshIntervalEstimateMilliseconds,
      cadenceP95RefreshMultiples: cadenceP95RefreshMultiples === null ? null :
        Number(cadenceP95RefreshMultiples.toFixed(3)) }),
    transitions: Object.freeze({ presentationGapMaximumMilliseconds: transitionPresentationGapMaximumMilliseconds,
      publishDurationMaximumMilliseconds: transitionPublishDurationMaximumMilliseconds,
      mainThreadTaskMaximumMilliseconds: transitionMainThreadTaskMaximumMilliseconds,
      detail: analysis.configurationTransitions }),
    network,
    timeline: Object.freeze({ rendererMainThread: analysis.rendererMainThread,
      traceCompletion: Object.freeze({ dataLossOccurred: trace.completion.dataLossOccurred,
        traceFormat: trace.completion.traceFormat, streamCompression: trace.completion.streamCompression }),
      layerize: analysis.layerize, commit: analysis.commit, paint: analysis.paint, gc: analysis.gc,
      longMainThreadTasks: analysis.longMainThreadTasks,
      performanceObserverLongTasks: appLongTasksDuringMeasurement }),
    performanceMetrics: Object.freeze({ initial: metricsObject(readyMetrics.metrics),
      final: metricsObject(finalMetrics.metrics),
      delta: metricsDelta(readyMetrics.metrics, finalMetrics.metrics) }),
    errors: Object.freeze([...errors, ...final.errors]),
    droppedFrameCauses: final.stats.droppedFrameCauses,
    acceptance,
    accepted: Object.values(acceptance).every(Boolean),
    tracePath,
  });
  await writeFile(tracePath, gzipSync(`${JSON.stringify(trace.data)}\n`, { level: 9 }));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, tracePath, accepted: report.accepted, acceptance,
    playback: report.playback, publicationEfficiency: report.publicationEfficiency,
    transitions: report.transitions, network: report.network,
    timeline: report.timeline }, null, 2));
  await context.close();
} finally {
  if (traceStarted && cdp) await stopAndReadTrace(cdp).catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await stopServer();
  await writeFile(serverLogPath, serverOutput).catch(() => undefined);
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`BlackHole Vite exited early: ${server.exitCode}`);
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("BlackHole Vite did not become ready");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  await Promise.race([
    new Promise((resolvePromise) => server.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (server.exitCode === null) {
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
}

async function stopAndReadTrace(session) {
  const complete = new Promise((resolvePromise) => session.once("Tracing.tracingComplete", resolvePromise));
  await session.send("Tracing.end");
  const completion = await complete;
  const { stream } = completion;
  let json = "";
  for (;;) {
    const chunk = await session.send("IO.read", { handle: stream });
    json += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data;
    if (chunk.eof) break;
  }
  await session.send("IO.close", { handle: stream });
  return { data: JSON.parse(json), completion };
}

function analyzeNetwork(transfers, readyCdpSeconds, finalCdpSeconds) {
  const normalized = transfers.filter((transfer) => transfer.finishedAtSeconds <= finalCdpSeconds).map((transfer) => {
    const url = new URL(transfer.url);
    const bank = url.pathname.match(/\/cssblackhole\/banks\/bank-(\d\d)-/u);
    return {
      url: transfer.url,
      path: url.pathname,
      type: transfer.type,
      status: transfer.response?.status ?? null,
      mimeType: transfer.response?.mimeType ?? null,
      encodedDataLength: transfer.encodedDataLength,
      startedRelativeToReadyMilliseconds: Number(((transfer.startedAtSeconds - readyCdpSeconds) * 1000).toFixed(3)),
      finishedRelativeToReadyMilliseconds: Number(((transfer.finishedAtSeconds - readyCdpSeconds) * 1000).toFixed(3)),
      phase: transfer.finishedAtSeconds <= readyCdpSeconds ? "cold-before-ready" : "future-after-ready",
      preparedBank: bank ? { bankIndex: Number(bank[1]) } : null,
    };
  });
  const cold = normalized.filter((entry) => entry.phase === "cold-before-ready");
  const future = normalized.filter((entry) => entry.phase === "future-after-ready");
  const prepared = normalized.filter((entry) => entry.preparedBank);
  const coldPrepared = prepared.filter((entry) => entry.phase === "cold-before-ready");
  const futurePrepared = prepared.filter((entry) => entry.phase === "future-after-ready");
  return Object.freeze({
    transferAccounting: "Chrome DevTools Protocol Network.loadingFinished.encodedDataLength",
    coldPayload: summarizeTransfers(cold),
    coldPreparedBanks: summarizeTransfers(coldPrepared),
    futureTraffic: summarizeTransfers(future),
    futurePreparedBanks: summarizeTransfers(futurePrepared),
    preparedTrafficByBank: groupPreparedByBank(prepared),
    transferCount: normalized.length,
    transfers: normalized,
  });
}

function summarizeTransfers(entries) {
  return Object.freeze({ requestCount: entries.length,
    encodedBytes: entries.reduce((sum, entry) => sum + entry.encodedDataLength, 0) });
}

function groupPreparedByBank(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.phase}:bank-${entry.preparedBank.bankIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = { phase: entry.phase, bankIndex: entry.preparedBank.bankIndex, requestCount: 0,
        encodedBytes: 0, firstStartRelativeToReadyMilliseconds: entry.startedRelativeToReadyMilliseconds,
        lastFinishRelativeToReadyMilliseconds: entry.finishedRelativeToReadyMilliseconds };
      groups.set(key, group);
    }
    group.requestCount += 1;
    group.encodedBytes += entry.encodedDataLength;
    group.firstStartRelativeToReadyMilliseconds = Math.min(group.firstStartRelativeToReadyMilliseconds,
      entry.startedRelativeToReadyMilliseconds);
    group.lastFinishRelativeToReadyMilliseconds = Math.max(group.lastFinishRelativeToReadyMilliseconds,
      entry.finishedRelativeToReadyMilliseconds);
  }
  return Array.from(groups.values()).sort((a, b) => a.bankIndex - b.bankIndex || a.phase.localeCompare(b.phase));
}

function analyzeTrace(events, pageMarks) {
  const threadNames = new Map();
  for (const event of events) {
    if (event.ph === "M" && event.name === "thread_name") {
      threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? event.args?.data?.name ?? "");
    }
  }
  const candidates = Array.from(threadNames, ([key, name]) => ({ key, name })).filter((item) =>
    item.name === "CrRendererMain");
  let selected = null;
  let selectedScore = -1;
  for (const candidate of candidates) {
    const [pid, tid] = candidate.key.split(":").map(Number);
    const score = events.reduce((count, event) => count + (event.pid === pid && event.tid === tid &&
      event.ph === "X" && /^(?:RunTask|Paint|FunctionCall)$/u.test(event.name) ? 1 : 0), 0);
    if (score > selectedScore) { selected = { pid, tid, name: candidate.name }; selectedScore = score; }
  }
  if (!selected) throw new Error("Chrome trace did not expose a CrRendererMain thread");
  const main = events.filter((event) => event.pid === selected.pid && event.tid === selected.tid &&
    event.ph === "X" && Number.isFinite(event.dur));
  const rendererProcess = events.filter((event) => event.pid === selected.pid && event.ph === "X" &&
    Number.isFinite(event.dur));
  const tasks = main.filter((event) => event.name === "RunTask" || event.name.endsWith("::RunTask"));
  const longTasks = tasks.filter((event) => event.dur >= 50_000).map((event) => ({
    startTraceMicroseconds: event.ts,
    durationMilliseconds: Number((event.dur / 1000).toFixed(3)),
    dominantContainedEvents: dominantEvents(main, event),
  }));
  const traceMarks = events.filter((event) => String(event.cat ?? "").includes("blink.user_timing"));
  const markTimes = new Map();
  for (const event of traceMarks) {
    const name = traceEventMarkName(event);
    if (name?.startsWith("cssblackhole-")) markTimes.set(name, event.ts);
  }
  const startPageMark = pageMarks.find((mark) => mark.name === "cssblackhole-trace-measurement-start")?.startTime;
  const startTraceMark = markTimes.get("cssblackhole-trace-measurement-start");
  const endTraceMark = markTimes.get("cssblackhole-trace-measurement-end");
  const observedPresentationEvents = events.filter((event) =>
    event.pid === selected.pid && event.tid === selected.tid &&
    event.name === "AnimationFrame::Presentation" &&
    (startTraceMark === undefined || event.ts >= startTraceMark) &&
    (endTraceMark === undefined || event.ts <= endTraceMark));
  const validPresentationEvents = observedPresentationEvents.filter((event) => {
    const beginFrameId = event.args?.begin_frame_id;
    return Number.isFinite(beginFrameId?.source_id) && Number.isFinite(beginFrameId?.sequence_number) &&
      !(beginFrameId.source_id === 0 && beginFrameId.sequence_number === 0);
  });
  const presentationFrames = new Map();
  for (const event of validPresentationEvents) {
    const beginFrameId = event.args.begin_frame_id;
    const key = `${beginFrameId.source_id}:${beginFrameId.sequence_number}`;
    const existing = presentationFrames.get(key);
    if (existing) {
      existing.timestamps.add(event.ts);
      existing.traceRecordCount += 1;
    } else {
      presentationFrames.set(key, {
        timestamp: event.ts,
        timestamps: new Set([event.ts]),
        traceRecordCount: 1,
      });
    }
  }
  const distinctPresentationFrames = [...presentationFrames.values()]
    .sort((left, right) => left.timestamp - right.timestamp);
  const presentationTimestamps = distinctPresentationFrames.map((frame) => frame.timestamp);
  const uniquePresentationTimestamps = [...new Set(presentationTimestamps)];
  const presentationIntervals = uniquePresentationTimestamps.slice(1)
    .map((timestamp, index) => (timestamp - uniquePresentationTimestamps[index]) / 1000);
  const configurationPageMarks = pageMarks.filter((mark) =>
    /^cssblackhole-configuration-transition-\d+-published$/u.test(mark.name));
  const configurationTransitions = configurationPageMarks.map((publishedMark) => {
    const match = publishedMark.name.match(/transition-(\d+)-published/u);
    const ordinal = Number(match[1]);
    const startName = `cssblackhole-configuration-transition-${ordinal}-start`;
    const stepPageMarks = pageMarks.filter((mark) =>
      new RegExp(`^cssblackhole-configuration-transition-${ordinal}-step-(\\d+)-published$`, "u")
        .test(mark.name));
    const measuredMarks = stepPageMarks.length > 0 ? stepPageMarks : [publishedMark];
    const measuredTasks = measuredMarks.map((mark) => {
      let traceTimestamp = markTimes.get(mark.name);
      if (traceTimestamp === undefined && startTraceMark !== undefined && startPageMark !== undefined) {
        traceTimestamp = startTraceMark + ((mark.startTime - startPageMark) * 1000);
      }
      const task = traceTimestamp === undefined ? null : tasks.find((candidate) =>
        candidate.ts <= traceTimestamp && candidate.ts + candidate.dur >= traceTimestamp);
      return { mark, task };
    });
    const slowest = measuredTasks.reduce((selectedTask, candidate) =>
      (candidate.task?.dur ?? -1) > (selectedTask.task?.dur ?? -1) ? candidate : selectedTask,
    { mark: { name: startName }, task: null });
    return Object.freeze({ ordinal,
      publishedAtPageMilliseconds: Number(publishedMark.startTime.toFixed(3)),
      handoffStepCount: measuredMarks.length,
      slowestHandoffStep: slowest.mark.name,
      enclosingMainThreadTaskMilliseconds: slowest.task ?
        Number((slowest.task.dur / 1000).toFixed(3)) : null,
      dominantContainedEvents: slowest.task ? dominantEvents(main, slowest.task) : [],
      handoffSteps: Object.freeze(measuredTasks.map(({ mark, task }) => Object.freeze({
        name: mark.name,
        publishedAtPageMilliseconds: Number(mark.startTime.toFixed(3)),
        enclosingMainThreadTaskMilliseconds: task ? Number((task.dur / 1000).toFixed(3)) : null,
      }))),
    });
  });
  return Object.freeze({
    rendererMainThread: selected,
    layerize: summarizeTimeline(main.filter((event) => /Layerize|UpdateLayerTree/u.test(event.name))),
    commit: summarizeTimeline(rendererProcess.filter((event) =>
      /^(?:Commit|CommitLoad|CompositeLayers|UpdateLayerTree)$/u.test(event.name))),
    paint: summarizeTimeline(main.filter((event) => /^(?:PrePaint|Paint|PaintImage)$/u.test(event.name))),
    gc: summarizeTimeline(main.filter((event) => /^(?:MinorGC|MajorGC)$/u.test(event.name))),
    longMainThreadTasks: longTasks,
    presentation: Object.freeze({
      rawEventCount: observedPresentationEvents.length,
      ignoredSentinelEventCount: observedPresentationEvents.length - validPresentationEvents.length,
      validRawEventCount: validPresentationEvents.length,
      distinctFrameCount: distinctPresentationFrames.length,
      duplicateTraceRecordCount: validPresentationEvents.length - distinctPresentationFrames.length,
      inconsistentDuplicateFrameTimestampCount: distinctPresentationFrames
        .filter((frame) => frame.timestamps.size > 1).length,
      uniqueTimestampCount: uniquePresentationTimestamps.length,
      duplicateTimestampCount: presentationTimestamps.length - uniquePresentationTimestamps.length,
      nearZeroIntervalCount: presentationIntervals.filter((interval) => interval > 0 && interval < 5).length,
      p50IntervalMilliseconds: percentile([...presentationIntervals].sort((a, b) => a - b), 0.5),
      p95IntervalMilliseconds: percentile([...presentationIntervals].sort((a, b) => a - b), 0.95),
      maximumIntervalMilliseconds: presentationIntervals.length === 0 ? 0 :
        Number(Math.max(...presentationIntervals).toFixed(3)),
    }),
    configurationTransitions,
  });
}

function traceEventMarkName(event) {
  if (typeof event.name === "string" && event.name.startsWith("cssblackhole-")) return event.name;
  for (const candidate of [event.args?.data?.name, event.args?.name]) {
    if (typeof candidate === "string" && candidate.startsWith("cssblackhole-")) return candidate;
  }
  return null;
}

function dominantEvents(main, task) {
  const contained = main.filter((event) => event !== task && event.ts >= task.ts &&
    event.ts + event.dur <= task.ts + task.dur && event.dur > 0);
  const grouped = new Map();
  for (const event of contained) grouped.set(event.name, (grouped.get(event.name) ?? 0) + event.dur);
  return Array.from(grouped, ([name, duration]) => ({ name,
    accumulatedMilliseconds: Number((duration / 1000).toFixed(3)) }))
    .sort((a, b) => b.accumulatedMilliseconds - a.accumulatedMilliseconds).slice(0, 8);
}

function summarizeTimeline(events) {
  const durations = events.map((event) => event.dur / 1000).sort((a, b) => a - b);
  const names = Object.create(null);
  for (const event of events) names[event.name] = (names[event.name] ?? 0) + 1;
  return Object.freeze({ count: events.length,
    totalMilliseconds: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(3)),
    p95Milliseconds: percentile(durations, 0.95),
    maximumMilliseconds: durations.length === 0 ? 0 : Number(durations.at(-1).toFixed(3)),
    eventNames: names });
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)].toFixed(3));
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? 0;
}

function countTransitionStarts(measurementSeconds, holdSeconds, durationSeconds) {
  let count = 0;
  let elapsed = 0;
  let slotIndex = 0;
  while (elapsed + holdSeconds[slotIndex] < measurementSeconds) {
    count += 1;
    elapsed += durationSeconds[slotIndex];
    slotIndex = (slotIndex + 1) % durationSeconds.length;
  }
  return count;
}

function metricsObject(metrics) {
  return Object.freeze(Object.fromEntries(metrics.map((metric) => [metric.name, metric.value])));
}

function metricsDelta(initial, final) {
  const before = metricsObject(initial);
  return Object.freeze(Object.fromEntries(final.map((metric) => [metric.name,
    Number((metric.value - (before[metric.name] ?? 0)).toFixed(6))])));
}
