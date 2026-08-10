#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { createPreparedKentMotion } from "../src/prepare/cssselectropaint/kentMotion.mjs";
import { KENT_VARIANTS } from "../src/prepare/cssselectropaint/variants.mjs";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const captureStateIndex = 359;
const outputRoot = resolve(
  repositoryRoot,
  "bench/results/cssselectropaint/variants/prepared-openings",
);
await mkdir(outputRoot, { recursive: true });
const port = await freePort();
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000);
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    for (const [variantIndex, variant] of KENT_VARIANTS.entries()) {
      const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
      const forcedRandomValue = variantIndex * 0x4000_0000 + 0x2000_0000;
      await context.addInitScript((value) => {
        Object.defineProperty(globalThis.crypto, "getRandomValues", {
          configurable: true,
          value(values) {
            values[0] = value;
            for (let index = 1; index < values.length; index += 1) values[index] = 0;
            return values;
          },
        });
      }, forcedRandomValue);
      const page = await context.newPage();
      const variantAssetUrls = [];
      page.on("response", (response) => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith("/cssselectropaint/variants/")) variantAssetUrls.push(path);
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => globalThis.__cssElectropaint?.status === "ready" ||
          globalThis.__cssElectropaint?.status === "error",
        null,
        { timeout: 120_000 },
      );
      const status = await page.evaluate(() => ({
        status: globalThis.__cssElectropaint.status,
        error: globalThis.__cssElectropaint.error,
      }));
      if (status.status !== "ready") throw new Error(status.error || "ElectroPaint variant capture failed");
      await page.evaluate(async (stateIndex) => {
        const api = globalThis.__cssElectropaint;
        api.pause();
        await api.setState(stateIndex);
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      }, captureStateIndex);
      const packedPath = resolve(outputRoot, `${variant.id}-packed.png`);
      await page.screenshot({ path: packedPath });
      const exactTransforms = exactPhysicalTransforms(variant, captureStateIndex);
      await page.evaluate((transforms) => {
        const quads = [...document.querySelectorAll(".polycss-scene > b")];
        for (let index = 0; index < quads.length; index += 1) quads[index].style.transform = transforms[index];
      }, exactTransforms);
      await new Promise((resolveFrame) => setTimeout(resolveFrame, 50));
      const exactPath = resolve(outputRoot, `${variant.id}-exact.png`);
      await page.screenshot({ path: exactPath });
      const diffPath = resolve(outputRoot, `${variant.id}-absolute-diff-16x.png`);
      const diff = await writeAbsoluteDiff(exactPath, packedPath, diffPath);
      const selectedId = await page.evaluate(() => globalThis.__cssElectropaint.selectedVariant.id);
      const fetchedVariantIds = [...new Set(variantAssetUrls.map((path) => path.split("/")[3]))];
      if (selectedId !== variant.id || fetchedVariantIds.length !== 1 || fetchedVariantIds[0] !== variant.id) {
        throw new Error(`ElectroPaint selected-only variant fetch drifted for ${variant.id}`);
      }
      results.push({
        id: variant.id,
        seed: `0x${variant.seed.toString(16)}`,
        warmupStateCount: variant.warmupStateCount,
        captureStateIndex,
        fetchedVariantIds,
        variantAssetRequestCount: variantAssetUrls.length,
        packedSha256: await fileSha256(packedPath),
        exactSha256: await fileSha256(exactPath),
        diff,
        packedPath,
        exactPath,
        diffPath,
      });
      await context.close();
    }
    if (new Set(results.map((result) => result.packedSha256)).size !== KENT_VARIANTS.length) {
      throw new Error("Prepared ElectroPaint variant openings are not visually distinct");
    }
    const mosaicPath = resolve(outputRoot, "prepared-variant-openings.png");
    await sharp({
      create: { width: 960, height: 540, channels: 4, background: "#000000" },
    }).composite(await Promise.all(results.map(async (result, index) => ({
      input: await sharp(result.packedPath).resize(480, 270).png().toBuffer(),
      left: (index % 2) * 480,
      top: Math.floor(index / 2) * 270,
    })))).png().toFile(mosaicPath);
    const summary = {
      schema: "cssselectropaint-prepared-variant-visual-proof@1",
      browser: await browser.version(),
      viewport: { width: 960, height: 540, deviceScaleFactor: 1 },
      selection: "forced-one-bin-per-crypto-random-variant-for-proof-only",
      productSelection: "one-crypto-random-variant-before-asset-fetch",
      packedAffineQuantizationScale: 1_000,
      distinctOpeningImageCount: new Set(results.map((result) => result.packedSha256)).size,
      maximumChangedPixelCount: Math.max(...results.map((result) => result.diff.changedPixelCount)),
      maximumChannelDelta: Math.max(...results.map((result) => result.diff.maximumChannelDelta)),
      results,
      mosaicPath,
    };
    await writeFile(resolve(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function exactPhysicalTransforms(variant, stateIndex) {
  const motion = createPreparedKentMotion(variant.seed);
  for (let index = 0; index < variant.warmupStateCount + stateIndex; index += 1) motion.step();
  const frame = motion.readFrame();
  const physical = new Array(40);
  for (let logicalIndex = 0; logicalIndex < 40; logicalIndex += 1) {
    const physicalIndex = ((logicalIndex - stateIndex) % 40 + 40) % 40;
    physical[physicalIndex] = matrix3d(frame.matrices[logicalIndex]);
  }
  return physical;
}

function matrix3d(matrix) {
  return `matrix3d(${matrix.map((value) => {
    if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
    return Number(value.toFixed(12)).toString();
  }).join(",")})`;
}

async function writeAbsoluteDiff(exactPath, packedPath, outputPath) {
  const exact = await sharp(exactPath).raw().toBuffer({ resolveWithObject: true });
  const packed = await sharp(packedPath).raw().toBuffer({ resolveWithObject: true });
  if (exact.info.width !== packed.info.width || exact.info.height !== packed.info.height ||
      exact.info.channels !== packed.info.channels) throw new Error("ElectroPaint proof image dimensions drifted");
  const output = Buffer.alloc(exact.data.length);
  let changedPixelCount = 0;
  let absoluteChannelDelta = 0;
  let maximumChannelDelta = 0;
  for (let pixel = 0; pixel < exact.info.width * exact.info.height; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < exact.info.channels; channel += 1) {
      const index = pixel * exact.info.channels + channel;
      const delta = Math.abs(exact.data[index] - packed.data[index]);
      if (channel < 3) {
        changed ||= delta !== 0;
        absoluteChannelDelta += delta;
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        output[index] = Math.min(255, delta * 16);
      } else {
        output[index] = 255;
      }
    }
    if (changed) changedPixelCount += 1;
  }
  await sharp(output, { raw: exact.info }).png().toFile(outputPath);
  return {
    changedPixelCount,
    changedPixelFraction: changedPixelCount / (exact.info.width * exact.info.height),
    meanAbsoluteChannelDelta: absoluteChannelDelta / (exact.info.width * exact.info.height * 3),
    maximumChannelDelta,
  };
}

async function fileSha256(path) {
  const bytes = await sharp(path).png().toBuffer();
  return createHash("sha256").update(bytes).digest("hex");
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      listener.close(() => resolvePort(selected));
    });
    listener.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds) {
  const started = Date.now();
  while (!predicate()) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${serverOutput}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}
