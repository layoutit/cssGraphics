import assert from "node:assert/strict";
import test from "node:test";
import { selectPreparedSceneEntry } from "../src/cssmaze/manifestClient.mjs";
import { createPreparedSceneShuffledBag } from "../src/cssmaze/preparedBankSelection.mjs";
import { compareRotationScores, scoreNativeCameraRotation } from "../src/prepare/cssmaze/rotationRanking.mjs";

test("prepared-bank selection uses a supplied uint32 once per page load", () => {
  const manifest = fixtureManifest();
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: 0 }).id, "scene-a");
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: 1 }).id, "scene-b");
  assert.equal(selectPreparedSceneEntry(manifest, { requestedScene: "scene-c" }, { randomUint32: 0 }).id, "scene-c");
  assert.throws(() => selectPreparedSceneEntry(manifest, { requestedScene: null }, { randomUint32: -1 }), /uint32/u);
});

test("session shuffle visits all 24 prepared scenes before repeating across reloads", () => {
  const manifest = fixtureManifest(24);
  const storage = fixtureStorage();
  let randomValue = 0;
  const options = { storage, randomUint32: () => randomValue++ };
  let bag = createPreparedSceneShuffledBag(manifest, options);
  const firstCycle = Array.from({ length: 7 }, () => bag.nextEntry().id);
  bag = createPreparedSceneShuffledBag(manifest, options);
  firstCycle.push(...Array.from({ length: 17 }, () => bag.nextEntry().id));
  assert.equal(new Set(firstCycle).size, 24);

  const secondCycle = Array.from({ length: 24 }, () => bag.nextEntry().id);
  assert.equal(new Set(secondCycle).size, 24);
  assert.notEqual(secondCycle[0], firstCycle.at(-1));
  assert.equal([...firstCycle, ...secondCycle].some((id, index, ids) =>
    index > 0 && id === ids[index - 1]), false);
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

test("rotation ranking prioritizes fewer total turns before aggregate turning ratio", () => {
  const twoTurns = scoreNativeCameraRotation(fixtureTrace(109, [0, 90, 90, 180, 180]));
  const threeTurns = scoreNativeCameraRotation(
    fixtureTrace(110, [0, 90, 90, 180, 180, 270, 270, 270, 270, 270, 270]),
  );
  assert.equal(twoTurns.maximumConsecutiveQuarterTurnCount, 1);
  assert.equal(threeTurns.maximumConsecutiveQuarterTurnCount, 1);
  assert.ok(twoTurns.turningFrameRatio > threeTurns.turningFrameRatio);
  assert.ok(compareRotationScores(twoTurns, threeTurns) < 0);
});

test("rotation scoring counts quarter-turn and full-rotation equivalents at preparation", () => {
  const score = scoreNativeCameraRotation(fixtureTrace(105, [0, 90, 180, 270, 0]));
  assert.equal(score.schema, "cssmaze-prepared-rotation-score@2");
  assert.equal(score.quarterTurnCount, 4);
  assert.equal(score.fullRotationEquivalentCount, 1);
  assert.equal(score.turnEventCount, 1);
  assert.equal(score.longestTurningRunFrameCount, 4);
  assert.equal(score.longestTurningRunDurationMilliseconds, 80);
  assert.equal(score.longestTurningRunDegrees, 360);
  assert.equal(score.maximumConsecutiveQuarterTurnCount, 4);
  assert.equal(score.loopOrientationChangeDegrees, 0);
  assert.equal(score.loopOrientationQuarterTurnCount, 0);
  assert.equal(score.loopOrientationDegrees, 0);
  assert.equal(score.runtimeScoring, false);
});

test("rotation scoring exposes a non-seamless prepared loop heading", () => {
  const score = scoreNativeCameraRotation(fixtureTrace(108, [270, 270, 180, 90]));
  assert.equal(score.loopOrientationChangeDegrees, 180);
  assert.equal(score.loopOrientationQuarterTurnCount, 2);
  assert.equal(score.loopOrientationDegrees, 270);
});

test("rotation ranking rejects long uninterrupted turn streaks before aggregate ratio", () => {
  const longStreak = scoreNativeCameraRotation(fixtureTrace(106, [0, 90, 180, 180, 180, 180, 180]));
  const separatedTurns = scoreNativeCameraRotation(fixtureTrace(107, [0, 90, 90, 180, 180, 270, 270]));
  assert.ok(longStreak.turningFrameRatio < separatedTurns.turningFrameRatio);
  assert.equal(longStreak.maximumConsecutiveQuarterTurnCount, 2);
  assert.equal(separatedTurns.maximumConsecutiveQuarterTurnCount, 1);
  assert.ok(compareRotationScores(separatedTurns, longStreak) < 0);
});

function fixtureManifest(count = 3) {
  const scenes = Array.from({ length: count }, (_, index) => ({
    id: count === 3 ? `scene-${String.fromCharCode(97 + index)}` : `scene-${index + 1}`,
  }));
  return {
    scenes,
    preparedBank: { sceneIds: scenes.map(({ id }) => id) },
  };
}

function fixtureStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

function fixtureTrace(seed, headings) {
  return {
    seed,
    frameDelayMicroseconds: 20_000,
    frames: headings.map((heading, index) => [index, 0, 0, heading, 0, 0]),
  };
}
