import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { generatedPublicRoot } from "../src/prepare/cssmenger/paths.mjs";

const root = resolve(import.meta.dirname, "..");
const generated = generatedPublicRoot;

test("generated manifest and scene expose one source-backed default path", async () => {
  const manifest = await readJson(join(generated, "manifest.json"));
  const scene = await readJson(join(generated, "scenes/depth-3.json"));
  assert.equal(manifest.schema, "cssmenger-manifest@1");
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.defaultScene.id, "depth-3");
  assert.deepEqual(manifest.scenes.map((entry) => entry.id), ["depth-3"]);
  assert.equal(manifest.artifactMode, "prepared-polycss-snapshot");
  assert.equal(manifest.runtime.geometryPayload, false);
  assert.equal(scene.schema, "cssmenger-prepared-scene@1");
  assert.equal(scene.source.sourceRevision, "906693799e4fb7581436590cf84ecb2d3c9186ba");
  assert.equal(scene.sourceProfile.seed, 26080801);
  assert.equal(scene.sourceProfile.depth, 3);
  assert.equal(scene.metrics.sourcePolygonCount, 18048);
  assert.equal(scene.metrics.preparedLeafCount, 84);
  assert.equal(scene.metrics.coplanarPartitionOptimal, true);
  assert.equal(scene.metrics.exactRectanglePartitionLeafCount, 9528);
  assert.equal(scene.metrics.preparedPlaneTexturePatternCount, 8);
  assert.equal(scene.planeAtlas.leafCount, 84);
  assert.equal(scene.planeAtlas.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.preparedTimelineStateCount, 1440);
  assert.equal(scene.metrics.preparedBackfaceCulling, true);
  assert.equal(scene.meshes, undefined);
  assert.deepEqual(scene.meshDescriptors.map((mesh) => mesh.polygonCount), [28, 28, 28]);
  assert.equal(scene.renderer.runtimeGeometryPayload, false);
  assert.equal(scene.renderer.runtimeDomGrowth, false);
  assert.equal(scene.renderer.backfacePolicy, "prepared-closed-opaque-surface-cull");
  assert.equal(scene.oracle.nativeStateCapture, "qualified-local-exact-common-prefix-0-45");
  assert.equal(scene.oracle.nativeVisualCapture, "qualified-local-bit-exact-aa-common-prefix-0-45");
  assert.equal(scene.oracle.browserVisualCapture, "qualified-local-bit-exact-aa-common-prefix-0-45");
  assert.equal(scene.oracle.visualComparison, "exact-first-common-prefix-diverged");
  assert.doesNotMatch(JSON.stringify({ manifest, scene }), /\/(?:Users|home)\//u);
});

test("prepared snapshot is retained DOM without an alternate renderer", async () => {
  const html = await readFile(join(generated, "scenes/depth-3.polycss.txt"), "utf8");
  assert.match(html, /class="[^"]*polycss-scene/u);
  assert.equal((html.match(/<b(?:\s|>)/gu) ?? []).length, 28);
  assert.equal((html.match(/<i(?:\s|>)/gu) ?? []).length, 28);
  assert.equal((html.match(/<s(?:\s|>)/gu) ?? []).length, 28);
  assert.equal((html.match(/<div(?:\s|>)/gu) ?? []).length, 2);
  assert.equal((html.match(/style="/gu) ?? []).length, 85);
  assert.doesNotMatch(html, /cssmenger-(?:model|axis)/u);
  const leafStyles = [...html.matchAll(/<[bis] style="([^"]+)"><\/[bis]>/gu)].map((match) => match[1]);
  assert.equal(leafStyles.length, 84);
  assert.equal(leafStyles.every((style) =>
    /^transform: matrix3d\([^)]+\); background-position-x: -\d+px;$/u.test(style)), true);
  assert.match(html, /backface-visibility:hidden!important/u);
  assert.match(html, /image-rendering:pixelated/u);
  assert.doesNotMatch(html, /<script\b|<canvas\b|<svg\b/iu);
  assert.doesNotMatch(html, /\/(?:Users|home)\//u);
});

test("product runtime CSS stays on the fast browser path", async () => {
  const css = await readFile(join(root, "src/cssmenger/styles.css"), "utf8");
  const shellGradient = "linear-gradient(180deg, #0b1119 0%, #000 100%)";
  assert.equal(css.split(shellGradient).length - 1, 2);
  assert.doesNotMatch(css.replaceAll(shellGradient, "none"), /(?:clip-path|mask(?:-image)?|backdrop-filter|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode)\s*:/iu);
});

test("product index uses the css.graphics shell", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  assert.match(html, /<title>css\.graphics\/menger<\/title>/u);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark"[^>]+href="https:\/\/css\.graphics\/"/u);
  assert.match(html, /site-wordmark-path">\/menger/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
});

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
