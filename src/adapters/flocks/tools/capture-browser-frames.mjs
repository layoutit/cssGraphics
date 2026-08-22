#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  CSSFLOCKS_FRAME_SEQUENCE_COUNT,
  CSSFLOCKS_FRAME_SEQUENCE_PLAN,
} from "./frameSequencePlan.mjs";
import { packageFlocksFrameSequence } from "./frameSequenceArtifacts.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/browser-frames");
const rawFrames = resolve(outputRoot, "raw");
const packagedFrames = resolve(outputRoot, "packaged");
const port = 4197;
const paletteVariantId = "rotate-120";
const url = `http://127.0.0.1:${port}/flocks/?window=source-114s&palette=${paletteVariantId}`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(rawFrames, { recursive: true });
let serverOutput = "";
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error?.stack || error)));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
  const initial = await page.evaluate(() => {
    const debug = window.__cssFlocksDebug;
    debug.pause();
    document.querySelector(".examples-sidebar")?.style.setProperty("display", "none");
    document.querySelector(".example-info")?.style.setProperty("display", "none");
    document.querySelector(".example-stage")?.style.setProperty("inset", "0");
    const roots = [...document.querySelectorAll(".example-stage > .polycss-camera > .polycss-scene > div")];
    const leaves = roots.flatMap((root) => [...root.children]);
    window.__cssFlocksSequenceIdentity = { roots, leaves };
    return { stats: debug.stats(), roots: roots.length, leaves: leaves.length };
  });
  if (initial.roots !== 324 || initial.leaves !== 1_944) throw new Error(`Flocks sequence DOM count drifted: ${JSON.stringify(initial)}`);

  const frames = [];
  let ordinal = 0;
  for (const segment of CSSFLOCKS_FRAME_SEQUENCE_PLAN) {
    await page.evaluate((streamFrameIndex) => window.__cssFlocksDebug.seekStreamFrame(streamFrameIndex), segment.frames[0]);
    for (let segmentOrdinal = 0; segmentOrdinal < segment.frames.length; segmentOrdinal += 1) {
      const expectedStreamFrameIndex = segment.frames[segmentOrdinal];
      const state = await page.evaluate(() => {
        const debug = window.__cssFlocksDebug;
        const roots = [...document.querySelectorAll(".example-stage > .polycss-camera > .polycss-scene > div")];
        const leaves = roots.flatMap((root) => [...root.children]);
        const identity = window.__cssFlocksSequenceIdentity;
        return {
          stats: debug.stats(),
          debugErrors: debug.errors,
          bodyClass: document.body.className,
          roots: roots.map((root) => ({ transform: root.style.transform, color: root.style.color })),
          rootCount: roots.length,
          leafCount: leaves.length,
          sameRootIdentity: roots.length === identity.roots.length && roots.every((root, index) => root === identity.roots[index]),
          sameLeafIdentity: leaves.length === identity.leaves.length && leaves.every((leaf, index) => leaf === identity.leaves[index]),
          canvasCount: document.querySelectorAll("canvas").length,
          svgCount: document.querySelectorAll(".example-stage > .polycss-camera svg").length,
        };
      });
      if (state.stats.streamFrameIndex !== expectedStreamFrameIndex) {
        throw new Error(`Flocks ${segment.id} expected stream frame ${expectedStreamFrameIndex}, received ${state.stats.streamFrameIndex}`);
      }
      const path = resolve(rawFrames, `frame_${String(ordinal).padStart(4, "0")}.png`);
      await page.screenshot({ path });
      frames.push(Object.freeze({
        ordinal,
        segmentId: segment.id,
        segmentOrdinal,
        streamFrameIndex: expectedStreamFrameIndex,
        path,
        ...state,
      }));
      ordinal += 1;
      if (segmentOrdinal + 1 < segment.frames.length) await page.evaluate(() => window.__cssFlocksDebug.stepFrame());
    }
  }
  if (frames.length !== CSSFLOCKS_FRAME_SEQUENCE_COUNT) throw new Error("Flocks browser frame count drifted");
  if (browserErrors.length > 0 || frames.some((frame) => frame.rootCount !== 324 || frame.leafCount !== 1_944 ||
    !frame.sameRootIdentity || !frame.sameLeafIdentity || frame.canvasCount !== 0 || frame.svgCount !== 0 ||
    frame.bodyClass !== "ready" || frame.debugErrors.length !== 0 ||
    frame.stats.retainedDomStable !== true || frame.stats.runtimeDomGrowth !== false)) {
    throw new Error(`Flocks browser sequence stability failed: ${JSON.stringify({ browserErrors, frames: frames.map(compactFrame) })}`);
  }
  const statesPath = resolve(outputRoot, "states.json");
  await writeFile(statesPath, `${JSON.stringify({
    schema: "cssflocks-frame-sequence-browser-state@1",
    browser: `installed Google Chrome ${browser.version()}`,
    url,
    paletteVariantId,
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    initial,
    browserErrors,
    frames,
  }, null, 2)}\n`);
  const packaged = await packageFlocksFrameSequence({
    frames: rawFrames,
    output: packagedFrames,
    label: "cssflocks_browser",
    expectedFrames: CSSFLOCKS_FRAME_SEQUENCE_COUNT,
  });
  const report = Object.freeze({
    schema: "cssflocks-browser-frame-sequence@1",
    browser: `installed Google Chrome ${browser.version()}`,
    url,
    viewport: Object.freeze({ width: 1280, height: 800, deviceScaleFactor: 1 }),
    frameCount: frames.length,
    segmentCount: CSSFLOCKS_FRAME_SEQUENCE_PLAN.length,
    plan: CSSFLOCKS_FRAME_SEQUENCE_PLAN,
    stableRootCount: 324,
    stableLeafCount: 1_944,
    rawFrames,
    packaged,
    states: statesPath,
    browserErrors,
  });
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await writeFile(resolve(outputRoot, "server.log"), serverOutput);
  await stopServer();
}

function compactFrame(frame) {
  return {
    ordinal: frame.ordinal,
    segmentId: frame.segmentId,
    streamFrameIndex: frame.streamFrameIndex,
    rootCount: frame.rootCount,
    leafCount: frame.leafCount,
    sameRootIdentity: frame.sameRootIdentity,
    sameLeafIdentity: frame.sameLeafIdentity,
    stats: frame.stats,
  };
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Flocks sequence server exited early: ${server.exitCode}\n${serverOutput}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Flocks sequence server did not become ready\n${serverOutput}`);
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => server.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
