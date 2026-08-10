#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const outputDirectory = resolve(process.argv[2] ??
  resolve(repositoryRoot, "bench", "results", "cssselectropaint", "browser-frames", "states-0-359"));
const frameCount = Number(process.argv[3] ?? 360);
const width = Number(process.argv[4] ?? 320);
const height = Number(process.argv[5] ?? 180);
const startState = Number(process.argv[6] ?? 0);
if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 64_000 ||
    !Number.isInteger(startState) || startState < 0 || startState + frameCount > 64_000 ||
    !Number.isInteger(width) || width < 64 || !Number.isInteger(height) || height < 64) {
  throw new Error("usage: capture-browser-frames.mjs [OUTPUT_DIR] [FRAME_COUNT] [WIDTH] [HEIGHT] [START_STATE]");
}
await mkdir(outputDirectory, { recursive: true });

const port = await freePort();
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => window.__cssElectropaint?.status === "ready" || window.__cssElectropaint?.status === "error",
      null,
      { timeout: 120_000 },
    );
    if (await page.evaluate(() => window.__cssElectropaint.status) !== "ready") {
      throw new Error(await page.evaluate(() => window.__cssElectropaint.error || "ElectroPaint client failed"));
    }
    await page.addStyleTag({ content: ".site-header{display:none!important}" });
    await page.evaluate(async (index) => {
      window.__cssElectropaint.pause();
      await window.__cssElectropaint.setState(index);
    }, startState);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame)));
      await page.screenshot({
        path: resolve(outputDirectory, `frame_${String(frameIndex).padStart(4, "0")}.png`),
      });
      if (frameIndex + 1 < frameCount) {
        await page.evaluate(() => window.__cssElectropaint.step(1));
      }
    }
    const evidence = await page.evaluate(() => {
      const camera = document.querySelector(".polycss-camera");
      const scene = document.querySelector(".polycss-scene");
      const quad = document.querySelector(".polycss-scene > b");
      const rectangles = [...document.querySelectorAll(".polycss-scene > b")]
        .map((element) => element.getBoundingClientRect());
      return {
        cameraPerspective: camera ? getComputedStyle(camera).perspective : null,
        cameraScale: camera ? getComputedStyle(camera).scale : null,
        sceneTransform: scene ? getComputedStyle(scene).transform : null,
        firstQuadTransform: quad ? getComputedStyle(quad).transform : null,
        firstQuadRect: quad?.getBoundingClientRect().toJSON() ?? null,
        perQuadWrapperCount: document.querySelectorAll(".polycss-scene > div").length,
        allLeafBounds: rectangles.length ? {
          left: Math.min(...rectangles.map((rectangle) => rectangle.left)),
          top: Math.min(...rectangles.map((rectangle) => rectangle.top)),
          right: Math.max(...rectangles.map((rectangle) => rectangle.right)),
          bottom: Math.max(...rectangles.map((rectangle) => rectangle.bottom)),
        } : null,
      };
    });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(JSON.stringify({
      status: "captured",
      renderer: "retained-dom-polycss",
      browser: { channel: "chrome", userAgent },
      headless: true,
      outputDirectory,
      startState,
      frames: frameCount,
      width,
      height,
      evidence,
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(selected));
    });
    probe.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (!predicate()) {
    onPoll();
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${serverOutput}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}
