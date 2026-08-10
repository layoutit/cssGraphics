#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  buildPreparedElectropaintScene,
  serializePreparedElectropaintChunk,
} from "../src/prepare/cssselectropaint/sceneBuilder.mjs";
import {
  lockedElectropaintAuthorities,
  verifyElectropaintAuthorities,
} from "../src/prepare/cssselectropaint/dataSource.mjs";
import {
  generatedAdapterRoot,
  sourceScenePathFor,
  timelineChunksRootFor,
} from "../src/prepare/cssselectropaint/paths.mjs";
import { KENT_VARIANTS } from "../src/prepare/cssselectropaint/variants.mjs";

const authorities = process.env.CSSSELECTROPAINT_USE_SOURCE_LOCK === "1"
  ? lockedElectropaintAuthorities()
  : await verifyElectropaintAuthorities();
await rm(generatedAdapterRoot, { recursive: true, force: true });
const prepared = [];
for (const variant of KENT_VARIANTS) {
  const timelineChunksRoot = timelineChunksRootFor(variant.id);
  const sourceScenePath = sourceScenePathFor(variant.id);
  await mkdir(timelineChunksRoot, { recursive: true });
  const chunkWrites = [];
  const scene = buildPreparedElectropaintScene(authorities, {
    sceneId: variant.id,
    seed: variant.seed,
    warmupStateCount: variant.warmupStateCount,
    emitChunk(chunk) {
      const serialized = serializePreparedElectropaintChunk(chunk, { sceneId: variant.id });
      chunkWrites.push(writeFile(
        resolve(timelineChunksRoot, basename(serialized.descriptor.url)),
        serialized.payload,
      ));
      return serialized.descriptor;
    },
  });
  await Promise.all(chunkWrites);
  await mkdir(dirname(sourceScenePath), { recursive: true });
  await writeFile(sourceScenePath, `${JSON.stringify(scene)}\n`);
  prepared.push({
    id: scene.id,
    seed: scene.sourceProfile.deterministicPreparationSeed,
    warmupStateCount: scene.sourceProfile.discardedWarmupStateCount,
    states: scene.playback.stateCount,
    chunks: scene.playback.chunks.count,
    chunkStoredBytes: scene.playback.chunks.totalStoredBytes,
    paletteEntries: scene.metrics.preparedPaletteEntryCount,
    sourceScenePath,
  });
}
console.log(JSON.stringify({
  status: "prepared",
  variantCount: prepared.length,
  variants: prepared,
}, null, 2));
