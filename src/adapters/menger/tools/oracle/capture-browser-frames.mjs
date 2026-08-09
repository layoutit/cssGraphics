#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../../src/prepare/cssmenger/paths.mjs";
import { cssmengerOracleRoot, writeJson } from "./oracle-support.mjs";
import { resolveCssmengerOracleTicks } from "./cssmenger-frame-schedule.mjs";

const CAPTURE_ONLY_CSS = `
  :root, html, body { background: #000 !important; }
  .site-header, .cssmenger-error-message { display: none !important; }
`;

export async function captureBrowserMengerFrames(options = {}) {
  const ticks = options.ticks ?? resolveCssmengerOracleTicks();
  const width = positiveInteger(options.width, 960, "browser width");
  const height = positiveInteger(options.height, 600, "browser height");
  const outputDir = resolve(options.outputDir ?? join(cssmengerOracleRoot, "browser", "capture"));
  const framesDir = join(outputDir, "frames");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const port = await freePort();
  let serverOutput = "";
  const server = spawn("pnpm", [
    "exec", "vite",
    "--config", join(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
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
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
      page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
      const url = `http://127.0.0.1:${port}/`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null, { timeout: 30_000 });
      const initial = await page.evaluate(() => ({
        status: document.body.dataset.portStatus,
        ready: Boolean(window.__cssMengerDebug?.ready),
        sceneId: window.__cssMengerDebug?.scene?.id ?? null,
        oracle: window.__cssMengerDebug?.scene?.oracle ?? null,
        stats: window.__cssMengerDebug?.stats?.() ?? null,
        forbiddenRendererElements: document.querySelectorAll(".polycss-camera canvas, .polycss-camera svg").length,
      }));
      if (pageErrors.length || initial.status !== "ready" || !initial.ready ||
          initial.sceneId !== "depth-3" || initial.forbiddenRendererElements !== 0) {
        throw new Error(`cssMenger browser oracle did not become ready: ${JSON.stringify({ initial, pageErrors })}`);
      }
      await page.evaluate(() => window.__cssMengerDebug.pause());
      await page.addStyleTag({ content: CAPTURE_ONLY_CSS });
      const rows = [];
      for (let index = 0; index < ticks.length; index += 1) {
        const sourceTick = ticks[index];
        const row = await page.evaluate(async (tick) => {
          const debug = window.__cssMengerDebug;
          debug.seek(tick);
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          const playback = debug.scene.playback;
          const publicationRoot = document.querySelector(".polycss-camera > .polycss-scene");
          return {
            tick: debug.state().tick,
            paused: debug.state().paused,
            preparedTransform: playback.transforms[tick],
            expectedPublishedTransform: playback.transforms[tick],
            publishedTransform: publicationRoot?.style.getPropertyValue("--m") ?? null,
            paletteIndices: playback.colorRows[tick],
            paletteSource16: playback.colorRows[tick].map((paletteIndex) => playback.palette[paletteIndex].source16),
            preparedAxisAtlasPositions: playback.colorRows[tick].map((paletteIndex) =>
              debug.scene.planeAtlas.paletteBackgroundPositionYs[paletteIndex]),
            publishedAxisAtlasPositions: ["--x", "--y", "--z"].map((property) =>
              publicationRoot?.style.getPropertyValue(property) ?? null),
            stableDom: debug.assertStableDomIdentity(),
          };
        }, sourceTick);
        if (row.tick !== sourceTick || !row.paused || !row.stableDom ||
            row.publishedTransform !== row.expectedPublishedTransform ||
            row.publishedAxisAtlasPositions.some((value, axis) => value !== row.preparedAxisAtlasPositions[axis])) {
          throw new Error(`Browser oracle state publication drifted at tick ${sourceTick}: ${JSON.stringify(row)}`);
        }
        rows.push(row);
        await page.locator(".polycss-camera").screenshot({ path: join(framesDir, frameName(index)) });
      }
      const final = await page.evaluate(() => ({
        state: window.__cssMengerDebug.state(),
        stats: window.__cssMengerDebug.stats(),
        stableDom: window.__cssMengerDebug.assertStableDomIdentity(),
        userAgent: navigator.userAgent,
      }));
      const statesPath = join(outputDir, "states.jsonl");
      await writeFile(statesPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
      const manifest = {
        schema: "cssmenger-browser-frame-sequence@1",
        url,
        outputDir,
        framesDir,
        statesPath,
        ticks,
        frameCount: ticks.length,
        viewport: { width, height, deviceScaleFactor: 1 },
        captureMode: "deterministic-prepared-state-seek",
        scenePixelBoundary: ".polycss-camera at the native viewport; shell chrome hidden and background forced to native black for oracle capture only",
        captureOnlyCss: CAPTURE_ONLY_CSS.trim(),
        initial,
        final,
      };
      const manifestPath = join(outputDir, "browser-capture.json");
      await writeJson(manifestPath, manifest);
      return Object.freeze({ ...manifest, manifestPath, states: Object.freeze(rows) });
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--out");
  const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  captureBrowserMengerFrames({ outputDir }).then((result) => {
    console.log(JSON.stringify({
      schema: result.schema,
      framesDir: result.framesDir,
      statesPath: result.statesPath,
      frameCount: result.frameCount,
      manifestPath: result.manifestPath,
    }, null, 2));
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
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
    const instance = createServer();
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      instance.close(() => resolvePort(selected));
    });
    instance.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the cssMenger oracle Vite server.");
}
