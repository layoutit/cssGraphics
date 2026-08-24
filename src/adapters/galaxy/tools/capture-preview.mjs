#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputPath = resolve(repositoryRoot, "site/public/landing/galaxy.webp");
const server = await createServer({
  configFile: resolve(repositoryRoot, "src/adapters/galaxy/vite.config.mjs"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 4211, strictPort: true, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  await page.route("**/landing/galaxy.webp", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto("http://127.0.0.1:4211/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => window.__cssGalaxyDebug?.ready === true, null, {
    timeout: 30_000,
  });
  await page.evaluate(async () => {
    window.__cssGalaxyDebug.pause();
    await window.__cssGalaxyDebug.seekStreamFrame(0);
  });
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage {
      position: fixed !important;
      inset: 0 !important;
      width: 480px !important;
      height: 270px !important;
    }
    .example-stage > .polycss-camera {
      --cssgalaxy-cover-scale: 0.8 !important;
      transform: translate(-55.7%, -48.33%) scale(var(--cssgalaxy-cover-scale)) !important;
    }
  ` });
  await page.evaluate(() => new Promise((resolvePromise) =>
    requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  const png = await page.screenshot({ type: "png", scale: "device" });
  await sharp(png)
    .extract({ left: 0, top: 0, width: 960, height: 540 })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputPath);
  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== 960 || metadata.height !== 540) {
    throw new Error("Galaxy landing preview dimensions drifted");
  }
  console.log(`prepared ${outputPath}`);
} finally {
  await browser?.close();
  await server.close();
}
