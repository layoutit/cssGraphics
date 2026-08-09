export const CSSMAZE_SCENE_ID = "default-maze";
export const CSSMAZE_SEED = 26080701;
export const CSSMAZE_PREPARED_BANK_COUNT = 24;
export const CSSMAZE_CANDIDATE_SEED_COUNT = 1_048_576;
export const CSSMAZE_MINIMUM_BANK_STATE_COUNT = 600;
export const CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT = 2;
export const CSSMAZE_MAXIMUM_TOTAL_QUARTER_TURN_COUNT = 6;
export const CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES = 0;
export const CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES = 180;
export const CSSMAZE_PREPARED_BANK_SEEDS = Object.freeze([
  26287452, 26515754, 26186219, 26140709, 26172274, 26443087,
  26815156, 26286804, 26498474, 26822000, 26696064, 26986887,
  26451638, 27017064, 26713184, 26445903, 26857926, 26297898,
  26527645, 27108148, 27106700, 26784994, 26652271, 26406708,
]);

export const cssmazeSlicePlan = Object.freeze({
  mode: "map-scene",
  artifactMode: "prepared-polycss-snapshot",
  logicalRows: 12,
  logicalColumns: 12,
  sourceGridRows: 25,
  sourceGridColumns: 25,
  seed: CSSMAZE_SEED,
  preparedBankCount: CSSMAZE_PREPARED_BANK_COUNT,
  preparedBankSeeds: CSSMAZE_PREPARED_BANK_SEEDS,
  candidateSeedStart: CSSMAZE_SEED,
  candidateSeedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
  minimumBankStateCount: CSSMAZE_MINIMUM_BANK_STATE_COUNT,
  maximumConsecutiveQuarterTurnCount: CSSMAZE_MAXIMUM_CONSECUTIVE_QUARTER_TURN_COUNT,
  maximumTotalQuarterTurnCount: CSSMAZE_MAXIMUM_TOTAL_QUARTER_TURN_COUNT,
  maximumLoopOrientationChangeDegrees: CSSMAZE_MAXIMUM_LOOP_ORIENTATION_CHANGE_DEGREES,
  requiredLoopOrientationDegrees: CSSMAZE_REQUIRED_LOOP_ORIENTATION_DEGREES,
  sourceFrameDelayMicroseconds: 20_000,
  sourceSpeed: 1,
  defaultScene: CSSMAZE_SCENE_ID,
  excluded: Object.freeze([
    "rats",
    "inverters",
    "overlay",
    "acid-modes",
    "floating-images",
    "user-textures",
  ]),
});

export function describeFirstSlice() {
  return "One startup-selected maze from a 24-scene low-rotation prepared XScreenSaver Maze3D bank with source walls, floor, ceiling, and camera cadence.";
}
