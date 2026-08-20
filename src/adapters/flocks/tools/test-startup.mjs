#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/startup");
const port = 4192;
const url = `http://127.0.0.1:${port}/flocks/`;
const profiles = [
  {
    id: "desktop",
    viewport: { width: 1280, height: 800 },
    readyLimitMilliseconds: 1_500,
    transferLimitBytes: 1.5 * 1024 * 1024,
    residentCssLimitBytes: 18 * 1024 * 1024,
    roots: 324,
    leaves: 1_944,
  },
  {
    id: "mobile",
    viewport: { width: 390, height: 844 },
    readyLimitMilliseconds: 1_250,
    transferLimitBytes: 0.8 * 1024 * 1024,
    residentCssLimitBytes: 10 * 1024 * 1024,
    roots: 164,
    leaves: 984,
  },
];
await mkdir(outputRoot, { recursive: true });
let serverOutput = "";
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });
try {
  await waitForServer();
  const reports = {};
  for (const profile of profiles) {
    const runs = [];
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      const observePlayback = runIndex === 2;
      const report = await captureRun(profile, observePlayback);
      runs.push(report);
      process.stdout.write(`${profile.id} cold ${runIndex + 1}/3: ${report.readyMilliseconds} ms\n`);
    }
    const medianReadyMilliseconds = median(runs.map((run) => run.readyMilliseconds));
    const maximumInitialEncodedTransferBytes = Math.max(...runs.map((run) => run.initialEncodedTransferBytes));
    const maximumResidentPreparedCssStringBytes = Math.max(...runs.map((run) => run.maximumResidentPreparedCssStringBytes));
    const materializationLongTasks = runs.flatMap((run) => run.materializationLongTasks);
    const foreignProfileBlockUrls = runs.flatMap((run) => run.foreignProfileBlockUrls);
    const playback = runs.at(-1).playback;
    const summary = {
      profile: profile.id,
      runs,
      medianReadyMilliseconds,
      maximumInitialEncodedTransferBytes,
      maximumResidentPreparedCssStringBytes,
      materializationLongTasks,
      foreignProfileBlockUrls,
      playback,
    };
    if (medianReadyMilliseconds > profile.readyLimitMilliseconds ||
        maximumInitialEncodedTransferBytes > profile.transferLimitBytes ||
        maximumResidentPreparedCssStringBytes > profile.residentCssLimitBytes ||
        playback.durationMilliseconds < 30_000 ||
        playback.finalStats.blockWaitCount !== 0 ||
        playback.finalStats.staleResponseCount !== 0 ||
        playback.finalStats.residentBlockCount > 3 ||
        playback.maximumResidentBlockCount > 3 ||
        playback.maximumResidentPreparedCssStringBytes > profile.residentCssLimitBytes ||
        materializationLongTasks.length > 0 ||
        foreignProfileBlockUrls.length > 0 ||
        !playback.sameRootIdentity || !playback.sameLeafIdentity ||
        playback.finalStats.retainedDomStable !== true ||
        playback.finalStats.productBugCount !== profile.roots ||
        playback.finalStats.retainedPolygonLeafCount !== profile.leaves) {
      throw new Error(`Flocks startup gate failed: ${JSON.stringify(summary)}`);
    }
    reports[profile.id] = summary;
  }
  const report = {
    schema: "cssflocks-startup-residency@1",
    browser: "installed Google Chrome",
    url,
    profiles: reports,
  };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report: resolve(outputRoot, "report.json"),
    desktop: compact(reports.desktop),
    mobile: compact(reports.mobile),
  }, null, 2));
} finally {
  await writeFile(resolve(outputRoot, "server.log"), serverOutput);
  await stopServer();
}

