#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPolyMorphCatalog,
  buildPolyMorphPackage,
} from "@layoutit/polycss-morph";
import {
  CSSFLIPFLOP_MOBILE_CAPABILITY_QUERY,
  CSSFLIPFLOP_MOBILE_BREAKPOINT_WIDTH,
} from "../src/cssflipflop/bankSelection.mjs";
import { buildFlipFlopPreparedModel } from "../src/prepare/cssflipflop/modelBuilder.mjs";
import {
  buildFlipFlopRasterAtlas,
  CSSFLIPFLOP_RASTER_ATLAS_PATH,
} from "../src/prepare/cssflipflop/rasterAtlas.mjs";
import {
  CSSFLIPFLOP_FRAME_MILLISECONDS,
  CSSFLIPFLOP_SOURCE_FRAME_COUNT,
  FLIPFLOP_BANKS,
  FLIPFLOP_SOURCE,
} from "../src/prepare/cssflipflop/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const sourceRoot = resolveRequiredSourceRoot();
const outputRoot = join(repositoryRoot, "build/generated/public/cssflipflop");
const stagingRoot = join(repositoryRoot, `build/generated/.cssflipflop-${process.pid}`);
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));

await assertSourceIdentity();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const atlasBytes = buildFlipFlopRasterAtlas();
const preparedBanks = [];
const catalogEntries = [];
for (const bank of Object.values(FLIPFLOP_BANKS)) {
  const prepared = buildFlipFlopPreparedModel({ bankId: bank.id });
  const builtPackage = await buildPolyMorphPackage(prepared.model, [{
    path: CSSFLIPFLOP_RASTER_ATLAS_PATH,
    role: "image",
    mediaType: "image/png",
    bytes: atlasBytes,
  }]);
  const packageRoot = join(stagingRoot, "model", bank.modelId);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of builtPackage.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), builtPackage.manifestBytes);
  catalogEntries.push({
    manifest: builtPackage.manifest,
    manifestPath: `${bank.modelId}/manifest.json`,
    manifestSha256: builtPackage.manifestSha256,
  });
  preparedBanks.push({
    id: bank.id,
    modelId: bank.modelId,
    ...prepared.metrics,
    manifestSha256: builtPackage.manifestSha256,
  });
}
const catalog = await buildPolyMorphCatalog(FLIPFLOP_BANKS.desktop.modelId, catalogEntries);
await writeBytes(join(stagingRoot, "model", "catalog.json"), catalog.bytes);
await writeJson(join(stagingRoot, "prepared.json"), {
  schema: "cssflipflop-prepared-scene@2",
  status: "ready",
  source: sourceLock,
  renderer: {
    package: "@layoutit/polycss-morph",
    profile: "prepared-playback",
    representation: "retained-rigid-tile-roots-with-prepared-raster-atlas-leaves",
    textureLeafSizing: "raster",
    runtimeGeometryConstruction: false,
    runtimeDomGrowth: false,
    runtimeAtlasRasterization: false,
  },
  selection: {
    startupOnly: true,
    mobileBreakpointWidth: CSSFLIPFLOP_MOBILE_BREAKPOINT_WIDTH,
    mobileCapabilityQuery: CSSFLIPFLOP_MOBILE_CAPABILITY_QUERY,
  },
  presentation: {
    frameMilliseconds: CSSFLIPFLOP_FRAME_MILLISECONDS,
    sourceAuthority: { start: 0, end: CSSFLIPFLOP_SOURCE_FRAME_COUNT - 1 },
    envelope: "prepared-exact-state-rewind",
  },
  preparedBanks,
  oracle: {
    sourceState: "native-state-aligned-at-ticks-0-180-599",
    visual: "unqualified",
  },
});

await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({ outputRoot, preparedBanks }, null, 2));

function resolveRequiredSourceRoot() {
  const value = process.env.CSSFLIPFLOP_SOURCE_ROOT;
  if (!value) throw new Error("Set CSSFLIPFLOP_SOURCE_ROOT to the pinned XScreenSaver checkout");
  return resolve(value);
}

async function assertSourceIdentity() {
  const head = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (head.error) throw head.error;
  if (head.status !== 0) {
    throw new Error(`Unable to resolve Flip Flop source revision:\n${head.stderr || head.stdout}`);
  }
  const revision = head.stdout.trim();
  if (revision !== sourceLock.revision || revision !== FLIPFLOP_SOURCE.commit) {
    throw new Error(`Flip Flop source revision drifted: ${revision}`);
  }
  for (const input of [sourceLock.primary, sourceLock.config]) {
    const bytes = await readFile(join(sourceRoot, input.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== input.sha256) throw new Error(`Flip Flop source bytes drifted: ${input.path}`);
  }
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeJson(path, value) {
  await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}
