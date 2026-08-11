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
  assert.equal(scene.metrics.preparedRenderWrapperCount, 2);
  assert.equal(scene.metrics.preparedModelRootCount, 0);
  assert.equal(scene.metrics.preparedAxisRootCount, 0);
  assert.equal(manifest.scenes[0].metrics.preparedRenderWrapperCount, 2);
  assert.equal(manifest.scenes[0].metrics.preparedModelRootCount, 0);
  assert.equal(manifest.scenes[0].metrics.preparedAxisRootCount, 0);
  assert.equal(scene.planeAtlas.leafCount, 84);
  assert.equal(scene.planeAtlas.profile, "desktop");
  assert.equal(scene.planeAtlas.schema, "cssmenger-prepared-sparse-leaf-lighting-atlas@1");
  assert.match(scene.planeAtlas.assetUrl, /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u);
  assert.equal(scene.planeAtlas.visibleLeafFieldCount, 61_524);
  assert.equal(scene.planeAtlas.slotCount, 29_406);
  assert.equal(scene.planeAtlas.exactDuplicateTileCount, 32_118);
  assert.equal(scene.planeAtlas.lightingSampleIntervalTicks, 2);
  assert.equal(scene.planeAtlas.lightingSampleDelayMilliseconds, 60);
  assert.equal(scene.planeAtlas.lightingSampleCount, 720);
  assert.equal(scene.planeAtlas.transformPublicationIntervalTicks, 1);
  assert.equal(scene.planeAtlas.transformPublicationDelayMilliseconds, 30);
  assert.equal(scene.planeAtlas.gutterPixels, 0);
  assert.equal(scene.planeAtlas.addressScheduleSchema,
    "cssmenger-prepared-exact-delta-lighting-address-schedule@1");
  assert.equal(scene.planeAtlas.addressUpdateCount, 30_989);
  assert.equal(scene.planeAtlas.addressStateOffsetByteLength, (1_440 + 1) * 2);
  assert.equal(scene.planeAtlas.addressLeafIndexByteLength, 30_989);
  assert.equal(scene.planeAtlas.addressSlotIndexByteLength, 30_989 * 2);
  assert.equal(scene.planeAtlas.redundantAddressWriteCountRemoved, 30_535);
  assert.deepEqual(scene.planeAtlas.addressWriteCountPerState, {
    minimum: 0,
    maximum: 50,
    average: 30_989 / 1_440,
    zeroWriteStateCount: 546,
  });
  assert.equal(scene.mobilePlaneAtlas.profile, "mobile");
  assert.match(scene.mobilePlaneAtlas.assetUrl,
    /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.avif$/u);
  assert.equal(scene.mobilePlaneAtlas.byteLength, 15_028);
  assert.equal(scene.mobilePlaneAtlas.decodedBytes, 218_700);
  assert.equal(scene.mobilePlaneAtlas.width, 2_025);
  assert.equal(scene.mobilePlaneAtlas.height, 27);
  assert.equal(scene.mobilePlaneAtlas.slotCount, 75);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleIntervalTicks, 1_440);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleDelayMilliseconds, 43_200);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleCount, 1);
  assert.equal(scene.mobilePlaneAtlas.addressUpdateCount, 84);
  assert.equal(scene.mobilePlaneAtlas.redundantAddressWriteCountRemoved, 61_440);
  assert.deepEqual(scene.mobilePlaneAtlas.addressWriteCountPerState, {
    minimum: 0,
    maximum: 43,
    average: 84 / 1_440,
    zeroWriteStateCount: 1_401,
  });
  assert.equal(scene.metrics.atlasPageCount, 2);
  assert.equal(scene.playback.frontFacingSchedule.schema, "cssmenger-prepared-front-facing-leaf-schedule@1");
  assert.equal(scene.playback.frontFacingSchedule.offsets.length, 1440 * 3 + 1);
  assert.equal(scene.playback.frontFacingSchedule.offsets.at(-1), scene.playback.frontFacingSchedule.leafIndices.length);
  assert.equal(scene.playback.frontFacingSchedule.frontFaceDilationTicks, 1);
  assert.deepEqual(scene.metrics.preparedFrontFacingLeafCountPerState, {
    minimum: 41,
    maximum: 50,
    average: 42.725,
  });
  assert.equal(scene.planeAtlas.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.preparedTimelineStateCount, 1440);
  assert.equal(scene.metrics.preparedBackfaceCulling, true);
  assert.equal(scene.meshes, undefined);
  assert.deepEqual(scene.meshDescriptors.map((mesh) => mesh.polygonCount), [28, 28, 28]);
  assert.equal(scene.renderer.runtimeGeometryPayload, false);
  assert.equal(scene.renderer.textureBackend, "atlas");
  assert.equal(scene.renderer.textureLeafSizing, "raster");
  assert.equal(scene.textureLeafSizing, "raster");
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
  assert.equal((html.match(/<b(?:\s|>)/gu) ?? []).length, 84);
  assert.equal((html.match(/<i(?:\s|>)/gu) ?? []).length, 0);
  assert.equal((html.match(/<s(?:\s|>)/gu) ?? []).length, 0);
  assert.equal((html.match(/<div(?:\s|>)/gu) ?? []).length, 2);
  assert.equal((html.match(/style="/gu) ?? []).length, 85);
  assert.doesNotMatch(html, /cssmenger-(?:model|axis)/u);
  assert.equal((html.match(/<b><\/b>/gu) ?? []).length, 0);
  assert.equal((html.match(/<b style="transform: matrix3d\(/gu) ?? []).length, 84);
  assert.doesNotMatch(html, /\.polycss-scene>b:nth-child\(\d+\)\{transform:/u);
  assert.match(html,
    /body>\.polycss-camera>\.polycss-scene>b\{background-image:url\("\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif"\)\}/u);
  assert.match(html,
    /\.polycss-scene\.cssmenger-mobile-atlas.*lighting-grid-mobile-[a-f0-9]{64}\.avif/u);
  assert.match(html, /\.polycss-scene\{translate:0px 0px -980\.385px;scale:1\.4(?:;|\})/u);
  assert.match(html, /<div class="polycss-scene" aria-hidden="true" style="transform: rotateX/u);
  assert.doesNotMatch(html, /<b style="(?!transform: matrix3d\()[^"]+/u);
  assert.doesNotMatch(html, /var\(--[mxyz]\)|--[mxyz]:/u);
  assert.match(html, /backface-visibility:\s*hidden/u);
  assert.doesNotMatch(html, /image-rendering:/u);
  assert.doesNotMatch(html, /!important/iu);
  assert.doesNotMatch(html, /<script\b|<canvas\b|<svg\b/iu);
  assert.doesNotMatch(html, /\/(?:Users|home)\//u);
});

test("product runtime CSS stays on the fast browser path", async () => {
  const css = await readFile(join(root, "src/cssmenger/styles.css"), "utf8");
  const shellGradient = "linear-gradient(180deg, #0b1119 0%, #000 100%)";
  assert.equal(css.split(shellGradient).length - 1, 2);
  assert.doesNotMatch(css, /!important/iu);
  assert.match(css, /body > \.polycss-camera > \.polycss-scene > b\s*\{/u);
  assert.doesNotMatch(css, /background-image:\s*var\(--a\)/u);
  assert.match(css, /body:not\(\.ready\):not\(\.error\)::after/u);
  assert.doesNotMatch(css, /data-port-status/u);
  assert.doesNotMatch(css.replaceAll(shellGradient, "none"), /(?:clip-path|mask(?:-image)?|backdrop-filter|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode)\s*:/iu);
});

test("product index uses the css.graphics shell", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  assert.match(html, /<title>css\.graphics\/menger<\/title>/u);
  assert.match(html, /class="site-header"/u);
  assert.match(html, /class="site-wordmark"[^>]+href="\/"/u);
  assert.match(html, /site-wordmark-path">\/menger/u);
  assert.match(html, /href="https:\/\/github\.com\/layoutit\/cssGraphics"/u);
});

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
