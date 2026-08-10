// SPDX-License-Identifier: GPL-2.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  generatedAdapterRoot,
  manifestPath,
  runtimeScenePathFor,
  snapshotPathFor,
  timelineChunksRootFor,
} from "../src/prepare/cssselectropaint/paths.mjs";
import { KENT_VARIANTS } from "../src/prepare/cssselectropaint/variants.mjs";
import { decodePreparedElectropaintBinaryChunk } from
  "../src/cssselectropaint/preparedChunkStore.mjs";

test("prepared Kent variants are random-selectable, compact, hash-bound retained-DOM banks", async () => {
  const expectedPublishedFiles = new Set(["manifest.json"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schema, "cssselectropaint-manifest@2");
  assert.equal(manifest.artifactMode, "prepared-polycss-snapshot-plus-timeline-chunks");
  assert.equal(manifest.retainedSquareCount, 40);
  assert.equal(manifest.nativePixelParity, "not-claimed");
  assert.equal(manifest.nativeVisualParity, "not-claimed");
  assert.deepEqual(manifest.selection, {
    policy: "crypto-random-uniform-once-before-variant-asset-fetch",
    selectionCountPerPageLoad: 1,
    selectedVariantAssetFetchOnly: true,
    cssKeyframes: false,
  });
  assert.deepEqual(manifest.variants.map(({ id, seed, warmupStateCount }) => ({
    id,
    seed,
    warmupStateCount,
  })), KENT_VARIANTS.map((variant) => ({
    id: variant.id,
    seed: `0x${variant.seed.toString(16)}`,
    warmupStateCount: variant.warmupStateCount,
  })));
  assert.equal(manifest.runtimePublication.timelineStorage,
    "content-addressed-gzip-binary-third-order-affine-four-chunk-lookahead");
  assert.equal(manifest.runtimePublication.publishedPreparedVariantCount, KENT_VARIANTS.length);
  assert.equal(manifest.runtimePublication.fetchedPreparedVariantCount, 1);
  assert.equal(manifest.runtimePublication.cssKeyframes, false);
  assert.ok(manifest.maximumVariantTimelineStoredBytes < 50 * 1024 * 1024);
  assert.ok(manifest.maximumStartupLookaheadStoredBytes < 2 * 1024 * 1024);
  assert.equal(manifest.maximumVariantTimelineStoredBytes,
    Math.max(...manifest.variants.map((variant) => variant.timelineStoredBytes)));
  assert.equal(manifest.maximumStartupLookaheadStoredBytes,
    Math.max(...manifest.variants.map((variant) => variant.startupLookaheadStoredBytes)));

  for (const variant of manifest.variants) {
    const sceneGzip = await readFile(runtimeScenePathFor(variant.id));
    const snapshotGzip = await readFile(snapshotPathFor(variant.id));
    const scene = JSON.parse(gunzipSync(sceneGzip));
    const snapshot = gunzipSync(snapshotGzip).toString("utf8");
    assert.equal(variant.sceneSha256, sha256(sceneGzip));
    assert.equal(variant.snapshotSha256, sha256(snapshotGzip));
    assert.equal(variant.sceneStoredBytes, sceneGzip.length);
    assert.equal(variant.snapshotStoredBytes, snapshotGzip.length);
    assert.equal(variant.sceneUrl,
      `/cssselectropaint/variants/${variant.id}/scene.json.gz?sha256=${variant.sceneSha256}`);
    assert.equal(variant.snapshotUrl,
      `/cssselectropaint/variants/${variant.id}/snapshot.html.gz?sha256=${variant.snapshotSha256}`);
    assert.equal(scene.id, variant.id);
    assert.equal(scene.schema, "cssselectropaint-prepared-scene@2");
    assert.equal(scene.source.browserReference?.commit,
      "714092ad588e668bee9eb66dfdc94c66f516452b");
    assert.equal(scene.meshes, undefined);
    assert.equal(scene.meshDescriptors.length, 40);
    assert.equal(scene.sourceProfile.deterministicPreparationSeed, variant.seed);
    assert.equal(scene.sourceProfile.discardedWarmupStateCount, variant.warmupStateCount);
    assert.equal(scene.playback.stateCount, 64_000);
    assert.equal(scene.playback.chunks.count, 128);
    assert.equal(scene.playback.chunks.framesPerChunk, 500);
    assert.equal(scene.playback.chunks.runtimeLookaheadChunkCount, 4);
    assert.equal(scene.playback.chunks.totalStoredBytes, variant.timelineStoredBytes);
    assert.equal(scene.playback.metrics.transformAssignmentCount, 2_559_960);
    assert.equal(scene.playback.metrics.innerChunkBoundaryResetCount, 0);
    assert.equal(scene.renderer.runtimeGeometryPayload, false);
    assert.equal(scene.renderer.preparedFlatPolycssQuadLeaves, true);
    assert.equal(scene.metrics.preparedRetainedQuadCount, 40);
    assert.equal((snapshot.match(/<b\b/gu) ?? []).length, 40);
    assert.equal((snapshot.match(/<div\b/gu) ?? []).length, 2);
    assert.doesNotMatch(snapshot, /polycss-mesh|<b[^>]*>\s*<b\b/iu);
    assert.equal((snapshot.match(/\.cp\d+\{/gu) ?? []).length, scene.playback.palette.length);
    assert.doesNotMatch(snapshot, /@keyframes|animation-name|<script\b|<canvas\b|<svg\b/iu);
    assert.doesNotMatch(snapshot, /background:#000|\/(?:Users|home)\//iu);

    const expectedFiles = scene.playback.chunks.descriptors
      .map((descriptor) => basename(descriptor.url)).sort();
    expectedPublishedFiles.add(`variants/${variant.id}/scene.json.gz`);
    expectedPublishedFiles.add(`variants/${variant.id}/snapshot.html.gz`);
    for (const file of expectedFiles) {
      expectedPublishedFiles.add(`variants/${variant.id}/chunks/${file}`);
    }
    assert.deepEqual((await readdir(timelineChunksRootFor(variant.id))).sort(), expectedFiles);
    let storedBytes = 0;
    for (const [index, descriptor] of scene.playback.chunks.descriptors.entries()) {
      const compressed = await readFile(resolve(
        timelineChunksRootFor(variant.id),
        basename(descriptor.url),
      ));
      const raw = gunzipSync(compressed);
      const chunk = decodePreparedElectropaintBinaryChunk(
        new Uint8Array(raw),
        descriptor,
        scene.playback.palette.length,
      );
      assert.equal(sha256(compressed), descriptor.sha256);
      assert.equal(compressed.length, descriptor.storedBytes);
      assert.equal(raw.length, descriptor.bytes);
      assert.equal(chunk.chunkIndex, index);
      assert.equal(chunk.startStateIndex, index * 500);
      assert.equal(chunk.stateCount, 500);
      assert.equal(chunk.initial.globalStateIndex, index * 500);
      assert.equal(chunk.initial.leafTransforms.length, 40);
      assert.equal(chunk.transformSchedule.schema,
        "cssselectropaint-prepared-chunk-transform-schedule@2");
      assert.equal(chunk.schema, "cssselectropaint-prepared-timeline-chunk@2");
      assert.equal(chunk.transformSchedule.encoding,
        "implicit-ring-addresses-plus-third-order-zigzag-varint-quantized-affine12");
      assert.equal(chunk.transformSchedule.affineQuantizationScale, 1_000);
      assert.equal(chunk.transformSchedule.affinePredictorOrder, 3);
      assert.equal(chunk.transformSchedule.transforms, undefined);
      assert.ok(chunk.transformSchedule.affineDeltas instanceof Uint8Array);
      assert.equal(chunk.transformSchedule.decodedMatrixStringCount,
        chunk.transformSchedule.assignmentCount);
      assert.equal(chunk.transformSchedule.assignmentCount, descriptor.transformAssignmentCount);
      assert.equal(chunk.colorSchedule.assignmentCount, descriptor.colorAssignmentCount);
      storedBytes += compressed.length;
    }
    assert.equal(storedBytes, variant.timelineStoredBytes);
  }
  assert.deepEqual((await publishedFiles(generatedAdapterRoot)).sort(),
    [...expectedPublishedFiles].sort());
});

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function publishedFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await publishedFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
    else throw new Error(`Unsupported ElectroPaint generated entry: ${path}`);
  }
  return files;
}
