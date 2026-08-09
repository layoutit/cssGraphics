#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withCssmazeBrowser } from "./browser-runner.mjs";

// withCssmazeBrowser launches Chromium with headless: true.

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const startTick = Number.parseInt(args[0] ?? "300", 10);
const count = Number.parseInt(args[1] ?? "60", 10);
if (!Number.isSafeInteger(startTick) || startTick < 0 || !Number.isSafeInteger(count) || count < 1 || count > 600) {
  throw new RangeError("usage: capture-browser-frames [startTick>=0] [count 1..600]");
}
const framesDir = resolve(process.env.CSSMAZE_BROWSER_FRAME_SEQUENCE_DIR ?? "bench/results/cssmaze/browser-frames/frames");
await mkdir(framesDir, { recursive: true });
await withCssmazeBrowser(async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector(".cssmaze-world").style.transition = "none";
  });
  for (let index = 0; index < count; index += 1) {
    const tick = startTick + index;
    await page.evaluate((value) => window.__cssMazeDebug.seek(value), tick);
    await page.screenshot({ path: join(framesDir, `frame_${String(index).padStart(4, "0")}.png`) });
  }
}, { path: "/?scene=default-maze" });
console.log(JSON.stringify({ status: "captured", startTick, count, framesDir }, null, 2));
