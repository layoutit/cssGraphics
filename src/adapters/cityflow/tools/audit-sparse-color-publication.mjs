#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import sharp from "sharp";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const outputRoot = resolve(
  repositoryRoot,
  "bench/results/csscityflow/sparse-color-publication",
  new Date().toISOString().replaceAll(":", "-"),
);
const port = await freePort();
const route = `http://127.0.0.1:${port}/cityflow/`;
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", resolve(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

let browser;
try {
  await mkdir(outputRoot, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const viewports = [];
  for (const viewport of [
    { id: "normal", width: 1280, height: 720 },
    { id: "wide", width: 2560, height: 1224 },
  ]) {
    viewports.push(await auditViewport(viewport));
  }
  const report = {
    schema: "csscityflow-sparse-color-publication-audit@1",
    status: "pixel-exact",
    route,
    browser: { name: "Google Chrome", version: browser.version(), headless: true },
    comparison:
      "sequential-sparse-product-publication-versus-same-state-full-face-color-publication",
    viewports,
  };
  const reportPath = resolve(outputRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function auditViewport(viewport) {
  const candidate = await openPage(viewport);
  const reference = await openPage(viewport);
  try {
    await Promise.all([
      initializeCandidate(candidate),
      initializeReference(reference),
    ]);
    const before = await candidate.evaluate(() => globalThis.__csscityflow.player.stats());
    let comparedPixelCount = 0;
    for (let step = 0; step <= before.frameCount; step += 1) {
      const frameIndex = step % before.frameCount;
      await Promise.all([
        candidate.evaluate((index) => globalThis.__csscityflow.player.seekFrame(index), frameIndex),
        reference.evaluate((index) => {
          const state = globalThis.__csscityflowFullColorReference;
          globalThis.__csscityflow.player.seekFrame(index);
          const roots = document.querySelectorAll(".csscityflow-box");
          for (let boxIndex = 0; boxIndex < state.playback.boxCount; boxIndex += 1) {
            const material = state.playback.colors.materials[
              state.materialIndices[index * state.playback.boxCount + boxIndex]
            ];
            const leaves = roots[boxIndex].children;
            for (let localFaceIndex = 0;
              localFaceIndex < state.playback.facesPerBox; localFaceIndex += 1) {
              leaves[localFaceIndex].style.backgroundColor = material[localFaceIndex];
            }
          }
        }, frameIndex),
      ]);
      const [candidatePng, referencePng] = await Promise.all([
        candidate.screenshot({ type: "png" }),
        reference.screenshot({ type: "png" }),
      ]);
      if (!candidatePng.equals(referencePng)) {
        const [candidatePixels, referencePixels] = await Promise.all([
          sharp(candidatePng).raw().toBuffer({ resolveWithObject: true }),
          sharp(referencePng).raw().toBuffer({ resolveWithObject: true }),
        ]);
        const changedBytes = candidatePixels.data.reduce((sum, value, index) =>
          sum + Number(value !== referencePixels.data[index]), 0);
        if (changedBytes !== 0) {
          const candidatePath = resolve(outputRoot,
            `${viewport.id}-frame-${String(frameIndex).padStart(3, "0")}-sparse.png`);
          const referencePath = resolve(outputRoot,
            `${viewport.id}-frame-${String(frameIndex).padStart(3, "0")}-full.png`);
          await Promise.all([
            writeFile(candidatePath, candidatePng),
            writeFile(referencePath, referencePng),
          ]);
          throw new Error(`Cityflow ${viewport.id} sparse color publication changed ` +
            `${changedBytes} pixel bytes at frame ${frameIndex}: ` +
            `${candidatePath} ${referencePath}`);
        }
      }
      comparedPixelCount += viewport.width * viewport.height;
    }
    const after = await candidate.evaluate(() => globalThis.__csscityflow.player.stats());
    return Object.freeze({
      ...viewport,
      deviceScaleFactor: 1,
      comparedFrameCount: before.frameCount + 1,
      comparedPixelCount,
      changedPixelBytes: 0,
      publicationDelta: after.publicationCount - before.publicationCount,
      shapeStyleWriteDelta: after.shapeStyleWrites - before.shapeStyleWrites,
      leafColorStyleWriteDelta: after.leafColorStyleWrites - before.leafColorStyleWrites,
      visibilityStyleWriteDelta: after.visibilityStyleWrites - before.visibilityStyleWrites,
      preparedStateSkipDelta: after.preparedStateSkipCount - before.preparedStateSkipCount,
      identityStable: after.identityStable,
    });
  } finally {
    await Promise.all([candidate.close(), reference.close()]);
  }
}

async function openPage({ width, height }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready ||
    globalThis.__csscityflow?.errors?.length, null, { timeout: 30_000 });
  if (errors.length || !await page.evaluate(() => globalThis.__csscityflow?.ready)) {
    throw new Error(`Cityflow sparse publication audit page failed: ${JSON.stringify(errors)}`);
  }
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
  return page;
}

async function initializeCandidate(page) {
  await page.evaluate(async () => {
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflow.player.seekFrame(0);
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
  });
}

async function initializeReference(page) {
  await page.evaluate(async () => {
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflow.player.seekFrame(0);
    const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Cityflow playback failed: ${response.status}`);
    const playback = await response.json();
    const binary = atob(playback.colors.presentationMaterialIndicesBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const materialIndices = Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
      view.getUint16(index * 2, true));
    globalThis.__csscityflowFullColorReference = { playback, materialIndices };
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
  });
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolveListen, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolveListen);
  });
  const address = socket.address();
  await new Promise((resolveClose) => socket.close(resolveClose));
  if (!address || typeof address === "string") {
    throw new Error("Cityflow sparse publication audit port is unavailable");
  }
  return address.port;
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Cityflow sparse publication server exited early:\n${serverOutput}`);
    }
    try {
      if ((await fetch(route)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Cityflow sparse publication server did not start:\n${serverOutput}`);
}
