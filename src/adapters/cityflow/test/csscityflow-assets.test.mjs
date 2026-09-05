// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const productRoot = resolve(repositoryRoot, "build/generated/public/csscityflow");

test("prepared Cityflow product binds source, topology, playback, and bounded transfer", async () => {
  const metadataText = await readFile(resolve(productRoot, "prepared.json"), "utf8");
  const metadata = JSON.parse(metadataText);
  const stylesheetPath = metadata.stylesheet.assetUrl.replace(/^\/csscityflow\//u, "");
  const [catalogText, manifestText, modelText, playbackText, css,
    mobileManifestText, mobileModelText, mobilePlaybackText, desktopAliasCss,
    mobileAliasCss] = await Promise.all([
    readFile(resolve(productRoot, "catalog.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow/manifest.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow/model.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow.playback.json"), "utf8"),
    readFile(resolve(productRoot, stylesheetPath), "utf8"),
    readFile(resolve(productRoot, "cityflow-mobile/manifest.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow-mobile/model.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow-mobile.playback.json"), "utf8"),
    readFile(resolve(productRoot, "cityflow.css"), "utf8"),
    readFile(resolve(productRoot, "cityflow-mobile.css"), "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const manifest = JSON.parse(manifestText);
  const model = JSON.parse(modelText);
  const playback = JSON.parse(playbackText);
  const mobileManifest = JSON.parse(mobileManifestText);
  const mobileModel = JSON.parse(mobileModelText);
  const mobilePlayback = JSON.parse(mobilePlaybackText);
  const bank = metadata.banks.find(({ id }) => id === "desktop");
  const mobileBank = metadata.banks.find(({ id }) => id === "mobile");
  assert.equal(metadata.schema, "csscityflow-prepared-product@3");
  assert.equal(metadata.status, "ready");
  assert.equal(metadata.defaultBank, "desktop");
  assert.equal(metadata.profileSelection.mobileBreakpointWidth, 600);
  assert.equal(metadata.profileSelection.mobileCapabilityQuery,
    "(hover: none) and (pointer: coarse)");
  assert.equal(metadata.source.revision, "906693799e4fb7581436590cf84ecb2d3c9186ba");
  assert.equal(metadata.source.license, "HPND");
  assert.equal(metadata.source.files.length, 14);
  assert.ok(metadata.source.files.every(({ path, sha256 }) =>
    !path.startsWith("/") && /^[a-f0-9]{64}$/u.test(sha256)));
  assert.equal(metadata.stylesheet.schema, "csscityflow-prepared-stylesheet@1");
  assert.equal(metadata.stylesheet.policy,
    "one-content-addressed-rendering-contract-shared-by-all-banks");
  assert.match(metadata.stylesheet.assetUrl,
    /^\/csscityflow\/assets\/presentation-[a-f0-9]{64}\.css$/u);
  assert.equal(createHash("sha256").update(css).digest("hex"), metadata.stylesheet.sha256);
  assert.equal(metadata.stylesheet.assetUrl,
    `/csscityflow/assets/presentation-${metadata.stylesheet.sha256}.css`);
  assert.equal(Buffer.byteLength(css), metadata.stylesheet.byteLength);
  assert.deepEqual(metadata.stylesheet.compatibilityAssetUrls, [
    "/csscityflow/cityflow.css",
    "/csscityflow/cityflow-mobile.css",
  ]);
  assert.equal(desktopAliasCss, css);
  assert.equal(mobileAliasCss, css);
  assert.match(css, /\.polycss-scene>div>b/u);
  assert.equal(bank.boxCount, 200);
  assert.equal(bank.leafCount, 600);
  assert.equal(bank.frameCount, 301);
  assert.equal(bank.sourceFrameCount, 251);
  assert.equal(bank.retainedFacePublication.schema, "csscityflow-retained-face-publication@3");
  assert.equal(bank.retainedFacePublication.policy,
    "prepared-whole-box-visibility-no-face-culling");
  assert.equal(bank.retainedFacePublication.faceCount, 600);
  assert.equal(bank.retainedFacePublication.boxCount, 200);
  assert.equal(bank.retainedFacePublication.visibleFaceCount, 585);
  assert.equal(bank.retainedFacePublication.hiddenFaceCount, 15);
  assert.equal(bank.retainedFacePublication.visibleBoxCount, 195);
  assert.equal(bank.retainedFacePublication.hiddenBoxCount, 5);
  assert.equal(bank.retainedFacePublication.staticVisibility.hiddenFaceIndices.length, 15);
  assert.equal(bank.retainedFacePublication.staticVisibility.schema,
    "csscityflow-prepared-static-visibility@3");
  assert.equal(bank.diagnosticVisibility.usage,
    "diagnostic-only-never-consumed-by-product-playback");
  assert.equal(bank.presentation.kind, "prepared-periodic-source-sample-reconstruction");
  assert.equal(bank.presentation.heightInterpolation,
    "periodic-uniform-cubic-b-spline-c2-source-approximation");
  assert.equal(bank.presentation.temporalFilter,
    "prepared-periodic-five-tap-fold-twelve-three-tap-refold-twelve-five-tap-refold-twelve-adaptive-smooth-sine-eased-extrema@1");
  assert.equal(bank.presentation.directionRunSuppression,
    "prepared-circular-twelve-frame-or-short-direction-run-folding-zero-sum-adaptive-smooth-sine-24-54-0.6-eased@1");
  assert.equal(bank.presentation.colorInterpolation,
    "prepared-srgb-interpolated-final-face-color");
  assert.equal(bank.presentation.transformPublication,
    "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication");
  assert.equal(bank.presentation.statePublication.animationCount, 0);
  assert.equal(bank.presentation.statePublication.frameCount, 301);
  assert.equal(bank.presentation.statePublication.runtimeFormatting, false);
  assert.equal(bank.presentation.statePublication.minimumShapeStyleWritesPerScheduledTick, 0);
  assert.equal(bank.presentation.statePublication.maximumShapeStyleWritesPerScheduledTick, 187);
  assert.equal(bank.presentation.statePublication.maximumLeafColorStyleWritesPerScheduledTick, 271);
  assert.equal(bank.presentation.statePublication.maximumVisibilityStyleWritesPerScheduledTick, 18);
  assert.equal(bank.loop.exactSourceLoop, false);
  assert.equal(catalog.packages.length, 2);
  assert.equal(manifest.identity.id, "cityflow");
  assert.equal(model.render.shapes.length, 200);
  assert.equal(model.render.leaves.length, 600);
  assert.equal(playback.frameCount, 301);
  assert.equal(playback.sourceFrameCount, 251);
  assert.equal(playback.schema, "csscityflow-prepared-playback@58");
  assert.equal(playback.bankId, "desktop");
  assert.equal(playback.modelId, "cityflow");
  assert.equal(playback.visibility, undefined);
  assert.equal(playback.diagnostics.visibility.schema,
    "csscityflow-prepared-visibility-culling@2");
  assert.equal(playback.diagnostics.productPolicy,
    "diagnostic-only-never-consumed-by-product-playback");
  assert.equal(playback.transforms, undefined);
  assert.equal(playback.transformTable.schema, "csscityflow-prepared-transform-table@1");
  assert.equal(playback.transformTable.count, 76051);
  assert.equal(playback.transformTable.groups.length, 200);
  assert.doesNotMatch(playbackText, /matrix3d\(/u,
    "prepared wire payload must not send expanded matrix strings");
  assert.ok(Buffer.byteLength(playbackText) < 1.5 * 1024 * 1024,
    `Prepared playback raw transfer grew to ${Buffer.byteLength(playbackText)} bytes`);
  const packedTransformBytes = playback.transformTable.groups.reduce((sum, group) =>
    sum + Buffer.from(group.deltasBase64, "base64").byteLength, 0);
  assert.ok(packedTransformBytes < 300_000,
    `Prepared transform component streams grew to ${packedTransformBytes} bytes`);
  assert.equal(Buffer.from(playback.transformIndices.presentationBase64, "base64").byteLength,
    301 * 200 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(playback.transformIndices.sourceBase64, "base64").byteLength,
    251 * 200 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(playback.colors.presentationMaterialIndicesBase64, "base64").byteLength,
    301 * 200 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(playback.colors.sourceMaterialIndicesBase64, "base64").byteLength,
    251 * 200 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(playback.colors.schema, "csscityflow-prepared-face-local-materials@7");
  assert.equal(playback.colors.presentationTransitions.transitionCount, 61358);
  assert.equal(playback.colors.presentationTransitions.maximumWritesPerFrame, 271);
  assert.equal(playback.colors.presentationTransitions.colors.length, 662);
  assert.equal(Buffer.from(playback.colors.presentationTransitions.offsetsBase64, "base64").byteLength,
    (301 + 1) * Uint32Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(playback.colors.presentationTransitions.faceIndicesBase64, "base64").byteLength,
    61358 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(playback.colors.presentationTransitions.colorIndicesBase64, "base64").byteLength,
    61358 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(
    playback.staticVisibility.presentation.initialVisibleBoxBitsBase64,
    "base64",
  ).byteLength, Math.ceil(200 / 8));
  assert.equal(Buffer.from(
    playback.staticVisibility.presentation.transitionOffsetsBase64,
    "base64",
  ).byteLength, (301 + 1) * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal(Buffer.from(
    playback.staticVisibility.presentation.transitionBoxIndicesBase64,
    "base64",
  ).byteLength, 240 * Uint16Array.BYTES_PER_ELEMENT);
  assert.equal((css.match(/@keyframes csscityflow-motion-/gu) ?? []).length, 0);
  assert.doesNotMatch(css, /::before/u);
  assert.doesNotMatch(css, /data-csscityflow-|attr\(|::after/u);
  assert.doesNotMatch(`${metadataText}\n${catalogText}\n${manifestText}\n${modelText}\n${playbackText}`,
    /\/Users\/|[A-Z]:\\/u);
  const brotliBytes = brotliCompressSync(Buffer.from(playbackText), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 8 },
  });
  const cssBrotliBytes = brotliCompressSync(Buffer.from(css), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 8 },
  });
  assert.ok(brotliBytes.length < 1024 * 1024,
    `Prepared playback Brotli transfer grew to ${brotliBytes.length} bytes`);
  assert.ok(cssBrotliBytes.length < 10_000,
    `Prepared motion CSS Brotli transfer grew to ${cssBrotliBytes.length} bytes`);
  assert.ok(brotliBytes.length + cssBrotliBytes.length < 1024 * 1024,
    `Combined prepared motion transfer grew to ${brotliBytes.length + cssBrotliBytes.length} bytes`);

  assert.equal(mobileBank.modelId, "cityflow-mobile");
  assert.equal(mobileBank.boxCount, 100);
  assert.equal(mobileBank.leafCount, 300);
  assert.equal(mobileManifest.identity.id, "cityflow-mobile");
  assert.equal(mobileModel.render.shapes.length, 100);
  assert.equal(mobileModel.render.leaves.length, 300);
  assert.equal(mobilePlayback.schema, "csscityflow-prepared-playback@58");
  assert.equal(mobilePlayback.bankId, "mobile");
  assert.equal(mobilePlayback.modelId, "cityflow-mobile");
  assert.equal(mobilePlayback.boxCount, 100);
  assert.equal(mobilePlayback.transformTable.groups.length, 100);
  assert.equal(mobilePlayback.staticVisibility.visibleFaceCount, 300);
  assert.equal(mobilePlayback.staticVisibility.hiddenFaceCount, 0);
  assert.equal(mobilePlayback.staticVisibility.presentation.transitionCount, 0);
  assert.equal(mobilePlayback.sideDepth.defaultDepthScale, 0.28);
  assert.equal(mobilePlayback.sideDepth.maximumDepthScale, 0.28);
  assert.equal(mobilePlayback.sideDepth.overrideCount, 0);
  assert.equal(mobilePlayback.presentation.statePublication.maximumShapeStyleWritesPerScheduledTick, 100);
  assert.doesNotMatch(mobilePlaybackText, /matrix3d\(/u,
    "mobile prepared wire payload must not send expanded matrix strings");
  assert.ok(Buffer.byteLength(mobilePlaybackText) < 800_000,
    `Mobile prepared playback raw transfer grew to ${Buffer.byteLength(mobilePlaybackText)} bytes`);
  assert.doesNotMatch(css, /will-change|attr\(|::before|::after/u);
  assert.doesNotMatch(
    `${metadataText}\n${catalogText}\n${manifestText}\n${modelText}\n${playbackText}\n${mobileManifestText}\n${mobileModelText}\n${mobilePlaybackText}`,
    /\/Users\/|[A-Z]:\\/u,
  );
});
