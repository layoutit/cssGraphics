export const CSSMAZE_SCENE_ID = "default-maze";
export const CSSMAZE_SEED = 26080701;
export const CSSMAZE_PREPARED_BANK_COUNT = 24;
export const CSSMAZE_CANDIDATE_SEED_COUNT = 4096;
export const CSSMAZE_MINIMUM_BANK_STATE_COUNT = 600;

export const cssmazeSlicePlan = Object.freeze({
  mode: "map-scene",
  artifactMode: "prepared-polycss-snapshot",
  logicalRows: 12,
  logicalColumns: 12,
  sourceGridRows: 25,
  sourceGridColumns: 25,
  seed: CSSMAZE_SEED,
  preparedBankCount: CSSMAZE_PREPARED_BANK_COUNT,
  candidateSeedStart: CSSMAZE_SEED,
  candidateSeedCount: CSSMAZE_CANDIDATE_SEED_COUNT,
  minimumBankStateCount: CSSMAZE_MINIMUM_BANK_STATE_COUNT,
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
