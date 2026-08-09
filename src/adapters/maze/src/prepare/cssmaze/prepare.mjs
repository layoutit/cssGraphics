import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CSSMAZE_TEXTURE_FILES, resolveCssmazeDataSource } from "./dataSource.mjs";
import { captureNativeMazeRotationSummaries, captureNativeMazeState } from "./nativeState.mjs";
import { generatedProductRoot } from "./paths.mjs";
import {
  compareRotationScores,
  scoreNativeCameraRotation,
  scoreNativeCameraRotationSummary,
} from "./rotationRanking.mjs";
import { buildCssmazeFirstSliceScene } from "./sceneBuilder.mjs";
import {
  CSSMAZE_CANDIDATE_SEED_COUNT,
  CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT,
  CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES,
  CSSMAZE_MINIMUM_BANK_STATE_COUNT,
  CSSMAZE_PREPARED_BANK_COUNT,
  CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES,
  CSSMAZE_SCENE_ID,
  CSSMAZE_SEED,
} from "./slicePlan.mjs";
import { writeCssmazePreparedOutput } from "./writeManifest.mjs";

export async function prepareCssmaze({ sourceRoot, seed } = {}) {
  const dataSource = await resolveCssmazeDataSource({ sourceRoot });
  const isRankedBank = seed === undefined;
  const ranked = seed === undefined
    ? await rankPreparedBankCandidates()
    : [await captureExplicitSeed(seed)];
  const scenes = [];
  const exactRanked = [];
  for (let rank = 0; rank < ranked.length; rank += 1) {
    const selected = ranked[rank];
    const nativeCapture = await captureNativeMazeState({ seed: selected.seed });
    const rotationScore = scoreNativeCameraRotation(nativeCapture.state);
    assertRankingSummaryMatchesCapture(selected.rotationScore, rotationScore);
    const loopTexturePhaseAligned = hasLoopTexturePhaseAlignment(nativeCapture.state);
    if (isRankedBank && !loopTexturePhaseAligned) {
      throw new Error("cssMaze selected loop changed the floor/ceiling texture phase");
    }
    exactRanked.push(Object.freeze({ seed: selected.seed, rotationScore, loopTexturePhaseAligned }));
    scenes.push(buildCssmazeFirstSliceScene({
      dataSource,
      nativeCapture,
      rotationScore,
      sceneId: rank === 0 ? CSSMAZE_SCENE_ID : `seed-${selected.seed}`,
    }));
  }
  await copyPreparedTextures(dataSource.root);
  return writeCssmazePreparedOutput({
    scenes,
    defaultSceneId: scenes[0].id,
    preparedBank: buildPreparedBank(scenes, exactRanked, { isRankedBank }),
  });
}

async function rankPreparedBankCandidates() {
  const eligible = [];
  const summaries = await captureNativeMazeRotationSummaries({
    seedStart: CSSMAZE_SEED,
    seedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
  });
  for (const summary of summaries) {
    const rotationScore = scoreNativeCameraRotationSummary(summary);
    if (rotationScore.stateCount >= CSSMAZE_MINIMUM_BANK_STATE_COUNT &&
        rotationScore.loopOrientationChangeDegrees <= CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES &&
        rotationScore.loopOrientationDegrees === CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES) {
      eligible.push(Object.freeze({ seed: summary.seed, rotationScore }));
    }
  }
  eligible.sort((left, right) => compareRotationScores(left.rotationScore, right.rotationScore));
  if (eligible.length < CSSMAZE_PREPARED_BANK_COUNT) {
    throw new Error(`cssMaze low-rotation candidate pool produced only ${eligible.length} eligible seeds`);
  }
  const selected = eligible.slice(0, CSSMAZE_PREPARED_BANK_COUNT);
  if (selected.at(-1)?.rotationScore.maximumConsecutiveQuarterTurnCount >
      CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT) {
    throw new Error("cssMaze candidate pool did not satisfy the consecutive-turn ceiling");
  }
  if (selected.some(({ rotationScore }) =>
    rotationScore.loopOrientationChangeDegrees > CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES ||
    rotationScore.loopOrientationDegrees !== CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES)) {
    throw new Error("cssMaze candidate pool did not satisfy the loop-orientation ceiling");
  }
  return Object.freeze(selected);
}

async function captureExplicitSeed(value) {
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed <= 0) {
    throw new RangeError("cssMaze seed must be a positive safe integer");
  }
  const capture = await captureNativeMazeState({ seed });
  return Object.freeze({ seed, rotationScore: scoreNativeCameraRotation(capture.state) });
}

function buildPreparedBank(scenes, ranked, { isRankedBank }) {
  return Object.freeze({
    schema: "cssmaze-prepared-bank@1",
    selection: isRankedBank
      ? "startup-crypto-random-common-loop-low-consecutive-turn-prepared-scene"
      : "explicit-prepared-scene",
    ranking: Object.freeze(isRankedBank ? {
      algorithm: "common-loop-orientation-then-lowest-maximum-consecutive-quarter-turns",
      candidateSeedStart: CSSMAZE_SEED,
      candidateSeedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
      minimumStateCount: CSSMAZE_MINIMUM_BANK_STATE_COUNT,
      maximumConsecutiveQuarterTurnCount: CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT,
      maximumLoopOrientationChangeDegrees: CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES,
      requiredLoopOrientationDegrees: CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES,
      loopTexturePhaseAligned: true,
      selectedSceneCount: scenes.length,
      runtimeScoring: false,
    } : {
      algorithm: "explicit-seed-no-ranking",
      loopTexturePhaseAligned: ranked.every((entry) => entry.loopTexturePhaseAligned),
      selectedSceneCount: scenes.length,
      runtimeScoring: false,
    }),
    sceneIds: Object.freeze(scenes.map((scene) => scene.id)),
    seeds: Object.freeze(ranked.map((entry) => entry.seed)),
    rotationScores: Object.freeze(ranked.map((entry) => entry.rotationScore)),
    runtimeSceneGeneration: false,
    runtimeGeometryConstruction: false,
    runtimeRotationScoring: false,
    mountedSceneCount: 1,
  });
}

function assertRankingSummaryMatchesCapture(summaryScore, captureScore) {
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
    if (summaryScore[key] !== captureScore[key]) {
      throw new Error(`cssMaze native ranking summary drifted at ${key}`);
    }
  }
}

function hasLoopTexturePhaseAlignment(state) {
  const first = state.frames[0];
  const last = state.frames.at(-1);
  const xCellDelta = Math.abs(last[1] - first[1]);
  const zCellDelta = Math.abs(last[2] - first[2]);
  return Math.abs(xCellDelta - Math.round(xCellDelta)) <= 0.000001 &&
    Math.abs(zCellDelta - Math.round(zCellDelta)) <= 0.000001;
}

async function copyPreparedTextures(sourceRoot) {
  const targetRoot = join(generatedProductRoot(), "assets");
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  for (const texture of CSSMAZE_TEXTURE_FILES) {
    await copyFile(join(sourceRoot, texture.path), join(targetRoot, texture.output));
  }
}
