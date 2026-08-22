import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve("build/generated/public/cssflocks");

test("prepared Flocks manifest binds the source-backed default scene", async () => {
  const manifest = await readJson("manifest.json");
  const prepared = await readJson("prepared.json");
  const scene = await readJson("scenes/flocks-default.json");
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.defaultScene, "flocks-default");
  assert.equal(prepared.defaultScene, manifest.defaultScene);
  assert.equal(scene.id, manifest.defaultScene);
  assert.equal(manifest.source.sha256, "0db819da1d123ad4ae2cf5f53bec278e64b2f65ecabe617a843197446c1813d6");
  assert.equal(scene.metrics.atlasCount, 0);
  assert.equal(scene.metrics.unresolvedTextureCount, 0);
  assert.equal(prepared.renderer.runtimeGeometryConstruction, false);
  assert.equal(prepared.renderer.runtimeDomGrowth, false);
});

test("desktop and mobile assets declare exact source and product counts", async () => {
  const prepared = await readJson("prepared.json");
  for (const [profileId, expected] of Object.entries({
    desktop: { bugs: 324, leaves: 1_944, model: "flocks" },
    mobile: { bugs: 164, leaves: 984, model: "flocks-mobile" },
  })) {
    const profile = prepared.profiles[profileId];
    const catalog = await readJson(`${profileId}/catalog.json`);
    assert.equal(profile.presentation.sourceDefaultBugCount, 1_004);
    assert.equal(profile.presentation.productBugCount, expected.bugs);
    assert.equal(profile.model.retainedBugRootCount, expected.bugs);
    assert.equal(profile.model.retainedPolygonLeafCount, expected.leaves);
    assert.equal(profile.model.id, expected.model);
    assert.equal(catalog.sourceDefaultBugCount, 1_004);
    assert.equal(catalog.bugCount, expected.bugs);
    assert.equal(catalog.leafCount, expected.leaves);
    assert.equal(catalog.sourceFrameCount, 12_960);
    assert.equal(catalog.streamFrameCount, 13_440);
    assert.equal(catalog.blockCount, 224);
    assert.equal(catalog.entries.length, 224);
    assert.equal(catalog.runtimeLookaheadBlockCount, 11);
    assert.equal(catalog.runtimeMaterializedLookaheadBlockCount, 2);
    assert.equal(catalog.startupMaterializedLookaheadBlockCount, 2);
    assert.equal(catalog.terminalSeam.strategy, "cubic-hermite-correspondence");
    assert.equal(catalog.terminalSeam.sourceBehaviorDeviation, true);
    assert.equal(catalog.terminalSeam.bridgeFrameCount, 480);
    assert.equal(catalog.terminalSeam.correspondence.length, expected.bugs);
    assert.equal(new Set(catalog.terminalSeam.correspondence).size, expected.bugs);
    assert.ok(catalog.entries.slice(0, 216).every((entry, index) =>
      entry.continuityKind === "exact-source-adjacent" && entry.sourceContinuousFromPrevious === (index > 0)));
    assert.ok(catalog.entries.slice(216).every((entry) =>
      entry.continuityKind === "prepare-only-hermite-terminal-bridge" && entry.sourceContinuousFromPrevious === false));
    assert.ok(profile.playback.preparedBlockEncodedBytes <= (profileId === "desktop" ? 12 : 6) * 1024 * 1024);
    assert.ok(catalog.entries.every((entry) => entry.byteLength > 0 && entry.decodedByteLength > entry.byteLength));
    for (const entry of catalog.entries) {
      const path = join(root, entry.assetUrl.replace(/^\/cssflocks\//u, ""));
      assert.equal((await stat(path)).size, entry.byteLength);
    }
  }
});

test("prepared model packages and catalog exist without atlas assets", async () => {
  for (const modelId of ["flocks", "flocks-mobile"]) {
    const manifest = await readJson(`model/${modelId}/manifest.json`);
    assert.equal(manifest.identity.id, modelId);
  }
  await stat(join(root, "model/catalog.json"));
  const files = await readdir(root, { recursive: true });
  assert.ok(files.every((path) => !/atlas|\.png$|\.webp$/iu.test(path)));
});

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}
