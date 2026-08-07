import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureNativeGears, CSSGEARS_NATIVE_SEED } from "../src/prepare/cssgears/nativeOracle.mjs";
import { buildSourceBoundSceneProfile } from "../src/prepare/cssgears/sourceProfile.mjs";

const sourceRoot = ".local/xscreensaver";

test("seeded native gears.c state and pixels are deterministic", {
  skip: !existsSync(sourceRoot) || process.platform !== "darwin" ? "Pinned local XScreenSaver source and macOS CGL are required" : false,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "cssgears-native-oracle-"));
  const first = await captureNativeGears(sourceRoot, { seed: CSSGEARS_NATIVE_SEED, outputDir: join(root, "first") });
  const second = await captureNativeGears(sourceRoot, { seed: CSSGEARS_NATIVE_SEED, outputDir: join(root, "second") });
  const viewRotationDegrees = buildSourceBoundSceneProfile(first).sourceProfile.presentation.rotationDegrees;
  const productView = await captureNativeGears(sourceRoot, {
    seed: CSSGEARS_NATIVE_SEED,
    outputDir: join(root, "product-view"),
    viewRotationDegrees,
  });
  assert.equal(first.stateSha256, second.stateSha256);
  assert.equal(first.frameSha256, second.frameSha256);
  assert.equal(productView.stateSha256, first.stateSha256);
  assert.notEqual(productView.frameSha256, first.frameSha256);
  assert.deepEqual(productView.viewRotationDegrees, viewRotationDegrees);
  const prepared = buildSourceBoundSceneProfile(first);
  assert.deepEqual(
    prepared.playback.transforms.slice(0, first.state.gearCount).map(transformTheta),
    first.state.gears.map((gear) => gear.theta),
  );
  assert.equal(first.state.gearCount, 3);
  assert.equal(first.state.polygonCount, 2130);
});

function transformTheta(transform) {
  const match = /rotateZ\(([-+0-9.eE]+)deg\)$/u.exec(transform);
  assert.ok(match, transform);
  return Number(match[1]);
}
