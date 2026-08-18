import assert from "node:assert/strict";
import test from "node:test";
import { validatePolyMorphModel } from "@layoutit/polycss-morph";
import {
  buildFlipFlopPresentationFrames,
  buildFlipFlopSourceFrames,
  buildFlipFlopTileGeometry,
  CSSFLIPFLOP_SOURCE_FRAME_COUNT,
  FLIPFLOP_BANKS,
  FLIPFLOP_SOURCE,
} from "../src/prepare/cssflipflop/sourceModel.mjs";
import {
  buildFlipFlopPreparedModel,
  expectedFlipFlopLeafCount,
} from "../src/prepare/cssflipflop/modelBuilder.mjs";

test("source defaults preserve the pinned 9x9 tile census", () => {
  const source = buildFlipFlopSourceFrames({ frameCount: 2 });
  assert.equal(source.frames[0].tiles.length, 76);
  assert.equal(FLIPFLOP_SOURCE.emptyCellCount, 5);
  assert.equal(source.frames[0].tiles.filter((tile) => tile.direction !== 0).length, 2);
  assert.deepEqual(
    source.frames[0].tiles.filter((tile) => tile.direction !== 0).map((tile) =>
      [tile.index, tile.x, tile.z, tile.direction, Number(tile.angle.toFixed(9))]),
    [
      [67, 7, 4, 1, 0.09424778],
      [68, 7, 5, 4, 0.09424778],
    ],
  );
});

test("prepared source simulation is deterministic", () => {
  const left = buildFlipFlopSourceFrames({ frameCount: 181 });
  const right = buildFlipFlopSourceFrames({ frameCount: 181 });
  assert.deepEqual(left, right);
  const frame = left.frames[180];
  assert.equal(frame.tiles.filter((tile) => tile.direction !== 0).length, 41);
  assert.equal(frame.tiles[3].direction, 2);
  assert.equal(frame.tiles[3].z, 2);
  assert.ok(Math.abs(frame.tiles[3].angle - 3.1101767270538954) < 1e-10);
});

test("mobile bank uses the source-supported 5x5 tile mode", () => {
  const source = buildFlipFlopSourceFrames({ bankId: "mobile", frameCount: 181 });
  const repeated = buildFlipFlopSourceFrames({ bankId: "mobile", frameCount: 181 });
  assert.equal(source.source.boardWidth, 5);
  assert.equal(source.source.boardDepth, 5);
  assert.equal(source.source.tileCount, 23);
  assert.equal(source.source.emptyCellCount, 2);
  assert.equal(source.frames[0].tiles.length, 23);
  assert.deepEqual(source, repeated);
});

test("presentation rewinds exact prepared states without a discontinuity", () => {
  const source = buildFlipFlopSourceFrames({ frameCount: 8 });
  const presentation = buildFlipFlopPresentationFrames(source);
  assert.equal(presentation.frameCount, 15);
  assert.deepEqual(presentation.frames[7].tiles, source.frames[7].tiles);
  assert.deepEqual(presentation.frames[8].tiles, source.frames[6].tiles);
  assert.deepEqual(presentation.frames.at(-1).tiles, source.frames[0].tiles);
  assert.deepEqual(presentation.frames.at(-1).boardMatrix, source.frames[0].boardMatrix);
});

test("prepared faces retain the exact source thickness", () => {
  const faces = Object.fromEntries(buildFlipFlopTileGeometry().map((face) => [face.id, face]));
  assert.equal(matrixAxisLength(faces.top.matrix, 0), 0.92);
  assert.equal(matrixAxisLength(faces.top.matrix, 1), 0.92);
  assert.equal(matrixAxisLength(faces.near.matrix, 0), 0.92);
  assert.equal(matrixAxisLength(faces.near.matrix, 1), 0.08);
  assert.equal(matrixAxisLength(faces.right.matrix, 0), 0.08);
  assert.equal(matrixAxisLength(faces.right.matrix, 1), 0.92);
});

test("Morph package owns one stable rigid root per tile and six leaves per tile", () => {
  const prepared = buildFlipFlopPreparedModel();
  const model = validatePolyMorphModel(prepared.model);
  assert.equal(model.render.shapes.length, 76);
  assert.equal(model.render.leaves.length, expectedFlipFlopLeafCount());
  assert.equal(model.render.leaves.length, 456);
  assert.ok(model.render.leaves.every((leaf) => leaf.strategy === "atlas-slice"));
  assert.ok(model.render.leaves.every((leaf) => leaf.width === 20 && leaf.height === 20));
  assert.ok(model.render.leaves.every((leaf) => leaf.atlas?.resourcePath === "assets/tile-colors.png"));
  assert.equal(model.playback.frames.length, CSSFLIPFLOP_SOURCE_FRAME_COUNT * 2 - 1);
  assert.equal(model.playback.frames[0].leaves.length, 456);
  assert.ok(model.playback.frames.slice(1).some((frame) => frame.leaves.length > 0));
  assert.equal(prepared.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(prepared.metrics.runtimeDomGrowth, false);
});

test("mobile Morph bank retains only its 23 source tiles", () => {
  const prepared = buildFlipFlopPreparedModel({ bankId: "mobile" });
  const model = validatePolyMorphModel(prepared.model);
  assert.equal(model.identity.id, FLIPFLOP_BANKS.mobile.modelId);
  assert.equal(model.render.shapes.length, 23);
  assert.equal(model.render.leaves.length, expectedFlipFlopLeafCount("mobile"));
  assert.equal(model.render.leaves.length, 138);
  assert.equal(prepared.metrics.cameraDistancePixels, 400);
});

function matrixAxisLength(matrix, column) {
  const offset = column * 4;
  return Math.hypot(matrix[offset], matrix[offset + 1], matrix[offset + 2]);
}
