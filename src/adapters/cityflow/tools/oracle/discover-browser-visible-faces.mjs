#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const route = process.env.CSSCITYFLOW_VISIBLE_FACE_URL ?? "http://127.0.0.1:4325/cityflow/";
const width = Number.parseInt(process.env.CSSCITYFLOW_VISIBLE_FACE_WIDTH ?? "1280", 10);
const height = Number.parseInt(process.env.CSSCITYFLOW_VISIBLE_FACE_HEIGHT ?? "720", 10);
const outputPath = resolve(process.env.CSSCITYFLOW_VISIBLE_FACE_OUT ??
  "bench/results/csscityflow/browser-visible-faces.json");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready, null, { timeout: 30_000 });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  const setup = await page.evaluate(async () => {
    const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Cityflow face-ID playback failed: ${response.status}`);
    const playback = await response.json();
    const boxes = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
    const leaves = boxes.flatMap((box) => [...box.children]);
    if (boxes.length !== playback.boxCount || leaves.length !== playback.boxCount * playback.facesPerBox) {
      throw new Error("Cityflow face-ID retained binding drifted");
    }
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflowFaceIdPlayback = playback;
    const colors = leaves.map((leaf, faceIndex) => {
      const red = 32 + faceIndex % 10 * 20;
      const green = 32 + Math.floor(faceIndex / 10) % 10 * 20;
      const blue = 32 + Math.floor(faceIndex / 100) * 20;
      const color = `rgb(${red}, ${green}, ${blue})`;
      leaf.style.setProperty("display", "block", "important");
      leaf.style.setProperty("visibility", "visible", "important");
      leaf.style.setProperty("opacity", "1", "important");
      leaf.style.setProperty("background-color", color, "important");
      return [red, green, blue];
    });
    globalThis.__csscityflowFaceIdColors = colors;
    return { frameCount: playback.frameCount, boxCount: playback.boxCount, colors };
  });
  const faceIndexByColor = new Map(setup.colors.map((color, faceIndex) =>
    [color.join(","), faceIndex]));
  const visibleFrameIndices = Array.from({ length: setup.colors.length }, () => []);
  for (let frameIndex = 0; frameIndex < setup.frameCount; frameIndex += 1) {
    await page.evaluate((nextFrameIndex) => {
      globalThis.__csscityflow.player.seekFrame(nextFrameIndex);
      const leaves = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")];
      leaves.forEach((leaf, faceIndex) => {
        const [red, green, blue] = globalThis.__csscityflowFaceIdColors[faceIndex];
        leaf.style.setProperty("display", "block", "important");
        leaf.style.setProperty("visibility", "visible", "important");
        leaf.style.setProperty("opacity", "1", "important");
        leaf.style.setProperty("background-color", `rgb(${red}, ${green}, ${blue})`, "important");
      });
    }, frameIndex);
    const screenshot = await page.screenshot();
    const image = await sharp(screenshot).removeAlpha().raw().toBuffer();
    const found = new Set();
    for (let byteIndex = 0; byteIndex < image.length; byteIndex += 3) {
      const faceIndex = faceIndexByColor.get(
        `${image[byteIndex]},${image[byteIndex + 1]},${image[byteIndex + 2]}`,
      );
      if (faceIndex !== undefined) found.add(faceIndex);
    }
    for (const faceIndex of found) visibleFrameIndices[faceIndex].push(frameIndex);
  }
  if (errors.length > 0) throw new Error(`Cityflow face-ID capture failed: ${errors.join("\n")}`);
  const visibleFaceIndices = visibleFrameIndices
    .map((frames, faceIndex) => frames.length > 0 ? faceIndex : -1)
    .filter((faceIndex) => faceIndex >= 0);
  const rows = Array.from({ length: setup.frameCount }, () => new Uint8Array(setup.colors.length));
  visibleFrameIndices.forEach((frames, faceIndex) => {
    for (const frameIndex of frames) rows[frameIndex][faceIndex] = 1;
  });
  const initial = Buffer.alloc(Math.ceil(setup.colors.length / 8));
  for (let faceIndex = 0; faceIndex < setup.colors.length; faceIndex += 1) {
    if (rows[0][faceIndex] !== 0) initial[faceIndex >> 3] |= 1 << (faceIndex & 7);
  }
  const offsets = [0];
  const indices = [];
  for (let frameIndex = 0; frameIndex < setup.frameCount; frameIndex += 1) {
    const previousFrameIndex = (frameIndex - 1 + setup.frameCount) % setup.frameCount;
    for (let faceIndex = 0; faceIndex < setup.colors.length; faceIndex += 1) {
      if (rows[frameIndex][faceIndex] !== rows[previousFrameIndex][faceIndex]) {
        indices.push(faceIndex);
      }
    }
    offsets.push(indices.length);
  }
  const offsetBytes = Buffer.alloc(offsets.length * Uint16Array.BYTES_PER_ELEMENT);
  const indexBytes = Buffer.alloc(indices.length * Uint16Array.BYTES_PER_ELEMENT);
  offsets.forEach((value, index) => offsetBytes.writeUInt16LE(value, index * 2));
  indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
  const visibleCounts = rows.map((row) => row.reduce((sum, value) => sum + value, 0));
  const report = {
    schema: "csscityflow-browser-visible-face-id-source@1",
    encoding: "initial-bitset-plus-u16le-per-target-frame-toggle-offsets-and-face-indices",
    browser: { name: "Google Chrome", version: browser.version(), headless: true },
    viewport: { width, height, deviceScaleFactor: 1 },
    frameCount: setup.frameCount,
    faceCount: setup.colors.length,
    initialVisibleCount: visibleCounts[0],
    minimumVisibleFaces: Math.min(...visibleCounts),
    maximumVisibleFaces: Math.max(...visibleCounts),
    meanVisibleFaces: visibleCounts.reduce((sum, value) => sum + value, 0) / setup.frameCount,
    visibleFaceCount: visibleFaceIndices.length,
    visibleFaceIndices,
    transitionCount: indices.length,
    initialVisibleBitsBase64: initial.toString("base64"),
    transitionOffsetsBase64: offsetBytes.toString("base64"),
    transitionFaceIndicesBase64: indexBytes.toString("base64"),
    provenance: {
      method: "chrome-solid-face-id-exact-interior-pixel-census",
      route,
      presentation: "current-prepared-presentation-player-seek-frame",
    },
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
} finally {
  await browser.close();
}
