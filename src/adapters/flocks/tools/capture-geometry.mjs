#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/geometry");
const browserFrames = resolve(outputRoot, "browser-frames");
const nativeFrames = resolve(outputRoot, "native-frames");
const port = 4188;
const url = `http://127.0.0.1:${port}/flocks/?palette=rotate-120`;
await mkdir(browserFrames, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot, env: process.env, stdio: "ignore",
});
let browser;
try {
  await waitForServer(url, server);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__cssFlocksDebug.pause();
    document.querySelector(".examples-sidebar")?.style.setProperty("display", "none");
    document.querySelector(".example-info")?.style.setProperty("display", "none");
    document.querySelector(".example-stage")?.style.setProperty("inset", "0");
    const camera = document.querySelector(".example-stage > .polycss-camera");
    const scene = camera.querySelector(":scope > .polycss-scene");
    const roots = [...scene.children];
    roots.slice(1).forEach((root) => { root.style.display = "none"; });
    camera.style.setProperty("--flocks-perspective", "686.275px");
    scene.style.left = "50%";
    scene.style.top = "50%";
    scene.style.transform = "translateZ(672.275px) scaleY(-1)";
    roots[0].style.color = "rgb(38, 204, 255)";
    window.__cssFlocksGeometryRoot = roots[0];
  });
  const frameReports = [];
  for (let frame = 0; frame < 12; frame += 1) {
    await page.evaluate((angle) => {
      window.__cssFlocksGeometryRoot.style.transform = `rotateX(15deg) rotateY(${angle}deg) scale3d(1, 1, 1.6)`;
    }, frame * 30);
    await page.waitForTimeout(50);
    const path = resolve(browserFrames, `browser-${String(frame).padStart(3, "0")}.png`);
    await page.screenshot({ path });
    frameReports.push(await inspectFrame(path, frame));
  }
  await makeContactSheet(browserFrames, "browser", resolve(outputRoot, "browser-contact-sheet.png"));
  await makeContactSheet(nativeFrames, "native", resolve(outputRoot, "native-contact-sheet.png"), "ppm");
  const report = Object.freeze({
    schema: "cssflocks-isolated-geometry-capture@1",
    url,
    frames: Object.freeze(frameReports),
    minimumVisiblePixelCount: Math.min(...frameReports.map((frame) => frame.visiblePixelCount)),
    maximumVisiblePixelCount: Math.max(...frameReports.map((frame) => frame.visiblePixelCount)),
    browserFrames,
    nativeFrames,
    browserContactSheet: resolve(outputRoot, "browser-contact-sheet.png"),
    nativeContactSheet: resolve(outputRoot, "native-contact-sheet.png"),
    lightingDeviation: "browser uses prepared source-directional root brightness plus fixed face factors; native uses smooth directional and specular lighting",
  });
  if (report.minimumVisiblePixelCount < 1000 || frameReports.some((frame) => frame.coloredBounds.width < 20 || frame.coloredBounds.height < 20)) {
    throw new Error(`Isolated Flocks browser geometry lost front faces: ${JSON.stringify(report)}`);
  }
  await writeFile(resolve(outputRoot, "capture-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}

async function inspectFrame(path, frame) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let visiblePixelCount = 0;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 3;
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 24) continue;
      visiblePixelCount += 1;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return Object.freeze({ frame, angleDegrees: frame * 30, visiblePixelCount, coloredBounds: Object.freeze({ left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }), path });
}

async function makeContactSheet(root, prefix, output, extension = "png") {
  const cells = [];
  for (let frame = 0; frame < 12; frame += 1) {
    const input = resolve(root, `${prefix}-${String(frame).padStart(3, "0")}.${extension}`);
    const source = extension === "ppm" ? await readPpm(input) : sharp(input);
    cells.push({ input: await source.resize(240, 240, { fit: "contain", background: "#000" }).png().toBuffer(), left: frame % 4 * 240, top: Math.floor(frame / 4) * 240 });
  }
  await sharp({ create: { width: 960, height: 720, channels: 3, background: "#000" } }).composite(cells).png().toFile(output);
}

async function readPpm(path) {
  const bytes = await readFile(path);
  const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(bytes.subarray(0, 64).toString("ascii"));
  if (!match) throw new Error(`Unsupported PPM header in ${path}`);
  const offset = Buffer.byteLength(match[0], "ascii");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = bytes.subarray(offset);
  if (pixels.byteLength !== width * height * 3) throw new Error(`PPM byte length drifted in ${path}`);
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks geometry server exited early: ${child.exitCode}`);
    try { const response = await fetch(targetUrl); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks geometry server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
