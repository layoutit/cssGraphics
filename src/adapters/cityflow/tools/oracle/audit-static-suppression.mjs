#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const route = process.env.CSSCITYFLOW_STATIC_AUDIT_URL ?? "http://127.0.0.1:4325/cityflow/";
const referenceRoot = resolve(process.env.CSSCITYFLOW_STATIC_AUDIT_REFERENCE ??
  "bench/results/csscityflow/static-visibility/unculled-wide/frames");
const width = Number.parseInt(process.env.CSSCITYFLOW_STATIC_AUDIT_WIDTH ?? "2473", 10);
const height = Number.parseInt(process.env.CSSCITYFLOW_STATIC_AUDIT_HEIGHT ?? "1236", 10);
const frameIndices = (process.env.CSSCITYFLOW_STATIC_AUDIT_FRAMES ??
  "41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,192,193,194,195,196,198,202,203")
  .split(",").map(Number);

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, { timeout: 30_000 });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  const hiddenBoxIndices = await page.evaluate(async () => {
    globalThis.__csscityflow.player.pause();
    const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Cityflow static audit playback failed: ${response.status}`);
    const playback = await response.json();
    const decodeUint16 = (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
        view.getUint16(index * 2, true));
    };
    globalThis.__csscityflowStaticAudit = {
      playback,
      transformIndices: decodeUint16(playback.transformIndices.presentationBase64),
      materialIndices: decodeUint16(playback.colors.presentationMaterialIndicesBase64),
    };
    return playback.staticVisibility.hiddenBoxIndices;
  });
  const results = Object.fromEntries(hiddenBoxIndices.map((boxIndex) => [boxIndex, {
    changedFrameCount: 0,
    changedPixelCount: 0,
    maximumChangedPixelsPerFrame: 0,
    maximumChannelDelta: 0,
  }]));
  for (const frameIndex of frameIndices) {
    await page.evaluate((nextFrameIndex) => {
      const { playback, transformIndices, materialIndices } = globalThis.__csscityflowStaticAudit;
      globalThis.__csscityflow.player.seekFrame(nextFrameIndex);
      const roots = [...document.querySelectorAll(".polycss-scene > div")];
      for (const boxIndex of playback.staticVisibility.hiddenBoxIndices) {
        const root = roots[boxIndex];
        root.style.setProperty("display", "block", "important");
        root.style.transform = globalThis.__csscityflow.player.preparedTransformAt(
          boxIndex,
          transformIndices[nextFrameIndex * playback.boxCount + boxIndex],
        );
        const material = playback.colors.materials[
          materialIndices[nextFrameIndex * playback.boxCount + boxIndex]
        ];
        [...root.children].forEach((leaf, faceIndex) => {
          leaf.style.setProperty("display", "block", "important");
          leaf.style.backgroundColor = material[faceIndex];
        });
      }
      return new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }, frameIndex);
    const reference = await sharp(resolve(
      referenceRoot,
      `frame_${String(frameIndex).padStart(4, "0")}.png`,
    )).removeAlpha().raw().toBuffer();
    for (const boxIndex of hiddenBoxIndices) {
      await page.evaluate((nextBoxIndex) => {
        document.querySelectorAll(".polycss-scene > div")[nextBoxIndex]
          .style.setProperty("display", "none", "important");
      }, boxIndex);
      const candidate = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer();
      await page.evaluate((nextBoxIndex) => {
        document.querySelectorAll(".polycss-scene > div")[nextBoxIndex]
          .style.setProperty("display", "block", "important");
      }, boxIndex);
      let changedPixelCount = 0;
      let maximumChannelDelta = 0;
      for (let byteIndex = 0; byteIndex < reference.length; byteIndex += 3) {
        const channelDelta = Math.max(
          Math.abs(reference[byteIndex] - candidate[byteIndex]),
          Math.abs(reference[byteIndex + 1] - candidate[byteIndex + 1]),
          Math.abs(reference[byteIndex + 2] - candidate[byteIndex + 2]),
        );
        changedPixelCount += Number(channelDelta !== 0);
        maximumChannelDelta = Math.max(maximumChannelDelta, channelDelta);
      }
      if (changedPixelCount > 0) results[boxIndex].changedFrameCount += 1;
      results[boxIndex].changedPixelCount += changedPixelCount;
      results[boxIndex].maximumChangedPixelsPerFrame = Math.max(
        results[boxIndex].maximumChangedPixelsPerFrame,
        changedPixelCount,
      );
      results[boxIndex].maximumChannelDelta = Math.max(
        results[boxIndex].maximumChannelDelta,
        maximumChannelDelta,
      );
    }
  }
  console.log(JSON.stringify({
    schema: "csscityflow-static-suppression-audit@1",
    viewport: { width, height, deviceScaleFactor: 1 },
    frameIndices,
    results,
  }, null, 2));
} finally {
  await browser.close();
}
