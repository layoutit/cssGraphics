#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import {
  CSSPIPES_ADAPTER_ROOT,
  CSSPIPES_PREPARE_SCENE_PATH,
  CSSPIPES_PREPARE_SNAPSHOT_PATH,
} from "../src/prepare/csspipes/paths.mjs";
import { writeCssPipesManifest } from "../src/prepare/csspipes/writeManifest.mjs";

const scene = JSON.parse(await readFile(CSSPIPES_PREPARE_SCENE_PATH, "utf8"));
const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", resolve(CSSPIPES_ADAPTER_ROOT, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForServer(server, () => output, port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: scene.camera.sourceViewport,
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const sceneUrl = "/csspipes/scenes/pipes-clips.scene.prepare.json";
    const url = `http://127.0.0.1:${port}/tools/polycss-snapshot-page.html?sceneUrl=${encodeURIComponent(sceneUrl)}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForFunction(
      () => ["ready", "error"].includes(globalThis.__cssPipesSnapshot?.status),
      null,
      { timeout: 120_000 },
    );
    const snapshot = await page.evaluate(() => globalThis.__cssPipesSnapshot);
    if (snapshot.status === "error") throw new Error(snapshot.error);
    if (errors.length) throw new Error(`Snapshot page errors:\n${errors.join("\n")}`);
    const html = `${snapshot.html.trimEnd()}\n`;
    if (/<script\b|<canvas\b|<svg\b/i.test(html) || /\/(?:Users|home)\//.test(html)) {
      throw new Error("Snapshot contains a forbidden runtime surface or local path");
    }
    if ((html.match(/class="[^"]*polycss-scene/g) ?? []).length !== 1) {
      throw new Error("Snapshot must retain exactly one .polycss-scene");
    }
    await mkdir(dirname(CSSPIPES_PREPARE_SNAPSHOT_PATH), { recursive: true });
    const temporary = `${CSSPIPES_PREPARE_SNAPSHOT_PATH}.tmp`;
    await writeFile(temporary, html);
    await rename(temporary, CSSPIPES_PREPARE_SNAPSHOT_PATH);
    const manifest = await writeCssPipesManifest(scene, snapshot);
    console.log(
      `Prepared stable PolyCSS snapshot: ${snapshot.mountedLeaves} leaves, ${snapshot.pipeRootCount} continuous tube roots, manifest ${manifest.sha256}`,
    );
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(server, getOutput, port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${getOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/tools/polycss-snapshot-page.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out starting snapshot Vite server:\n${getOutput()}`);
}
