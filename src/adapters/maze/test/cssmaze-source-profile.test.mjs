import assert from "node:assert/strict";
import test from "node:test";
import {
  captureNativeMazeRotationSummaries,
  captureNativeMazeState,
} from "../src/prepare/cssmaze/nativeState.mjs";
import {
  scoreNativeCameraRotation,
  scoreNativeCameraRotationSummary,
} from "../src/prepare/cssmaze/rotationRanking.mjs";
import { buildCssmazeFirstSliceScene } from "../src/prepare/cssmaze/sceneBuilder.mjs";

test("headless source-state dump reproduces the fixed first slice", async () => {
  const nativeCapture = await captureNativeMazeState({ seed: 26080701 });
  assert.equal(nativeCapture.state.frameCount, 1169);
  assert.equal(nativeCapture.state.completeTraversal, true);
  assert.deepEqual(nativeCapture.state.start, [19, 17]);
  assert.deepEqual(nativeCapture.state.finish, [1, 5]);
  assert.deepEqual(nativeCapture.state.frames[0], [0, 9, 9.5, 270, 0, 0]);
  assert.deepEqual(nativeCapture.state.frames.at(-1), [1168, 2.5, 1, 0, 0, 6]);
});

test("native ranking summaries match full source-state rotation evidence", async () => {
  const [summary] = await captureNativeMazeRotationSummaries({ seedStart: 26080701, seedCount: 1 });
  const nativeCapture = await captureNativeMazeState({ seed: 26080701 });
  const summarized = scoreNativeCameraRotationSummary(summary);
  const exact = scoreNativeCameraRotation(nativeCapture.state);
  for (const key of [
    "seed",
    "stateCount",
    "turningFrameCount",
    "turnEventCount",
    "longestTurningRunFrameCount",
    "maximumConsecutiveQuarterTurnCount",
    "loopOrientationChangeDegrees",
    "loopOrientationQuarterTurnCount",
    "loopOrientationDegrees",
    "quarterTurnCount",
  ]) {
    assert.equal(summarized[key], exact[key], key);
  }
  assert.ok(Math.abs(summarized.totalAngularTravelDegrees - exact.totalAngularTravelDegrees) < 0.00001);
  assert.ok(Math.abs(summarized.longestTurningRunDegrees - exact.longestTurningRunDegrees) < 0.00001);
});

test("native ranking summary validation rejects impossible metrics", () => {
  const valid = {
    schema: "cssmaze-native-rotation-summary@1",
    seed: 1,
    stateCount: 10,
    frameDelayMicroseconds: 20_000,
    totalAngularTravelDegrees: 90,
    turningFrameCount: 2,
    turnEventCount: 1,
    longestTurningRunFrameCount: 2,
    longestTurningRunDegrees: 90,
    initialRotationDegrees: 0,
    finalRotationDegrees: 90,
    completeTraversal: true,
  };
  for (const invalid of [
    { totalAngularTravelDegrees: -1 },
    { longestTurningRunDegrees: -1 },
    { initialRotationDegrees: -1 },
    { finalRotationDegrees: -1 },
    { turningFrameCount: 10 },
    { longestTurningRunFrameCount: 3 },
    { turnEventCount: 3 },
    { longestTurningRunDegrees: 91 },
    { turningFrameCount: 0 },
    { turnEventCount: 0 },
  ]) {
    assert.throws(() => scoreNativeCameraRotationSummary({ ...valid, ...invalid }), /valid native summary/u);
  }
});

test("native ranking summary normalization never publishes 360 degrees", () => {
  const score = scoreNativeCameraRotationSummary({
    schema: "cssmaze-native-rotation-summary@1",
    seed: 1,
    stateCount: 10,
    frameDelayMicroseconds: 20_000,
    totalAngularTravelDegrees: 0,
    turningFrameCount: 0,
    turnEventCount: 0,
    longestTurningRunFrameCount: 0,
    longestTurningRunDegrees: 0,
    initialRotationDegrees: 359.9999999996,
    finalRotationDegrees: 359.9999999996,
    completeTraversal: true,
  });
  assert.equal(score.loopOrientationDegrees, 0);
});

test("native ranking range validation rejects seed overflow", async () => {
  await assert.rejects(
    captureNativeMazeRotationSummaries({ seedStart: Number.MAX_SAFE_INTEGER, seedCount: 2 }),
    /positive safe integers/u,
  );
});

