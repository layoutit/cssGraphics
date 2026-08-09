import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { gunzipSync } from "node:zlib";
import { compareRotationScores } from "../src/prepare/cssmaze/rotationRanking.mjs";

const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "..", "..", "..");
const generated = join(repositoryRoot, "build/generated/public/cssmaze");

test("generated manifest exposes 24 source-backed low-rotation prepared scenes", async () => {
  const manifest = await readJson(join(generated, "manifest.json"));
  const scene = await readGzipJson(join(generated, "scenes/default-maze.json.gz"));
  assert.equal(manifest.schema, "cssmaze-manifest@3");
  assert.equal(manifest.scope, "public-prepared-product");
  assert.equal(manifest.release.status, "ready");
  assert.equal(manifest.defaultScene.id, "default-maze");
  assert.equal(manifest.scenes.length, 24);
  assert.equal(manifest.preparedBank.schema, "cssmaze-prepared-bank@1");
  assert.equal(manifest.preparedBank.sceneIds.length, 24);
  assert.deepEqual(manifest.scenes.map((entry) => entry.id), manifest.preparedBank.sceneIds);
  assert.deepEqual(manifest.scenes.map((entry) => entry.nativeSeed), manifest.preparedBank.seeds);
  assert.equal(manifest.preparedBank.ranking.algorithm,
    "common-loop-orientation-then-lowest-maximum-consecutive-quarter-turns");
  assert.equal(manifest.preparedBank.ranking.candidateSeedCount, 131_072);
  assert.equal(manifest.preparedBank.ranking.minimumStateCount, 600);
  assert.equal(manifest.preparedBank.ranking.maximumConsecutiveQuarterTurnCount, 2);
  assert.equal(manifest.preparedBank.ranking.maximumLoopOrientationChangeDegrees, 0);
  assert.equal(manifest.preparedBank.ranking.requiredLoopOrientationDegrees, 180);
  assert.equal(manifest.preparedBank.ranking.loopTexturePhaseAligned, true);
  assert.equal(manifest.preparedBank.ranking.runtimeScoring, false);
  assert.equal(manifest.preparedBank.runtimeSceneGeneration, false);
  assert.equal(manifest.preparedBank.runtimeRotationScoring, false);
  assert.equal(manifest.preparedBank.mountedSceneCount, 1);
  assert.equal(manifest.transport.schema, "cssmaze-prepared-transport@1");
  assert.equal(manifest.transport.encoding, "gzip");
  assert.equal(manifest.transport.startup, "selected-scene-and-snapshot-first");
  assert.equal(manifest.transport.selection, "page-load-only");
  assert.equal(manifest.transport.runtimeArchiveDownload, false);
  assert.equal(manifest.transport.runtimeGeometryPayload, false);
  assert.equal(manifest.transport.sharedSnapshotAtlases.length, 2);
  assert.deepEqual(
    manifest.transport.sharedSnapshotAtlases.map((atlas) => atlas.id).sort(),
    ["snapshot-atlas:surfaces", "snapshot-atlas:walls"],
  );
  for (const atlas of manifest.transport.sharedSnapshotAtlases) {
    assert.equal(atlas.encoding, "identity");
    assert.ok(atlas.byteLength > 0);
    assert.match(atlas.sha256, /^[a-f0-9]{64}$/u);
    const bytes = await readFile(join(generated, atlas.url.slice("/cssmaze/".length)));
    assert.equal(bytes.length, atlas.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), atlas.sha256);
  }
  for (let index = 1; index < manifest.preparedBank.rotationScores.length; index += 1) {
    assert.ok(compareRotationScores(
      manifest.preparedBank.rotationScores[index - 1],
      manifest.preparedBank.rotationScores[index],
    ) <= 0);
  }
  for (const score of manifest.preparedBank.rotationScores) {
    assert.equal(score.schema, "cssmaze-prepared-rotation-score@2");
    assert.ok(score.maximumConsecutiveQuarterTurnCount <= 2);
    assert.ok(score.longestTurningRunDegrees <= 180.01);
    assert.ok(score.longestTurningRunFrameCount <= 64);
    assert.equal(score.loopOrientationChangeDegrees, 0);
    assert.equal(score.loopOrientationQuarterTurnCount, 0);
    assert.equal(score.loopOrientationDegrees, 180);
  }
  assert.equal(manifest.artifactMode, "prepared-polycss-snapshot");
  assert.equal(scene.schema, "cssmaze-prepared-scene@1");
  assert.equal(scene.meshes, undefined);
  assert.equal(scene.meshDescriptors.length, 2);
  assert.equal(scene.renderer.runtimeGeometryPayload, false);
  assert.equal(scene.sourceProfile.seed, manifest.preparedBank.seeds[0]);
  assert.deepEqual(scene.sourceProfile.rotationScore, manifest.preparedBank.rotationScores[0]);
  assert.equal(scene.metrics.sourceWallSegmentCount, 169);
  assert.equal(scene.metrics.sourcePolygonCount, 171);
  assert.equal(scene.metrics.preparedLeafCount, 171);
  assert.equal(scene.metrics.sourceWallCoverageExact, true);
  assert.equal(scene.metrics.unresolvedTextureCount, 0);
  assert.equal(scene.metrics.preparedTimelineStateCount, scene.sourceProfile.rotationScore.stateCount);
  assert.ok(scene.metrics.preparedTimelineStateCount >= 600);
  assert.ok(scene.metrics.preparedLeafVisibilitySetCount > 1);
  assert.equal(scene.playback.leafVisibilitySets.every((set) => set.length === 169), true);
  assert.equal(scene.playback.leafVisibilityChangeRows.length, scene.playback.stateCount);
  assert.equal(
    scene.metrics.preparedLeafVisibilityDeltaOperationCount,
    scene.playback.leafVisibilityChangeRows.reduce((sum, row) => sum + row.length, 0),
  );
  assert.equal(
    scene.metrics.preparedInitialLeafVisibilityOperationCount,
    scene.playback.initialLeafVisibilityChanges.length,
  );
  assert.equal(scene.metrics.runtimeLeafVisibilityComparisonCount, 0);
  assert.equal(scene.meshDescriptors.reduce((sum, mesh) => sum + mesh.polygonCount, 0), 171);
  assert.equal(scene.playback.frameRows.length, scene.sourceProfile.rotationScore.stateCount);
  assert.equal(scene.renderer.textureBackend, "atlas");
  assert.equal(scene.renderer.textureLeafSizing, "raster");
  assert.equal(scene.renderer.textureImageRendering, "pixelated");
  assert.equal(scene.renderer.textureProjection, "affine");
  assert.equal(scene.renderer.uniformCameraScale3d, true);
  assert.equal(scene.textureQuality, 1);
  assert.equal(scene.camera.preparedEyeOffsetPixels, 56.25);
  assert.equal(scene.camera.preparedSceneScale, 4.8);
  assert.equal(scene.renderer.runtimeDomGrowth, false);
  assert.equal(scene.renderer.runtimeVisibilityCalculation, false);
  assert.equal(scene.oracle.nativeVisualCapture, "local-source-backed-helper-available-unqualified");
  assert.equal(scene.oracle.visualComparison, "unqualified");
  assert.doesNotMatch(JSON.stringify({ manifest, scene }), /\/(?:Users|home)\//u);

  for (const entry of manifest.scenes) {
    assert.match(entry.sceneUrl, /^\/cssmaze\/scenes\/[a-z0-9._-]+\.json\.gz$/u);
    assert.match(entry.snapshotUrl, /^\/cssmaze\/scenes\/[a-z0-9._-]+\.polycss\.html\.gz$/u);
    const prepared = await readGzipJson(join(generated, `scenes/${entry.id}.json.gz`));
    const firstPose = prepared.playback.sourceCameraPoses[0];
    const lastPose = prepared.playback.sourceCameraPoses.at(-1);
    assert.equal(Math.abs(((lastPose[2] - firstPose[2] + 540) % 360) - 180), 0);
    assert.equal(firstPose[2], 180);
    assert.equal(lastPose[2], 180);
    assert.equal(Number.isInteger(lastPose[0] - firstPose[0]), true);
    assert.equal(Number.isInteger(lastPose[1] - firstPose[1]), true);
    assert.equal(prepared.playback.leafVisibilityChangeRows.length, prepared.playback.stateCount);
    assert.equal(
      prepared.metrics.preparedLeafVisibilityDeltaOperationCount,
      prepared.playback.leafVisibilityChangeRows.reduce((sum, row) => sum + row.length, 0),
    );
    assert.equal(prepared.metrics.runtimeLeafVisibilityComparisonCount, 0);
  }
});

