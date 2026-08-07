#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = join("bench", "results", "cssgears", "browser");
const framesDir = join(outDir, "frames");
const framePath = join(framesDir, "frame_0000.png");
const previewPath = join(outDir, "frame.png");
const port = await freePort();
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(framesDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes(`http://127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
    const url = `http://127.0.0.1:${port}/?scene=fixed-non-planetary`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.matches(".ready,.error"), null, { timeout: 20_000 });
    const state = await page.evaluate(() => {
      const api = window.__cssGearsDebug;
      if (!api?.ready) throw new Error("cssGears debug API did not become ready");
      api.pause();
      api.setTick(0);
      return {
        route: api.route,
        sourceProfile: api.scene.sourceProfile,
        oracle: api.scene.oracle,
        stats: api.stats(),
        stableDom: api.assertStableDomIdentity(),
      };
    });
    await page.locator("#status").evaluate((element) => { element.hidden = true; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator("#scene").screenshot({ path: framePath });
    await copyFile(framePath, previewPath);
    const frameSha256 = createHash("sha256").update(await readFile(framePath)).digest("hex");
    const manifest = {
      schema: "cssgears-polycss-browser-capture@1",
      qualification: "browser-candidate-frame",
      browser: `Google Chrome ${browserVersion}`,
      headless: true,
      url,
      viewport: { width: 720, height: 720, deviceScaleFactor: 1 },
      tick: 0,
      presentationOverlayHidden: true,
      nativeStateSha256: state.oracle.nativeStateSha256,
      nativeFrameSha256: state.oracle.nativeFrameSha256,
      frameSha256,
      framePath,
      previewPath,
      state,
    };
    await writeFile(join(outDir, "capture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
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
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
