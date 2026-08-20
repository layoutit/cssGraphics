#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/cadence/visual");
const port = 4196;
const url = `http://127.0.0.1:${port}/flocks/?window=source-114s`;
const opaquePath = resolve(outputRoot, "opaque-flat-lighting.png");
const alphaPath = resolve(outputRoot, "prior-alpha-lighting-reference.png");
const globalContextPath = resolve(outputRoot, "prior-global-preserve-3d-reference.png");
const lightingDifferencePath = resolve(outputRoot, "lighting-absolute-difference-8x.png");
const contextDifferencePath = resolve(outputRoot, "context-absolute-difference-8x.png");
const lightingComparisonPath = resolve(outputRoot, "lighting-comparison.png");
const contextComparisonPath = resolve(outputRoot, "context-comparison.png");
const faceFactors = Object.freeze([0.78, 0.9, 1, 0.82, 0.96, 0.86]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "ignore",
});
let browser;
try {
  await waitForServer(url, server);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
  const state = await page.evaluate(() => {
    window.__cssFlocksDebug.pause();
    window.__cssFlocksDebug.seekFrame(30);
    document.querySelector(".site-header")?.remove();
    const scene = document.querySelector("body > .polycss-camera > .polycss-scene");
    const roots = [...scene.children];
    return {
      stats: window.__cssFlocksDebug.stats(),
      rootCount: roots.length,
      leafCount: roots.reduce((sum, root) => sum + root.childElementCount, 0),
      sceneDisplay: getComputedStyle(scene).display,
      sceneTransformStyle: getComputedStyle(scene).transformStyle,
      rootTransformStyle: getComputedStyle(roots[0]).transformStyle,
      rootTranslate: getComputedStyle(roots[0]).translate,
      rootScale: getComputedStyle(roots[0]).scale,
    };
  });
  await twoPaints(page);
  const qualifiedRects = await readProjectedLeafRects(page);
  await page.screenshot({ path: opaquePath });
  await page.evaluate(() => {
    const scene = document.querySelector("body > .polycss-camera > .polycss-scene");
    scene.style.display = "block";
    for (const root of scene.children) {
      root.style.left = "0";
      root.style.top = "0";
      root.style.translate = "none";
      root.style.scale = "none";
    }
  });
  await twoPaints(page);
  const globalReferenceRects = await readProjectedLeafRects(page);
  await page.screenshot({ path: globalContextPath });
  await page.evaluate((factors) => {
    const scene = document.querySelector("body > .polycss-camera > .polycss-scene");
    scene.style.removeProperty("display");
    for (const root of scene.children) {
      root.style.removeProperty("left");
      root.style.removeProperty("top");
      root.style.removeProperty("translate");
      root.style.removeProperty("scale");
      [...root.children].forEach((leaf, index) => {
        leaf.style.backgroundColor = "currentColor";
        leaf.style.opacity = String(factors[index]);
      });
    }
  }, faceFactors);
  await twoPaints(page);
  await page.screenshot({ path: alphaPath });
  const lightingDifference = await compareImages(opaquePath, alphaPath, lightingDifferencePath);
  const contextDifference = await compareImages(opaquePath, globalContextPath, contextDifferencePath);
  const projectionDifference = compareProjectedRects(qualifiedRects, globalReferenceRects);
  await makeComparison([
    [opaquePath, "qualified opaque flat lighting"],
    [alphaPath, "prior alpha reference"],
    [lightingDifferencePath, "absolute difference x8"],
  ], lightingComparisonPath);
  await makeComparison([
    [opaquePath, "qualified boxless scene"],
    [globalContextPath, "prior global preserve-3D"],
    [contextDifferencePath, "absolute difference x8"],
  ], contextComparisonPath);
  const report = Object.freeze({
    schema: "cssflocks-flat-lighting-visual-comparison@1",
    browser: "installed Chrome via Playwright channel=chrome",
    url,
    explicitStartupWindow: "source-114s",
    blockFrameIndex: 30,
    sourceFrameIndex: 6_870,
    faceFactors,
    state,
    errors,
    lightingDifference,
    contextDifference,
    projectionDifference,
    opaquePath,
    priorAlphaReferencePath: alphaPath,
    priorGlobalPreserve3dReferencePath: globalContextPath,
    lightingAbsoluteDifferencePath: lightingDifferencePath,
    contextAbsoluteDifferencePath: contextDifferencePath,
    lightingComparisonPath,
    contextComparisonPath,
  });
  if (errors.length > 0 || state.rootCount !== 324 || state.leafCount !== 1_944 ||
      state.stats.streamFrameIndex !== 6_870 || state.sceneDisplay !== "contents" ||
      state.sceneTransformStyle !== "preserve-3d" || state.rootTransformStyle !== "preserve-3d" ||
      state.rootScale !== "1 -1" || projectionDifference.visibilityMismatchCount !== 0 ||
      projectionDifference.p95CoordinateDeltaPixels > 0.25) {
    throw new Error(`Flocks cadence visual binding failed: ${JSON.stringify(report)}`);
  }
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}

