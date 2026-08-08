#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const outDir = join("bench", "results", "cssmenger", "browser");
const port = await freePort();
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(outDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const url = "http://127.0.0.1:" + port + "/";
    await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(outDir, "frame.png") });
    const state = await page.evaluate(() => ({
      url: location.href,
      status: document.body.dataset.portStatus ?? "",
      debugReady: Boolean(window.__cssMengerDebug),
      stats: window.__cssMengerDebug?.stats?.() ?? null,
      meshes: window.__cssMengerDebug?.meshes?.() ?? [],
      message: document.getElementById("status")?.textContent ?? "",
    }));
    await writeFile(join(outDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
    console.log(JSON.stringify({ outDir, state }, null, 2));
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
  throw new Error("Timed out waiting for Vite.\n" + output);
}
