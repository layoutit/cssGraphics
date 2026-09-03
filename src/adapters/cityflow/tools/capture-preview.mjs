#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputPath = resolve(repositoryRoot, "site/public/landing/cityflow.webp");
const sidebarPath = resolve(repositoryRoot, "site/public/landing/sidebar/cityflow.webp");
const server = await createServer({
  configFile: resolve(repositoryRoot, "src/adapters/cityflow/vite.config.mjs"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 4217, strictPort: true, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await page.route("**/landing/cityflow.webp", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto("http://127.0.0.1:4217/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(async () => {
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflow.player.seekFrame(92);
    await new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
  });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  await page.evaluate(() => new Promise((resolvePaint) =>
    requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
  const png = await page.screenshot({ type: "png" });
  await mkdir(dirname(sidebarPath), { recursive: true });
  await sharp(png).webp({ lossless: true, effort: 6 }).toFile(outputPath);
  await sharp(png).resize(480, 270).webp({ lossless: true, effort: 6 }).toFile(sidebarPath);
  for (const path of [outputPath, sidebarPath]) {
    const metadata = await sharp(path).metadata();
    const expectedWidth = path === outputPath ? 960 : 480;
    const expectedHeight = path === outputPath ? 540 : 270;
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error(`Cityflow preview dimensions drifted: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: "prepared", outputPath, sidebarPath }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
