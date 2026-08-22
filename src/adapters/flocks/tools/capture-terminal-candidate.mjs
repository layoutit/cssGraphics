#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatMatrix3dValues } from "@layoutit/polycss";
import { chromium } from "playwright";
import sharp from "sharp";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceEndpointSamples,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { buildFlocksBugMatrix, flocksHueToHex } from "../src/shared/cssflocks/bugTransform.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const searchPath = resolve(process.argv[2] ?? "/tmp/cssflocks-terminal-search-3600.json");
const search = JSON.parse(await readFile(searchPath, "utf8"));
const { startFrame, endFrame } = search.selected;
const wanted = new Set([startFrame, endFrame]);
const frames = new Map();
const bank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  frameCount: endFrame + 1,
});
for (const frame of buildFlocksSourceEndpointSamples({ bank })) {
  if (wanted.has(frame.index)) frames.set(frame.index, frame);
}
if (frames.size !== 2) throw new Error("Selected Flocks seam endpoints were not reproduced");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/terminal-window-search");
await mkdir(outputRoot, { recursive: true });
const port = 4191;
const url = `http://127.0.0.1:${port}/flocks/`;
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });
let browser;
try {
  await waitForServer(url, server);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => window.__cssFlocksDebug.pause());
  const paths = {};
  for (const [id, frameIndex] of [["start", startFrame], ["end", endFrame]]) {
    const state = materialize(frames.get(frameIndex).bugs.slice(0, CSSFLOCKS_PRODUCT_PROFILES.desktop.bugCount));
    await page.evaluate(({ transforms, colors }) => {
      const roots = [...document.querySelector(".example-stage > .polycss-camera > .polycss-scene").children];
      roots.forEach((root, index) => {
        root.style.transform = transforms[index];
        root.style.color = colors[index];
      });
    }, state);
    const path = resolve(outputRoot, `desktop-${id}.png`);
    await page.screenshot({ path });
    paths[id] = path;
  }
  const comparison = await comparePng(paths.start, paths.end);
  const report = {
    schema: "cssflocks-terminal-candidate-capture@1",
    searchPath,
    startFrame,
    endFrame,
    durationSeconds: search.selected.durationSeconds,
    searchMetrics: search.selected.profiles.desktop.metrics,
    comparison,
    paths,
  };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}

function materialize(bugs) {
  return {
    transforms: bugs.map((bug) => `matrix3d(${formatMatrix3dValues(buildFlocksBugMatrix(bug.position, bug.velocity).matrix, 6)})`),
    colors: bugs.map((bug) => flocksHueToHex(bug.hue)),
  };
}

async function comparePng(leftPath, rightPath) {
  const left = await sharp(await readFile(leftPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(await readFile(rightPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) throw new Error("Terminal capture dimensions drifted");
  let changedPixels = 0;
  let channelDifference = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    const difference = Math.max(
      Math.abs(left.data[index] - right.data[index]),
      Math.abs(left.data[index + 1] - right.data[index + 1]),
      Math.abs(left.data[index + 2] - right.data[index + 2]),
    );
    if (difference > 8) changedPixels += 1;
    channelDifference += difference;
  }
  const pixelCount = left.info.width * left.info.height;
  return {
    width: left.info.width,
    height: left.info.height,
    changedPixels,
    changedPixelFraction: changedPixels / pixelCount,
    meanMaximumChannelDifference: channelDifference / pixelCount,
  };
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks server exited early: ${child.exitCode}`);
    try { const response = await fetch(targetUrl); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Flocks terminal capture server did not become ready\n${serverOutput}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
