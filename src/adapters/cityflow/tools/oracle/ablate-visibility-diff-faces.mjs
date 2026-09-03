#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const route = process.env.CSSCITYFLOW_DIFF_FACE_URL ?? "http://127.0.0.1:4325/cityflow/";
const width = positiveInteger("CSSCITYFLOW_DIFF_FACE_WIDTH", 2473);
const height = positiveInteger("CSSCITYFLOW_DIFF_FACE_HEIGHT", 1236);
const frameIndex = nonNegativeInteger("CSSCITYFLOW_DIFF_FACE_FRAME", 253);
const referencePath = resolve(process.env.CSSCITYFLOW_DIFF_FACE_REFERENCE ??
  `bench/results/csscityflow/static-visibility/unculled-wide/frames/frame_${pad(frameIndex)}.png`);
const candidatePath = resolve(process.env.CSSCITYFLOW_DIFF_FACE_CANDIDATE ??
  `bench/results/csscityflow/product-visibility/after-wide/frames/frame_${pad(frameIndex)}.png`);
const reference = await rawRgb(referencePath);
const candidate = await rawRgb(candidatePath);
const expected = diff(reference, candidate);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, { timeout: 30_000 });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  const hiddenFaceIndices = await page.evaluate(async (nextFrameIndex) => {
    const player = globalThis.__csscityflow.player;
    player.pause();
    player.seekFrame(nextFrameIndex);
    const playback = await (await fetch("/csscityflow/cityflow.playback.json", {
      cache: "no-store",
    })).json();
    const decodeUint16 = (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
        view.getUint16(index * 2, true));
    };
    const transformIndices = decodeUint16(playback.transformIndices.presentationBase64);
    const materialIndices = decodeUint16(playback.colors.presentationMaterialIndicesBase64);
    const roots = [...document.querySelectorAll(".csscityflow-box")];
    const leaves = roots.flatMap((root) => [...root.children]);
    for (let boxIndex = 0; boxIndex < playback.boxCount; boxIndex += 1) {
      roots[boxIndex].style.transform = player.preparedTransformAt(
        boxIndex,
        transformIndices[nextFrameIndex * playback.boxCount + boxIndex],
      );
      const material = playback.colors.materials[
        materialIndices[nextFrameIndex * playback.boxCount + boxIndex]
      ];
      [...roots[boxIndex].children].forEach((leaf, faceIndex) => {
        leaf.style.backgroundColor = material[faceIndex];
      });
    }
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    const staticallyHidden = new Set(playback.staticVisibility.hiddenFaceIndices);
    return leaves.map((leaf, faceIndex) => ({
      faceIndex,
      visibility: getComputedStyle(leaf).visibility,
    })).filter(({ faceIndex, visibility }) =>
      visibility === "hidden" && !staticallyHidden.has(faceIndex))
      .map(({ faceIndex }) => faceIndex);
  }, frameIndex);
  const live = await rawRgb(await page.screenshot());
  const liveDiff = diff(reference, live);
  if (liveDiff.changedPixels !== expected.changedPixels ||
      liveDiff.maximumChannelDelta !== expected.maximumChannelDelta) {
    throw new Error(`Cityflow live candidate drifted: ${JSON.stringify({ expected, liveDiff })}`);
  }
  const ranked = [];
  for (const faceIndex of hiddenFaceIndices) {
    await page.evaluate((nextFaceIndex) => {
      document.querySelectorAll(".csscityflow-box>b")[nextFaceIndex]
        .style.visibility = "";
    }, faceIndex);
    const restoredDiff = diff(reference, await rawRgb(await page.screenshot()));
    ranked.push({
      faceIndex,
      restoredChangedPixels: restoredDiff.changedPixels,
      changedPixelReduction: expected.changedPixels - restoredDiff.changedPixels,
      maximumChannelDelta: restoredDiff.maximumChannelDelta,
    });
    await page.evaluate((nextFaceIndex) => {
      document.querySelectorAll(".csscityflow-box>b")[nextFaceIndex]
        .style.visibility = "hidden";
    }, faceIndex);
  }
  ranked.sort((left, right) => right.changedPixelReduction - left.changedPixelReduction);
  console.log(JSON.stringify({
    frameIndex,
    hiddenFaceCount: hiddenFaceIndices.length,
    baseline: expected,
    positiveRestorations: ranked.filter(({ changedPixelReduction }) =>
      changedPixelReduction > 0),
  }, null, 2));
} finally {
  await browser.close();
}

async function rawRgb(input) {
  return (await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;
}

function diff(reference, candidate) {
  if (reference.byteLength !== candidate.byteLength) {
    throw new Error("Cityflow visibility-diff frame geometry drifted");
  }
  let changedPixels = 0;
  let maximumChannelDelta = 0;
  for (let byteIndex = 0; byteIndex < reference.byteLength; byteIndex += 3) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(reference[byteIndex + channel] - candidate[byteIndex + channel]);
      changed ||= delta !== 0;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    }
    changedPixels += Number(changed);
  }
  return { changedPixels, maximumChannelDelta };
}

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function nonNegativeInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be non-negative`);
  return value;
}

function pad(value) {
  return String(value).padStart(4, "0");
}
