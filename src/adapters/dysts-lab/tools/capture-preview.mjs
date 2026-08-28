#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputPath = resolve(repositoryRoot,
  process.env.CSSCHAOS_PREVIEW_OUTPUT ?? "site/public/landing/chaos.webp");
const sidebarOutputPath = resolve(repositoryRoot,
  process.env.CSSCHAOS_SIDEBAR_PREVIEW_OUTPUT ?? "site/public/landing/sidebar/chaos.webp");
const system = process.env.CSSCHAOS_PREVIEW_SYSTEM ?? "bouali2";
const previewWidth = 960;
const previewHeight = 540;
const cropWidth = 720;
const cropHeight = 405;
const deviceScaleFactor = 2;
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(sidebarOutputPath), { recursive: true });
await ensurePlaceholder(outputPath, previewWidth, previewHeight);
await ensurePlaceholder(sidebarOutputPath, 480, 270);
const server = await createServer({
  configFile: resolve(repositoryRoot, "src/adapters/dysts-lab/vite.config.mjs"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 4217, strictPort: true, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: previewWidth, height: previewHeight },
    deviceScaleFactor,
  });
  await page.goto(`http://127.0.0.1:4217/?start=${encodeURIComponent(system)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__cssChaosDebug?.ready === true, null, {
    timeout: 30_000,
  });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  await page.waitForTimeout(3_800);
  await page.evaluate(() => window.__cssChaosDebug.pause());
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
  await sharp(outputPath).resize(480, 270)
    .webp({ quality: 88, smartSubsample: true }).toFile(sidebarOutputPath);
  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== previewWidth || metadata.height !== previewHeight) {
    throw new Error("Chaos landing preview dimensions drifted");
  }
  console.log(`prepared ${system} preview at ${outputPath}`);
} finally {
  await browser?.close();
  await server.close();
}

async function ensurePlaceholder(path, width, height) {
  try {
    await access(path);
  } catch {
    await sharp({ create: { width, height, channels: 3, background: "#000000" } })
      .webp({ quality: 1 }).toFile(path);
  }
}
