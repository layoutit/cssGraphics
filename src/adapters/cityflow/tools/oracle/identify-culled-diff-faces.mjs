#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const route = process.env.CSSCITYFLOW_DIFF_FACE_URL ?? "http://127.0.0.1:4325/cityflow/";
const width = Number.parseInt(process.env.CSSCITYFLOW_DIFF_FACE_WIDTH ?? "2473", 10);
const height = Number.parseInt(process.env.CSSCITYFLOW_DIFF_FACE_HEIGHT ?? "1236", 10);
const frameIndex = Number.parseInt(process.env.CSSCITYFLOW_DIFF_FACE_FRAME ?? "253", 10);
const referencePath = resolve(process.env.CSSCITYFLOW_DIFF_FACE_REFERENCE ??
  `bench/results/csscityflow/static-visibility/unculled-wide/frames/frame_${String(frameIndex).padStart(4, "0")}.png`);
const candidatePath = resolve(process.env.CSSCITYFLOW_DIFF_FACE_CANDIDATE ??
  `bench/results/csscityflow/product-visibility/after-wide/frames/frame_${String(frameIndex).padStart(4, "0")}.png`);
const [reference, candidate] = await Promise.all([referencePath, candidatePath].map((path) =>
  sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
const changed = [];
for (let byteIndex = 0; byteIndex < reference.data.length; byteIndex += 3) {
  const delta = Math.max(
    Math.abs(reference.data[byteIndex] - candidate.data[byteIndex]),
    Math.abs(reference.data[byteIndex + 1] - candidate.data[byteIndex + 1]),
    Math.abs(reference.data[byteIndex + 2] - candidate.data[byteIndex + 2]),
  );
  if (delta === 0) continue;
  const pixelIndex = byteIndex / 3;
  changed.push({ x: pixelIndex % width, y: Math.floor(pixelIndex / width), delta });
}
changed.sort((left, right) => right.delta - left.delta);
const samples = [];
for (const pixel of changed) {
  if (samples.some((sample) => Math.hypot(sample.x - pixel.x, sample.y - pixel.y) < 12)) continue;
  samples.push(pixel);
  if (samples.length >= 200) break;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, { timeout: 30_000 });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
    .example-stage>.polycss-camera>.polycss-scene>div>b { pointer-events: auto !important; }
  ` });
  const hits = await page.evaluate(async ({ frameIndex: nextFrameIndex, samples: points }) => {
    const player = globalThis.__csscityflow.player;
    player.pause();
    player.seekFrame(nextFrameIndex);
    const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
    const playback = await response.json();
    const decodeUint16 = (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
        view.getUint16(index * 2, true));
    };
    const transformIndices = decodeUint16(playback.transformIndices.presentationBase64);
    const roots = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
    const leaves = roots.flatMap((root) => [...root.children]);
    for (let boxIndex = 0; boxIndex < playback.boxCount; boxIndex += 1) {
      roots[boxIndex].style.transform = player.preparedTransformAt(
        boxIndex,
        transformIndices[nextFrameIndex * playback.boxCount + boxIndex],
      );
    }
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    return points.map((point) => ({
      ...point,
      hits: document.elementsFromPoint(point.x, point.y)
        .filter((element) => element.matches?.(".example-stage>.polycss-camera>.polycss-scene>div>b"))
        .map((element) => ({
          faceIndex: leaves.indexOf(element),
          opacity: getComputedStyle(element).opacity,
          display: getComputedStyle(element).display,
        })),
    }));
  }, { frameIndex, samples });
  const hiddenHitCounts = new Map();
  for (const sample of hits) {
    for (const hit of sample.hits.filter(({ opacity, display }) => opacity === "0" || display === "none")) {
      hiddenHitCounts.set(hit.faceIndex, (hiddenHitCounts.get(hit.faceIndex) ?? 0) + 1);
    }
  }
  console.log(JSON.stringify({
    frameIndex,
    changedPixelCount: changed.length,
    sampleCount: samples.length,
    hiddenHitCounts: [...hiddenHitCounts].sort((left, right) => right[1] - left[1]),
  }, null, 2));
} finally {
  await browser.close();
}
