#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { CSSFLOCKS_STARTUP_WINDOWS } from "../src/shared/cssflocks/startupWindows.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/startup-windows");
const port = 4193;
const baseUrl = `http://127.0.0.1:${port}/flocks/`;
const profiles = Object.freeze([
  Object.freeze({ id: "desktop", viewport: Object.freeze({ width: 1280, height: 800 }), rootCount: 324, leafCount: 1_944, cell: Object.freeze({ width: 320, height: 200 }) }),
  Object.freeze({ id: "mobile", viewport: Object.freeze({ width: 390, height: 844 }), rootCount: 164, leafCount: 984, cell: Object.freeze({ width: 195, height: 422 }) }),
]);
const captureFrames = Object.freeze([0, 30, 59]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "ignore",
});
let browser;
try {
  await waitForServer(baseUrl, server);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = [];
  for (const profile of profiles) {
    const profileRoot = resolve(outputRoot, profile.id);
    await mkdir(profileRoot, { recursive: true });
    for (const startupWindow of CSSFLOCKS_STARTUP_WINDOWS) {
      captures.push(...await captureWindow({ browser, profile, profileRoot, startupWindow }));
    }
    await makeContactSheet({ captures, profile });
  }
  const report = Object.freeze({
    schema: "cssflocks-startup-window-capture@1",
    browser: "installed Chrome via Playwright channel=chrome",
    baseUrl,
    captureFrames,
    startupWindowOrder: CSSFLOCKS_STARTUP_WINDOWS.map(({ id, blockIndex, sourceFrameIndex }) => ({ id, blockIndex, sourceFrameIndex })),
    profiles: profiles.map(({ id, viewport, rootCount, leafCount }) => ({
      id,
      viewport,
      expectedRetainedBugRootCount: rootCount,
      expectedRetainedPolygonLeafCount: leafCount,
      contactSheet: resolve(outputRoot, `${id}-contact-sheet.png`),
    })),
    captures,
  });
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}

async function captureWindow({ browser, profile, profileRoot, startupWindow }) {
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
  const url = `${baseUrl}?window=${encodeURIComponent(startupWindow.id)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    const initial = await page.evaluate(() => {
      const debug = window.__cssFlocksDebug;
      debug.pause();
      return { startupWindow: debug.startupWindow, stats: debug.stats(), errors: debug.errors };
    });
    assertCaptureBinding({ errors, initial, profile, startupWindow });
    const captures = [];
    for (const frameIndex of captureFrames) {
      const state = await page.evaluate((nextFrameIndex) => {
        const debug = window.__cssFlocksDebug;
        debug.seekFrame(nextFrameIndex);
        return { startupWindow: debug.startupWindow, stats: debug.stats(), errors: debug.errors };
      }, frameIndex);
      await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
      const framePath = resolve(profileRoot, `${startupWindow.id}-frame-${String(frameIndex).padStart(2, "0")}.png`);
      await page.screenshot({ path: framePath });
      assertCaptureBinding({ errors, initial: state, profile, startupWindow, frameIndex });
      captures.push(Object.freeze({
        profileId: profile.id,
        startupWindowId: startupWindow.id,
        blockIndex: startupWindow.blockIndex,
        sourceFrameIndex: startupWindow.sourceFrameIndex + frameIndex,
        blockFrameIndex: frameIndex,
        retainedBugRootCount: state.stats.retainedBugRootCount,
        retainedPolygonLeafCount: state.stats.retainedPolygonLeafCount,
        path: framePath,
      }));
    }
    return captures;
  } finally {
    await context.close();
  }
}

function assertCaptureBinding({ errors, initial, profile, startupWindow, frameIndex = null }) {
  const combinedErrors = [...errors, ...(initial.errors ?? [])];
  const expectedStreamFrame = frameIndex === null ? null : startupWindow.sourceFrameIndex + frameIndex;
  if (combinedErrors.length > 0 || initial.startupWindow?.id !== startupWindow.id ||
      initial.startupWindow?.blockIndex !== startupWindow.blockIndex ||
      initial.stats?.profileId !== profile.id || initial.stats?.activeBlockIndex !== startupWindow.blockIndex ||
      initial.stats?.retainedBugRootCount !== profile.rootCount ||
      initial.stats?.retainedPolygonLeafCount !== profile.leafCount ||
      initial.stats?.retainedDomStable !== true || initial.stats?.runtimeDomGrowth !== false ||
      (expectedStreamFrame !== null && initial.stats?.streamFrameIndex !== expectedStreamFrame)) {
    throw new Error(`Flocks startup-window capture binding failed: ${JSON.stringify({
      profile: profile.id,
      startupWindow: startupWindow.id,
      frameIndex,
      expectedStreamFrame,
      initial,
      errors: combinedErrors,
    })}`);
  }
}

async function makeContactSheet({ captures, profile }) {
  const profileCaptures = captures.filter((capture) => capture.profileId === profile.id);
  const labelHeight = 24;
  const cellWidth = profile.cell.width;
  const cellHeight = profile.cell.height + labelHeight;
  const composites = [];
  for (const capture of profileCaptures) {
    const column = CSSFLOCKS_STARTUP_WINDOWS.findIndex((window) => window.id === capture.startupWindowId);
    const row = captureFrames.indexOf(capture.blockFrameIndex);
    const image = await sharp(capture.path)
      .resize(cellWidth, profile.cell.height, { fit: "fill" })
      .png()
      .toBuffer();
    composites.push({ input: image, left: column * cellWidth, top: row * cellHeight + labelHeight });
    composites.push({
      input: label(`${capture.startupWindowId}  source frame ${capture.sourceFrameIndex}`, cellWidth, labelHeight),
      left: column * cellWidth,
      top: row * cellHeight,
    });
  }
  await sharp({
    create: {
      width: cellWidth * CSSFLOCKS_STARTUP_WINDOWS.length,
      height: cellHeight * captureFrames.length,
      channels: 3,
      background: "#000",
    },
  }).composite(composites).png().toFile(resolve(outputRoot, `${profile.id}-contact-sheet.png`));
}

function label(text, width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="16" fill="#ddd" font-family="monospace" font-size="12">${text}</text></svg>`);
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks startup-window server exited early: ${child.exitCode}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks startup-window server did not become ready");
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
