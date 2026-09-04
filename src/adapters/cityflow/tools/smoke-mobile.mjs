#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { buildCityflowMobileProduct } from "../src/prepare/csscityflow/mobileModel.mjs";
import { decodeMobileHeights } from "../src/csscityflow/mobileTransforms.mjs";

// Independent pixel check: construct ordinary isometric polygons directly from
// the authored grid and scalar heights, not from the browser's CSS matrices.
const product = buildCityflowMobileProduct();
const heights = decodeMobileHeights(product.playback);
const palettes = [[96,133,25,48,72,16,29,52,10], [87,140,26,41,72,17,22,50,11],
  [110,139,26,59,75,16,37,52,9], [69,147,27,36,74,18,19,49,12]];

export async function captureMobile({ browser, route, width, height,
  deviceScaleFactor = 2, mobileDevice = true, outputRoot, allFrames = false }) {
  const label = `mobile-${width}x${height}-dpr${deviceScaleFactor}`;
  const directory = resolve(outputRoot, label);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor,
    isMobile: mobileDevice, hasTouch: mobileDevice });
  const errors = [];
  const preparedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/csscityflow/")) preparedRequests.push(path);
  });
  try {
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForFunction(() => globalThis.__csscityflow?.ready || globalThis.__csscityflow?.errors.length);
    const initial = await page.evaluate(() => {
      const state = globalThis.__csscityflow;
      if (!state.ready) throw new Error(state.errors.join("\n"));
      state.player.pause();
      return { bankId: state.bankId, stats: state.player.stats() };
    });
    assert.equal(initial.bankId, "mobile");
    assert.equal(initial.stats.retainedFaceCount, product.boxes.length * 3);
    assert.equal(preparedRequests.length, 4);
    assert.ok(preparedRequests.every((path) => path === "/csscityflow/prepared.json" ||
      /^\/csscityflow\/assets\/mobile-(snapshot|stylesheet|playback)-[a-f0-9]{64}\.(html|css|json)$/u.test(path)));
    let checkedInteriorPixels = 0;
    let checkedGapPixels = 0;
    const frameNumbers = allFrames ? Array.from({ length: 360 }, (_, index) => index) : [0, 90, 180, 270, 359];
    const framesDirectory = resolve(directory, "frames");
    await mkdir(framesDirectory, { recursive: true });
    let previous;
    let repeatedImages = 0;
    for (const frame of frameNumbers) {
      const layout = await page.evaluate((frameIndex) => {
        const state = globalThis.__csscityflow;
        state.player.seekFrame(frameIndex);
        const camera = state.dom.cameraElement;
        const scene = state.dom.sceneElement;
        const stage = camera.parentElement.getBoundingClientRect();
        const leaves = state.dom.leafElements.flat();
        for (const element of [camera, scene, ...state.dom.shapeElements, ...leaves]) {
          const style = getComputedStyle(element);
          if (style.transformStyle !== "flat" || style.perspective !== "none" ||
              style.transform.startsWith("matrix3d") || style.visibility !== "visible" ||
              style.display === "none") throw new Error("Mobile inherited a 3D or hidden surface");
        }
        for (const leaf of leaves) {
          const box = leaf.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0 || box.width > stage.width || box.height > stage.height) {
            throw new Error(`Mobile face has an unbounded raster area at ${frameIndex}`);
          }
        }
        if (getComputedStyle(camera).overflow !== "hidden") throw new Error("Mobile camera lost its paint clip");
        const info = document.querySelector(".example-info");
        const hudRange = document.createRange();
        if (info) hudRange.selectNodeContents(info);
        return { x: scene.getBoundingClientRect().x, y: scene.getBoundingClientRect().y,
          scale: camera.getBoundingClientRect().width / 512,
          stage: stage.toJSON(), hud: info ? hudRange.getBoundingClientRect().toJSON() : null };
      }, frame);
      const png = await page.screenshot();
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let blackGapPixels = 0;
      for (let py = Math.ceil((layout.stage.top + 2) * deviceScaleFactor);
        py < Math.floor((layout.stage.bottom - 2) * deviceScaleFactor); py += 1) {
        for (let px = Math.ceil((layout.stage.left + 2) * deviceScaleFactor);
          px < Math.floor((layout.stage.right - 2) * deviceScaleFactor); px += 1) {
          const index = (py * info.width + px) * 3;
          checkedGapPixels += 1;
          if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 0) blackGapPixels += 1;
        }
      }
      if (previous?.equals(data)) repeatedImages += 1;
      previous = data;
      const polygons = framePolygons(frame);
      let badPixels = 0;
      const failures = [];
      for (const face of polygons) {
        for (const u of [0.2, 0.5, 0.8]) for (const v of [0.2, 0.5, 0.8]) {
          const x = face.x + face.ax * u + face.bx * v;
          const y = face.y + face.ay * u + face.by * v;
          const px = Math.floor((layout.x + x * layout.scale) * deviceScaleFactor);
          const py = Math.floor((layout.y + y * layout.scale) * deviceScaleFactor);
          if (px < 0 || py < 0 || px >= info.width || py >= info.height) continue;
          const cssX = (px + 0.5) / deviceScaleFactor;
          const cssY = (py + 0.5) / deviceScaleFactor;
          if (cssX < layout.stage.left + 2 || cssX > layout.stage.right - 2 ||
              cssY < layout.stage.top + 2 || cssY > layout.stage.bottom - 2) continue;
          if (layout.hud && cssX >= layout.hud.left - 2 && cssX <= layout.hud.right + 2 &&
              cssY >= layout.hud.top - 2 && cssY <= layout.hud.bottom + 2) continue;
          const actualX = ((px + 0.5) / deviceScaleFactor - layout.x) / layout.scale;
          const actualY = ((py + 0.5) / deviceScaleFactor - layout.y) / layout.scale;
          const owner = pixelOwner(polygons, actualX, actualY, 1.25 / (layout.scale * deviceScaleFactor));
          if (!owner || owner.edgeDistance < 0.12) continue;
          checkedInteriorPixels += 1;
          const index = (py * info.width + px) * 3;
          if (owner.face.color.some((value, channel) => Math.abs(data[index + channel] - value) > 2)) {
            badPixels += 1;
            if (failures.length < 12) failures.push({ px, py, expected: owner.face.color,
              actual: [...data.subarray(index, index + 3)], edgeDistance: owner.edgeDistance });
          }
        }
      }
      await writeFile(resolve(framesDirectory, `frame_${String(frame).padStart(4, "0")}.png`), png);
      assert.equal(blackGapPixels, 0, `${label} frame ${frame} exposed black space between towers`);
      if (badPixels) console.log(JSON.stringify({ label, frame, layout, failures }));
      assert.equal(badPixels, 0, `${label} frame ${frame}: missing/wrong interior pixels; see ${framesDirectory}`);
    }
    assert.equal(repeatedImages, 0);
    const lifecycle = await page.evaluate(async ({ width, height }) => {
      const state = globalThis.__csscityflow;
      state.player.seekFrame(0);
      state.player.resume();
      const samples = [];
      for (let index = 0; index < 125; index += 1) {
        await new Promise(requestAnimationFrame);
        const stats = state.player.stats();
        samples.push({ frame: stats.frameIndex, time: performance.now(), publications: stats.publicationCount });
      }
      state.player.pause();
      const paused = state.player.stats().frameIndex;
      await new Promise((done) => setTimeout(done, 80));
      if (state.player.stats().frameIndex !== paused) throw new Error("Mobile did not pause");
      return { samples, stats: state.player.stats(), originalViewport: { width, height } };
    }, { width, height });
    const advances = lifecycle.samples.slice(1).map((row, index) => ({
      delta: (row.frame - lifecycle.samples[index].frame + 360) % 360,
      milliseconds: row.time - lifecycle.samples[index].time,
    }));
    assert.ok(advances.every(({ delta }) => delta <= 1), "mobile skipped a prepared state");
    assert.ok(advances.filter(({ delta }) => delta === 1).length > 60);
    assert.equal(lifecycle.stats.runtimeDomMutationCount, 0);
    // Rotation must resize the existing scene, never rebuild or switch banks.
    await page.setViewportSize({ width: height, height: width });
    const rotated = await page.evaluate(() => ({ bankId: __csscityflow.bankId,
      stable: __csscityflow.dom.assertStableDomIdentity(), stats: __csscityflow.player.stats() }));
    assert.equal(rotated.bankId, "mobile");
    assert.equal(rotated.stable, true);
    assert.equal(rotated.stats.runtimeDomMutationCount, 0);
    assert.deepEqual(errors, []);
    return { label, width, height, deviceScaleFactor, checkedFrames: frameNumbers.length,
      checkedInteriorPixels, checkedGapPixels, blackGapPixels: 0,
      wrongInteriorPixels: 0, repeatedImages, preparedRequests,
      maximumSampleIntervalMs: Math.max(...advances.map(({ milliseconds }) => milliseconds)),
      adjacentTransitions: advances.filter(({ delta }) => delta === 1).length,
      stableAfterRotation: true, framesDirectory };
  } finally { await page.close(); }
}

