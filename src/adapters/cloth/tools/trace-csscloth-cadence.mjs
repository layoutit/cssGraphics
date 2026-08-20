#!/usr/bin/env node

import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2];
const output = resolve(process.argv[3] ?? ".local/proofs/csscloth-cadence");
const durationMilliseconds = Number(process.argv[4] ?? 52_000);
if (!url || !Number.isFinite(durationMilliseconds) || durationMilliseconds < 40_000) {
  throw new Error("Usage: trace-csscloth-cadence.mjs <url> [output-dir] [duration-ms >= 40000]");
}

const tracePath = resolve(output, "Trace.json.gz");
const summaryPath = resolve(output, "browser-cadence.json");
const screenshotPath = resolve(output, "final-frame.png");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__cssClothDebug?.ready === true, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await startTrace(cdp);
  await page.evaluate(() => {
    globalThis.__cssClothCadenceSamples = [];
    globalThis.__cssClothLongTasks = [];
    globalThis.__cssClothCadenceSampling = true;
    globalThis.__cssClothLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__cssClothLongTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    globalThis.__cssClothLongTaskObserver.observe({ type: "longtask", buffered: true });
    let previous = performance.now();
    const sample = (timestamp) => {
      globalThis.__cssClothCadenceSamples.push({
        timestamp,
        interval: timestamp - previous,
      });
      previous = timestamp;
      if (globalThis.__cssClothCadenceSampling) requestAnimationFrame(sample);
    };
    performance.mark("csscloth-cadence-capture-start");
    requestAnimationFrame(sample);
  });
  await page.waitForTimeout(durationMilliseconds);
  const browserEvidence = await page.evaluate(() => {
    globalThis.__cssClothCadenceSampling = false;
    globalThis.__cssClothLongTaskObserver.disconnect();
    performance.mark("csscloth-cadence-capture-end");
    const captureStart = performance.getEntriesByName("csscloth-cadence-capture-start").at(-1).startTime;
    const captureEnd = performance.getEntriesByName("csscloth-cadence-capture-end").at(-1).startTime;
    return {
      captureStart,
      captureEnd,
      samples: globalThis.__cssClothCadenceSamples,
      longTasks: globalThis.__cssClothLongTasks,
      handoffs: performance.getEntriesByName("csscloth-bank-handoff").map((entry) => entry.startTime),
      prefetchStarts: performance.getEntriesByName("csscloth-bank-prefetch-start")
        .map((entry) => entry.startTime),
      prefetchCompletes: performance.getEntriesByName("csscloth-bank-prefetch-complete")
        .map((entry) => entry.startTime),
      stats: globalThis.__cssClothDebug.stats(),
      errors: [...globalThis.__cssClothDebug.errors],
      documentLeafCount: document.querySelectorAll(
        ".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u",
      ).length,
    };
  });
  await page.waitForTimeout(50);
  await stopTrace(cdp, tracePath);
  await page.screenshot({ path: screenshotPath });
  const intervals = browserEvidence.samples.slice(1).map((sample) => sample.interval);
  const summary = {
    schema: "csscloth-cadence-trace@1",
    url,
    durationMilliseconds,
    viewport: { width: 1440, height: 900 },
    browser: { name: "Google Chrome", version: browser.version() },
    errors: [...errors, ...browserEvidence.errors],
    cadence: summarizeIntervals(intervals),
    handoffs: browserEvidence.handoffs.map((timestamp) => ({
      timestamp,
      cadence: summarizeIntervals(browserEvidence.samples
        .filter((sample) => Math.abs(sample.timestamp - timestamp) <= 250)
        .map((sample) => sample.interval)),
      longTasks: browserEvidence.longTasks.filter((task) =>
        task.startTime <= timestamp + 250 && task.startTime + task.duration >= timestamp - 250),
    })),
    prefetchStarts: browserEvidence.prefetchStarts,
    prefetchCompletes: browserEvidence.prefetchCompletes,
    longTasks: browserEvidence.longTasks.filter((task) =>
      task.startTime >= browserEvidence.captureStart && task.startTime <= browserEvidence.captureEnd),
    stats: browserEvidence.stats,
    documentLeafCount: browserEvidence.documentLeafCount,
    outputs: { tracePath, summaryPath, screenshotPath },
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}

function summarizeIntervals(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50Milliseconds: quantile(sorted, 0.5),
    p95Milliseconds: quantile(sorted, 0.95),
    p99Milliseconds: quantile(sorted, 0.99),
    maximumMilliseconds: sorted.at(-1) ?? null,
    gapsAbove33Milliseconds: sorted.filter((value) => value > 33).length,
  };
}

function quantile(sorted, percentile) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return Number(sorted[lower].toFixed(3));
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return Number(value.toFixed(3));
}

async function startTrace(cdp) {
  await cdp.send("Tracing.start", {
    categories: [
      "blink.user_timing",
      "cc",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "toplevel",
      "v8",
      "v8.execute",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    streamCompression: "gzip",
  });
}

async function stopTrace(cdp, path) {
  const completed = new Promise((resolveComplete) => {
    cdp.once("Tracing.tracingComplete", resolveComplete);
  });
  await cdp.send("Tracing.end");
  const { stream } = await completed;
  if (!stream) throw new Error("Chrome trace did not return a stream");
  const output = createWriteStream(path, { flags: "w" });
  while (true) {
    const result = await cdp.send("IO.read", { handle: stream });
    const bytes = result.base64Encoded
      ? Buffer.from(result.data, "base64")
      : Buffer.from(result.data, "utf8");
    if (!output.write(bytes)) await once(output, "drain");
    if (result.eof) break;
  }
  output.end();
  await once(output, "close");
  await cdp.send("IO.close", { handle: stream });
}
