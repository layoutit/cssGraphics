import assert from "node:assert/strict";
import test from "node:test";
import { buildClothPreparedModel } from "../src/prepare/csscloth/modelBuilder.mjs";
import { groundImageSlice, shadowImageSlice } from "../src/prepare/csscloth/rasterAtlas.mjs";
import {
  buildClothTriangleSeamEdges,
  clothTriangleMatrixFromWorldPoints,
} from "../src/shared/csscloth/clothTriangleTransform.mjs";
import {
  CSSCLOTH_PLAYBACK_ENCODING,
  CSSCLOTH_PLAYBACK_SCHEMA,
  createClothPreparedPlaybackMaterialization,
  decodeClothPreparedPlayback,
  encodeClothPreparedPlayback,
  materializeClothPreparedMatrixRange,
} from "../src/shared/csscloth/preparedPlaybackTransport.mjs";

const prepared = buildClothPreparedModel();

test("prepared model keeps one retained triangle root per cloth face", () => {
  assert.equal(prepared.model.profile, "static-prepared");
  assert.equal(prepared.model.playback, null);
  assert.equal(prepared.metrics.clothTriangleCount, 200);
  assert.equal(prepared.metrics.groundLeafCount, 1);
  assert.equal(prepared.metrics.clothShadowLeafCount, 51);
  assert.equal(prepared.metrics.fixtureShadowLeafCount, 30);
  assert.equal(prepared.metrics.shadowLeafCount, 81);
  assert.equal(prepared.metrics.groundTextureRepeatCount, 14);
  assert.equal(prepared.metrics.retainedLeafCount, 231 + prepared.metrics.shadowLeafCount);
  assert.equal(prepared.metrics.bankCount, 8);
  assert.equal(prepared.metrics.bankFrameCount, 1440);
  assert.equal(prepared.metrics.bankDurationMilliseconds, 24_000);
  assert.equal(prepared.metrics.frameCount, 11_520);
  assert.equal(prepared.metrics.durationMilliseconds, 192_000);
  assert.equal(prepared.metrics.clothLightingStateCount, 60_269);
  assert.equal(prepared.metrics.clothLightingDistinctStateKeyCount, 5_656);
  assert.equal(prepared.metrics.clothAtlasStoredStateCount, 60_269);
  assert.equal(prepared.metrics.clothAtlasUniqueStateCount, 5_656);
  assert.equal(prepared.metrics.clothAtlasDeduplicatedStateCount, 54_613);
  assert.equal(prepared.metrics.clothRasterPagePixels, 5_130_000);
  assert.equal(prepared.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(prepared.metrics.runtimeDomGrowth, false);
  assert.equal(prepared.model.render.shapes.filter((shape) => /^cloth-\d{3}$/u.test(shape.id)).length, 200);
  assert.ok(prepared.model.render.shapes
    .filter((shape) => /^cloth-\d{3}$/u.test(shape.id))
    .every((shape) => shape.matrix.every((value, index) => value === (index % 5 === 0 ? 1 : 0))));
  const clothLeaves = prepared.model.render.leaves.filter((leaf) => /^leaf-cloth-\d{3}$/u.test(leaf.id));
  assert.equal(clothLeaves.length, 200);
  assert.ok(clothLeaves.every((leaf, index) => (
    leaf.width === prepared.rasterBoxes[index].width
    && leaf.height === prepared.rasterBoxes[index].height
    && leaf.strategy === "solid-triangle"
    && leaf.matrix.some((value, matrixIndex) => value !== (matrixIndex % 5 === 0 ? 1 : 0))
    && leaf.atlas === null
    && leaf.fallback?.width === prepared.rasterBoxes[index].width
    && leaf.fallback?.height === prepared.rasterBoxes[index].height
    && leaf.fallback?.atlas.height === prepared.rasterBoxes[index].height
  )));
  const groundLeaves = prepared.model.render.leaves.filter((leaf) => leaf.id === "leaf-ground");
  assert.equal(groundLeaves.length, 1);
  assert.equal(groundLeaves[0].strategy, "direct-image");
  const shadowLeaves = prepared.model.render.leaves.filter((leaf) => leaf.id.startsWith("leaf-cloth-shadow-"));
  assert.equal(shadowLeaves.length, prepared.metrics.clothShadowLeafCount);
  assert.ok(shadowLeaves.every((leaf) => leaf.strategy === "atlas-slice"));
  const fixtureShadowLeaves = prepared.model.render.leaves.filter((leaf) => leaf.id.startsWith("leaf-fixture-shadow-"));
  assert.equal(fixtureShadowLeaves.length, prepared.metrics.fixtureShadowLeafCount);
  assert.ok(fixtureShadowLeaves.every((leaf) => leaf.strategy === "atlas-slice"));
  assert.equal(prepared.model.budgets.maxResources, prepared.metrics.clothRasterPageCount + 3);
});

test("prepared playback uses compact fixed-point transport", () => {
  const playback = prepared.playbackBanks[0];
  const bytes = encodeClothPreparedPlayback(playback);
  assert.ok(bytes.byteLength < 3_500_000);
  const decoded = decodeClothPreparedPlayback(bytes, {
    schema: CSSCLOTH_PLAYBACK_SCHEMA,
    encoding: CSSCLOTH_PLAYBACK_ENCODING,
    frameCount: playback.frameCount,
    particleCount: playback.particleCount,
    triangleCount: playback.triangleCount,
    shadowTriangleCount: playback.shadowTriangleCount,
    frameMilliseconds: playback.frameMilliseconds,
  });
  const materialization = createClothPreparedPlaybackMaterialization(bytes, {
    schema: CSSCLOTH_PLAYBACK_SCHEMA,
    encoding: CSSCLOTH_PLAYBACK_ENCODING,
    frameCount: playback.frameCount,
    particleCount: playback.particleCount,
    triangleCount: playback.triangleCount,
    shadowTriangleCount: playback.shadowTriangleCount,
    frameMilliseconds: playback.frameMilliseconds,
  });
  assert.equal(decoded.transforms.length, 1440 * 200);
  assert.equal(decoded.lightingOffsets.length, 1441);
  assert.equal(decoded.lightingOffsets[1], 200);
  assert.equal(decoded.lightingIndices.length, decoded.lightingSlots.length);
  assert.ok(decoded.lightingIndices.length < 1440 * 50);
  assert.equal(decoded.shadowTransformOffsets.length, 1441);
  assert.equal(decoded.shadowVisibilityOffsets.length, 1441);
  assert.equal(decoded.shadowTransformOffsets[1], prepared.metrics.clothShadowLeafCount);
  assert.equal(decoded.shadowVisibilityOffsets[1], prepared.metrics.clothShadowLeafCount);
  assert.ok(decoded.shadowTransformValues.length < 1440 * prepared.metrics.clothShadowLeafCount);
  assert.ok(decoded.shadowVisibilityValues.length < 1440 * prepared.metrics.clothShadowLeafCount);
  assert.deepEqual(
    [...materialization.playback.shadowTransformOffsets],
    [...decoded.shadowTransformOffsets],
  );
  assert.deepEqual(
    [...materialization.playback.shadowTransformIndices],
    [...decoded.shadowTransformIndices],
  );
  assert.deepEqual(
    [...materialization.playback.lightingOffsets],
    [...decoded.lightingOffsets],
  );
  const sampledTransformIndex = 137 * 200 + 47;
  assert.deepEqual(
    materializeClothPreparedMatrixRange(
      materialization,
      "cloth",
      sampledTransformIndex,
      sampledTransformIndex + 1,
    ),
    [decoded.transforms[sampledTransformIndex]],
  );
  assert.deepEqual(
    materializeClothPreparedMatrixRange(materialization, "shadow", 0, 480),
    decoded.shadowTransformValues.slice(0, 480),
  );
  const actual = decoded.transforms[137 * 200 + 47].match(/matrix3d\(([^)]+)\)/u)[1].split(",").map(Number);
  const topology = prepared.triangles.map((triangle) => triangle.particleIndices);
  const expected = clothTriangleMatrixFromWorldPoints(
    topology[47].map((particleIndex) => playback.frames[137].particlePositions[particleIndex]),
    47,
    buildClothTriangleSeamEdges(topology),
  );
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 0.000051));
  const shadowState = reconstructShadowState(decoded, 137);
  const shadowActual = shadowState.transforms[7].match(/matrix3d\(([^)]+)\)/u)[1].split(",").map(Number);
  const shadowExpected = playback.frames[137].shadowMatrices[7];
  assert.ok(shadowActual.every((value, index) => Math.abs(value - shadowExpected[index]) <= 0.000051));
  assert.deepEqual(
    [...shadowState.visibility],
    playback.frames[137].shadowVisibility,
  );
  const lightingState = reconstructLightingState(decoded, 137);
  assert.deepEqual(
    [...lightingState],
    playback.frames[137].lightingRows.map((row, triangleIndex) =>
      playback.atlasStateSlots[triangleIndex][row]),
  );
});

