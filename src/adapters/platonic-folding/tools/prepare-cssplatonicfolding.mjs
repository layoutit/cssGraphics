#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph";
import { buildPlatonicPreparedModel } from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
import {
  buildPlatonicRasterAtlas,
  CSSPLATONIC_RASTER_ATLAS_PATH,
} from "../src/prepare/cssplatonicfolding/rasterAtlas.mjs";
import { PLATONIC_BANKS, PLATONIC_SOURCE } from "../src/prepare/cssplatonicfolding/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/cssplatonicfolding");
const stagingRoot = join(repositoryRoot, `build/generated/.cssplatonicfolding-${process.pid}`);
const sourceRoot = resolveRequiredSourceRoot();
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const firstPrepared = buildPlatonicPreparedModel({ bankId: "desktop" });
const atlasBytes = buildPlatonicRasterAtlas(firstPrepared.source.faceDefinitions);
const catalogEntries = [];
const preparedBanks = [];
for (const bank of Object.values(PLATONIC_BANKS)) {
  const prepared = bank.id === "desktop" ? firstPrepared : buildPlatonicPreparedModel({ bankId: bank.id });
  const built = await buildPolyMorphPackage(prepared.model, [{
    path: CSSPLATONIC_RASTER_ATLAS_PATH,
    role: "image",
    mediaType: "image/png",
    bytes: atlasBytes,
  }]);
  const packageRoot = join(stagingRoot, "model", bank.modelId);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
  catalogEntries.push({
    manifest: built.manifest,
    manifestPath: `${bank.modelId}/manifest.json`,
    manifestSha256: built.manifestSha256,
  });
  preparedBanks.push({
    id: bank.id,
    modelId: bank.modelId,
    ...prepared.metrics,
    manifestSha256: built.manifestSha256,
  });
}
const catalog = await buildPolyMorphCatalog(PLATONIC_BANKS.desktop.modelId, catalogEntries);
await writeBytes(join(stagingRoot, "model", "catalog.json"), catalog.bytes);
await writeJson(join(stagingRoot, "prepared.json"), {
  schema: "cssplatonicfolding-prepared-scene@1",
  status: "ready",
  source: sourceLock,
  renderer: {
    package: "@layoutit/polycss-morph",
    profile: "prepared-playback",
    representation: "retained-source-face-roots-with-prepared-raster-lighting",
    runtimeGeometryConstruction: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
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

function resolveRequiredSourceRoot() {
  const value = process.env.CSSPLATONICFOLDING_SOURCE_ROOT;
  if (!value) throw new Error("Set CSSPLATONICFOLDING_SOURCE_ROOT to the pinned XScreenSaver checkout");
  return resolve(value);
}

async function assertSourceIdentity() {
  const head = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.error) throw head.error;
  if (head.status !== 0) throw new Error(`Unable to resolve Platonic Folding source revision:\n${head.stderr || head.stdout}`);
  const revision = head.stdout.trim();
  if (revision !== sourceLock.revision || revision !== PLATONIC_SOURCE.commit) {
    throw new Error(`Platonic Folding source revision drifted: ${revision}`);
  }
  for (const input of [sourceLock.primary, sourceLock.config]) {
    const actual = createHash("sha256").update(await readFile(join(sourceRoot, input.path))).digest("hex");
    if (actual !== input.sha256) throw new Error(`Platonic Folding source bytes drifted: ${input.path}`);
  }
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJson(path, value) {
  await writeBytes(path, `${JSON.stringify(value)}\n`);
}
