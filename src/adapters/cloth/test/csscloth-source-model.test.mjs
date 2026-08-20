import assert from "node:assert/strict";
import test from "node:test";
import { computeSolidTrianglePlanFromCssPoints } from "@layoutit/polycss";
import {
  fitGroundRasterPhase,
  groundRasterFilterPlan,
} from "../src/prepare/csscloth/rasterAtlas.mjs";
import {
  buildClothSourceFrames,
  buildClothSourceFramesFromCheckpoint,
  buildClothMobileSourceFrames,
  buildClothSeamEdges,
  buildClothTriangles,
  buildFixtureFaces,
  buildFixtureShadowCasters,
  buildGroundPlane,
  clothFogFactor,
  buildClothLightingBank,
  clothTriangleFogState,
  clothTriangleBasis,
  clothTriangleLightState,
  clothTriangleMatrix,
  CSSCLOTH_GROUND_RASTER_HEIGHT,
  CSSCLOTH_GROUND_RASTER_WIDTH,
  CSSCLOTH_GROUND_REPEAT_COUNT,
  CSSCLOTH_GROUND_SOURCE_REPEAT_COUNT,
  CSSCLOTH_BANK_FRAME_COUNT,
  CSSCLOTH_PARTICLE_COUNT,
  CSSCLOTH_TRIANGLE_COUNT,
  CSSCLOTH_MOBILE_PARTICLE_COUNT,
  CSSCLOTH_MOBILE_TRIANGLE_COUNT,
  CSSCLOTH_RASTER_LEAF_SIZE,
  sourceWorldToCssView,
} from "../src/prepare/csscloth/sourceModel.mjs";

test("the pinned source topology keeps 121 particles and 200 triangles", () => {
  assert.equal(CSSCLOTH_PARTICLE_COUNT, 121);
  assert.equal(CSSCLOTH_TRIANGLE_COUNT, 200);
  assert.equal(buildClothTriangles().length, 200);
});

test("mobile remesh keeps a full square with 72 cloth triangles", () => {
  const source = buildClothSourceFrames({ frameCount: 2 });
  const mobile = buildClothMobileSourceFrames(source);
  assert.equal(CSSCLOTH_MOBILE_PARTICLE_COUNT, 49);
  assert.equal(CSSCLOTH_MOBILE_TRIANGLE_COUNT, 72);
  assert.equal(mobile.triangles.length, 72);
  assert.equal(new Set(mobile.triangles.flatMap((triangle) => triangle.particleIndices)).size, 49);
  assert.deepEqual(mobile.triangles[0].uv[0], [0, 0]);
  assert.deepEqual(mobile.triangles.at(-1).uv[1], [1, 1]);
  const seams = buildClothSeamEdges(mobile.triangles);
  assert.equal(seams.length, 72);
  const matrix = clothTriangleMatrix(mobile.frames[1], 47, seams);
  assert.equal(matrix.length, 16);
  assert.ok(matrix.every(Number.isFinite));
  const lighting = buildClothLightingBank(mobile);
  assert.equal(lighting.states.length, 72);
});

test("source fog uses the pinned Three.js r132 linear range", () => {
  assert.equal(clothFogFactor(500), 0);
  assert.equal(clothFogFactor(5250), 0.5);
  assert.equal(clothFogFactor(10_000), 1);
});

test("prepared ground filtering grows toward the horizon", () => {
  const matrix = buildGroundPlane().matrix;
  const far = groundRasterFilterPlan(matrix, 0.5, 2048, 2048);
  const near = groundRasterFilterPlan(matrix, CSSCLOTH_GROUND_RASTER_HEIGHT - 0.5, 2048, 2048);
  assert.ok(far.sampleCount > near.sampleCount);
  assert.ok(far.sampleCount <= 16);
  assert.ok(far.mipLevel > near.mipLevel);
  assert.ok(far.span > near.span);
});

test("prepared ground phase fitting is deterministic and keeps opaque RGB", () => {
  const input = Buffer.from(Array.from({ length: 27 }, (_, index) => index * 17 % 256));
  assert.deepEqual([...fitGroundRasterPhase(input, 3, 3)], [
    58, 75, 92, 109, 126, 143, 160, 80, 97,
    42, 59, 76, 95, 122, 139, 148, 109, 126,
    88, 105, 122, 145, 162, 179, 201, 109, 126,
  ]);
});

