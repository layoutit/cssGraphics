import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CSSMAZE_TEXTURE_FILES, resolveCssmazeDataSource } from "./dataSource.mjs";
import { captureNativeMazeState } from "./nativeState.mjs";
import { generatedProductRoot } from "./paths.mjs";
import {
  compareRotationScores,
  scoreNativeCameraRotation,
} from "./rotationRanking.mjs";
import { buildCssmazeFirstSliceScene } from "./sceneBuilder.mjs";
import {
  CSSMAZE_CANDIDATE_SEED_COUNT,
  CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT,
  CSSMAZE_MAXIMUM_TOTAL_QUARTER_TURN_COUNT,
  CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES,
  CSSMAZE_MINIMUM_BANK_STATE_COUNT,
  CSSMAZE_PREPARED_BANK_COUNT,
  CSSMAZE_PREPARED_BANK_SEEDS,
  CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES,
  CSSMAZE_SCENE_ID,
  CSSMAZE_SEED,
} from "./slicePlan.mjs";
import { writeCssmazePreparedOutput } from "./writeManifest.mjs";

export async function prepareCssmaze({ sourceRoot, seed } = {}) {
  const dataSource = await resolveCssmazeDataSource({ sourceRoot });
  const isRankedBank = seed === undefined;
  const ranked = seed === undefined
    ? CSSMAZE_PREPARED_BANK_SEEDS.map((selectedSeed) => Object.freeze({ seed: selectedSeed }))
    : [captureExplicitSeed(seed)];
  const scenes = [];
  const exactRanked = [];
  for (let rank = 0; rank < ranked.length; rank += 1) {
    const selected = ranked[rank];
    const nativeCapture = await captureNativeMazeState({ seed: selected.seed });
    const rotationScore = scoreNativeCameraRotation(nativeCapture.state);
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
  if (isRankedBank) validatePreparedBankRanking(exactRanked);
  await copyPreparedTextures(dataSource.root);
  return writeCssmazePreparedOutput({
    scenes,
    defaultSceneId: scenes[0].id,
    preparedBank: buildPreparedBank(scenes, exactRanked, { isRankedBank }),
  });
}

function captureExplicitSeed(value) {
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed <= 0) {
    throw new RangeError("cssMaze seed must be a positive safe integer");
  }
  return Object.freeze({ seed });
}

function validatePreparedBankRanking(ranked) {
  if (ranked.length !== CSSMAZE_PREPARED_BANK_COUNT ||
      new Set(ranked.map(({ seed }) => seed)).size !== CSSMAZE_PREPARED_BANK_COUNT ||
      ranked.some(({ rotationScore }) =>
        rotationScore.stateCount < CSSMAZE_MINIMUM_BANK_STATE_COUNT ||
        rotationScore.maximumConsecutiveQuarterTurnCount >
          CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT ||
        rotationScore.quarterTurnCount > CSSMAZE_MAXIMUM_TOTAL_QUARTER_TURN_COUNT ||
        rotationScore.loopOrientationChangeDegrees >
          CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES ||
        rotationScore.loopOrientationDegrees !== CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES) ||
      ranked.some((entry, index) => index > 0 &&
        compareRotationScores(ranked[index - 1].rotationScore, entry.rotationScore) > 0)) {
    throw new Error("cssMaze pinned prepared bank failed its native rotation contract");
  }
}

function buildPreparedBank(scenes, ranked, { isRankedBank }) {
  return Object.freeze({
    schema: "cssmaze-prepared-bank@1",
    selection: isRankedBank
      ? "session-shuffled-bag-no-repeat-common-loop-low-total-turn-prepared-scene"
      : "explicit-prepared-scene",
    ranking: Object.freeze(isRankedBank ? {
      algorithm: "common-loop-orientation-then-lowest-consecutive-and-total-quarter-turns",
      selectionPreparation: "pinned-results-of-native-summary-scan",
      candidateSeedStart: CSSMAZE_SEED,
      candidateSeedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
      minimumStateCount: CSSMAZE_MINIMUM_BANK_STATE_COUNT,
      maximumConsecutiveQuarterTurnCount: CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT,
      maximumTotalQuarterTurnCount: CSSMAZE_MAXIMUM_TOTAL_QUARTER_TURN_COUNT,
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
