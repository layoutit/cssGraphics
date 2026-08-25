#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputPath = resolve(repositoryRoot,
  process.env.CSSBLACKHOLE_PREVIEW_OUTPUT ?? "site/public/landing/luminet.webp");
const sidebarOutputPath = resolve(repositoryRoot,
  process.env.CSSBLACKHOLE_SIDEBAR_PREVIEW_OUTPUT ??
    "site/public/landing/sidebar/luminet.webp");
const streamFrame = Number(process.env.CSSBLACKHOLE_PREVIEW_STREAM_FRAME ?? 120);
const previewWidth = Number(process.env.CSSBLACKHOLE_PREVIEW_WIDTH ?? 960);
const previewHeight = Number(process.env.CSSBLACKHOLE_PREVIEW_HEIGHT ?? 540);
const cropWidth = Number(process.env.CSSBLACKHOLE_PREVIEW_CROP_WIDTH ?? 560);
const cropHeight = Number(process.env.CSSBLACKHOLE_PREVIEW_CROP_HEIGHT ?? 315);
const deviceScaleFactor = Number(process.env.CSSBLACKHOLE_PREVIEW_DPR ?? 2);
if (!Number.isSafeInteger(streamFrame) || streamFrame < 0 || streamFrame >= 10800) {
  throw new Error("BlackHole preview stream frame drifted");
}
if (!Number.isSafeInteger(previewWidth) || previewWidth < 1 ||
    !Number.isSafeInteger(previewHeight) || previewHeight < 1) {
  throw new Error("BlackHole preview viewport drifted");
}
if (!Number.isSafeInteger(cropWidth) || cropWidth < 1 || cropWidth > previewWidth ||
    !Number.isSafeInteger(cropHeight) || cropHeight < 1 || cropHeight > previewHeight ||
    cropWidth * previewHeight !== cropHeight * previewWidth) {
  throw new Error("BlackHole preview crop drifted");
}
if (!Number.isSafeInteger(deviceScaleFactor) || deviceScaleFactor < 1 || deviceScaleFactor > 4) {
  throw new Error("BlackHole preview DPR drifted");
}
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(sidebarOutputPath), { recursive: true });
const server = await createServer({
  configFile: resolve(repositoryRoot, "src/adapters/blackhole/vite.config.mjs"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 4211, strictPort: true, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: previewWidth, height: previewHeight },
    deviceScaleFactor,
  });
  await page.route("**/landing/luminet.webp", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto("http://127.0.0.1:4211/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssBlackHoleDebug?.ready === true, null, {
    timeout: 30_000,
  });
  await page.evaluate(async (frame) => {
    window.__cssBlackHoleDebug.pause();
    await window.__cssBlackHoleDebug.seekStreamFrame(frame);
  }, streamFrame);
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  await page.evaluate(() => new Promise((resolvePromise) =>
    requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const png = await page.screenshot({ type: "png" });
  await sharp(png)
    .extract({
      left: Math.floor((previewWidth - cropWidth) / 2) * deviceScaleFactor,
      top: Math.floor((previewHeight - cropHeight) / 2) * deviceScaleFactor,
      width: cropWidth * deviceScaleFactor,
      height: cropHeight * deviceScaleFactor,
    })
    .resize(previewWidth, previewHeight)
    .webp({ quality: 88, smartSubsample: true })
    .toFile(outputPath);
  await sharp(outputPath)
    .resize(480, 270)
    .webp({ quality: 88, smartSubsample: true })
    .toFile(sidebarOutputPath);
  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== previewWidth || metadata.height !== previewHeight) {
    throw new Error("BlackHole landing preview dimensions drifted");
  }
  console.log(`prepared frame ${streamFrame} at ${outputPath}`);
} finally {
  await browser?.close();
  await server.close();
}