test("prepared simulation is deterministic and keeps the full top row pinned", () => {
  const left = buildClothSourceFrames({ frameCount: 8 });
  const right = buildClothSourceFrames({ frameCount: 8 });
  assert.deepEqual(left, right);
  assert.deepEqual(left.frames[7].triangles[0].positions[0], [-125, 125, 0]);
  assert.deepEqual(left.frames[7].triangles[0].positions[1], [-100, 125, 0]);
  assert.ok(left.frames[7].triangles.some((triangle) => triangle.positions.some((position) => position[2] !== 0)));
  assert.equal(clothTriangleLightState(left.frames[7], 0).length, 3);
  assert.equal(clothTriangleFogState(left.frames[7], 0).length, 3);
  const lighting = buildClothLightingBank(left);
  assert.equal(lighting.frameRows.length, left.frames.length);
  assert.equal(lighting.states.length, 200);
  assert.ok(lighting.states.every((states) => states.length > 0 && states.length <= 0x10000));
  assert.ok(lighting.states.flat().every((state) => state.length === 6));
});

test("late-bank checkpoints preserve the source simulation exactly", () => {
  const bankIndex = 5;
  const replayFrameCount = 840;
  const source = buildClothSourceFrames({
    frameCount: (bankIndex + 1) * CSSCLOTH_BANK_FRAME_COUNT,
  });
  const replay = buildClothSourceFramesFromCheckpoint(
    source.bankCheckpoints[bankIndex],
    replayFrameCount,
  );
  const frameOffset = bankIndex * CSSCLOTH_BANK_FRAME_COUNT;
  for (let frameIndex = 0; frameIndex < replayFrameCount; frameIndex += 1) {
    assert.deepEqual(replay.frames[frameIndex], source.frames[frameOffset + frameIndex]);
  }
});

test("specialized particle matrices match the general PolyCSS triangle planner", () => {
  const source = buildClothSourceFrames({ frameCount: 8 });
  const seams = buildClothSeamEdges(source.triangles);
  for (const frame of source.frames) {
    for (let triangleIndex = 0; triangleIndex < source.triangles.length; triangleIndex += 1) {
      assert.deepEqual(
        clothTriangleMatrix(frame, triangleIndex, seams),
        referenceClothTriangleMatrix(frame, triangleIndex, seams),
      );
    }
  }
});

test("prepared scene geometry is finite and source-sized", () => {
  const source = buildClothSourceFrames({ frameCount: 2 });
  const matrix = clothTriangleMatrix(source.frames[1], 47);
  assert.equal(matrix.length, 16);
  assert.ok(matrix.every(Number.isFinite));
  assert.equal(buildFixtureFaces().length, 30);
  const fixtureCasters = buildFixtureShadowCasters();
  assert.deepEqual(fixtureCasters.map((caster) => caster.id), [
    "pole-left",
    "pole-right",
    "pole-top",
    "foot-left",
    "foot-right",
  ]);
  assert.ok(fixtureCasters.every((caster) => caster.vertices.length === 8));
  assert.ok(fixtureCasters.every((caster) => caster.vertices.flat().every(Number.isFinite)));
  const ground = buildGroundPlane();
  assert.equal(ground.id, "ground");
  assert.equal(ground.width, CSSCLOTH_GROUND_RASTER_WIDTH);
  assert.equal(ground.height, CSSCLOTH_GROUND_RASTER_HEIGHT);
  assert.equal(CSSCLOTH_GROUND_SOURCE_REPEAT_COUNT, 25);
  assert.equal(CSSCLOTH_GROUND_REPEAT_COUNT, 14);
  assert.ok(ground.world.every((point) => Math.abs(point[1] + 250) < 0.000001));
  assert.equal(ground.view[0][1], ground.view[1][1]);
  assert.equal(ground.view[0][2], ground.view[1][2]);
  assert.equal(ground.view[2][1], ground.view[3][1]);
  assert.equal(ground.view[2][2], ground.view[3][2]);
  assert.ok(ground.matrix[3] !== 0 || ground.matrix[7] !== 0);
  assert.ok(ground.matrix.every(Number.isFinite));
});

function referenceClothTriangleMatrix(frame, triangleIndex, seamEdges) {
  const points = frame.triangles[triangleIndex].positions.map(sourceWorldToCssView);
  const plan = computeSolidTrianglePlanFromCssPoints(
    { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
    triangleIndex,
    {
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: 0.3,
      seamEdges: new Set(seamEdges[triangleIndex] ?? []),
    },
    {
      basis: clothTriangleBasis(triangleIndex),
      matrixDecimals: 7,
      primitive: "corner-bevel",
      includeColor: false,
    },
    ...points.flat(),
  );
  const matrix = plan.transformText.slice(9, -1).split(",").map(Number);
  const rasterScale = 32 / CSSCLOTH_RASTER_LEAF_SIZE;
  for (const index of [0, 1, 2, 4, 5, 6]) matrix[index] *= rasterScale;
  return matrix.map((value) => {
    const rounded = Number(value.toFixed(7));
    return Object.is(rounded, -0) ? 0 : rounded;
  });
}
