#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const outputRoot = resolve(process.env.CSSCITYFLOW_PRESENTATION_SEQUENCE_OUT ??
  "bench/results/csscityflow/presentation-sequence");
const framesRoot = resolve(outputRoot, "frames");
const route = process.env.CSSCITYFLOW_PRESENTATION_SEQUENCE_URL ?? "http://127.0.0.1:4325/cityflow/";
const width = positiveInteger("CSSCITYFLOW_PRESENTATION_SEQUENCE_WIDTH", 1280);
const height = positiveInteger("CSSCITYFLOW_PRESENTATION_SEQUENCE_HEIGHT", 720);
const frameCount = positiveInteger("CSSCITYFLOW_PRESENTATION_SEQUENCE_FRAMES", 302);
const unculled = process.env.CSSCITYFLOW_PRESENTATION_SEQUENCE_UNCULLED === "1";
await rm(outputRoot, { recursive: true, force: true });
await mkdir(framesRoot, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, { timeout: 30_000 });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  await page.evaluate(async (restoreStaticSuppression) => {
    globalThis.__csscityflow.player.pause();
    if (restoreStaticSuppression) {
      const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Cityflow presentation playback failed: ${response.status}`);
      const playback = await response.json();
      const decodeUint16 = (base64) => {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
          view.getUint16(index * 2, true));
      };
      globalThis.__csscityflowUnculledCapture = {
        playback,
        transformIndices: decodeUint16(playback.transformIndices.presentationBase64),
        materialIndices: decodeUint16(playback.colors.presentationMaterialIndicesBase64),
      };
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  }, unculled);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    await page.evaluate(async ({ index, restoreStaticSuppression }) => {
      globalThis.__csscityflow.player.seekFrame(index % globalThis.__csscityflow.player.stats().frameCount);
      if (restoreStaticSuppression) {
        const { playback, transformIndices, materialIndices } =
          globalThis.__csscityflowUnculledCapture;
        const frameIndex = index % playback.frameCount;
        const roots = [...document.querySelectorAll(".csscityflow-box")];
        for (let boxIndex = 0; boxIndex < playback.boxCount; boxIndex += 1) {
          const root = roots[boxIndex];
          root.style.setProperty("display", "block", "important");
          root.style.transform = globalThis.__csscityflow.player.preparedTransformAt(
            boxIndex,
            transformIndices[frameIndex * playback.boxCount + boxIndex],
          );
          const material = playback.colors.materials[
            materialIndices[frameIndex * playback.boxCount + boxIndex]
          ];
          [...root.children].forEach((leaf, faceIndex) => {
            leaf.style.setProperty("display", "block", "important");
            leaf.style.setProperty("opacity", "1", "important");
            leaf.style.backgroundColor = material[faceIndex];
          });
        }
      }
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }, { index: frameIndex, restoreStaticSuppression: unculled });
    await page.screenshot({ path: resolve(framesRoot, `frame_${String(frameIndex).padStart(4, "0")}.png`) });
  }
  const audit = await page.evaluate(() => ({
    player: globalThis.__csscityflow.player.stats(),
    roots: document.querySelectorAll(".csscityflow-box").length,
    leaves: document.querySelectorAll(".csscityflow-box>b").length,
  }));
  if (errors.length) throw new Error(`Cityflow presentation capture failed: ${JSON.stringify(errors)}`);
  const report = {
    schema: "csscityflow-browser-presentation-frame-sequence@1",
    route,
    browser: { name: "Google Chrome", version: browser.version(), headless: true },
    viewport: { width, height, deviceScaleFactor: 1 },
    frameCount,
    frameRate: 60,
    framePattern: resolve(framesRoot, "frame_%04d.png"),
    captureMode: "paused-prepared-sequential-player-frame-seek",
    staticSuppressionRestoredForOracle: unculled,
    audit,
  };
  await writeFile(resolve(outputRoot, "capture.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