async function captureRun(profile, observePlayback) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__flocksStartupProbe = {
        longTasks: [],
        residency: [],
        readyAt: null,
      };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__flocksStartupProbe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {}
      setInterval(() => {
        const stats = window.__cssFlocksDebug?.stats?.();
        if (!stats) return;
        window.__flocksStartupProbe.residency.push({
          time: performance.now(),
          residentBlockCount: stats.residentBlockCount,
          residentPreparedCssStringBytes: stats.residentPreparedCssStringBytes,
          pendingBlockCount: stats.pendingBlockCount,
          staleResponseCount: stats.staleResponseCount,
        });
      }, 100);
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const startedAt = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    const readyMilliseconds = Number((performance.now() - startedAt).toFixed(2));
    const ready = await page.evaluate(() => {
      window.__flocksStartupProbe.readyAt = performance.now();
      window.__cssFlocksDebug.pause();
      const resources = performance.getEntriesByType("resource");
      const profileId = window.__cssFlocksDebug.stats().profileId;
      return {
        readyAt: window.__flocksStartupProbe.readyAt,
        stats: window.__cssFlocksDebug.stats(),
        initialEncodedTransferBytes: resources
          .filter((entry) => /\/cssflocks\/(?:desktop|mobile)\/blocks\//u.test(entry.name) &&
            entry.responseEnd <= window.__flocksStartupProbe.readyAt)
          .reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        foreignProfileBlockUrls: resources
          .map((entry) => entry.name)
          .filter((name) => /\/cssflocks\/(?:desktop|mobile)\/blocks\//u.test(name) &&
            !name.includes(`/cssflocks/${profileId}/blocks/`)),
      };
    });
    await page.waitForFunction(() => window.__cssFlocksDebug.stats().pendingBlockCount === 0, null, { timeout: 5_000 });
    const settled = await page.evaluate(() => {
      const scene = document.querySelector("body > .polycss-camera > .polycss-scene");
      const roots = [...scene.children];
      const leaves = roots.flatMap((root) => [...root.children]);
      window.__flocksStartupIdentity = { roots, leaves };
      const settledAt = performance.now();
      return {
        stats: window.__cssFlocksDebug.stats(),
        settledAt,
        materializationLongTasks: window.__flocksStartupProbe.longTasks
          .filter((entry) => entry.startTime >= window.__flocksStartupProbe.readyAt && entry.startTime < settledAt && entry.duration >= 50),
      };
    });
    let playback = null;
    if (observePlayback) {
      const playbackStartedAt = await page.evaluate(() => performance.now());
      await page.evaluate(() => window.__cssFlocksDebug.resume());
      await page.waitForTimeout(30_000);
      playback = await page.evaluate(({ playbackStartedAt }) => {
        const scene = document.querySelector("body > .polycss-camera > .polycss-scene");
        const roots = [...scene.children];
        const leaves = roots.flatMap((root) => [...root.children]);
        const probe = window.__flocksStartupProbe;
        const postReadyResidency = probe.residency.filter((sample) => sample.time >= probe.readyAt);
        return {
          durationMilliseconds: performance.now() - playbackStartedAt,
          finalStats: window.__cssFlocksDebug.stats(),
          playbackLongTasks: probe.longTasks.filter((entry) => entry.startTime >= playbackStartedAt && entry.duration >= 50),
          maximumResidentBlockCount: Math.max(0, ...postReadyResidency.map((sample) => sample.residentBlockCount)),
          maximumResidentPreparedCssStringBytes: Math.max(0, ...postReadyResidency.map((sample) => sample.residentPreparedCssStringBytes)),
          sameRootIdentity: roots.length === window.__flocksStartupIdentity.roots.length &&
            roots.every((root, index) => root === window.__flocksStartupIdentity.roots[index]),
          sameLeafIdentity: leaves.length === window.__flocksStartupIdentity.leaves.length &&
            leaves.every((leaf, index) => leaf === window.__flocksStartupIdentity.leaves[index]),
        };
      }, { playbackStartedAt });
    }
    if (errors.length > 0) throw new Error(`Flocks ${profile.id} startup browser errors: ${errors.join("\n")}`);
    return {
      readyMilliseconds,
      initialEncodedTransferBytes: ready.initialEncodedTransferBytes,
      foreignProfileBlockUrls: ready.foreignProfileBlockUrls,
      readyStats: ready.stats,
      settledStats: settled.stats,
      materializationLongTasks: settled.materializationLongTasks,
      maximumResidentPreparedCssStringBytes: Math.max(
        ready.stats.residentPreparedCssStringBytes,
        settled.stats.residentPreparedCssStringBytes,
        playback?.maximumResidentPreparedCssStringBytes ?? 0,
      ),
      playback,
    };
  } finally {
    await browser.close();
  }
}

function compact(report) {
  return {
    medianReadyMilliseconds: report.medianReadyMilliseconds,
    maximumInitialEncodedTransferBytes: report.maximumInitialEncodedTransferBytes,
    maximumResidentPreparedCssStringBytes: report.maximumResidentPreparedCssStringBytes,
    blockWaitCount: report.playback.finalStats.blockWaitCount,
    staleResponseCount: report.playback.finalStats.staleResponseCount,
    materializationLongTaskCount: report.materializationLongTasks.length,
    playbackLongTaskCount: report.playback.playbackLongTasks.length,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Flocks startup server exited early: ${server.exitCode}\n${serverOutput}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Flocks startup server did not become ready\n${serverOutput}`);
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
