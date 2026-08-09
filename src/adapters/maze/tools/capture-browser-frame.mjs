#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withCssmazeBrowser } from "./browser-runner.mjs";

// withCssmazeBrowser launches Chromium with headless: true.

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const tick = Number.parseInt(args[0] ?? "420", 10);
if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("capture tick must be non-negative");
const output = resolve(args[1] ?? `bench/results/cssmaze/browser/frame-${String(tick).padStart(5, "0")}.png`);
await withCssmazeBrowser(async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector(".cssmaze-world").style.transition = "none";
  });
  await page.evaluate((value) => window.__cssMazeDebug.seek(value), tick);
  await page.waitForTimeout(100);
  await mkdir(dirname(output), { recursive: true });
  await page.screenshot({ path: output });
}, { path: "/?scene=default-maze" });
console.log(JSON.stringify({ status: "captured", tick, output }, null, 2));
