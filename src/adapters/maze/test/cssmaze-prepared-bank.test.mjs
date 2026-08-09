import assert from "node:assert/strict";
import test from "node:test";
import { selectPreparedSceneEntry } from "../src/cssmaze/manifestClient.mjs";
import { compareRotationScores, scoreNativeCameraRotation } from "../src/prepare/cssmaze/rotationRanking.mjs";

test("prepared-bank selection uses a supplied uint32 once per page load", () => {
  const manifest = fixtureManifest();
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: 0 }).id, "scene-a");
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: 1 }).id, "scene-b");
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: "scene-c" }, { randomUint32: 0 }).id, "scene-c");
  assert.throws(() => selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: -1 }), /uint32/u);
});

test("rotation ranking favors traces that spend less time turning", () => {
  const lowRotation = scoreNativeCameraRotation(fixtureTrace(101, [0, 0, 0, 0, 10]));
  const highRotation = scoreNativeCameraRotation(fixtureTrace(102, [0, 10, 20, 30, 40]));
  assert.ok(lowRotation.turningFrameRatio < highRotation.turningFrameRatio);
  assert.ok(compareRotationScores(lowRotation, highRotation) < 0);
  assert.equal(lowRotation.runtimeScoring, false);
});

test("rotation ranking breaks equal turning ratios with fewer quarter turns", () => {
  const oneQuarterTurn = scoreNativeCameraRotation(fixtureTrace(103, [0, 0, 90, 90]));
  const twoQuarterTurns = scoreNativeCameraRotation(fixtureTrace(104, [0, 0, 180, 180]));
  assert.equal(oneQuarterTurn.turningFrameRatio, twoQuarterTurns.turningFrameRatio);
  assert.ok(compareRotationScores(oneQuarterTurn, twoQuarterTurns) < 0);
});

test("rotation scoring counts quarter-turn and full-rotation equivalents at preparation", () => {
  const score = scoreNativeCameraRotation(fixtureTrace(105, [0, 90, 180, 270, 0]));
  assert.equal(score.quarterTurnCount, 4);
  assert.equal(score.fullRotationEquivalentCount, 1);
  assert.equal(score.turnEventCount, 1);
  assert.equal(score.runtimeScoring, false);
});

function fixtureManifest() {
  const scenes = ["scene-a", "scene-b", "scene-c"].map((id) => ({ id }));
  return {
    scenes,
    preparedBank: { sceneIds: scenes.map(({ id }) => id) },
  };
}

function fixtureTrace(seed, headings) {
  return {
    seed,
    frameDelayMicroseconds: 20_000,
    frames: headings.map((heading, index) => [index, 0, 0, heading, 0, 0]),
  };
}