test("prepared playback banks form one continuous 192-second stream", () => {
  assert.equal(prepared.playbackBanks.length, 8);
  assert.deepEqual(prepared.playbackBanks.map((bank) => bank.streamFrameOffset), [
    0, 1440, 2880, 4320, 5760, 7200, 8640, 10_080,
  ]);
  assert.ok(prepared.playbackBanks.every((bank, bankIndex) =>
    bank.bankIndex === bankIndex && bank.frameCount === 1440 && bank.durationMilliseconds === 24_000));
  assert.notDeepEqual(
    prepared.playbackBanks[0].frames.at(-1).particlePositions,
    prepared.playbackBanks[1].frames[0].particlePositions,
  );
});

function reconstructShadowState(playback, frameIndex) {
  const transforms = new Array(playback.shadowTriangleCount);
  const visibility = new Uint8Array(playback.shadowTriangleCount);
  for (let sourceFrame = 0; sourceFrame <= frameIndex; sourceFrame += 1) {
    for (let assignment = playback.shadowTransformOffsets[sourceFrame];
      assignment < playback.shadowTransformOffsets[sourceFrame + 1]; assignment += 1) {
      transforms[playback.shadowTransformIndices[assignment]] =
        playback.shadowTransformValues[assignment];
    }
    for (let assignment = playback.shadowVisibilityOffsets[sourceFrame];
      assignment < playback.shadowVisibilityOffsets[sourceFrame + 1]; assignment += 1) {
      visibility[playback.shadowVisibilityIndices[assignment]] =
        playback.shadowVisibilityValues[assignment];
    }
  }
  return { transforms, visibility };
}

function reconstructLightingState(playback, frameIndex) {
  const slots = new Uint16Array(playback.triangleCount);
  for (let sourceFrame = 0; sourceFrame <= frameIndex; sourceFrame += 1) {
    for (let assignment = playback.lightingOffsets[sourceFrame];
      assignment < playback.lightingOffsets[sourceFrame + 1]; assignment += 1) {
      slots[playback.lightingIndices[assignment]] = playback.lightingSlots[assignment];
    }
  }
  return slots;
}

test("the prepared shadow leaves share one small raster triangle", () => {
  assert.deepEqual(shadowImageSlice(), {
    resourcePath: "assets/shadow.png",
    x: 0,
    y: 0,
    width: 28,
    height: 28,
    pageWidth: 28,
    pageHeight: 28,
  });
});

test("the ground direct-image leaf uses the complete pinned source image", () => {
  assert.deepEqual(groundImageSlice(), {
    resourcePath: "assets/ground.webp",
    x: 0,
    y: 0,
    width: 3072,
    height: 2048,
    pageWidth: 3072,
    pageHeight: 2048,
  });
});
