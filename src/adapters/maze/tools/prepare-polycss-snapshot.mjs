#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import {
  generatedCompressedScenePath,
  generatedCompressedSnapshotPath,
  generatedProductRoot,
  generatedPreparedScenePath,
  generatedScenePath,
  generatedSourceSceneUrl,
  generatedSnapshotPath,
  generatedSnapshotUrl,
  manifestPath,
  adapterRoot,
  repositoryRoot,
} from "../src/prepare/cssmaze/paths.mjs";

const SNAPSHOT_ATLAS_GROUPS = Object.freeze([
  Object.freeze({ id: "snapshot-atlas:surfaces", name: "surfaces", selector: ".cssmaze-surfaces>s" }),
  Object.freeze({ id: "snapshot-atlas:walls", name: "walls", selector: ".cssmaze-walls>s" }),
]);

const manifest = JSON.parse(await readFile(manifestPath(), "utf8"));
if (!Array.isArray(manifest.scenes) || manifest.scenes.length < 1) {
  throw new Error("cssMaze snapshot preparation requires a generated scene bank");
}
await clearSnapshotAtlasAssets();
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
    const sharedSnapshotAtlases = new Map();
    const snapshotMetadataByScene = new Map();
    let sharedStructuralStyles = null;
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
        const structuralStyles = JSON.stringify({
          retainedWallBackgroundPositions: snapshot.retainedWallBackgroundPositions,
          retainedSurfaceStyles: snapshot.retainedSurfaceStyles,
        });
        if (sharedStructuralStyles !== null && structuralStyles !== sharedStructuralStyles) {
          throw new Error(`cssMaze retained non-geometry styles drifted for ${sceneId}`);
        }
        sharedStructuralStyles ??= structuralStyles;
        snapshotMetadataByScene.set(sceneId, Object.freeze({
          retainedWallTransforms: Object.freeze([...snapshot.retainedWallTransforms]),
        }));
        const externalized = await externalizeSnapshotAtlases(snapshot.html, sharedSnapshotAtlases);
        await mkdir(dirname(snapshotPath), { recursive: true });
        await writeFile(snapshotPath, externalized);
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
    const atlasDescriptors = SNAPSHOT_ATLAS_GROUPS.map(({ id }) => sharedSnapshotAtlases.get(id));
    if (atlasDescriptors.some((descriptor) => !descriptor)) {
      throw new Error("cssMaze shared snapshot atlases are incomplete");
    }
    await publishCompressedRuntimeAssets(manifest, atlasDescriptors, snapshotMetadataByScene);
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

async function publishCompressedRuntimeAssets(manifest, sharedSnapshotAtlases, snapshotMetadataByScene) {
  for (const { id: sceneId } of manifest.scenes) {
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
      preparedSceneTransition: buildPreparedSceneTransition(scene, snapshotMetadataByScene.get(sceneId)),
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
  manifest.transport.sharedSnapshotAtlases = sharedSnapshotAtlases;
  await writeJsonAtomic(manifestPath(), manifest);
}

function buildPreparedSceneTransition(scene, snapshotMetadata) {
  const retainedWallTransforms = snapshotMetadata?.retainedWallTransforms;
  if (!Array.isArray(retainedWallTransforms) ||
      retainedWallTransforms.length !== scene.metrics.sourceWallSegmentCount ||
      retainedWallTransforms.some((transform) =>
        typeof transform !== "string" || !transform.startsWith("matrix3d("))) {
    throw new Error(`cssMaze retained wall transition transforms drifted for ${scene.id}`);
  }
  const initialVisibility = visibilityAtState(scene, scene.playback.segmentStartState);
  const initialVisibilityOperations = Object.freeze(
    [...initialVisibility].map((visible, index) => visible === "1" ? index + 1 : -(index + 1)),
  );
  return Object.freeze({
    schema: "cssmaze-prepared-scene-transition@1",
    retainedWallTransforms,
    initialVisibilityOperations,
    runtimeGeometryCalculation: false,
    runtimeVisibilityComparison: false,
    runtimeDomRemount: false,
  });
}

function visibilityAtState(scene, stateIndex) {
  const visibilityIndex = scene.playback.frameRows[stateIndex][2];
  const visibility = scene.playback.leafVisibilitySets[visibilityIndex];
  if (typeof visibility !== "string" ||
      visibility.length !== scene.metrics.sourceWallSegmentCount || /[^01]/u.test(visibility)) {
    throw new Error(`cssMaze prepared transition visibility drifted for ${scene.id}`);
  }
  return visibility;
}

async function externalizeSnapshotAtlases(snapshotHtml, sharedSnapshotAtlases) {
  let html = snapshotHtml;
  for (const group of SNAPSHOT_ATLAS_GROUPS) {
    const expression = new RegExp(
      `(${escapeRegExp(group.selector)}\\s*\\{\\s*background-image:\\s*url\\(\")data:image\\/png;base64,([A-Za-z0-9+/=]+)(\"\\))`,
      "u",
    );
    const match = expression.exec(html);
    if (!match) throw new Error(`cssMaze exported ${group.name} atlas data URL is missing`);
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      throw new Error(`cssMaze exported ${group.name} atlas is not PNG`);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = `polycss-${group.name}-${sha256}.png`;
    const descriptor = Object.freeze({
      id: group.id,
      url: `/cssmaze/assets/${fileName}`,
      encoding: "identity",
      byteLength: bytes.length,
      sha256,
    });
    const existing = sharedSnapshotAtlases.get(group.id);
    if (existing && (existing.sha256 !== descriptor.sha256 ||
        existing.byteLength !== descriptor.byteLength || existing.url !== descriptor.url)) {
      throw new Error(`cssMaze ${group.name} atlas drifted across prepared seeds`);
    }
    if (!existing) {
      const assetPath = join(generatedProductRoot(), "assets", fileName);
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, bytes);
      sharedSnapshotAtlases.set(group.id, descriptor);
    }
    html = html.replace(expression, `$1${descriptor.url}$3`);
  }
  if (/data:image\//u.test(html)) {
    throw new Error("cssMaze snapshot retained an inline image after atlas externalization");
  }
  return html;
}

async function clearSnapshotAtlasAssets() {
  const assetRoot = join(generatedProductRoot(), "assets");
  let entries;
  try {
    entries = await readdir(assetRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isFile() && /^polycss-(?:surfaces|walls)-[a-f0-9]{64}\.png$/u.test(entry.name))
    .map((entry) => unlink(join(assetRoot, entry.name))));
}

async function writeGzipAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, gzipSync(bytes, { level: 9 }));
  await rename(temporary, path);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
