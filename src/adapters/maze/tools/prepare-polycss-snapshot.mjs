#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { chromium } from "playwright";
import {
  generatedCompressedScenePath,
  generatedCompressedSnapshotPath,
  generatedPreparedScenePath,
  generatedScenePath,
  generatedSourceSceneUrl,
  generatedSnapshotPath,
  generatedSnapshotUrl,
  manifestPath,
  adapterRoot,
  repositoryRoot,
} from "../src/prepare/cssmaze/paths.mjs";

const manifest = JSON.parse(await readFile(manifestPath(), "utf8"));
if (!Array.isArray(manifest.scenes) || manifest.scenes.length < 1) {
  throw new Error("cssMaze snapshot preparation requires a generated scene bank");
}
const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  cwd: repositoryRoot,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  for (const entry of manifest.scenes) await stagePreparedScene(entry.id);
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const snapshots = [];
    for (const entry of manifest.scenes) {
      const sceneId = entry.id;
      const sceneUrl = generatedSourceSceneUrl(sceneId);
      const snapshotPath = generatedSnapshotPath(sceneId);
      const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
      try {
        await page.goto(
          `http://127.0.0.1:${port}/tools/polycss-snapshot-page.html?sceneUrl=${encodeURIComponent(sceneUrl)}`,
          { waitUntil: "networkidle" },
        );
        await page.waitForFunction(
          () => window.__cssMazeSnapshot?.status === "ready" || window.__cssMazeSnapshot?.status === "error",
          null,
          { timeout: 120_000 },
        );
        const snapshot = await page.evaluate(() => window.__cssMazeSnapshot);
        if (snapshot.status !== "ready") throw new Error(snapshot.error || `cssMaze snapshot failed for ${sceneId}`);
        await mkdir(dirname(snapshotPath), { recursive: true });
        await writeFile(snapshotPath, snapshot.html);
        snapshots.push(Object.freeze({
          sceneId,
          snapshotPath: generatedCompressedSnapshotPath(sceneId),
          snapshotUrl: generatedSnapshotUrl(sceneId),
          mountedLeaves: snapshot.mountedLeaves,
        }));
      } finally {
        await page.close();
      }
    }
    await publishCompressedRuntimeAssets(manifest.scenes.map((entry) => entry.id));
    console.log(JSON.stringify({ status: "prepared", snapshotCount: snapshots.length, snapshots }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function stagePreparedScene(sceneId) {
  const publicPath = generatedScenePath(sceneId);
  try {
    const scene = JSON.parse(await readFile(publicPath, "utf8"));
    if (!Array.isArray(scene.meshes)) throw new Error("missing meshes");
    return;
  } catch {
    const preparedPath = generatedPreparedScenePath(sceneId);
    const scene = JSON.parse(await readFile(preparedPath, "utf8"));
    if (!Array.isArray(scene.meshes)) {
      throw new Error(`Prepared cssMaze geometry is missing for ${sceneId}. Run pnpm prepare:cssmaze:scene.`);
    }
    await mkdir(dirname(publicPath), { recursive: true });
    await writeFile(publicPath, `${JSON.stringify(scene, null, 2)}\n`);
  }
}

async function publishCompressedRuntimeAssets(sceneIds) {
  for (const sceneId of sceneIds) {
    const sourceScenePath = generatedScenePath(sceneId);
    const snapshotPath = generatedSnapshotPath(sceneId);
    const scene = JSON.parse(await readFile(sourceScenePath, "utf8"));
    if (!Array.isArray(scene.meshes) || scene.meshes.length !== 2) {
      throw new Error(`Prepared cssMaze scene ${sceneId} is missing source meshes`);
    }
    const preparedPath = generatedPreparedScenePath(sceneId);
    await mkdir(dirname(preparedPath), { recursive: true });
    await writeFile(preparedPath, `${JSON.stringify(scene, null, 2)}\n`);
    const runtimeScene = {
      ...scene,
      renderer: { ...scene.renderer, runtimeGeometryPayload: false },
      meshDescriptors: scene.meshes.map((mesh) => ({
        id: mesh.id,
        kind: mesh.kind,
        sourceId: mesh.sourceId,
        polygonCount: mesh.polygons.length,
      })),
    };
    delete runtimeScene.meshes;
    const snapshotBytes = await readFile(snapshotPath);
    await Promise.all([
      writeGzipAtomic(
        generatedCompressedScenePath(sceneId),
        Buffer.from(`${JSON.stringify(runtimeScene, null, 2)}\n`),
      ),
      writeGzipAtomic(generatedCompressedSnapshotPath(sceneId), snapshotBytes),
    ]);
    await Promise.all([unlink(sourceScenePath), unlink(snapshotPath)]);
  }
}

async function writeGzipAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, gzipSync(bytes, { level: 9 }));
  await rename(temporary, path);
}

async function freePort() {
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
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
