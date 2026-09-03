#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  buildCityflowMorphModel,
  buildCityflowPreparedCss,
  buildCityflowPreparedPlayback,
} from "../src/prepare/csscityflow/model.mjs";
import { CITYFLOW_BANKS } from "../src/prepare/csscityflow/sourceModel.mjs";
import { ensureCityflowSourceTree } from "../src/prepare/csscityflow/sourceAuthority.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/csscityflow");
const stagingRoot = join(repositoryRoot, `build/generated/.csscityflow-${process.pid}`);
const sourceIdentity = await ensureCityflowSourceTree();
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const packages = [];
const preparedBanks = [];
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
  const playback = buildCityflowPreparedPlayback(state);
  await writeFile(
    join(stagingRoot, `${model.identity.id}.css`),
    `${buildCityflowPreparedCss(state)}\n`,
  );
  await writeFile(
    join(stagingRoot, `${model.identity.id}.playback.json`),
    `${JSON.stringify(playback)}\n`,
  );
  preparedBanks.push(Object.freeze({
    id: bankId,
    modelId: model.identity.id,
    seed: state.seed,
    boxCount: state.boxes.length,
    leafCount: state.boxes.length * 3,
    frameCount: playback.frameCount,
    sourceFrameCount: playback.sourceFrameCount,
    tickIntervalUs: playback.tickIntervalUs,
    sourceTickIntervalUs: playback.sourceTickIntervalUs,
    presentation: playback.presentation,
    loop: playback.loop,
    retainedFacePublication: Object.freeze({
      schema: "csscityflow-retained-face-publication@3",
      policy: "prepared-whole-box-visibility-no-face-culling",
      faceCount: state.boxes.length * playback.facesPerBox,
      boxCount: state.boxes.length,
      visibleFaceCount: playback.staticVisibility.visibleFaceCount,
      hiddenFaceCount: playback.staticVisibility.hiddenFaceCount,
      visibleBoxCount: playback.staticVisibility.visibleBoxCount,
      hiddenBoxCount: playback.staticVisibility.hiddenBoxCount,
      staticVisibility: playback.staticVisibility,
      sideDepth: playback.sideDepth,
    }),
    diagnosticVisibility: Object.freeze({
      schema: playback.diagnostics.visibility.schema,
      usage: playback.diagnostics.productPolicy,
      coverage: playback.diagnostics.visibility.coverage ?? null,
      viewportUnion: playback.diagnostics.visibility.viewportUnion ?? [],
    }),
  }));
}
const catalog = await buildPolyMorphCatalog("cityflow", packages);
await writeBytes(join(stagingRoot, "catalog.json"), catalog.bytes);
await writeFile(join(stagingRoot, "prepared.json"), `${JSON.stringify({
  schema: "csscityflow-prepared-product@2",
  status: "ready",
  defaultBank: "desktop",
  profileSelection: {
    mode: "viewport-capability-or-mobile-user-agent-before-profile-fetch-and-mount",
    mobileBreakpointWidth: 600,
    mobileCapabilityQuery: "(hover: none) and (pointer: coarse)",
  },
  source: {
    repository: sourceIdentity.repository,
    revision: sourceIdentity.revision,
    license: "HPND",
    files: sourceIdentity.files,
  },
  renderer: {
    kind: "retained-dom-polycss-prepared-playback",
    runtimeGeometry: false,
    runtimeRasterization: false,
    runtimeDomGrowth: false,
  },
  banks: preparedBanks,
}, null, 2)}\n`);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({
  status: "prepared",
  outputRoot,
  banks: packages.map(({ manifest }) => ({ id: manifest.identity.id, resources: manifest.resources.length })),
}, null, 2));

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
