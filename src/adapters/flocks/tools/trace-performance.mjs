#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { captureFrameSleuthTrace } from "../../../../scripts/frame-sleuth-trace.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssflocks/baseline");
const port = 4187;
const url = `http://127.0.0.1:${port}/flocks/?palette=rotate-120`;
const profiles = Object.freeze([
  Object.freeze({ id: "desktop", viewport: Object.freeze({ width: 1280, height: 800 }) }),
  Object.freeze({ id: "mobile", viewport: Object.freeze({ width: 390, height: 844 }) }),
]);
const resumeTraces = process.argv.includes("--resume-traces");

await mkdir(resultRoot, { recursive: true });
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });

try {
  await waitForServer(url, server);
  const coldStarts = resumeTraces ? await readColdStarts() : {};
  if (!resumeTraces) {
    for (const profile of profiles) {
      const profileRoot = resolve(resultRoot, profile.id);
      await mkdir(profileRoot, { recursive: true });
      coldStarts[profile.id] = [];
      for (let runIndex = 0; runIndex < 3; runIndex += 1) {
        const report = await captureColdStart(profile, runIndex, profileRoot);
        coldStarts[profile.id].push(report);
        process.stdout.write(`cold ${profile.id} ${runIndex + 1}/3: ${report.readyMilliseconds} ms\n`);
      }
    }
  }

  const terminalWrap = resumeTraces
    ? JSON.parse(await readFile(resolve(resultRoot, "terminal-wrap/report.json"), "utf8"))
    : await captureTerminalWrap(profiles[0]);
  if (!resumeTraces) process.stdout.write(`terminal wrap observed at ${terminalWrap.elapsedMilliseconds} ms\n`);

  const traces = {};
  for (const profile of profiles) {
    const output = resolve(resultRoot, profile.id, "Trace.json.gz");
    traces[profile.id] = await captureFrameSleuthTrace({
      url,
      output,
      durationMs: 12_000,
      startupMs: 2_000,
      headless: true,
      screenshots: false,
      lean: true,
      frameSleuthFilter: true,
      width: profile.viewport.width,
      height: profile.viewport.height,
    });
    process.stdout.write(`trace ${profile.id}: ${output}\n`);
  }

  const catalogs = await readCatalogBudgets();
  const summary = Object.freeze({
    schema: "cssflocks-failing-baseline@1",
    capturedAt: new Date().toISOString(),
    browser: "installed Google Chrome via Playwright channel=chrome",
    url,
    historicalAcceptedStartingPoint: Object.freeze({
      desktopPreparedBlockEncodedBytes: 4_792_091,
      mobilePreparedBlockEncodedBytes: 2_381_303,
      coldReadyMilliseconds: 1_902.68,
      shortObservationAppliedFrames: 105,
      shortObservationSchedulerLateResets: 21,
    }),
    regeneratedAfterNativeSourceQualification: catalogs,
    coldStarts: Object.freeze(Object.fromEntries(Object.entries(coldStarts).map(([id, runs]) => [id, Object.freeze({
      runs: Object.freeze(runs),
      medianReadyMilliseconds: median(runs.map((run) => run.readyMilliseconds)),
      medianInitialEncodedTransferBytes: median(runs.map((run) => run.network.encodedDataLength)),
      medianDecodedBytes: median(runs.map((run) => run.stats.cumulativeDecodedBytes)),
      medianPreparedCssStringBytes: median(runs.map((run) => run.stats.residentPreparedCssStringBytes)),
      maximumHeapUsedBytes: Math.max(...runs.map((run) => run.heap.usedSize)),
    })]))),
    terminalWrap,
    traces: Object.freeze(Object.fromEntries(Object.entries(traces).map(([id, capture]) => [id, Object.freeze({
      trace: capture.trace,
      rawTrace: capture.rawTrace,
      cadence: capture.cadence,
      worstSteadyFrame: capture.worstSteadyFrame,
      errors: capture.errors,
      reports: capture.reports,
    })]))),
    verdict: "failing-baseline-only",
  });
  await writeFile(resolve(resultRoot, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(resolve(resultRoot, "report.md"), renderMarkdown(summary));
  process.stdout.write(`${JSON.stringify({
    report: resolve(resultRoot, "report.json"),
    desktopMedianReadyMilliseconds: summary.coldStarts.desktop.medianReadyMilliseconds,
    mobileMedianReadyMilliseconds: summary.coldStarts.mobile.medianReadyMilliseconds,
    terminalWrapCount: summary.terminalWrap.after.terminalWrapCount,
  }, null, 2)}\n`);
} finally {
  await writeFile(resolve(resultRoot, "server.log"), serverOutput);
  await stopServer(server);
}

async function captureColdStart(profile, runIndex, profileRoot) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let context;
  try {
    context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const cdp = await context.newCDPSession(page);
    await Promise.all([
      cdp.send("Network.enable"),
      cdp.send("Performance.enable"),
      cdp.send("Network.setCacheDisabled", { cacheDisabled: true }),
    ]);
    const network = { encodedDataLength: 0, requestCount: 0 };
    cdp.on("Network.loadingFinished", (event) => {
      network.encodedDataLength += event.encodedDataLength ?? 0;
      network.requestCount += 1;
    });
    const startedAt = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    const readyMilliseconds = Number((performance.now() - startedAt).toFixed(2));
    await page.waitForTimeout(50);
    const [pageState, heap, performanceMetrics] = await Promise.all([
      page.evaluate(() => ({
        stats: window.__cssFlocksDebug.stats(),
        resources: performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          duration: entry.duration,
        })),
        navigation: performance.getEntriesByType("navigation")[0]?.toJSON() ?? null,
        dom: {
          cameraCount: document.querySelectorAll("body > .polycss-camera").length,
          rootCount: document.querySelectorAll("body > .polycss-camera > .polycss-scene > div").length,
          leafCount: document.querySelectorAll("body > .polycss-camera > .polycss-scene > div > *").length,
        },
      })),
      cdp.send("Runtime.getHeapUsage"),
      cdp.send("Performance.getMetrics"),
    ]);
    const screenshotPath = resolve(profileRoot, `cold-${String(runIndex + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: screenshotPath });
    const report = Object.freeze({
      run: runIndex + 1,
      viewport: profile.viewport,
      readyMilliseconds,
      network: Object.freeze({
        encodedDataLength: Math.round(network.encodedDataLength),
        requestCount: network.requestCount,
        resourceTransferSize: Math.round(pageState.resources.reduce((sum, entry) => sum + entry.transferSize, 0)),
        resourceEncodedBodySize: Math.round(pageState.resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0)),
        resourceDecodedBodySize: Math.round(pageState.resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0)),
      }),
      stats: pageState.stats,
      navigation: pageState.navigation,
      dom: pageState.dom,
      heap: Object.freeze({ usedSize: heap.usedSize, embedderHeapUsedSize: heap.embedderHeapUsedSize, backingStorageSize: heap.backingStorageSize }),
      performanceMetrics: Object.freeze(Object.fromEntries(performanceMetrics.metrics.map(({ name, value }) => [name, value]))),
      errors: Object.freeze(errors),
      screenshotPath,
    });
    if (errors.length > 0 || report.stats?.profileId !== profile.id || report.stats?.residentBlockCount !== 3) {
      throw new Error(`Flocks ${profile.id} cold baseline capture failed: ${JSON.stringify(report)}`);
    }
    await writeFile(resolve(profileRoot, `cold-${String(runIndex + 1).padStart(2, "0")}.json`), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close();
  }
}

async function captureTerminalWrap(profile) {
  const outputRoot = resolve(resultRoot, "terminal-wrap");
  const frameRoot = resolve(outputRoot, "frames");
  await mkdir(frameRoot, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let context;
  try {
    context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    const startedAt = performance.now();
    const before = await page.evaluate(() => window.__cssFlocksDebug.stats());
    await page.screenshot({ path: resolve(frameRoot, "frame-000-ready.png") });
    for (let index = 1; index <= 5; index += 1) {
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: resolve(frameRoot, `frame-${String(index).padStart(3, "0")}.png`) });
    }
    await page.evaluate(async () => {
      const debug = window.__cssFlocksDebug;
      debug.pause();
      await debug.seekStreamFrame(debug.stats().streamFrameCount - 1);
    });
    await page.waitForFunction(() => window.__cssFlocksDebug.stats().pendingBlockCount === 0, null, { timeout: 5_000 });
    const seamBefore = await page.evaluate(() => window.__cssFlocksDebug.stats());
    await page.screenshot({ path: resolve(frameRoot, "frame-006-terminal-before.png") });
    const seamAfter = await page.evaluate(async () => window.__cssFlocksDebug.stepFrame());
    await page.screenshot({ path: resolve(frameRoot, "frame-007-terminal-after.png") });
    const terminalImageDelta = await compareScreenshots(
      resolve(frameRoot, "frame-006-terminal-before.png"),
      resolve(frameRoot, "frame-007-terminal-after.png"),
    );
    const visualCoverage = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll("body > .polycss-camera > .polycss-scene > div > *")];
      const rects = leaves.map((leaf) => leaf.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
      const visible = rects.filter((rect) => rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
      return {
        measurableLeafCount: rects.length,
        visibleLeafCount: visible.length,
        clippedLeft: rects.filter((rect) => rect.left < 0).length,
        clippedRight: rects.filter((rect) => rect.right > innerWidth).length,
        clippedTop: rects.filter((rect) => rect.top < 0).length,
        clippedBottom: rects.filter((rect) => rect.bottom > innerHeight).length,
      };
    });
    const report = Object.freeze({
      viewport: profile.viewport,
      elapsedMilliseconds: Number((performance.now() - startedAt).toFixed(2)),
      before,
      seamBefore,
      after: seamAfter,
      visualCoverage,
      frameRoot,
      terminalImageDelta,
      visibleDiscontinuityStatus: terminalImageDelta.changedRatio > 0.05
        ? "confirmed-large-terminal-image-change"
        : "requires-numbered-strip-review",
    });
    if (seamAfter.terminalWrapCount <= before.terminalWrapCount || seamAfter.blockWaitCount !== 0) {
      throw new Error(`Flocks terminal baseline did not observe a cleanly instrumented wrap: ${JSON.stringify(report)}`);
    }
    await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close();
  }
}

async function readCatalogBudgets() {
  const output = {};
  for (const profile of profiles) {
    const catalog = JSON.parse(await readFile(resolve(repositoryRoot, `build/generated/public/cssflocks/${profile.id}/catalog.json`), "utf8"));
    output[profile.id] = Object.freeze({
      streamSeconds: catalog.streamDurationMilliseconds / 1_000,
      blockCount: catalog.blockCount,
      totalEncodedBytes: catalog.entries.reduce((sum, entry) => sum + entry.byteLength, 0),
      totalDecodedBytes: catalog.entries.reduce((sum, entry) => sum + entry.decodedByteLength, 0),
      firstThreeEncodedBytes: catalog.entries.slice(0, 3).reduce((sum, entry) => sum + entry.byteLength, 0),
      firstThreeDecodedBytes: catalog.entries.slice(0, 3).reduce((sum, entry) => sum + entry.decodedByteLength, 0),
    });
  }
  return Object.freeze(output);
}

async function readColdStarts() {
  const output = {};
  for (const profile of profiles) {
    output[profile.id] = [];
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      output[profile.id].push(JSON.parse(await readFile(resolve(
        resultRoot,
        profile.id,
        `cold-${String(runIndex + 1).padStart(2, "0")}.json`,
      ), "utf8")));
    }
  }
  return output;
}

function renderMarkdown(summary) {
  const lines = [
    "# Flocks failing baseline",
    "",
    `Captured: ${summary.capturedAt}`,
    "",
    "This is evidence of the pre-optimization failure, not a performance or parity claim.",
    "",
    "## Cold starts",
    "",
    `- Desktop median ready: ${summary.coldStarts.desktop.medianReadyMilliseconds} ms`,
    `- Mobile-emulation median ready: ${summary.coldStarts.mobile.medianReadyMilliseconds} ms`,
    `- Desktop prepared CSS strings after startup: ${summary.coldStarts.desktop.medianPreparedCssStringBytes} bytes`,
    `- Mobile prepared CSS strings after startup: ${summary.coldStarts.mobile.medianPreparedCssStringBytes} bytes`,
    "",
    "## Prepared payload",
    "",
    `- Desktop regenerated ${summary.regeneratedAfterNativeSourceQualification.desktop.streamSeconds}-second bank: ${summary.regeneratedAfterNativeSourceQualification.desktop.totalEncodedBytes} encoded bytes`,
    `- Mobile regenerated ${summary.regeneratedAfterNativeSourceQualification.mobile.streamSeconds}-second bank: ${summary.regeneratedAfterNativeSourceQualification.mobile.totalEncodedBytes} encoded bytes`,
    "",
    "## Terminal wrap",
    "",
    `- Observed wrap count: ${summary.terminalWrap.after.terminalWrapCount}`,
    `- Observation elapsed: ${summary.terminalWrap.elapsedMilliseconds} ms`,
    `- Numbered strip: ${summary.terminalWrap.frameRoot}`,
    `- Review status: ${summary.terminalWrap.visibleDiscontinuityStatus}`,
    "",
    "## FrameSleuth",
    "",
    `- Desktop trace: ${summary.traces.desktop.trace.path}`,
    `- Mobile-emulation trace: ${summary.traces.mobile.trace.path}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function compareScreenshots(leftPath, rightPath) {
  const [left, right] = await Promise.all([
    sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (left.info.width !== right.info.width || left.info.height !== right.info.height || left.data.length !== right.data.length) {
    throw new Error("Flocks terminal screenshots have incompatible dimensions");
  }
  let changedPixelsAbove12 = 0;
  let absoluteChannelDelta = 0;
  for (let index = 0; index < left.data.length; index += 3) {
    const delta = (Math.abs(left.data[index] - right.data[index]) +
      Math.abs(left.data[index + 1] - right.data[index + 1]) +
      Math.abs(left.data[index + 2] - right.data[index + 2])) / 3;
    absoluteChannelDelta += delta;
    if (delta > 12) changedPixelsAbove12 += 1;
  }
  const pixelCount = left.info.width * left.info.height;
  return Object.freeze({
    width: left.info.width,
    height: left.info.height,
    pixelCount,
    changedPixelsAbove12,
    changedRatio: changedPixelsAbove12 / pixelCount,
    meanAbsoluteChannelDelta: absoluteChannelDelta / pixelCount,
  });
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks Vite server exited early: ${child.exitCode}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      // Bounded readiness retry.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks Vite server did not become ready");
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
