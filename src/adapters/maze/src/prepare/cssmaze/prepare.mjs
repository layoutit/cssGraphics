import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CSSMAZE_TEXTURE_FILES, resolveCssmazeDataSource } from "./dataSource.mjs";
import { captureNativeMazeState } from "./nativeState.mjs";
import { generatedProductRoot } from "./paths.mjs";
import { compareRotationScores, scoreNativeCameraRotation } from "./rotationRanking.mjs";
import { buildCssmazeFirstSliceScene } from "./sceneBuilder.mjs";
import {
  CSSMAZE_CANDIDATE_SEED_COUNT,
  CSSMAZE_MINIMUM_BANK_STATE_COUNT,
  CSSMAZE_PREPARED_BANK_COUNT,
  CSSMAZE_SCENE_ID,
  CSSMAZE_SEED,
} from "./slicePlan.mjs";
import { writeCssmazePreparedOutput } from "./writeManifest.mjs";

export async function prepareCssmaze({ sourceRoot, seed } = {}) {
  const dataSource = await resolveCssmazeDataSource({ sourceRoot });
  const ranked = seed === undefined
    ? await rankPreparedBankCandidates()
    : [await captureExplicitSeed(seed)];
  const scenes = [];
  for (let rank = 0; rank < ranked.length; rank += 1) {
    const selected = ranked[rank];
    const nativeCapture = await captureNativeMazeState({ seed: selected.seed });
    scenes.push(buildCssmazeFirstSliceScene({
      dataSource,
      nativeCapture,
      rotationScore: selected.rotationScore,
      sceneId: rank === 0 ? CSSMAZE_SCENE_ID : `seed-${selected.seed}`,
    }));
  }
  await copyPreparedTextures(dataSource.root);
  return writeCssmazePreparedOutput({
    scenes,
    defaultSceneId: scenes[0].id,
    preparedBank: buildPreparedBank(scenes, ranked),
  });
}

async function rankPreparedBankCandidates() {
  const eligible = [];
  for (let offset = 0; offset < CSSMAZE_CANDIDATE_SEED_COUNT; offset += 1) {
    const seed = CSSMAZE_SEED + offset;
    const capture = await captureNativeMazeState({ seed });
    const rotationScore = scoreNativeCameraRotation(capture.state);
    if (rotationScore.stateCount >= CSSMAZE_MINIMUM_BANK_STATE_COUNT) {
      eligible.push(Object.freeze({ seed, rotationScore }));
    }
  }
  eligible.sort((left, right) => compareRotationScores(left.rotationScore, right.rotationScore));
  if (eligible.length < CSSMAZE_PREPARED_BANK_COUNT) {
    throw new Error(`cssMaze low-rotation candidate pool produced only ${eligible.length} eligible seeds`);
  }
  return Object.freeze(eligible.slice(0, CSSMAZE_PREPARED_BANK_COUNT));
}

async function captureExplicitSeed(value) {
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed <= 0) {
    throw new RangeError("cssMaze seed must be a positive safe integer");
  }
  const capture = await captureNativeMazeState({ seed });
  return Object.freeze({ seed, rotationScore: scoreNativeCameraRotation(capture.state) });
}

function buildPreparedBank(scenes, ranked) {
  return Object.freeze({
    schema: "cssmaze-prepared-bank@1",
    selection: "startup-crypto-random-low-rotation-prepared-scene",
    ranking: Object.freeze({
      algorithm: "lowest-turning-frame-ratio-then-angular-rate",
      candidateSeedStart: CSSMAZE_SEED,
      candidateSeedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
      minimumStateCount: CSSMAZE_MINIMUM_BANK_STATE_COUNT,
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

async function copyPreparedTextures(sourceRoot) {
  const targetRoot = join(generatedProductRoot(), "assets");
  await mkdir(targetRoot, { recursive: true });
  for (const texture of CSSMAZE_TEXTURE_FILES) {
    await copyFile(join(sourceRoot, texture.path), join(targetRoot, texture.output));
  }
}
