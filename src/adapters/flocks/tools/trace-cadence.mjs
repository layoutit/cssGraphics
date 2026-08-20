#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  analyzeTrace,
  compareAnalyses,
  loadTrace,
  renderMarkdown,
} from "../../../../scripts/frame-sleuth.mjs";
import { captureFrameSleuthTrace } from "../../../../scripts/frame-sleuth-trace.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const options = parseOptions(process.argv.slice(2));
const profile = options.profile === "desktop"
  ? Object.freeze({ id: "desktop", viewport: Object.freeze({ width: 1280, height: 800 }), rootCount: 324, leafCount: 1_944 })
  : Object.freeze({ id: "mobile", viewport: Object.freeze({ width: 390, height: 844 }), rootCount: 164, leafCount: 984 });
const outputRoot = resolve(repositoryRoot, `bench/results/cssflocks/cadence/${profile.id}`);
const baselineTracePath = resolve(repositoryRoot, `bench/results/cssflocks/baseline/${profile.id}/Trace.json.gz`);
const port = 4195;
const url = `http://127.0.0.1:${port}/flocks/?window=source-114s`;
const thresholds = Object.freeze({
  presentedFrameP95Milliseconds: 22,
  maximumDrawFrameGapMilliseconds: 33.3,
  maximumAppTaskMilliseconds: 50,
  minimumSourcePublicationRateHz: 59.5,
  maximumSourcePublicationRateHz: 60.5,
});

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
let serverOutput = "";
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });

try {
  await waitForServer(url, server);
  const runs = [];
  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const stem = runIndex === 0 ? "Trace" : `Trace-${String(runIndex + 1).padStart(2, "0")}`;
    const capture = await captureFrameSleuthTrace({
      url,
      output: resolve(outputRoot, `${stem}.json.gz`),
      durationMs: 12_000,
      startupMs: 4_000,
      headless: true,
      screenshots: false,
      lean: true,
      frameTimeline: true,
      frameSleuthFilter: true,
      width: profile.viewport.width,
      height: profile.viewport.height,
    });
    const analysis = (await loadAnalysis(capture.reports.analysis)).steady;
    const probe = await captureSteadyProbe({ profile, url });
    const gates = evaluateRun({ analysis, capture, probe, profile, thresholds });
    const report = Object.freeze({
      run: runIndex + 1,
      trace: capture.trace,
      rawTrace: capture.rawTrace,
      reports: capture.reports,
      cadence: Object.freeze({
        presentedFrame: analysis.timeline.stats,
        drawFrame: analysis.cadence.drawFrame,
        requestAnimationFrame: analysis.cadence.requestAnimationFrame,
        styleAndLayout: analysis.cadence.styleAndLayout,
      }),
      longTasks: analysis.longTasks,
      workload: Object.freeze({
        UpdateLayoutTree: analysis.workload.named.UpdateLayoutTree,
        Paint: analysis.workload.named.Paint,
        RasterTask: analysis.workload.named.RasterTask,
        Layerize: analysis.workload.named.Layerize,
      }),
      probe,
      gates,
    });
    runs.push(report);
    await writeFile(resolve(outputRoot, `run-${String(runIndex + 1).padStart(2, "0")}.json`), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`run ${runIndex + 1}/${options.runs}: presented p95 ${analysis.timeline.stats.p95Ms} ms, DrawFrame max ${analysis.cadence.drawFrame.maxMs} ms, publication ${probe.sourcePublicationRateHz} Hz\n`);
  }

  const baseline = analyzeTrace(await loadTrace(baselineTracePath), {
    top: 5,
    url: "/flocks/",
    startMs: 4_000,
    question: "what work caused the failing Flocks cadence?",
  });
  const finalAnalysis = (await loadAnalysis(runs[0].reports.analysis)).steady;
  const comparison = compareAnalyses(baseline, finalAnalysis);
  await writeFile(resolve(outputRoot, "before-after.md"), renderMarkdown(baseline, comparison));
  await writeFile(resolve(outputRoot, "before-after.json"), `${JSON.stringify({
    baselineTrace: baselineTracePath,
    finalTrace: runs[0].trace.path,
    baseline: summarizeAnalysis(baseline),
    final: summarizeAnalysis(finalAnalysis),
    comparison,
  }, null, 2)}\n`);

  const report = Object.freeze({
    schema: "cssflocks-desktop-cadence-qualification@1",
    capturedAt: new Date().toISOString(),
    browser: "fresh installed Google Chrome via Playwright channel=chrome",
    profile: profile.id,
    viewport: profile.viewport,
    explicitStartupWindow: "source-114s",
    thresholds,
    runs,
    allRunsPass: runs.every((run) => Object.values(run.gates).every(Boolean)),
    beforeAfter: Object.freeze({
      markdown: resolve(outputRoot, "before-after.md"),
      json: resolve(outputRoot, "before-after.json"),
    }),
  });
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.allRunsPass) throw new Error(`Flocks cadence qualification failed: ${JSON.stringify(runs.map(({ run, gates }) => ({ run, gates })))}`);
  console.log(JSON.stringify({
    report: resolve(outputRoot, "report.json"),
    beforeAfter: report.beforeAfter,
    runs: runs.map(({ run, cadence, longTasks, probe }) => ({
      run,
      presentedFrameP95Milliseconds: cadence.presentedFrame.p95Ms,
      maximumDrawFrameGapMilliseconds: cadence.drawFrame.maxMs,
      maximumAppTaskMilliseconds: longTasks.maxMs ?? 0,
      sourcePublicationRateHz: probe.sourcePublicationRateHz,
    })),
  }, null, 2));
} finally {
  await writeFile(resolve(outputRoot, "server.log"), serverOutput);
  await stopServer(server);
}