test("generated local textures preserve pinned byte identity", async () => {
  const expected = {
    "brick1.png": "60190f318c521e43160cd8780a70e08117f4cc6d8bd839c304bcc30f312c300d",
    "brick2.png": "8829d69a3eb036ac97fbf5a3bf9ecdbc90fe9fe1a36775bd96fa57a46d481ef9",
    "wood2.png": "22e6111a207b6e1463641c583ea08a17cc6f89bc62276a3e14ad37ff3350f0a6",
  };
  for (const [name, hash] of Object.entries(expected)) {
    const bytes = await readFile(join(generated, "assets", name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
});

test("every prepared snapshot is retained DOM without an alternate renderer", async () => {
  const manifest = await readJson(join(generated, "manifest.json"));
  for (const entry of manifest.scenes) {
    const html = gunzipSync(await readFile(join(generated, `scenes/${entry.id}.polycss.html.gz`))).toString("utf8");
    assert.match(html, /class="[^"]*polycss-scene/u);
    assert.match(html, /cssmaze-world/u);
    assert.match(html, /cssmaze-walls/u);
    assert.match(html, /cssmaze-surfaces/u);
    assert.match(html, /transform: scale3d\(4\.8, 4\.8, 4\.8\)/u);
    assert.doesNotMatch(html, /transform: scale\(4\.8\)/u);
    assert.doesNotMatch(html, /\sdata-[a-z0-9-]+=/iu);
    const leaves = html.match(/<s\b[^>]*><\/s>/gu) ?? [];
    assert.equal(leaves.length, 171);
    for (const leaf of leaves) {
      assert.match(leaf, /style="[^"]*transform: matrix3d\(/u);
      assert.match(leaf, /background-position:/u);
      assert.doesNotMatch(leaf, /(?:image-rendering|background-repeat|background-size|width|height):/u);
    }
    assert.match(html, /\.cssmaze-world s\{image-rendering:pixelated;background-repeat:no-repeat\}/u);
    assert.match(html, /\.cssmaze-surfaces>s\{width:600px;height:600px;background-size:/u);
    assert.match(html, /\.cssmaze-walls>s\{width:50px;height:50px;background-size:/u);
    assert.match(html, /\.cssmaze-world s\{-webkit-backface-visibility:visible;backface-visibility:visible\}/u);
    assert.doesNotMatch(html, /data:image\//u);
    for (const atlas of manifest.transport.sharedSnapshotAtlases) {
      assert.equal(html.split(atlas.url).length - 1, 1);
    }
    assert.doesNotMatch(html, /<script\b|<canvas\b|<svg\b/iu);
    assert.doesNotMatch(html, /\/(?:Users|home)\//u);
  }
});

test("prepared wall atlas preserves source texture brightness", async () => {
  const manifest = await readJson(join(generated, "manifest.json"));
  const descriptor = manifest.transport.sharedSnapshotAtlases.find((atlas) =>
    atlas.id === "snapshot-atlas:walls");
  assert.ok(descriptor, "prepared wall atlas must be distributed once");
  const atlas = PNG.sync.read(await readFile(join(generated, descriptor.url.slice("/cssmaze/".length))));
  const source = PNG.sync.read(await readFile(join(generated, "assets/brick1.png")));
  const atlasMean = meanRgb(atlas, { x: 1, y: 1, width: 50, height: 50 });
  const sourceMean = meanRgb(source, { x: 0, y: 0, width: source.width, height: source.height });
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(atlasMean[channel] - sourceMean[channel]) < 3,
      `wall atlas channel ${channel} darkened: ${atlasMean[channel]} vs ${sourceMean[channel]}`);
  }
});

test("product runtime CSS stays on the fast browser path", async () => {
  const css = await readFile(join(root, "src/cssmaze/styles.css"), "utf8");
  const shellGradient = "linear-gradient(180deg, #0b1119 0%, #000 100%)";
  assert.equal(css.split(shellGradient).length - 1, 2);
  assert.doesNotMatch(css.replaceAll(shellGradient, "none"), /(?:clip-path|mask(?:-image)?|backdrop-filter|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode)\s*:/iu);
});

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readGzipJson(path) {
  return JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
}

function meanRgb(png, { x, y, width, height }) {
  const sums = [0, 0, 0];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * png.width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += png.data[offset + channel];
    }
  }
  return sums.map((sum) => sum / (width * height));
}