test("scene builder preserves exact wall coverage and prepared-only playback", async () => {
  const nativeCapture = await captureNativeMazeState({ seed: 26080701 });
  const dataSource = {
    verifiedFiles: [
      { output: "brick1.png", path: "hacks/images/brick1.png", sha256: "wall" },
      { output: "brick2.png", path: "hacks/images/brick2.png", sha256: "ceiling" },
      { output: "wood2.png", path: "hacks/images/wood2.png", sha256: "floor" },
    ],
  };
  const scene = buildCssmazeFirstSliceScene({ dataSource, nativeCapture });
  assert.equal(scene.metrics.sourceWallSegmentCount, 169);
  assert.equal(scene.metrics.sourcePolygonCount, 171);
  assert.equal(scene.metrics.preparedLeafCount, 171);
  assert.equal(scene.metrics.sourceWallCoverageExact, true);
  assert.equal(scene.metrics.preparedMergeCount, 0);
  assert.equal(scene.playback.stateCount, 1169);
  assert.ok(scene.playback.leafVisibilitySets.length > 1);
  assert.equal(scene.playback.leafVisibilitySets.every((set) => set.length === 169), true);
  assert.equal(scene.playback.leafVisibilityChangeRows.length, 1169);
  assert.ok(scene.playback.initialLeafVisibilityChanges.length > 0);
  assertPreparedVisibilityDeltas(scene.playback);
  assert.equal(scene.playback.sourceCameraPoses.length, 1169);
  assert.equal(scene.camera.preparedEyeOffsetPixels, 56.25);
  assert.equal(scene.camera.preparedSceneScale, 4.8);
  assert.deepEqual(scene.lighting.ambient, { color: "#ffffff", intensity: 3.25 });
  assert.equal(scene.playback.cameraTransforms[0], "translateZ(56.25px) rotateY(270deg) translate3d(-450px, 25px, -475px)");
  const walls = scene.meshes.find((mesh) => mesh.id === "maze-walls").polygons;
  assert.equal(scene.meshes.every((mesh) => mesh.polygons.every((polygon) => polygon.color === "#ffffff")), true);
  const westWallIndex = walls.findIndex((wall) => wall.data.sourceId === "maze3d.c:wall:r19:c14");
  const eastWallIndex = walls.findIndex((wall) => wall.data.sourceId === "maze3d.c:wall:r19:c20");
  const initialVisibility = scene.playback.leafVisibilitySets[scene.playback.frameRows[65][2]];
  assert.equal(initialVisibility[westWallIndex], "1");
  assert.equal(initialVisibility[eastWallIndex], "0");
  assert.equal(scene.playback.runtimeInterpolation, false);
  assert.equal(scene.playback.preparedCompositorInterpolation, true);
  assert.equal(scene.playback.preparedCompositorInterpolationMilliseconds, 20);
  assert.equal(scene.playback.preparedCompositorTimingFunction, "linear");
  assert.equal(scene.playback.preparedLoopResetTransition, "instant");
  const sourceWrapIndex = scene.playback.sourceCameraPoses.findIndex((pose, index, poses) =>
    index > 0 && Math.abs(pose[2] - poses[index - 1][2]) > 180);
  assert.ok(sourceWrapIndex > 0, "fixture trace should cross the normalized source angle boundary");
  const previousPreparedRotation = preparedRotationAt(scene.playback, sourceWrapIndex - 1);
  const currentPreparedRotation = preparedRotationAt(scene.playback, sourceWrapIndex);
  assert.ok(Math.abs(currentPreparedRotation - previousPreparedRotation) < 5,
    `prepared compositor angle wrapped discontinuously: ${previousPreparedRotation} -> ${currentPreparedRotation}`);
  assert.equal(scene.renderer.runtimeGeometryConstruction, false);
  assert.equal(scene.renderer.runtimeCameraCalculation, false);
  assert.equal(scene.renderer.runtimeVisibilityCalculation, false);
});

function assertPreparedVisibilityDeltas(playback) {
  const initial = [..."1".repeat(playback.leafVisibilitySets[0].length)];
  for (const operation of playback.initialLeafVisibilityChanges) {
    initial[Math.abs(operation) - 1] = operation > 0 ? "1" : "0";
  }
  assert.equal(
    initial.join(""),
    playback.leafVisibilitySets[playback.frameRows[0][2]],
    "prepared initial visibility operations drifted",
  );

  for (let index = 0; index < playback.frameRows.length; index += 1) {
    const previousIndex = index === 0 ? playback.frameRows.length - 1 : index - 1;
    const previous = playback.leafVisibilitySets[playback.frameRows[previousIndex][2]];
    const expected = playback.leafVisibilitySets[playback.frameRows[index][2]];
    const actual = [...previous];
    for (const operation of playback.leafVisibilityChangeRows[index]) {
      actual[Math.abs(operation) - 1] = operation > 0 ? "1" : "0";
    }
    assert.equal(actual.join(""), expected, `prepared visibility delta drifted at state ${index}`);
  }
}

function preparedRotationAt(playback, index) {
  const transform = playback.cameraTransforms[playback.frameRows[index][0]];
  const match = /rotateY\(([-0-9.]+)deg\)/u.exec(transform);
  assert.ok(match, `prepared camera transform lacks rotateY: ${transform}`);
  return Number(match[1]);
}
