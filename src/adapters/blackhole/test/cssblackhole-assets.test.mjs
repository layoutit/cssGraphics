// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import sharp from "sharp";
import sourceLock from "../notes/references/source-lock.json" with { type: "json" };
import {
  CSSBLACKHOLE_OPACITY_ENCODING,
  CSSBLACKHOLE_OPACITY_PALETTE,
  decodeBlackHolePreparedBank,
  quantizeBlackHolePreparedOpacityIndex,
} from "../src/shared/cssblackhole/preparedBlockTransport.mjs";
import { selectNonOverlappingLuminetPointFrames } from
  "../tools/select-luminet-points.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/cssblackhole");
const palette = ["#ffffff", "#f8f5ff", "#eee7ff", "#dfd1ff", "#c7abff", "#aa82ee"];
const directImagePalette = palette.slice(0, 4);
const ghostImagePalette = palette.slice(3);
const periodicOrbitCounts = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 18, 22, 27, 35, 41, 48,
];

test("Luminet adapter owns a standalone prepared cssblackhole contract", async () => {
  const [preparedBytes, catalogBytes, prepared, catalog, state, snapshot, stylesheet] =
    await Promise.all([
      readFile(resolve(generatedRoot, "prepared.json")),
      readFile(resolve(generatedRoot, "catalog.json")),
      readJson(resolve(generatedRoot, "prepared.json")),
      readJson(resolve(generatedRoot, "catalog.json")),
      readJson(resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-state.json")),
      readFile(resolve(generatedRoot, "snapshot.html"), "utf8"),
      readFile(resolve(repositoryRoot, "src/adapters/blackhole/src/cssblackhole/styles.css"), "utf8"),
    ]);
  assert.equal(prepared.schema, "cssblackhole-prepared-scene@1");
  assert.equal(catalog.schema, "cssblackhole-prepared-stream-catalog@1");
  assert.equal(prepared.catalog.sha256, sha256(catalogBytes));
  assert.equal(prepared.catalog.byteLength, catalogBytes.byteLength);
  assert.equal(preparedBytes.byteLength > 0, true);
  assert.equal(sourceLock.license.spdx, "MIT");
  assert.equal(catalog.source.commit, sourceLock.commit);
  assert.equal(catalog.source.classification,
    "source-backed-luminet-photon-geodesic-preparation");
  assert.equal(catalog.starCount, 1979);
  assert.equal(catalog.configurationCount, 3);
  assert.equal(catalog.presentationConfigurationCount, 4);
  assert.equal(catalog.transportSeed, 6477);
  assert.equal(catalog.sourceFramesPerSecond, 60);
  assert.equal(catalog.framesPerSecond, 60);
  assert.equal(catalog.blockFrameCount, 60);
  assert.equal(catalog.blocksPerBank, 5);
  assert.equal(catalog.bankFrameCount, 300);
  assert.equal(catalog.bankCount, 36);
  assert.equal(catalog.blockCount, 180);
  assert.deepEqual(catalog.materialization, {
    schema: "cssblackhole-bounded-materialized-block@1",
    policy: "galaxy-style-multiple-playback-blocks-per-transport-bank",
    maximumRetainedBlockCount: 2,
    transformCharacterLimit: 3_200_000,
    scheduleByteLimit: 260_000,
    maximumTransformAssignmentCount: 118_740,
    maximumOpacityAssignmentCount: 3_876,
    maximumTransformCharacters: 3_159_508,
    maximumScheduleBytes: 249_592,
    maximumTransformCharacterBlockIndex: 136,
  });
  assert.equal(catalog.streamFrameCount, 10800);
  assert.equal(catalog.streamDurationMilliseconds, 180_000);
  assert.equal(prepared.cadence.blockSeconds, 1);
  assert.equal(prepared.cadence.bankSeconds, 5);
  assert.equal(prepared.cadence.streamSeconds, 180);
  assert.equal(prepared.renderer.kind, "retained-dom-polycss-prepared-playback");
  assert.equal(prepared.renderer.runtimePhysics, false);
  assert.equal(prepared.renderer.runtimeRasterization, false);
  assert.deepEqual(prepared.presentation.spaceContext, catalog.spaceContext);
  assert.equal(catalog.spaceContext.schema, "cssblackhole-prepared-space-context@1");
  assert.equal(catalog.spaceContext.classification,
    "decorative-static-deep-space-context-not-luminet-source-state");
  assert.equal(catalog.spaceContext.mode,
    "prepared-resolution-aware-luminet-dot-primitive-plates");
  assert.equal(catalog.spaceContext.seed, 1979);
  assert.equal(catalog.spaceContext.sourceStarCountPerPlate, 1_000);
  assert.equal(catalog.spaceContext.distribution.uniformPointCount, 600);
  assert.equal(catalog.spaceContext.distribution.broadGalacticBandPointCount, 400);
  assert.equal(catalog.spaceContext.distribution.centerDensityMode,
    "prepared-smooth-radial-sparsity-no-hard-cutout");
  assert.equal(catalog.spaceContext.distribution.centerDensityCurve, "smoothstep");
  assert.equal(catalog.spaceContext.distribution.minimumCenterDensity, 0.1);
  assert.equal(catalog.spaceContext.distribution.fullDensityRadiusLogicalPixels, 360);
  assert.equal(catalog.spaceContext.distribution.centerProbeRadiusLogicalPixels, 160);
  assert.equal(catalog.spaceContext.distribution.coreRadiusLogicalPixels, 96);
  assert.deepEqual(catalog.spaceContext.palette, palette);
  assert.deepEqual(catalog.spaceContext.opacityPalette,
    ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]);
  assert.equal(catalog.spaceContext.maximumBaseOpacity, 0.8);
  assert.equal(catalog.spaceContext.layerOpacity, 0.5);
  assert.equal(catalog.spaceContext.maximumEffectiveOpacity, 0.4);
  assert.equal(catalog.spaceContext.opacitySamplingBucketCount, 9);
  assert.equal(catalog.spaceContext.opacityMode,
    "prepared-original-dot-opacity-palette");
  assert.equal(catalog.spaceContext.pointPrimitive.shape, "axis-aligned-square");
  assert.equal(catalog.spaceContext.pointPrimitive.cssPixelsAt1dppx, 2);
  assert.equal(catalog.spaceContext.pointPrimitive.cssPixelsAtMinimum2dppx, 2);
  assert.equal(catalog.spaceContext.pointPrimitive.overlappingPreparedPointCount, 0);
  assert.equal(catalog.spaceContext.runtimeDomNodeCount, 0);
  assert.equal(catalog.spaceContext.runtimeAnimationCount, 0);
  assert.equal(catalog.spaceContext.runtimeStyleWriteCount, 0);
  assert.equal(catalog.spaceContext.runtimeRasterizationCount, 0);
  assert.deepEqual(catalog.configurationLoop.configurationSequence, [
    "luminet-inclination-85deg",
    "luminet-inclination-60deg",
    "luminet-inclination-0deg",
    "luminet-inclination-60deg",
  ]);
  assert.equal(catalog.publication.mode, "complete-1979-point-state-at-sixty-hertz");
  assert.equal(catalog.publication.snapshotOwnsInitialFrame, true);
  assert.equal(catalog.publication.runtimeIntermediateFrameGeneration, false);
  assert.equal(catalog.publication.runtimeCatchupPublication, false);
  assert.equal(catalog.configurationLoop.sourceFrameStep, 1);
  assert.deepEqual(catalog.configurationLoop.presentationSlotHoldSeconds, [5, 2.5, 2, 2.5]);
  assert.deepEqual(catalog.configurationLoop.presentationSlotDurationSeconds, [7, 4.5, 4, 4.5]);
  assert.deepEqual(catalog.configurationLoop.presentationSlotFrameCounts, [420, 270, 240, 270]);
  assert.deepEqual(catalog.configurationLoop.presentationSlotStartFrameIndices, [0, 420, 690, 930]);
  assert.deepEqual(catalog.configurationLoop.transitionStartFrameIndices, [300, 150, 120, 150]);
  assert.equal(catalog.configurationLoop.transitionFrameCount, 120);
  assert.equal(catalog.configurationLoop.transitionSeconds, 2);
  assert.deepEqual(catalog.configurationLoop.transitionCadenceSecondsBySlot, [7, 4.5, 4, 4.5]);
  assert.equal(catalog.configurationLoop.orbitalSpeedScale, 0.25);
  assert.equal(catalog.configurationLoop.sourceMotionReferenceSeconds, 20);
  assert.equal(catalog.configurationLoop.sourceLoopSeconds, 90);
  assert.equal(catalog.configurationLoop.sourceLoopFrameCount, 5400);
  assert.equal(catalog.configurationLoop.combinedLoopSeconds, 180);
  assert.equal(catalog.configurationLoop.combinedLoopFrameCount, 10800);
  assert.equal(state.schema, "cssblackhole-luminet-prepared-state@9");
  assert.equal(state.sourceCommit, sourceLock.commit);
  assert.equal(state.pointCount, 3000);
  assert.equal(state.directPointCount, 2000);
  assert.equal(state.ghostPointCount, 1000);
  assert.equal(catalog.pointSelection.publicationYear, 1979);
  assert.equal(catalog.pointSelection.selectedPointCount, 1979);
  assert.equal(catalog.pointSelection.selectedDirectPointCount, 1319);
  assert.equal(catalog.pointSelection.selectedGhostPointCount, 660);
  assert.equal(catalog.pointSelection.schema, "cssblackhole-source-point-selection@3");
  assert.equal(catalog.pointSelection.mode,
    "publication-year-count-proportional-non-overlapping-prepared-source-identity-subset");
  assert.equal(catalog.pointSelection.collisionDomain,
    "frame-local-exact-tenth-pixel-coordinate-over-complete-moving-configuration-loop");
  assert.equal(catalog.pointSelection.sourcePeriodicRadiusCount, 16);
  assert.equal(catalog.pointSelection.selectedDirectPeriodicRadiusCount, 16);
  assert.equal(catalog.pointSelection.selectedGhostPeriodicRadiusCount, 16);
  assert.equal(catalog.pointSelection.analyzedSourceFrameCount, 10800);
  assert.equal(catalog.pointSelection.selectedDirectMaximumPointsPerRadius, 230);
  assert.equal(catalog.pointSelection.selectedGhostMaximumPointsPerRadius, 115);
  assert.equal(catalog.pointSelection.preparedCollisionSeparationCount, 303464);
  assert.equal(catalog.pointSelection.maximumPreparedCollisionSeparationCount, 54);
  assert.equal(catalog.pointSelection.maximumPreparedCollisionSeparationPixels, 1.414);
  assert.equal(catalog.pointSelection.sourceCoordinateSampleCount, 21_373_200);
  assert.equal(catalog.pointSelection.sourceExactCoordinateSampleCount, 21_069_736);
  assert.equal(catalog.pointSelection.selectedExactCoordinateConflictPairCount, 0);
  assert.equal(catalog.pointSelection.sourcePointIndices.length, 1979);
  assert.ok(catalog.pointSelection.sourcePointIndices.slice(0, 1319)
    .every((sourceIndex) => sourceIndex < 2000));
  assert.ok(catalog.pointSelection.sourcePointIndices.slice(1319)
    .every((sourceIndex) => sourceIndex >= 2000));
  assert.equal(state.orbitalSpeedScale, 0.25);
  assert.equal(state.sourceMotionReferenceSeconds, 20);
  assert.equal(state.sourceLoopSeconds, 90);
  assert.equal(state.sourceLoopFrameCount, 5400);
  assert.equal(state.availablePeriodicRadiusCount, 44);
  assert.equal(state.periodicRadiusCount, 16);
  assert.deepEqual(state.periodicOrbitCounts, periodicOrbitCounts);
  assert.equal(state.periodicRadiusSelection,
    "source-valid-greedy-maximin-radius-coverage");
  assert.equal(state.particlePeriodicOrbitCounts.length, 3000);
  assert.deepEqual(state.configurationSequence.presentationSlotHoldSeconds, [5, 2.5, 2, 2.5]);
  assert.deepEqual(state.configurationSequence.presentationSlotDurationSeconds, [7, 4.5, 4, 4.5]);
  assert.deepEqual(state.configurationSequence.sourceMotionSecondsBeforeTransitionBySlot,
    [5, 2.5, 2, 2.5]);
  assert.equal(state.configurationSequence.transitionSeconds, 2);
  assert.equal(state.configurationSequence.distinctConfigurationCount, 3);
  assert.equal(state.configurationSequence.presentationConfigurationCount, 4);
  assert.deepEqual(state.configurationSequence.presentationStateIndices, [0, 1, 2, 1]);
  assert.deepEqual(state.configurationSequence.presentationSequence,
    catalog.configurationLoop.configurationSequence);
  assert.deepEqual(state.configurationSequence.states.map(
    ({ id, view, inclinationDegrees }) => ({ id, view, inclinationDegrees })), [
    { id: "luminet-inclination-85deg", view: "side", inclinationDegrees: 85 },
    { id: "luminet-inclination-60deg", view: "angled", inclinationDegrees: 60 },
    { id: "luminet-inclination-0deg", view: "top", inclinationDegrees: 0 },
  ]);
  assert.ok(state.sourceConfigurationBounds[0].maximumY -
    state.sourceConfigurationBounds[0].minimumY <
    state.sourceConfigurationBounds[1].maximumY -
    state.sourceConfigurationBounds[1].minimumY);
  assert.ok(state.sourceConfigurationBounds[1].maximumY -
    state.sourceConfigurationBounds[1].minimumY <
    state.sourceConfigurationBounds[2].maximumY -
    state.sourceConfigurationBounds[2].minimumY);
  assert.equal(state.photometry.observedFluxEquation, "F_o=F_s/(1+z)^4");
  assert.equal(state.photometry.displayPowerGamma, 0.35);
  assert.equal(state.photometry.displayOpacityFloor, 0.22);
  assert.equal(catalog.presentationColors.sourceDefaultExposureParity, false);
  assert.deepEqual(catalog.presentationColors.palette, palette);
  assert.deepEqual(catalog.presentationColors.directImagePalette, directImagePalette);
  assert.deepEqual(catalog.presentationColors.ghostImagePalette, ghostImagePalette);
  assert.equal(catalog.presentationColors.paletteIntent,
    "direct-image-white-lavender-and-ghost-image-lavender-purple");
  assert.equal(catalog.presentationColors.colorAssignment,
    "source-image-class-palettes-across-stable-retained-leaf-identity");
  assert.equal(catalog.presentationColors.runtimeColorWrites, false);
  assert.deepEqual(catalog.preparedOpacityPalette, CSSBLACKHOLE_OPACITY_PALETTE);
  assert.equal(catalog.presentationColors.opacityPaletteEntryCount, 11);
  assert.equal(catalog.presentationColors.opacityDecimalPlaces, 1);
  assert.equal(catalog.presentationColors.opacityQuantization, "nearest-decile-at-prepare-time");
  assert.equal((snapshot.match(/<b style="color:#[a-f0-9]{6};transform:translate\([^<]+;opacity:[^<]+"><\/b>/gu) ?? []).length, 1979);
  const snapshotOpacities = [...snapshot.matchAll(/;opacity:([^";]+)"/gu)]
    .map((match) => match[1]);
  assert.equal(snapshotOpacities.length, 1979);
  assert.ok(snapshotOpacities.every((opacity) => /^(?:0|1|0\.[1-9])$/u.test(opacity)));
  assert.equal(catalog.snapshot.initialStreamFrame, 0);
  assert.equal(catalog.snapshot.preparedTransformCount, 1979);
  assert.equal(catalog.snapshot.preparedOpacityCount, 1979);
  const snapshotColors = [...snapshot.matchAll(/<b style="color:(#[a-f0-9]{6});/gu)]
    .map((match) => match[1]);
  const directSnapshotColors = snapshotColors.slice(0,
    catalog.pointSelection.selectedDirectPointCount);
  const ghostSnapshotColors = snapshotColors.slice(
    catalog.pointSelection.selectedDirectPointCount);
  assert.deepEqual(directSnapshotColors,
    Array.from({ length: 1319 }, (_, leafIndex) =>
      directImagePalette[leafIndex % directImagePalette.length]));
  assert.deepEqual(ghostSnapshotColors,
    Array.from({ length: 660 }, (_, leafIndex) =>
      ghostImagePalette[leafIndex % ghostImagePalette.length]));
  assert.deepEqual(palette.map((color) =>
    snapshotColors.filter((snapshotColor) => snapshotColor === color).length),
  [330, 330, 330, 549, 220, 220]);
  assert.equal((stylesheet.match(/::/gu) ?? []).length, 0);
  assert.doesNotMatch(stylesheet,
    /(?:clip-path|gradient|mask|filter|box-shadow|canvas|svg)/u);
  assert.match(stylesheet, /image-set\([\s\S]*space-context-landscape@2x\.webp/u);
  assert.match(stylesheet, /orientation:\s*portrait[\s\S]*space-context-portrait@2x\.webp/u);
  assert.match(stylesheet, /center\s*\/\s*auto\s+repeat/u);
  assert.doesNotMatch(stylesheet, /transition-property|transition-duration/u);

  const allowedPixels = new Set(["0,0,0"]);
  for (const color of palette) {
    for (const opacity of catalog.spaceContext.opacityPalette) {
      allowedPixels.add(compositeOverBlack(
        color, Number(opacity) * catalog.spaceContext.layerOpacity).join(","));
    }
  }
  for (const plate of catalog.spaceContext.plates) {
    assert.equal(plate.sourceStarCount, 1_000);
    assert.equal(plate.centralPointCountWithinCoreRadius, 0);
    assert.ok(plate.centralPointCountWithinProbeRadius >= 1);
    assert.ok(plate.centralPointCountWithinProbeRadius <= 16);
    for (const variant of plate.variants) {
      const path = resolve(generatedRoot, variant.assetUrl.split("/").at(-1));
      const bytes = await readFile(path);
      assert.equal(bytes.byteLength, variant.byteLength);
      assert.equal(sha256(bytes), variant.sha256);
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, variant.width);
      assert.equal(info.height, variant.height);
      assert.equal(info.channels, 3);
      let nonBlackPixelCount = 0;
      for (let offset = 0; offset < data.length; offset += 3) {
        if (data[offset] === 0 && data[offset + 1] === 0 && data[offset + 2] === 0) continue;
        const pixel = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
        assert.equal(allowedPixels.has(pixel), true,
          `${variant.assetUrl} contains a non-Luminet-dot palette pixel ${pixel}`);
        nonBlackPixelCount += 1;
      }
      const pixelsPerPoint = 4 * variant.deviceScaleFactor ** 2;
      assert.equal(nonBlackPixelCount, plate.sourceStarCount * pixelsPerPoint);
    }
  }
});

test("prepared transport reproduces the pinned moving coordinate and flux state", async () => {
  const [catalog, sourceCoordinates, sourceLuminances] = await Promise.all([
    readJson(resolve(generatedRoot, "catalog.json")),
    readFile(resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-coordinates.bin")),
    readFile(resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-luminance.bin")),
  ]);
  const sourceFrameCount = sourceCoordinates.byteLength /
    (catalog.pointSelection.sourcePointCount * 2 * Int32Array.BYTES_PER_ELEMENT);
  assert.equal(sourceFrameCount, catalog.pointSelection.analyzedSourceFrameCount);
  const sourceCoordinateValues = new Int32Array(
    sourceCoordinates.buffer, sourceCoordinates.byteOffset, sourceCoordinates.byteLength / 4);
  const preparedSelection = selectNonOverlappingLuminetPointFrames({
    coordinates: sourceCoordinateValues,
    frameCount: sourceFrameCount,
    sourcePointCount: catalog.pointSelection.sourcePointCount,
    sourceDirectPointCount: catalog.pointSelection.sourceDirectPointCount,
    sourceGhostPointCount: catalog.pointSelection.sourceGhostPointCount,
    selectedDirectPointCount: catalog.pointSelection.selectedDirectPointCount,
    selectedGhostPointCount: catalog.pointSelection.selectedGhostPointCount,
  });
  assert.deepEqual(preparedSelection.sourcePointIndices, catalog.pointSelection.sourcePointIndices);
  assert.deepEqual(preparedSelection.report, Object.freeze({
    analyzedSourceFrameCount: catalog.pointSelection.analyzedSourceFrameCount,
    retainedStratifiedPointCount: catalog.pointSelection.retainedStratifiedPointCount,
    framesWithPreparedCollisionSeparation:
      catalog.pointSelection.framesWithPreparedCollisionSeparation,
    preparedCollisionSeparationCount: catalog.pointSelection.preparedCollisionSeparationCount,
    maximumPreparedCollisionSeparationCount:
      catalog.pointSelection.maximumPreparedCollisionSeparationCount,
    maximumPreparedCollisionSeparationPixels:
      catalog.pointSelection.maximumPreparedCollisionSeparationPixels,
    sourceCoordinateSampleCount: catalog.pointSelection.sourceCoordinateSampleCount,
    sourceExactCoordinateSampleCount: catalog.pointSelection.sourceExactCoordinateSampleCount,
    selectedExactCoordinateConflictPairCount:
      catalog.pointSelection.selectedExactCoordinateConflictPairCount,
  }));
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    const frameCoordinates = new Set();
    for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
      const offset = (frameIndex * catalog.starCount + leafIndex) * 2;
      const key = `${preparedSelection.selectedCoordinates[offset]},` +
        `${preparedSelection.selectedCoordinates[offset + 1]}`;
      assert.equal(frameCoordinates.has(key), false,
        `frame ${frameIndex} contains an exact selected-point collision`);
      frameCoordinates.add(key);
    }
    assert.equal(frameCoordinates.size, catalog.starCount);
  }
  assert.deepEqual(catalog.banks.map(({ sourceLoopStartFrameIndex }) => sourceLoopStartFrameIndex),
    Array.from({ length: 36 }, (_, index) => index * 300));
  const descriptor = catalog.banks[0];
  assert.equal(descriptor.opacityEncoding, CSSBLACKHOLE_OPACITY_ENCODING);
  const expanded = brotliDecompressSync(await readFile(resolve(
    generatedRoot, "banks", descriptor.assetUrl.split("/").at(-1))));
  const bank = decodeBlackHolePreparedBank(expanded, descriptor, catalog);
  const firstBlock = bank.decodedBlocks[0].coordinates;
  const firstBlockBytes = Buffer.from(firstBlock.buffer, firstBlock.byteOffset, firstBlock.byteLength);
  const preparedFirstBlockBytes = Buffer.from(
    preparedSelection.selectedCoordinates.buffer,
    preparedSelection.selectedCoordinates.byteOffset,
    catalog.blockFrameCount * catalog.starCount * 2 * Int32Array.BYTES_PER_ELEMENT);
  assert.equal(sha256(firstBlockBytes), sha256(preparedFirstBlockBytes));

  const reconstructed = Buffer.alloc(catalog.blockFrameCount * catalog.starCount);
  const current = new Uint8Array(catalog.starCount);
  const opacity = bank.decodedBlocks[0].opacitySchedule;
  for (let frameIndex = 0; frameIndex < catalog.blockFrameCount; frameIndex += 1) {
    for (let assignmentIndex = opacity.frameOffsets[frameIndex];
      assignmentIndex < opacity.frameOffsets[frameIndex + 1]; assignmentIndex += 1) {
      current[opacity.leafIndices[assignmentIndex]] = opacity.opacityIndices[assignmentIndex];
    }
    reconstructed.set(current, frameIndex * catalog.starCount);
  }
  const selectedSourceLuminances = selectSourcePointFrames(
    sourceLuminances, 0, catalog.blockFrameCount, catalog.pointSelection.sourcePointCount,
    1, catalog.pointSelection.sourcePointIndices, catalog.publication.sourceFrameStep);
  const expectedOpacityIndices = Uint8Array.from(
    selectedSourceLuminances, quantizeBlackHolePreparedOpacityIndex);
  assert.equal(sha256(reconstructed), sha256(expectedOpacityIndices));
  assert.ok(reconstructed.every((opacityIndex) => opacityIndex < 11));
  assert.ok(sourceLuminances.reduce((minimum, value) => Math.min(minimum, value), 255) >=
    Math.floor(0.22 * 255));
  const coordinateFrameBytes = catalog.pointSelection.sourcePointCount * 2 * 4;
  const coordinateHashAt = (frame) => sha256(sourceCoordinates.subarray(
    frame * coordinateFrameBytes, (frame + 1) * coordinateFrameBytes));
  assert.equal(new Set([0, 420, 690, 930].map(coordinateHashAt)).size, 4);
  for (const startFrame of [0, 420, 690, 930]) {
    assert.equal(new Set([0, 30, 60, 120, 239]
      .map((offset) => coordinateHashAt(startFrame + offset))).size, 5);
  }
  let ordinarySourceMotionMaximum = 0;
  for (let frameIndex = 0; frameIndex < 180; frameIndex += 1) {
    ordinarySourceMotionMaximum = Math.max(ordinarySourceMotionMaximum,
      maximumFrameDisplacement(sourceCoordinateValues, frameIndex, frameIndex + 1,
        catalog.pointSelection.sourcePointCount));
  }
  for (let sequenceStart = 0; sequenceStart < sourceFrameCount; sequenceStart += 1200) {
    for (const localBoundary of [419, 689, 929, 1199]) {
      const transitionBoundary = sequenceStart + localBoundary;
      const nextFrame = (transitionBoundary + 1) % sourceFrameCount;
      assert.ok(maximumFrameDisplacement(
        sourceCoordinateValues, transitionBoundary, nextFrame,
        catalog.pointSelection.sourcePointCount) <= ordinarySourceMotionMaximum);
    }
  }
});

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compositeOverBlack(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return [
    Math.round((value >> 16 & 0xff) * opacity),
    Math.round((value >> 8 & 0xff) * opacity),
    Math.round((value & 0xff) * opacity),
  ];
}

function maximumFrameDisplacement(coordinates, fromFrame, toFrame, starCount) {
  let maximum = 0;
  for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
    const fromOffset = (fromFrame * starCount + leafIndex) * 2;
    const toOffset = (toFrame * starCount + leafIndex) * 2;
    maximum = Math.max(maximum, Math.hypot(
      coordinates[toOffset] - coordinates[fromOffset],
      coordinates[toOffset + 1] - coordinates[fromOffset + 1]) / 10);
  }
  return maximum;
}

function selectSourcePointFrames(
  source, startFrame, frameCount, sourcePointCount, bytesPerPoint, pointIndices, frameStep,
) {
  const selected = Buffer.alloc(frameCount * pointIndices.length * bytesPerPoint);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sourceFrameIndex = startFrame + frameIndex * frameStep;
    for (let selectedIndex = 0; selectedIndex < pointIndices.length; selectedIndex += 1) {
      const sourceStart = (sourceFrameIndex * sourcePointCount + pointIndices[selectedIndex]) *
        bytesPerPoint;
      source.copy(selected,
        (frameIndex * pointIndices.length + selectedIndex) * bytesPerPoint,
        sourceStart, sourceStart + bytesPerPoint);
    }
  }
  return selected;
}
