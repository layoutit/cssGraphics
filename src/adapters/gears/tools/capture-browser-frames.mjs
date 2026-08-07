#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = join("bench", "results", "cssgears", "browser-frames");
const configuredOutDir = process.env.CSS_BROWSER_FRAME_SEQUENCE_OUT_DIR?.trim();
const captureOutDir = configuredOutDir || outDir;
const framesDir = join(captureOutDir, "frames");
const frameCount = positiveInt(process.env.CSS_FRAME_SEQUENCE_FRAMES, 120);
const settleFrames = positiveInt(process.env.CSS_BROWSER_FRAME_SEQUENCE_SETTLE_FRAMES, 2);
const replayScriptPath = process.env.CSS_BROWSER_FRAME_SEQUENCE_SCRIPT ?? "";
const port = await freePort();
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(framesDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
    const url = "http://127.0.0.1:" + port + "/?scene=fixed-non-planetary";
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.matches(".ready,.error"), null, { timeout: 20_000 });
    const initialState = await page.evaluate(() => ({
      status: document.body.classList.contains("ready") ? "ready" : "error",
      message: document.getElementById("status")?.textContent ?? "",
      debugReady: Boolean(window.__cssGearsDebug),
      stats: window.__cssGearsDebug?.stats?.() ?? null,
      sourceProfile: window.__cssGearsDebug?.scene?.sourceProfile ?? null,
      oracle: window.__cssGearsDebug?.scene?.oracle ?? null,
    }));
    if (initialState.status === "error" && process.env.CSS_BROWSER_FRAME_SEQUENCE_ALLOW_ERROR !== "1") {
      throw new Error("Runtime did not become ready for frame capture: " + JSON.stringify(initialState));
    }
    if (replayScriptPath) {
      const replayScript = await readFile(replayScriptPath, "utf8");
      await page.evaluate(async (source) => {
        const result = (0, eval)(source);
        if (result && typeof result.then === "function") await result;
      }, replayScript);
    }
    await page.evaluate(() => {
      const api = window.__cssGearsDebug;
      if (!api?.ready) throw new Error("cssGears debug API did not become ready");
      api.pause();
      api.setTick(0);
      const status = document.getElementById("status");
      if (status) status.hidden = true;
    });
    const ticks = [];
    for (let index = 0; index < frameCount; index += 1) {
      const tick = await page.evaluate(async ({ sourceTick, frames }) => {
        const api = window.__cssGearsDebug;
        api.setTick(sourceTick);
        await new Promise((resolve) => {
          let remaining = frames;
          const next = () => {
            remaining -= 1;
            if (remaining <= 0) resolve();
            else requestAnimationFrame(next);
          };
          requestAnimationFrame(next);
        });
        const transforms = api.nodes().gearRoots.map((root) => root.style.transform);
        const playback = api.scene.playback;
        const logicalTransforms = sourceTick === 0
          ? playback.initial.shapeTransformIndices.map((transformIndex) => playback.transforms[transformIndex])
          : (() => {
              const row = playback.frameRows[sourceTick];
              const byShape = new Array(playback.retainedGearRootCount);
              for (let index = 0; index < row[2]; index += 1) {
                const offset = (row[1] + index) * 2;
                byShape[playback.shapeChanges[offset]] = playback.transforms[playback.shapeChanges[offset + 1]];
              }
              return byShape;
            })();
        const transformIndices = sourceTick === 0
          ? playback.initial.shapeTransformIndices
          : (() => {
              const row = playback.frameRows[sourceTick];
              const byShape = new Array(playback.retainedGearRootCount);
              for (let index = 0; index < row[2]; index += 1) {
                const offset = (row[1] + index) * 2;
                byShape[playback.shapeChanges[offset]] = playback.shapeChanges[offset + 1];
              }
              return byShape;
            })();
        const theta = transformIndices.map((transformIndex) => playback.sourceTheta[transformIndex]);
        const publishedTransformExact = transforms.every((transform, index) => transform === logicalTransforms[index]);
        return {
          tick: api.tick(),
          theta,
          publishedTheta: publishedTransformExact ? theta : [],
          publishedTransformExact,
          logicalTransforms,
          transforms,
        };
      }, { sourceTick: index, frames: settleFrames });
      if (tick.tick !== index) throw new Error(`Browser frame ${index} presented source tick ${tick.tick}`);
      ticks.push(tick);
      await page.locator("#scene").screenshot({ path: join(framesDir, frameName(index)) });
    }
    const finalState = await page.evaluate(() => ({
      status: document.body.classList.contains("ready") ? "ready" : "error",
      debugReady: Boolean(window.__cssGearsDebug),
      stats: window.__cssGearsDebug?.stats?.() ?? null,
      meshes: window.__cssGearsDebug?.meshes?.() ?? [],
    }));
    const ticksPath = join(captureOutDir, "ticks.jsonl");
    await writeFile(ticksPath, ticks.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await writeFile(join(captureOutDir, "frame-sequence.json"), JSON.stringify({
      schema: "cssgears-browser-frame-sequence@2",
      title: "cssGears — XScreenSaver Gears",
      url,
      framesDir,
      frameCount,
      settleFrames,
      captureMode: "deterministic-source-tick-seek",
      ticksPath,
      replayScriptPath: replayScriptPath || null,
      initialState,
      finalState,
      note: "Each numbered frame is captured after setTick(frameIndex); this is a synchronized source-state oracle, not natural wall-clock playback.",
    }, null, 2) + "\n");
    console.log(JSON.stringify({ outDir: captureOutDir, framesDir, frameCount, ticksPath, finalState }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function frameName(index) {
  return "frame_" + String(index).padStart(4, "0") + ".png";
}

async function waitAnimationFrames(page, count) {
  await page.evaluate((frames) => new Promise((resolve) => {
    let remaining = frames;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMs, onPoll = () => undefined) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Vite.\n" + output);
}