async function captureSteadyProbe({ profile: selectedProfile, url: targetUrl }) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let context;
  try {
    context = await browser.newContext({ viewport: selectedProfile.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    await page.waitForTimeout(4_000);
    const before = await readProbeState(page, true);
    await page.waitForTimeout(6_000);
    const after = await readProbeState(page, false);
    const elapsedMilliseconds = after.atMilliseconds - before.atMilliseconds;
    const statsDelta = subtractStats(before.stats, after.stats, [
      "applyCount",
      "shapeTransformWrites",
      "rootColorWrites",
      "schedulerFrameCallbackCount",
      "schedulerLateResetCount",
      "blockSwitchCount",
      "blockWaitCount",
    ]);
    return Object.freeze({
      elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
      before: before.stats,
      after: after.stats,
      statsDelta,
      sourcePublicationRateHz: Number((statsDelta.applyCount / elapsedMilliseconds * 1_000).toFixed(3)),
      rootColorPublicationRateHz: Number((statsDelta.rootColorWrites / selectedProfile.rootCount / elapsedMilliseconds * 1_000).toFixed(3)),
      sameRootIdentity: after.sameRootIdentity,
      sameLeafIdentity: after.sameLeafIdentity,
      rootCount: after.rootCount,
      leafCount: after.leafCount,
      errors,
    });
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close();
  }
}

async function readProbeState(page, rememberIdentity) {
  return page.evaluate((remember) => {
    const roots = [...document.querySelectorAll("body > .polycss-camera > .polycss-scene > div")];
    const leaves = roots.flatMap((root) => [...root.children]);
    if (remember) window.__cssFlocksCadenceIdentity = { roots, leaves };
    const identity = window.__cssFlocksCadenceIdentity;
    return {
      atMilliseconds: performance.now(),
      stats: window.__cssFlocksDebug.stats(),
      rootCount: roots.length,
      leafCount: leaves.length,
      sameRootIdentity: roots.length === identity.roots.length && roots.every((root, index) => root === identity.roots[index]),
      sameLeafIdentity: leaves.length === identity.leaves.length && leaves.every((leaf, index) => leaf === identity.leaves[index]),
    };
  }, rememberIdentity);
}

function subtractStats(before, after, keys) {
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, after[key] - before[key]])));
}

function evaluateRun({ analysis, capture, probe, profile: selectedProfile, thresholds: limits }) {
  return Object.freeze({
    traceHasNoErrors: capture.errors.length === 0,
    presentedFrameP95WithinBudget: analysis.timeline.stats.p95Ms <= limits.presentedFrameP95Milliseconds,
    drawFrameEvidenceAvailable: analysis.cadence.drawFrame.eventCount >= 2,
    drawFrameHasNoGapAboveBudget: analysis.cadence.drawGapsAboveMs["33.3"] === 0 && analysis.cadence.drawFrame.maxMs <= limits.maximumDrawFrameGapMilliseconds,
    noAppLongTask: analysis.longTasks.available && analysis.longTasks.count === 0,
    exactFullDom: probe.rootCount === selectedProfile.rootCount && probe.leafCount === selectedProfile.leafCount,
    stableDomIdentity: probe.sameRootIdentity && probe.sameLeafIdentity && probe.after.retainedDomStable === true && probe.after.runtimeDomGrowth === false,
    noBlockWait: probe.statsDelta.blockWaitCount === 0,
    noSteadySchedulerLateReset: probe.statsDelta.schedulerLateResetCount === 0,
    everySourceTransformStatePublished: probe.statsDelta.shapeTransformWrites === probe.statsDelta.applyCount * selectedProfile.rootCount,
    sourcePublicationRateWithinBudget: probe.sourcePublicationRateHz >= limits.minimumSourcePublicationRateHz && probe.sourcePublicationRateHz <= limits.maximumSourcePublicationRateHz,
    boundedFlatColorPublication: probe.after.colorPublicationRateHz === 12,
    noBrowserProbeErrors: probe.errors.length === 0,
  });
}

function summarizeAnalysis(analysis) {
  return Object.freeze({
    presentedFrame: analysis.timeline.stats,
    drawFrame: analysis.cadence.drawFrame,
    requestAnimationFrame: analysis.cadence.requestAnimationFrame,
    styleAndLayout: analysis.cadence.styleAndLayout,
    longTasks: analysis.longTasks,
    workload: Object.freeze({
      UpdateLayoutTree: analysis.workload.named.UpdateLayoutTree,
      Paint: analysis.workload.named.Paint,
      RasterTask: analysis.workload.named.RasterTask,
      Layerize: analysis.workload.named.Layerize,
    }),
  });
}

async function loadAnalysis(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseOptions(argv) {
  let profile = "desktop";
  let runs = 3;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--profile") profile = argv[++index];
    else if (argument === "--runs") runs = Number(argv[++index]);
    else throw new Error(`Unknown Flocks cadence option: ${argument}`);
  }
  if (!new Set(["desktop", "mobile"]).has(profile)) throw new Error("Flocks cadence profile must be desktop or mobile");
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 5) throw new Error("Flocks cadence runs must be an integer from 1 to 5");
  return Object.freeze({ profile, runs });
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks cadence server exited early: ${child.exitCode}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks cadence server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
