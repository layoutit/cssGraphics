#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { adapterRoot, oracleRoot, repositoryRoot, writeJson } from "./oracle-support.mjs";
import { resolvePlatonicOracleFrames } from "./frame-schedule.mjs";

export async function captureBrowserPlatonicFrames(options = {}) {
  const frames = options.frames ?? resolvePlatonicOracleFrames();
  const width = positiveInteger(options.width, 960, "browser width");
  const height = positiveInteger(options.height, 600, "browser height");
  const outputDir = resolve(options.outputDir ?? join(oracleRoot, "browser", "capture"));
  const framesDir = join(outputDir, "frames");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const port = await freePort();
  let serverOutput = "";
  const server = spawn("pnpm", [
    "exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000, () => {
      if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    });
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors = [];
      await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
      page.on("pageerror", (error) => errors.push(error.stack || error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      const url = `http://127.0.0.1:${port}/`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__cssPlatonicFoldingDebug?.ready === true ||
        document.body.classList.contains("error"), null, { timeout: 30_000 });
      const initial = await page.evaluate(() => ({
        ready: window.__cssPlatonicFoldingDebug?.ready ?? false,
        errors: window.__cssPlatonicFoldingDebug?.errors ?? [],
        stats: window.__cssPlatonicFoldingDebug?.stats() ?? null,
        forbiddenRendererElements: document.querySelectorAll(".polycss-camera canvas, .polycss-camera svg").length,
      }));
      if (errors.length || !initial.ready || initial.errors.length ||
          initial.stats?.selectedPreparedBank !== "desktop" ||
          initial.stats?.retainedFaceRootCount !== 50 ||
          initial.stats?.retainedPolygonLeafCount !== 50 ||
          initial.forbiddenRendererElements !== 0) {
        throw new Error(`Platonic Folding browser oracle did not become ready: ${JSON.stringify({ initial, errors })}`);
      }
      await page.evaluate(() => {
        window.__cssPlatonicFoldingDebug.pause();
        document.querySelector(".site-header")?.remove();
      });
      const rows = [];
      for (let index = 0; index < frames.length; index += 1) {
        const sourceFrame = frames[index];
        const row = await page.evaluate((frame) => {
          const debug = window.__cssPlatonicFoldingDebug;
          const state = debug.seekFrame(frame);
          return {
            sourceFrame: frame,
            publishedFrame: state.frameIndex,
            paused: state.paused,
            visibleLeaves: [...document.querySelectorAll(".polycss-camera s")]
              .filter((leaf) => getComputedStyle(leaf).visibility !== "hidden").length,
            stableDom: state.retainedDomStable,
            runtimeGeometryConstructionCount: state.runtimeGeometryConstructionCount,
            runtimeAtlasRasterizationCount: state.runtimeAtlasRasterizationCount,
            runtimeDomGrowth: state.runtimeDomGrowth,
          };
        }, sourceFrame);
        if (row.publishedFrame !== sourceFrame || !row.paused || !row.stableDom ||
            row.runtimeGeometryConstructionCount !== 0 || row.runtimeAtlasRasterizationCount !== 0 ||
            row.runtimeDomGrowth !== false) {
          throw new Error(`Platonic Folding browser publication drifted: ${JSON.stringify(row)}`);
        }
        rows.push(row);
        await page.locator(".polycss-camera").screenshot({ path: join(framesDir, frameName(index)) });
      }
      const statesPath = join(outputDir, "states.jsonl");
      await writeFile(statesPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
      const manifest = {
        schema: "cssplatonicfolding-browser-frame-sequence@1",
        url,
        frames,
        frameCount: frames.length,
        viewport: { width, height, deviceScaleFactor: 1 },
        captureMode: "deterministic prepared frame seek",
        framesDir,
        statesPath,
        initial,
      };
      const manifestPath = join(outputDir, "browser-capture.json");
      await writeJson(manifestPath, manifest);
      return Object.freeze({ ...manifest, manifestPath });
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

function frameName(index) {
  return `frame_${String(index).padStart(4, "0")}.png`;
}

function positiveInteger(value, fallback, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the Platonic Folding oracle server");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureBrowserPlatonicFrames().then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