function framePolygons(frame) {
  return product.boxes.flatMap(({ row, column, x, y, width, depth }, box) => {
    const h = heights[frame * product.boxes.length + box] * product.playback.heightScale / 1000;
    const rgb = palettes[(row * 3 + column) % 4];
    return [
      { x, y: y - h, ax: width, ay: width * 0.22, bx: -depth * 0.36, by: depth * 0.6, color: rgb.slice(0, 3) },
      { x: x - depth * 0.36, y: y + depth * 0.6 - h, ax: width, ay: width * 0.22,
        bx: 0, by: h, color: rgb.slice(3, 6) },
      { x: x + width - depth * 0.36, y: y + width * 0.22 + depth * 0.6 - h,
        ax: depth * 0.36, ay: -depth * 0.6, bx: 0, by: h, color: rgb.slice(6, 9) },
    ];
  });
}

function pixelOwner(polygons, x, y, rasterMargin) {
  for (let index = polygons.length - 1; index >= 0; index -= 1) {
    const face = polygons[index];
    const det = face.ax * face.by - face.ay * face.bx;
    const u = ((x - face.x) * face.by - (y - face.y) * face.bx) / det;
    const v = (face.ax * (y - face.y) - face.ay * (x - face.x)) / det;
    // Exclude the 1.25-device-pixel antialias band of ANY nearer face,
    // including a nearer edge just outside the mathematical polygon.
    const eu = rasterMargin * Math.hypot(face.bx, face.by) / Math.abs(det);
    const ev = rasterMargin * Math.hypot(face.ax, face.ay) / Math.abs(det);
    if (u >= -eu && u <= 1 + eu && v >= -ev && v <= 1 + ev &&
        (u < eu || u > 1 - eu || v < ev || v > 1 - ev)) return null;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      return { face, edgeDistance: Math.min(u, v, 1 - u, 1 - v) };
    }
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const outputRoot = resolve(process.env.CSSCITYFLOW_MOBILE_SMOKE_OUT ?? "output/playwright/cityflow-mobile-rebuild/continuous-loop");
  const route = process.env.CSSCITYFLOW_SMOKE_URL ?? "http://127.0.0.1:4325/cityflow/";
  try {
    const reports = [];
    for (const [width, height, deviceScaleFactor] of [[320,568,1], [390,844,2], [448,827,2.25], [844,390,2], [599,900,1]]) {
      const report = await captureMobile({ browser, route, width, height, deviceScaleFactor,
        outputRoot, allFrames: process.argv.includes("--all-frames") });
      reports.push(report);
      console.log(JSON.stringify(report));
    }
    await writeFile(resolve(outputRoot, "report.json"), JSON.stringify({
      browser: await browser.version(), target: "installed Chrome, headless; not physical Android",
      route, reports,
    }, null, 2));
  } finally { await browser.close(); }
}
