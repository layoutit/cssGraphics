#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const outDir = join("bench", "results", "cssmenger", "browser-frames");
const framesDir = join(outDir, "frames");
const frameCount = positiveInt(process.env.CSS_FRAME_SEQUENCE_FRAMES, 120);
const settleFrames = positiveInt(process.env.CSS_BROWSER_FRAME_SEQUENCE_SETTLE_FRAMES, 1);
const replayScriptPath = process.env.CSS_BROWSER_FRAME_SEQUENCE_SCRIPT ?? "";
const port = await freePort();
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(framesDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const url = "http://127.0.0.1:" + port + "/";
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("ready") || document.body.classList.contains("error"), null, { timeout: 20_000 });
    const initialState = await page.evaluate(() => ({
      status: document.body.classList.contains("ready") ? "ready" :
        document.body.classList.contains("error") ? "error" : "loading",
      message: document.getElementById("status")?.textContent ?? "",
      debugReady: Boolean(window.__cssMengerDebug),
      stats: window.__cssMengerDebug?.stats?.() ?? null,
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
    for (let index = 0; index < frameCount; index += 1) {
      if (index > 0) await waitAnimationFrames(page, settleFrames);
      await page.screenshot({ path: join(framesDir, frameName(index)) });
    }
    const finalState = await page.evaluate(() => ({
      status: document.body.classList.contains("ready") ? "ready" :
        document.body.classList.contains("error") ? "error" : "loading",
      debugReady: Boolean(window.__cssMengerDebug),
      stats: window.__cssMengerDebug?.stats?.() ?? null,
      meshes: window.__cssMengerDebug?.meshes?.() ?? [],
    }));
    await writeFile(join(outDir, "frame-sequence.json"), JSON.stringify({
      schema: "polycss-browser-frame-sequence@1",
      title: "cssMenger — XScreenSaver Menger",
      url,
      framesDir,
      frameCount,
      settleFrames,
      replayScriptPath: replayScriptPath || null,
      initialState,
      finalState,
      note: replayScriptPath ? "Captured after running CSS_BROWSER_FRAME_SEQUENCE_SCRIPT." : "No replay script set; sequence may be an idle visual stability capture.",
    }, null, 2) + "\n");
    console.log(JSON.stringify({ outDir, framesDir, frameCount, finalState }, null, 2));
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
