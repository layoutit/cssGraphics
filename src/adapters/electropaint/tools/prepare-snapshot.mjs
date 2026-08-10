#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { chromium } from "playwright";
import {
  adapterRoot,
  manifestPath,
  repositoryRoot,
  runtimeScenePathFor,
  runtimeSceneUrlFor,
  snapshotPathFor,
  snapshotUrlFor,
  sourceScenePathFor,
  sourceSceneUrlFor,
} from "../src/prepare/cssselectropaint/paths.mjs";
import { KENT_VARIANTS } from "../src/prepare/cssselectropaint/variants.mjs";

const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const preparedVariants = [];
    for (const variant of KENT_VARIANTS) {
      const sourceSceneUrl = sourceSceneUrlFor(variant.id);
      await page.goto(
        `http://127.0.0.1:${port}/tools/polycss-snapshot-page.html?sceneUrl=${encodeURIComponent(sourceSceneUrl)}`,
        { waitUntil: "networkidle" },
      );
      await page.waitForFunction(
        () => window.__cssselectropaintSnapshot?.status === "ready" ||
          window.__cssselectropaintSnapshot?.status === "error",
        null,
        { timeout: 120_000 },
      );
      const snapshot = await page.evaluate(() => window.__cssselectropaintSnapshot);
      if (snapshot.status !== "ready") throw new Error(snapshot.error || "ElectroPaint snapshot failed");
      const sourceScenePath = sourceScenePathFor(variant.id);
      const sourceScene = JSON.parse(await readFile(sourceScenePath, "utf8"));
      const runtimeScene = {
        ...sourceScene,
        playback: {
          ...sourceScene.playback,
          rootTransform: snapshot.rootTransform,
          rootTransformPublication: "prepared-once-in-snapshot-no-runtime-root-writes",
        },
        renderer: { ...sourceScene.renderer, runtimeGeometryPayload: false },
        meshDescriptors: sourceScene.meshes.map((mesh) => ({
          id: mesh.id,
          sourceHistoryOffset: mesh.sourceHistoryOffset,
          polygonCount: mesh.polygons.length,
        })),
      };
      delete runtimeScene.meshes;
      const runtimeSceneGzip = gzipSync(Buffer.from(`${JSON.stringify(runtimeScene)}\n`), { level: 9 });
      const snapshotGzip = gzipSync(Buffer.from(snapshot.html), { level: 9 });
      const runtimeSceneSha256 = sha256(runtimeSceneGzip);
      const snapshotSha256 = sha256(snapshotGzip);
      await Promise.all([
        writeAtomic(runtimeScenePathFor(variant.id), runtimeSceneGzip),
        writeAtomic(snapshotPathFor(variant.id), snapshotGzip),
      ]);
      await unlink(sourceScenePath);
      preparedVariants.push({
        id: variant.id,
        seed: runtimeScene.sourceProfile.deterministicPreparationSeed,
        warmupStateCount: runtimeScene.sourceProfile.discardedWarmupStateCount,
        sourceFrameCount: runtimeScene.playback.stateCount,
        timelineChunkCount: runtimeScene.playback.chunks.count,
        timelineFramesPerChunk: runtimeScene.playback.chunks.framesPerChunk,
        timelineDurationMilliseconds: runtimeScene.playback.presentationCadence.totalDurationMilliseconds,
        timelineStoredBytes: runtimeScene.playback.chunks.totalStoredBytes,
        startupLookaheadStoredBytes: runtimeScene.playback.chunks.descriptors
          .slice(0, runtimeScene.playback.chunks.runtimeLookaheadChunkCount)
          .reduce((total, descriptor) => total + descriptor.storedBytes, 0),
        sceneUrl: contentAddressedUrl(runtimeSceneUrlFor(variant.id), runtimeSceneSha256),
        sceneSha256: runtimeSceneSha256,
        sceneEncoding: "gzip",
        sceneStoredBytes: runtimeSceneGzip.byteLength,
        snapshotUrl: contentAddressedUrl(snapshotUrlFor(variant.id), snapshotSha256),
        snapshotSha256,
        snapshotEncoding: "gzip",
        snapshotStoredBytes: snapshotGzip.byteLength,
      });
    }
    const exemplar = preparedVariants[0];
    const manifest = {
      schema: "cssselectropaint-manifest@2",
      artifactMode: "prepared-polycss-snapshot-plus-timeline-chunks",
      retainedSquareCount: 40,
      variants: preparedVariants,
      selection: {
        policy: "crypto-random-uniform-once-before-variant-asset-fetch",
        selectionCountPerPageLoad: 1,
        selectedVariantAssetFetchOnly: true,
        cssKeyframes: false,
      },
      maximumVariantTimelineStoredBytes: Math.max(...preparedVariants.map((entry) => entry.timelineStoredBytes)),
      maximumStartupLookaheadStoredBytes: Math.max(...preparedVariants.map((entry) => entry.startupLookaheadStoredBytes)),
      totalPublishedTimelineStoredBytes: preparedVariants.reduce((total, entry) => total + entry.timelineStoredBytes, 0),
      license: "GPL-2.0-only for the ElectroPaint adapter; see src/adapters/electropaint/NOTICE.md",
      commercialUse: "permitted-subject-to-gpl-2.0-only-compliance",
      nativePixelParity: "not-claimed",
      nativeVisualParity: "not-claimed",
      runtimePublication: {
        scheme: "prepared-forty-wing-history-ring",
        timelineStorage: "content-addressed-gzip-binary-third-order-affine-four-chunk-lookahead",
        retainedDomBankCount: 1,
        publishedPreparedVariantCount: preparedVariants.length,
        fetchedPreparedVariantCount: 1,
        runtimeLookaheadChunkCount: 4,
        sequentialRootTransformWrites: 0,
        maximumSequentialLeafTransformWrites: 40,
        maximumSequentialColorClassWrites: 1,
        innerChunkBoundaryLeafTransformWrites: 40,
        innerChunkBoundaryColorClassWrites: 1,
        innerChunkBoundaryResets: 0,
        resetLeafTransformWrites: 40,
        resetColorClassWrites: 40,
        directColorStyleWrites: 0,
        outlineWrites: 0,
        leafWideComparisons: 0,
        matrixCalculations: 0,
        ringIndexCalculations: 0,
        cadenceCalculations: 0,
        cadenceDelayLookupsPerSequentialState: 0,
        constantFrameDelayMilliseconds: 1_000 / 60,
        cssKeyframes: false,
      },
    };
    if (!exemplar) throw new Error("ElectroPaint preparation produced no variants");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({
      status: "prepared",
      variants: preparedVariants.map((variant) => ({
        id: variant.id,
        timelineStoredBytes: variant.timelineStoredBytes,
        startupLookaheadStoredBytes: variant.startupLookaheadStoredBytes,
      })),
      maximumVariantTimelineStoredBytes: manifest.maximumVariantTimelineStoredBytes,
      maximumStartupLookaheadStoredBytes: manifest.maximumStartupLookaheadStoredBytes,
      manifestPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentAddressedUrl(url, hash) {
  return `${url}?sha256=${hash}`;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (!predicate()) {
    onPoll();
    if (Date.now() - started > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
