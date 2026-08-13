// SPDX-License-Identifier: GPL-2.0-only
import { readPreparedJson, readPreparedText } from "./preparedResponse.mjs";

const SOURCE_FRAME_COUNT = 64_000;
const CHUNK_COUNT = 128;
const FRAMES_PER_CHUNK = 500;
const RETAINED_SQUARE_COUNT = 40;

export async function loadPreparedElectropaint(
  fetchImpl = globalThis.fetch.bind(globalThis),
  readRandomUint32 = cryptoRandomUint32,
) {
  const manifestResponse = await fetchImpl("/cssselectropaint/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Failed to load ElectroPaint manifest: ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  validateManifest(manifest);
  const selectedVariant = selectValidatedVariant(manifest, readRandomUint32);
  const [sceneResponse, snapshotResponse] = await Promise.all([
    fetchImpl(selectedVariant.sceneUrl, { cache: "force-cache" }),
    fetchImpl(selectedVariant.snapshotUrl, { cache: "force-cache" }),
  ]);
  if (!sceneResponse.ok || !snapshotResponse.ok) {
    throw new Error("Prepared ElectroPaint assets are missing. Run pnpm prepare:electropaint:source.");
  }
  const [sceneData, snapshotHtml] = await Promise.all([
    readPreparedJson(sceneResponse),
    readPreparedText(snapshotResponse),
  ]);
  validateScene(sceneData, selectedVariant);
  return Object.freeze({ manifest, selectedVariant, sceneData, snapshotHtml });
}

export function selectPreparedElectropaintVariant(manifest, readRandomUint32 = cryptoRandomUint32) {
  validateManifest(manifest);
  return selectValidatedVariant(manifest, readRandomUint32);
}

function selectValidatedVariant(manifest, readRandomUint32) {
  const value = readRandomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("ElectroPaint random variant selector returned an invalid uint32");
  }
  const index = Math.floor((value / 0x1_0000_0000) * manifest.variants.length);
  return manifest.variants[index];
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

function validateManifest(manifest) {
  const runtime = manifest?.runtimePublication;
  if (manifest?.schema !== "cssselectropaint-manifest@2" ||
      manifest.artifactMode !== "prepared-polycss-snapshot-plus-timeline-chunks" ||
      manifest.retainedSquareCount !== RETAINED_SQUARE_COUNT ||
      !Array.isArray(manifest.variants) || manifest.variants.length !== 8 ||
      new Set(manifest.variants.map((variant) => variant.id)).size !== manifest.variants.length ||
      manifest.variants.some((variant) => !validVariant(variant)) ||
      manifest.selection?.policy !== "crypto-random-uniform-once-before-variant-asset-fetch" ||
      manifest.selection.selectionCountPerPageLoad !== 1 ||
      manifest.selection.selectedVariantAssetFetchOnly !== true ||
      manifest.selection.cssKeyframes !== false ||
      manifest.maximumVariantTimelineStoredBytes !==
        Math.max(...manifest.variants.map((variant) => variant.timelineStoredBytes)) ||
      manifest.maximumStartupLookaheadStoredBytes !==
        Math.max(...manifest.variants.map((variant) => variant.startupLookaheadStoredBytes)) ||
      manifest.totalPublishedTimelineStoredBytes !==
        manifest.variants.reduce((total, variant) => total + variant.timelineStoredBytes, 0) ||
      runtime?.scheme !== "prepared-forty-wing-history-ring" ||
      runtime.timelineStorage !== "content-addressed-gzip-binary-third-order-affine-four-chunk-lookahead" ||
      runtime.retainedDomBankCount !== 1 || runtime.publishedPreparedVariantCount !== 8 ||
      runtime.fetchedPreparedVariantCount !== 1 || runtime.runtimeLookaheadChunkCount !== 4 ||
      runtime.sequentialRootTransformWrites !== 0 ||
      runtime.maximumSequentialLeafTransformWrites !== 40 ||
      runtime.maximumSequentialColorClassWrites !== 1 ||
      runtime.innerChunkBoundaryLeafTransformWrites !== 40 ||
      runtime.innerChunkBoundaryColorClassWrites !== 1 || runtime.innerChunkBoundaryResets !== 0 ||
      runtime.resetLeafTransformWrites !== 40 || runtime.resetColorClassWrites !== 40 ||
      runtime.directColorStyleWrites !== 0 || runtime.outlineWrites !== 0 ||
      runtime.leafWideComparisons !== 0 || runtime.matrixCalculations !== 0 ||
      runtime.ringIndexCalculations !== 0 || runtime.cadenceCalculations !== 0 ||
      runtime.cadenceDelayLookupsPerSequentialState !== 0 ||
      runtime.constantFrameDelayMilliseconds !== 1_000 / 60 || runtime.cssKeyframes !== false) {
    throw new Error("Generated ElectroPaint manifest is invalid. Run pnpm prepare:electropaint:source.");
  }
}

function validVariant(variant) {
  return /^[a-z0-9-]+$/u.test(variant?.id ?? "") &&
    /^0x[a-f0-9]+$/u.test(variant.seed ?? "") &&
    Number.isSafeInteger(variant.warmupStateCount) && variant.warmupStateCount >= 0 &&
    variant.sourceFrameCount === SOURCE_FRAME_COUNT && variant.timelineChunkCount === CHUNK_COUNT &&
    variant.timelineFramesPerChunk === FRAMES_PER_CHUNK &&
    variant.timelineDurationMilliseconds === SOURCE_FRAME_COUNT * (1_000 / 60) &&
    Number.isSafeInteger(variant.timelineStoredBytes) && variant.timelineStoredBytes > 0 &&
    Number.isSafeInteger(variant.startupLookaheadStoredBytes) && variant.startupLookaheadStoredBytes > 0 &&
    variant.startupLookaheadStoredBytes < variant.timelineStoredBytes &&
    variant.sceneEncoding === "gzip" && variant.snapshotEncoding === "gzip" &&
    Number.isSafeInteger(variant.sceneStoredBytes) && variant.sceneStoredBytes > 0 &&
    Number.isSafeInteger(variant.snapshotStoredBytes) && variant.snapshotStoredBytes > 0 &&
    validContentAddressedVariantUrl(variant.sceneUrl, variant.id, "scene.json.gz", variant.sceneSha256) &&
    validContentAddressedVariantUrl(
      variant.snapshotUrl,
      variant.id,
      "snapshot.html.gz",
      variant.snapshotSha256,
    );
}

function validContentAddressedVariantUrl(url, variantId, fileName, expectedHash) {
  if (typeof url !== "string" || !/^[a-f0-9]{64}$/u.test(expectedHash)) return false;
  const [path, query, extra] = url.split("?");
  if (extra !== undefined || path !== `/cssselectropaint/variants/${variantId}/${fileName}`) return false;
  const parameters = new URLSearchParams(query);
  return [...parameters.keys()].length === 1 && parameters.get("sha256") === expectedHash;
}

function validateScene(scene, selectedVariant) {
  const playback = scene?.playback;
  const chunks = playback?.chunks;
  if (scene?.schema !== "cssselectropaint-prepared-scene@2" || scene.id !== selectedVariant.id ||
      scene.mode !== "model-viewer" ||
      scene.artifactMode !== "prepared-polycss-snapshot-plus-timeline-chunks" ||
      scene.meshes !== undefined || scene.meshDescriptors?.length !== RETAINED_SQUARE_COUNT ||
      scene.metrics?.preparedRetainedQuadCount !== RETAINED_SQUARE_COUNT ||
      scene.renderer?.runtimeGeometryPayload !== false ||
      scene.renderer.preparedFlatPolycssQuadLeaves !== true ||
      scene.sourceProfile?.deterministicPreparationSeed !== selectedVariant.seed ||
      scene.sourceProfile.discardedWarmupStateCount !== selectedVariant.warmupStateCount ||
      playback?.schema !== "cssselectropaint-prepared-playback@4" ||
      playback.rootTransformPublication !== "prepared-once-in-snapshot-no-runtime-root-writes" ||
      playback.rootTransform !== "translateY(135px) rotateX(45deg)" ||
      playback.stateCount !== SOURCE_FRAME_COUNT || playback.initialStateIndex !== 0 ||
      playback.initial?.leafTransforms?.length !== RETAINED_SQUARE_COUNT ||
      playback.initial?.colorIndices?.length !== RETAINED_SQUARE_COUNT ||
      playback.restart?.schema !== "cssselectropaint-prepared-restart@1" ||
      playback.restart.transformCount !== RETAINED_SQUARE_COUNT ||
      playback.restart.colorCount !== RETAINED_SQUARE_COUNT ||
      playback.restart.leafTransforms?.length !== RETAINED_SQUARE_COUNT ||
      playback.restart.colorIndices?.length !== RETAINED_SQUARE_COUNT ||
      chunks?.schema !== "cssselectropaint-prepared-timeline-chunks@1" ||
      chunks.continuity !== "single-prepared-state-stream-split-without-inner-resets" ||
      chunks.count !== CHUNK_COUNT || chunks.framesPerChunk !== FRAMES_PER_CHUNK ||
      chunks.runtimeLookaheadChunkCount !== 4 ||
      chunks.totalStoredBytes !== selectedVariant.timelineStoredBytes ||
      !validChunkDescriptors(chunks.descriptors, selectedVariant.id) ||
      playback.metrics?.maximumTransformAssignmentsPerSequentialState !== 40 ||
      playback.metrics.maximumColorAssignmentsPerSequentialState !== 1 ||
      playback.metrics.innerChunkBoundaryResetCount !== 0 ||
      playback.outline?.invariant !== true || playback.outline.runtimeWrites !== 0 ||
      playback.presentationCadence?.policy !== "fixed-kent-animation-interval" ||
      playback.presentationCadence.dynamic !== false ||
      playback.presentationCadence.sourceTicksPerSecond !== 60 ||
      playback.presentationCadence.runtimeSelection !== "single-constant-frame-period-no-cadence-table" ||
      playback.cadenceSchedule !== undefined ||
      !Array.isArray(playback.palette) || playback.palette.length < 1) {
    throw new Error("Prepared ElectroPaint scene contract drifted");
  }
}

function validChunkDescriptors(descriptors, variantId) {
  const urlPattern = new RegExp(
    `^/cssselectropaint/variants/${variantId}/chunks/chunk-\\d{3}-[a-f0-9]{16}\\.bin\\.gz$`,
    "u",
  );
  return Array.isArray(descriptors) && descriptors.length === CHUNK_COUNT && descriptors.every((descriptor, index) =>
    descriptor?.chunkIndex === index && descriptor.startStateIndex === index * FRAMES_PER_CHUNK &&
    descriptor.stateCount === FRAMES_PER_CHUNK && descriptor.encoding === "gzip-binary" &&
    Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0 &&
    Number.isSafeInteger(descriptor.storedBytes) && descriptor.storedBytes > 0 &&
    Number.isSafeInteger(descriptor.transformAssignmentCount) && descriptor.transformAssignmentCount > 0 &&
    Number.isSafeInteger(descriptor.colorAssignmentCount) && descriptor.colorAssignmentCount > 0 &&
    /^[a-f0-9]{64}$/u.test(descriptor.sha256) && urlPattern.test(descriptor.url));
}
