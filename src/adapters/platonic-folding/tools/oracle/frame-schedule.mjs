const SOLID_FRAME_COUNT = 542;
const POSE_FRAMES = Object.freeze([90, 180, 225, 270, 315, 360, 450]);

export const CSSPLATONIC_ORACLE_FRAMES = Object.freeze([
  0,
  ...Array.from({ length: 5 }, (_, solidIndex) =>
    POSE_FRAMES.map((frame) => solidIndex * SOLID_FRAME_COUNT + frame)).flat(),
  5 * SOLID_FRAME_COUNT - 1,
]);

export function resolvePlatonicOracleFrames(value = process.env.CSSPLATONIC_ORACLE_FRAMES) {
  if (!value) return CSSPLATONIC_ORACLE_FRAMES;
  const frames = String(value).split(",").map((part) => Number(part.trim()));
  if (frames.length === 0 || frames.some((frame, index) =>
    !Number.isSafeInteger(frame) || frame < 0 || frame >= 5 * SOLID_FRAME_COUNT ||
    (index > 0 && frame <= frames[index - 1]))) {
    throw new RangeError("CSSPLATONIC_ORACLE_FRAMES must contain strictly increasing frames in 0..2709");
  }
  return Object.freeze(frames);
}
