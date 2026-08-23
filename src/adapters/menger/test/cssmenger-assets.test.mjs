import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { loadPreparedMengerPlaneAtlasAsset } from "../src/cssmenger/preparedPlaneAtlasAsset.mjs";
import { generatedPublicRoot } from "../src/prepare/cssmenger/paths.mjs";
import { PREPARED_STATE_COUNT } from "../src/prepare/cssmenger/sourcePlayback.mjs";

const root = resolve(import.meta.dirname, "..");
const generated = generatedPublicRoot;

test("prepared lighting atlas decodes and retains one direct stylesheet URL without a runtime fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalImage = globalThis.Image;
  const assetSha256 = "a".repeat(64);
  let fetchCount = 0;
  const decodedUrls = [];
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("Prepared CSS atlas binding must not fetch at runtime");
  };
  globalThis.Image = class PreparedTestImage {
    complete = true;
    naturalWidth = 27;
    naturalHeight = 27;
    decoding = "auto";
    src = "";

    async decode() {
      decodedUrls.push(this.src);
    }

    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  };
  try {
    const asset = await loadPreparedMengerPlaneAtlasAsset({
      schema: "cssmenger-prepared-sparse-leaf-lighting-atlas@1",
      presentation: "source-rgb",
      assetUrl: `/cssmenger/assets/lighting-grid-${assetSha256}.webp`,
      profile: "desktop",
      assetSha256,
      encoding: "WebP-lossless-transcode-of-AVIF-q83-alpha-lossless-yuv444",
      mimeType: "image/webp",
      lossless: true,
      quality: 83,
      alphaQuality: 100,
      chromaSubsampling: "4:4:4",
      byteLength: 4,
      width: 27,
      height: 27,
    });
    assert.equal(asset.url, `/cssmenger/assets/lighting-grid-${assetSha256}.webp`);
    assert.equal(asset.cssImageBinding, "prepared-direct-stylesheet-url");
    assert.equal(asset.decodeReadiness, "awaited-image-decode-before-mount");
    assert.equal(asset.decodedImageRetention, "javascript-image-object-no-dom-node");
    assert.deepEqual(decodedUrls, [`/cssmenger/assets/lighting-grid-${assetSha256}.webp`]);
    assert.equal(fetchCount, 0);
    assert.equal(asset.retained, true);
    asset.destroy();
    assert.equal(asset.retained, false);
    asset.destroy();
    const cssOpacityAsset = await loadPreparedMengerPlaneAtlasAsset({
      schema: "cssmenger-prepared-coplanar-plane-atlas@1",
      paletteRole: "css-opacity-base",
      rgbScale: 0.75,
      assetUrl: `/cssmenger/assets/planes-opacity-base-${assetSha256}.png`,
      assetSha256,
      encoding: "PNG-RGBA8",
      byteLength: 4,
      width: 27,
      height: 27,
    });
    assert.equal(cssOpacityAsset.paletteRole, "css-opacity-base");
    assert.deepEqual(decodedUrls, [
      `/cssmenger/assets/lighting-grid-${assetSha256}.webp`,
      `/cssmenger/assets/planes-opacity-base-${assetSha256}.png`,
    ]);
    assert.equal(fetchCount, 0);
    cssOpacityAsset.destroy();
    assert.equal(cssOpacityAsset.retained, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

test("generated manifest exposes depth-3 desktop and depth-2 mobile prepared paths", async () => {
  const manifest = await readJson(join(generated, "manifest.json"));
  const scene = await readJson(join(generated, "scenes/depth-3.json"));
  const mobileScene = await readJson(join(generated, "scenes/depth-2.json"));
  assert.equal(manifest.schema, "cssmenger-manifest@1");
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.defaultScene.id, "depth-3");
  assert.deepEqual(manifest.scenes.map((entry) => entry.id), ["depth-3", "depth-2"]);
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
  assert.equal(scene.metrics.preparedLightingRootCount, 0);
  assert.equal(scene.metrics.preparedAxisRootCount, 0);
  assert.equal(manifest.scenes[0].metrics.preparedRenderWrapperCount, 2);
  assert.equal(manifest.scenes[0].metrics.preparedModelRootCount, 0);
  assert.equal(manifest.scenes[0].metrics.preparedLightingRootCount, 0);
  assert.equal(manifest.scenes[0].metrics.preparedAxisRootCount, 0);
  assert.equal(scene.planeAtlas.leafCount, 84);
  assert.equal(scene.planeAtlas.profile, "desktop");
  assert.equal(scene.planeAtlas.schema, "cssmenger-prepared-sparse-leaf-lighting-atlas@1");
  assert.match(scene.planeAtlas.assetUrl, /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.webp$/u);
  assert.equal(scene.planeAtlas.mimeType, "image/webp");
  assert.equal(scene.planeAtlas.lossless, true);
  assert.equal(scene.planeAtlas.encoding,
    "WebP-lossless-transcode-of-AVIF-q83-alpha-lossless-yuv444");
  assert.equal(scene.planeAtlas.byteLength, 8_507_944);
  assert.equal(scene.planeAtlas.decodedBytes, 89_812_800);
  assert.equal(scene.planeAtlas.width, 4_752);
  assert.equal(scene.planeAtlas.height, 4_725);
  assert.equal(scene.planeAtlas.packing, "balanced-near-square-pixel-surface");
  assert.equal(scene.planeAtlas.visiblePixelIdentity,
    "byte-exact-to-prepared-avif-decode-where-alpha-is-nonzero");
  assert.equal(scene.planeAtlas.visibleLeafFieldCount, 65_436);
  assert.equal(scene.planeAtlas.slotCount, 30_744);
  assert.equal(scene.planeAtlas.exactDuplicateTileCount, 34_692);
  assert.equal(scene.planeAtlas.lightingSampleIntervalTicks, 2);
  assert.equal(scene.planeAtlas.lightingSampleDelayMilliseconds, 60);
  assert.equal(scene.planeAtlas.lightingSampleCount, 768);
  assert.equal(scene.planeAtlas.transformPublicationIntervalTicks, 1);
  assert.equal(scene.planeAtlas.transformPublicationDelayMilliseconds, 30);
  assert.equal(scene.planeAtlas.gutterPixels, 0);
  assert.equal(scene.planeAtlas.addressScheduleSchema,
    "cssmenger-prepared-exact-delta-lighting-address-schedule@1");
  assert.equal(scene.planeAtlas.addressUpdateCount, 32_889);
  assert.equal(scene.planeAtlas.reverseAddressScheduleSchema, undefined);
  assert.equal(scene.planeAtlas.addressStateOffsetByteLength, (PREPARED_STATE_COUNT + 1) * 2);
  assert.equal(scene.planeAtlas.addressLeafIndexByteLength, 32_889);
  assert.equal(scene.planeAtlas.addressSlotIndexByteLength, 32_889 * 2);
  assert.equal(scene.planeAtlas.redundantAddressWriteCountRemoved, 32_547);
  assert.deepEqual(scene.planeAtlas.addressWriteCountPerState, {
    minimum: 0,
    maximum: 50,
    average: 32_889 / PREPARED_STATE_COUNT,
    zeroWriteStateCount: 607,
  });
  assert.equal(scene.mobilePlaneAtlas.profile, "mobile");
  assert.match(scene.mobilePlaneAtlas.assetUrl,
    /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.webp$/u);
  assert.equal(scene.mobilePlaneAtlas.byteLength, 20_034);
  assert.equal(scene.mobilePlaneAtlas.decodedBytes, 236_196);
  assert.equal(scene.mobilePlaneAtlas.width, 243);
  assert.equal(scene.mobilePlaneAtlas.height, 243);
  assert.equal(scene.mobilePlaneAtlas.packing, "balanced-near-square-pixel-surface");
  assert.equal(scene.mobilePlaneAtlas.slotCount, 75);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleIntervalTicks, 1_536);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleDelayMilliseconds, 46_080);
  assert.equal(scene.mobilePlaneAtlas.lightingSampleCount, 1);
  assert.equal(scene.mobilePlaneAtlas.addressUpdateCount, 84);
  assert.equal(scene.mobilePlaneAtlas.redundantAddressWriteCountRemoved, 65_352);
  assert.deepEqual(scene.mobilePlaneAtlas.addressWriteCountPerState, {
    minimum: 0,
    maximum: 0,
    average: 0,
    zeroWriteStateCount: PREPARED_STATE_COUNT,
  });
  assert.equal(scene.mobilePlaneAtlas.addressInitialization, "all-leaf-addresses-before-playback");
  assert.equal(scene.mobilePlaneAtlas.addressInitializationWriteCount, 84);
  assert.equal(scene.cssOpacityBaseAtlas.schema, "cssmenger-prepared-coplanar-plane-atlas@1");
  assert.equal(scene.cssOpacityBaseAtlas.paletteRole, "css-opacity-base");
  assert.equal(scene.cssOpacityBaseAtlas.rgbNormalization, "divide-by-maximum-rgb-channel");
  assert.equal(scene.cssOpacityBaseAtlas.rgbScale, 0.75);
  assert.equal(scene.cssOpacityBaseAtlas.rgbCalibration,
    "native-oracle-common-prefix-display-range-scale");
  assert.equal(scene.cssOpacityBaseAtlas.paletteStateCount, 128);
  assert.equal(scene.cssOpacityBaseAtlas.leafCount, 84);
  assert.equal(scene.cssOpacityBaseAtlas.decodedBytes, 3_444_736);
  assert.match(scene.cssOpacityBaseAtlas.assetUrl,
    /^\/cssmenger\/assets\/planes-opacity-base-[a-f0-9]{64}\.png$/u);
  assert.equal(scene.cssOpacityShadowAtlas.schema, "cssmenger-prepared-sparse-leaf-lighting-atlas@1");
  assert.equal(scene.cssOpacityShadowAtlas.presentation, "css-black-alpha");
  assert.equal(scene.cssOpacityShadowAtlas.byteLength, 5_857_995);
  assert.equal(scene.cssOpacityShadowAtlas.decodedBytes, 195_384_484);
  assert.equal(scene.cssOpacityShadowAtlas.width, 6_989);
  assert.equal(scene.cssOpacityShadowAtlas.height, 6_989);
  assert.equal(scene.cssOpacityShadowAtlas.gutterPixels, 1);
  assert.equal(scene.cssOpacityShadowAtlas.slotCount, 58_080);
  assert.match(scene.cssOpacityShadowAtlas.assetUrl,
    /^\/cssmenger\/assets\/lighting-shadow-grid-[a-f0-9]{64}\.avif$/u);
  assert.equal(scene.cssOpacityShadowAtlas.lightingSampleIntervalTicks, 1);
  assert.equal(scene.cssOpacityShadowAtlas.lightingSampleDelayMilliseconds, 30);
  assert.equal(scene.cssOpacityShadowAtlas.lightingSampleCount, PREPARED_STATE_COUNT);
  assert.equal(scene.cssOpacityShadowAtlas.addressPublicationIntervalTicks, 1);
  assert.equal(scene.cssOpacityShadowAtlas.addressPublicationDelayMilliseconds, 30);
  assert.equal(scene.cssOpacityShadowAtlas.addressedVisibleLeafFieldCount, 65_436);
  assert.equal(scene.cssOpacityShadowAtlas.addressUpdateCount, 60_555);
  assert.deepEqual(scene.cssOpacityShadowAtlas.preparedAxisPaletteSourceIndices, [1, 0, 2]);
  assert.equal(scene.cssOpacityShadowAtlas.preparedPaletteColors.length, 128);
  const opacityBaseBytes = await readFile(join(generated,
    scene.cssOpacityBaseAtlas.assetUrl.replace(/^\/cssmenger\//u, "")));
  const opacityBaseImage = PNG.sync.read(opacityBaseBytes);
  for (let paletteIndex = 0; paletteIndex < scene.cssOpacityBaseAtlas.paletteStateCount; paletteIndex += 1) {
    const contentY = paletteIndex * scene.cssOpacityBaseAtlas.slotHeight +
      scene.cssOpacityBaseAtlas.gutterPixels;
    const opaquePixel = firstOpaquePixelInRow(opacityBaseImage, contentY);
    assert.ok(opaquePixel, `missing CSS-opacity base pixel for palette ${paletteIndex}`);
    assert.equal(Math.max(...opaquePixel.slice(0, 3)),
      Math.round(255 * scene.cssOpacityBaseAtlas.rgbScale));
  }
  assert.equal(scene.cssOpacityLighting, undefined);
  assert.equal(scene.metrics.atlasPageCount, 2);
  assert.equal(scene.playback.frontFacingSchedule.schema, "cssmenger-prepared-front-facing-leaf-schedule@1");
  assert.equal(scene.playback.frontFacingSchedule.offsets.length, PREPARED_STATE_COUNT * 3 + 1);
  assert.equal(scene.playback.frontFacingSchedule.offsets.at(-1), scene.playback.frontFacingSchedule.leafIndices.length);
  assert.equal(scene.playback.frontFacingSchedule.frontFaceDilationTicks, 1);
  assert.deepEqual(scene.metrics.preparedFrontFacingLeafCountPerState, {
    minimum: 41,
    maximum: 50,
    average: 42.6015625,
  });
  assert.equal(scene.planeAtlas.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.sourceFaceCoverageExact, true);
  assert.equal(scene.metrics.preparedTimelineStateCount, PREPARED_STATE_COUNT);
  assert.equal(scene.playback.loopMode, "prepared-forward-cyclic-c2-rotation-and-palette");
  assert.equal(scene.playback.cycleClosure.cycleDurationMilliseconds, 46_080);
  assert.equal(scene.playback.cycleClosure.orientationMaximumEquivalentDeltaDegrees, 0);
  assert.equal(scene.playback.cycleClosure.velocityMaximumDeltaDegreesPerTick < 1e-9, true);
  assert.equal(scene.playback.cycleClosure.accelerationMaximumDeltaDegreesPerTickSquared < 1e-9, true);
  assert.equal(scene.metrics.preparedBackfaceCulling, true);
  assert.equal(scene.meshes, undefined);
  assert.deepEqual(scene.meshDescriptors.map((mesh) => mesh.polygonCount), [28, 28, 28]);
  assert.equal(scene.renderer.runtimeGeometryPayload, false);
  assert.equal(scene.renderer.textureBackend, "atlas");
  assert.equal(scene.renderer.textureLeafSizing, "raster");
  assert.equal(scene.renderer.preparedPlaneGridSnap, "exact-source-cell-boundary-matrix3d");
  assert.equal(scene.renderer.transformPresentation,
    "compositor-css-keyframes-through-prepared-30ms-states-on-existing-scene-node");
  assert.equal(scene.textureLeafSizing, "raster");
  assert.equal(scene.renderer.runtimeDomGrowth, false);
  assert.equal(scene.renderer.backfacePolicy, "prepared-closed-opaque-surface-cull");
  assert.equal(scene.oracle.nativeStateCapture, "qualified-local-exact-common-prefix-0-45");
  assert.equal(scene.oracle.nativeVisualCapture, "qualified-local-bit-exact-aa-common-prefix-0-45");
  assert.equal(scene.oracle.browserVisualCapture, "qualified-local-bit-exact-aa-common-prefix-0-45");
  assert.equal(scene.oracle.visualComparison, "exact-first-common-prefix-diverged");
  assert.doesNotMatch(JSON.stringify({ manifest, scene }), /\/(?:Users|home)\//u);
  assert.equal(mobileScene.sourceProfile.depth, 2);
  assert.equal(mobileScene.metrics.sourcePolygonCount, 1056);
  assert.equal(mobileScene.metrics.preparedLeafCount, 30);
  assert.equal(mobileScene.metrics.mergedSourceFaceCount, 1026);
  assert.equal(mobileScene.metrics.sourceFaceCoverageExact, true);
  assert.deepEqual(mobileScene.meshDescriptors.map((mesh) => mesh.polygonCount), [10, 10, 10]);
  assert.equal(mobileScene.mobilePlaneAtlas.profile, "mobile");
  assert.equal(mobileScene.mobilePlaneAtlas.byteLength, 783_408);
  assert.equal(mobileScene.mobilePlaneAtlas.decodedBytes, 3_572_100);
  assert.equal(mobileScene.mobilePlaneAtlas.width, 945);
  assert.equal(mobileScene.mobilePlaneAtlas.height, 945);
  assert.equal(mobileScene.mobilePlaneAtlas.packing, "balanced-near-square-pixel-surface");
  assert.equal(mobileScene.mobilePlaneAtlas.leafCount, 30);
  assert.equal(mobileScene.mobilePlaneAtlas.addressUpdateCount, 11_680);
  assert.equal(mobileScene.mobilePlaneAtlas.lightingSampleIntervalTicks, 2);
  assert.equal(mobileScene.mobilePlaneAtlas.addressWriteCountPerState.maximum, 18);
  assert.equal(mobileScene.mobilePlaneAtlas.addressInitializationWriteCount, 0);
  assert.equal(mobileScene.renderer.runtimeGeometryPayload, false);
  assert.equal(mobileScene.renderer.preparedPlaneGridSnap, "exact-source-cell-boundary-matrix3d");
  assert.equal(mobileScene.renderer.transformPresentation,
    "compositor-css-keyframes-through-prepared-30ms-states-on-existing-scene-node");
  assert.doesNotMatch(JSON.stringify(mobileScene), /\/(?:Users|home)\//u);
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
    /\.polycss-scene>b\{background-image:url\("\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.webp"\)\}/u);
  assert.match(html,
    /\.polycss-scene\.cssmenger-mobile-atlas.*lighting-grid-mobile-[a-f0-9]{64}\.webp/u);
  assert.match(html,
    /\.polycss-scene\.cssmenger-css-opacity.*planes-opacity-base-[a-f0-9]{64}\.png/u);
  assert.match(html,
    /\.polycss-scene\.cssmenger-css-opacity>b\{[^}]*background-image:url\("\/cssmenger\/assets\/lighting-shadow-grid-[^)]*\),url\("\/cssmenger\/assets\/planes-opacity-base-/u);
  assert.doesNotMatch(html, /mask-image|-webkit-mask/u);
  assert.match(html, /\.polycss-scene\{translate:0px 0px -980\.385px;scale:1\.4(?:;|\})/u);
  assert.match(html, /<div class="polycss-scene" aria-hidden="true" style="transform: rotateX/u);
  assert.match(html, /@keyframes cssmenger-prepared-rotation\{0%\{transform:rotateX/u);
  assert.match(html, /--cssmenger-rotation-duration:46080ms/u);
  assert.equal((html.match(/%\{transform:rotateX/gu) ?? []).length, PREPARED_STATE_COUNT + 1);
  assert.doesNotMatch(html, /cssmenger-(?:rotation|lighting)-root/u);
  assert.doesNotMatch(html, /<b style="(?!transform: matrix3d\()[^"]+/u);
  assert.doesNotMatch(html, /var\(--[mxyz]\)|--[mxyz]:/u);
  assert.match(html, /backface-visibility:\s*hidden/u);
  assert.doesNotMatch(html, /image-rendering:/u);
  assert.doesNotMatch(html, /!important/iu);
  assert.doesNotMatch(html, /<script\b|<canvas\b|<svg\b/iu);
  assert.doesNotMatch(html, /\/(?:Users|home)\//u);
});

test("mobile snapshot is the reduced retained depth-2 graph", async () => {
  const html = await readFile(join(generated, "scenes/depth-2.polycss.txt"), "utf8");
  assert.equal((html.match(/<b(?:\s|>)/gu) ?? []).length, 30);
  assert.equal((html.match(/<i(?:\s|>)/gu) ?? []).length, 0);
  assert.equal((html.match(/<s(?:\s|>)/gu) ?? []).length, 0);
  assert.equal((html.match(/<div(?:\s|>)/gu) ?? []).length, 2);
  assert.equal((html.match(/<b style="transform: matrix3d\(/gu) ?? []).length, 30);
  assert.match(html, /--cssmenger-tile-width:9px;--cssmenger-tile-height:9px/u);
  assert.match(html, /matrix3d\(36\.666666667,/u);
  assert.doesNotMatch(html, /cssmenger-(?:model|axis)|!important|\sdata-[\w-]+=/u);
  assert.doesNotMatch(html, /<script\b|<canvas\b|<svg\b/iu);
});

test("product runtime CSS stays on the fast browser path", async () => {
  const css = await readFile(join(root, "src/cssmenger/styles.css"), "utf8");
  const shellGradient = "linear-gradient(180deg, #0b1119 0%, #000 100%)";
  assert.equal(css.split(shellGradient).length - 1, 2);
  assert.doesNotMatch(css, /!important/iu);
  assert.match(css, /animation: cssmenger-loading 0\.8s linear infinite;/u);
  assert.match(css, /@keyframes cssmenger-loading/u);
  assert.match(css, /\.example-stage > \.polycss-camera > \.polycss-scene\s*\{[^}]*animation:\s*cssmenger-prepared-rotation var\(--cssmenger-rotation-duration\) linear infinite normal both paused;/su);
  assert.match(css, /\.example-stage > \.polycss-camera > \.polycss-scene\s*\{[^}]*will-change:\s*transform;/su);
  assert.match(css, /\.example-stage > \.polycss-camera > \.polycss-scene > b\s*\{/u);
  assert.doesNotMatch(css, /background-image:\s*var\(--a\)/u);
  assert.match(css, /body:not\(\.ready\):not\(\.error\)::after/u);
  assert.doesNotMatch(css, /data-port-status/u);
  assert.doesNotMatch(css.replaceAll(shellGradient, "none"), /(?:clip-path|mask(?:-image)?|backdrop-filter|box-shadow|text-shadow|(?:linear|radial|conic)-gradient|mix-blend-mode|background-blend-mode)\s*:/iu);
});

test("product index uses the css.graphics shell", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  assert.match(html, /<title>Menger Sponge - Powered by PolyCSS<\/title>/u);
  assert.match(html, /cssgraphics-examples-sidebar/u);
  assert.match(html, /<main class="example-stage"><\/main>/u);
  assert.doesNotMatch(html, /iframe|site-header/u);
});

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function firstOpaquePixelInRow(image, y) {
  for (let x = 0; x < image.width; x += 1) {
    const offset = (y * image.width + x) * 4;
    if (image.data[offset + 3] > 0) return [...image.data.subarray(offset, offset + 4)];
  }
  return null;
}
