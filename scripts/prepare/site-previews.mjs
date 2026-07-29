import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";

const repoRoot = resolve(import.meta.dirname, "../..");
const outputDirectory = resolve(repoRoot, "site/public/previews");
const configFile = resolve(repoRoot, "vite.config.ts");
const thumbnailBackground = { r: 13, g: 13, b: 13, alpha: 1 };
const thumbnailInset = 28;
const thumbnailContentWidth = 112;
const thumbnailContentHeight = 112;

await mkdir(outputDirectory, { recursive: true });

const server = await createServer({
  configFile,
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: false,
    hmr: false,
  },
});

let browser;

try {
  await server.listen();
  const origin = server.resolvedUrls?.local?.[0];
  if (!origin) throw new Error("Vite did not expose a local preview URL.");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 320, height: 720 },
    deviceScaleFactor: 2,
  });

  await page.goto(new URL("preview.html", origin).href, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => {
    const previews = [...document.querySelectorAll("[data-preview]")];
    return (
      previews.length > 0 &&
      previews.every((preview) =>
        preview.dataset.ready === "true"
        && preview.querySelector(".polycss-morph-leaf"),
      )
    );
  });

  const assetIds = await page
    .locator("[data-preview]")
    .evaluateAll((previews) =>
      previews.map((preview) => preview.getAttribute("data-preview")),
    );

  for (const assetId of assetIds) {
    if (!assetId) continue;
    const png = await page
      .locator(`[data-preview="${assetId}"]`)
      .screenshot({ type: "png" });
    const outputPath = resolve(outputDirectory, `${assetId}.webp`);
    await sharp(png)
      .trim({ background: thumbnailBackground, threshold: 4 })
      .resize({
        width: thumbnailContentWidth,
        height: thumbnailContentHeight,
        fit: "contain",
        background: thumbnailBackground,
      })
      .extend({
        top: thumbnailInset,
        right: thumbnailInset,
        bottom: thumbnailInset,
        left: thumbnailInset,
        background: thumbnailBackground,
      })
      .webp({ quality: 82, smartSubsample: true })
      .toFile(outputPath);
    console.log(`prepared site/public/previews/${assetId}.webp`);
  }
} finally {
  await browser?.close();
  await server.close();
}
