#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  CSSPLATONIC_MODEL_ID,
  buildPlatonicPreparedModel,
  buildPlatonicPreparedPlayback,
} from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
import {
  buildPlatonicRasterAtlas,
  CSSPLATONIC_RASTER_ATLAS_PATH,
} from "../src/prepare/cssplatonicfolding/rasterAtlas.mjs";
import { PLATONIC_BANKS, PLATONIC_SOURCE } from "../src/prepare/cssplatonicfolding/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/cssplatonicfolding");
const stagingRoot = join(repositoryRoot, `build/generated/.cssplatonicfolding-${process.pid}`);
const sourceRoot = resolveSourceRoot();
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const preparedModel = buildPlatonicPreparedModel();
const atlasBytes = buildPlatonicRasterAtlas(preparedModel.source.faceDefinitions);
const built = await buildPolyMorphPackage(preparedModel.model, [{
  path: CSSPLATONIC_RASTER_ATLAS_PATH,
  role: "image",
  mediaType: "image/png",
  bytes: atlasBytes,
}]);
const packageRoot = join(stagingRoot, "model", CSSPLATONIC_MODEL_ID);
await mkdir(packageRoot, { recursive: true });
for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
const catalog = await buildPolyMorphCatalog(CSSPLATONIC_MODEL_ID, [{
  manifest: built.manifest,
  manifestPath: `${CSSPLATONIC_MODEL_ID}/manifest.json`,
  manifestSha256: built.manifestSha256,
}]);
await writeBytes(join(stagingRoot, "model", "catalog.json"), catalog.bytes);

const preparedBanks = [];
for (const bank of Object.values(PLATONIC_BANKS)) {
  const prepared = buildPlatonicPreparedPlayback({ bankId: bank.id });
  const playbackPath = `banks/${bank.id}/playback.json`;
  const playbackBytes = Buffer.from(`${JSON.stringify(prepared.playback)}\n`);
  await writeBytes(join(stagingRoot, playbackPath), playbackBytes);
  preparedBanks.push({
    id: bank.id,
    modelId: CSSPLATONIC_MODEL_ID,
    ...prepared.metrics,
    manifestSha256: built.manifestSha256,
    playbackPath: `/cssplatonicfolding/${playbackPath}`,
    playbackSha256: createHash("sha256").update(playbackBytes).digest("hex"),
    playbackBytes: playbackBytes.byteLength,
  });
}
await writeJson(join(stagingRoot, "prepared.json"), {
  schema: "cssplatonicfolding-prepared-scene@1",
  status: "ready",
  source: sourceLock,
  renderer: {
    package: "@layoutit/polycss-morph",
    profile: "static-prepared",
    representation: "retained-source-face-roots-with-sparse-prepared-dom-playback",
    morphTarget: "createPolyMorphPreparedDomTarget",
    runtimeGeometryConstruction: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
    runtimePreparedStateMaterialization: false,
    runtimeFullStateDiff: false,
    runtimeMatrixFormatting: false,
    runtimeIdLookup: false,
  },
  presentation: {
    frameMilliseconds: PLATONIC_SOURCE.delayMicroseconds / 1_000,
    solidOrder: ["icosahedron", "dodecahedron", "hexahedron", "octahedron", "tetrahedron"],
    foldMode: "source-joint",
    foldingsPerSolid: 1,
  },
  preparedBanks,
  oracle: {
    sourceState: "source-constants-and-topology-pinned",
    visual: "source-faithful-bounded-approximation",
  },
});
await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({ outputRoot, atlasBytes: atlasBytes.byteLength, preparedBanks }, null, 2));

function resolveSourceRoot() {
  const value = process.env.CSSPLATONICFOLDING_SOURCE_ROOT;
  return value ? resolve(value) : null;
}

async function assertSourceIdentity() {
  if (sourceLock.revision !== PLATONIC_SOURCE.commit) {
    throw new Error("Platonic Folding source lock revision drifted");
  }
  if (sourceRoot) {
    const head = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (head.error) throw head.error;
    if (head.status !== 0) throw new Error(`Unable to resolve Platonic Folding source revision:\n${head.stderr || head.stdout}`);
    const revision = head.stdout.trim();
    if (revision !== sourceLock.revision) {
      throw new Error(`Platonic Folding source revision drifted: ${revision}`);
    }
  }
  for (const input of [sourceLock.primary, sourceLock.config]) {
    const bytes = sourceRoot
      ? await readFile(join(sourceRoot, input.path))
      : await fetchPinnedSource(input.path);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== input.sha256) throw new Error(`Platonic Folding source bytes drifted: ${input.path}`);
  }
}

async function fetchPinnedSource(path) {
  const repositoryPath = new URL(sourceLock.repository).pathname.replace(/^\//u, "").replace(/\/$/u, "");
  const url = `https://raw.githubusercontent.com/${repositoryPath}/${sourceLock.revision}/${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Platonic Folding pinned source download failed: ${response.status} ${path}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJson(path, value) {
  await writeBytes(path, `${JSON.stringify(value)}\n`);
}
