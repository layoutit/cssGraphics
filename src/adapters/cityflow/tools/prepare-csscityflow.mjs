#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  buildCityflowMorphModel,
  buildCityflowPreparedCss,
  buildCityflowPreparedPlayback,
} from "../src/prepare/csscityflow/model.mjs";
import { CITYFLOW_BANKS } from "../src/prepare/csscityflow/sourceModel.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/csscityflow");
const stagingRoot = join(repositoryRoot, `build/generated/.csscityflow-${process.pid}`);
const sourceRoot = resolveRequiredSourceRoot();

await verifySourceLock();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const packages = [];
for (const bankId of Object.keys(CITYFLOW_BANKS)) {
  const { state, model } = buildCityflowMorphModel({ bankId });
  const built = await buildPolyMorphPackage(model);
  const packageRoot = join(stagingRoot, model.identity.id);
  await mkdir(packageRoot, { recursive: true });
  for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
  await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
  packages.push({
    manifest: built.manifest,
    manifestPath: `${model.identity.id}/manifest.json`,
    manifestSha256: built.manifestSha256,
  });
  await writeFile(join(stagingRoot, `${model.identity.id}.css`), `${buildCityflowPreparedCss(state)}\n`);
  await writeFile(
    join(stagingRoot, `${model.identity.id}.playback.json`),
    `${JSON.stringify(buildCityflowPreparedPlayback(state))}\n`,
  );
}
const catalog = await buildPolyMorphCatalog("cityflow", packages);
await writeBytes(join(stagingRoot, "catalog.json"), catalog.bytes);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({
  status: "prepared",
  outputRoot,
  banks: packages.map(({ manifest }) => ({ id: manifest.identity.id, resources: manifest.resources.length })),
}, null, 2));

async function verifySourceLock() {
  const head = (await readFile(join(sourceRoot, ".git/HEAD"), "utf8")).trim();
  const revision = head.startsWith("ref: ")
    ? (await readFile(join(sourceRoot, ".git", head.slice(5)), "utf8")).trim()
    : head;
  if (revision !== CITYFLOW_BANKS.desktop.commit) throw new Error(`Cityflow source commit drifted: ${revision}`);
  for (const [path, expected] of [
    [CITYFLOW_BANKS.desktop.primaryPath, CITYFLOW_BANKS.desktop.primarySha256],
    [CITYFLOW_BANKS.desktop.configPath, CITYFLOW_BANKS.desktop.configSha256],
  ]) {
    const actual = createHash("sha256").update(await readFile(join(sourceRoot, path))).digest("hex");
    if (actual !== expected) throw new Error(`Cityflow source bytes drifted: ${path}`);
  }
}

function resolveRequiredSourceRoot() {
  const configured = process.env.CSSCITYFLOW_SOURCE_ROOT;
  if (!configured) throw new Error("Set CSSCITYFLOW_SOURCE_ROOT to the pinned XScreenSaver checkout");
  return resolve(configured);
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