async function compareImages(leftPath, rightPath, outputPath) {
  const [left, right] = await Promise.all([
    sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (left.info.width !== right.info.width || left.info.height !== right.info.height || left.data.length !== right.data.length) {
    throw new Error("Flocks lighting comparison images have incompatible dimensions");
  }
  const difference = Buffer.alloc(left.data.length);
  const perPixelMaximum = [];
  let channelDeltaTotal = 0;
  let changedPixelsAbove2 = 0;
  let visiblePixelCount = 0;
  let visibleChangedPixelsAbove2 = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < left.data.length; offset += 3) {
    let pixelMaximum = 0;
    let visible = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left.data[offset + channel] - right.data[offset + channel]);
      difference[offset + channel] = Math.min(255, delta * 8);
      channelDeltaTotal += delta;
      pixelMaximum = Math.max(pixelMaximum, delta);
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
      visible ||= left.data[offset + channel] > 8 || right.data[offset + channel] > 8;
    }
    perPixelMaximum.push(pixelMaximum);
    if (pixelMaximum > 2) changedPixelsAbove2 += 1;
    if (visible) {
      visiblePixelCount += 1;
      if (pixelMaximum > 2) visibleChangedPixelsAbove2 += 1;
    }
  }
  perPixelMaximum.sort((leftValue, rightValue) => leftValue - rightValue);
  await sharp(difference, { raw: left.info }).png().toFile(outputPath);
  return Object.freeze({
    width: left.info.width,
    height: left.info.height,
    meanAbsoluteChannelDelta: Number((channelDeltaTotal / left.data.length).toFixed(6)),
    p95PixelMaximumChannelDelta: percentile(perPixelMaximum, 0.95),
    maximumChannelDelta,
    changedPixelFractionAbove2: Number((changedPixelsAbove2 / perPixelMaximum.length).toFixed(6)),
    visiblePixelCount,
    visibleChangedPixelFractionAbove2: Number((visibleChangedPixelsAbove2 / Math.max(1, visiblePixelCount)).toFixed(6)),
    differenceVisualizationScale: 8,
  });
}

async function readProjectedLeafRects(page) {
  return page.evaluate(() => [...document.querySelectorAll("body > .polycss-camera > .polycss-scene > div > *")].map((leaf) => {
    const rect = leaf.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      visible: rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
    };
  }));
}

function compareProjectedRects(qualified, reference) {
  if (qualified.length !== reference.length) throw new Error("Flocks projected leaf counts drifted");
  const coordinateDeltas = [];
  let visibilityMismatchCount = 0;
  for (let index = 0; index < qualified.length; index += 1) {
    const left = qualified[index];
    const right = reference[index];
    if (left.visible !== right.visible) visibilityMismatchCount += 1;
    if (!left.visible && !right.visible) continue;
    for (const key of ["left", "top", "right", "bottom"]) {
      coordinateDeltas.push(Math.abs(left[key] - right[key]));
    }
  }
  coordinateDeltas.sort((left, right) => left - right);
  return Object.freeze({
    comparedVisibleLeafCount: coordinateDeltas.length / 4,
    visibilityMismatchCount,
    p95CoordinateDeltaPixels: Number(percentile(coordinateDeltas, 0.95).toFixed(6)),
    maximumCoordinateDeltaPixels: Number((coordinateDeltas.at(-1) ?? 0).toFixed(6)),
  });
}

async function makeComparison(sources, output) {
  const width = 426;
  const height = 267;
  const labelHeight = 28;
  const composites = [];
  for (let index = 0; index < sources.length; index += 1) {
    const [path, text] = sources[index];
    composites.push({ input: await sharp(path).resize(width, height).png().toBuffer(), left: index * width, top: labelHeight });
    composites.push({ input: label(text, width, labelHeight), left: index * width, top: 0 });
  }
  await sharp({ create: { width: width * sources.length, height: height + labelHeight, channels: 3, background: "#000" } })
    .composite(composites)
    .png()
    .toFile(output);
}

function label(text, width, height) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="19" fill="#ddd" font-family="monospace" font-size="13">${text}</text></svg>`);
}

function percentile(values, fraction) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

async function twoPaints(page) {
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks cadence visual server exited early: ${child.exitCode}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks cadence visual server did not become ready");
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
