export const CSSMENGER_ORACLE_FRAME_SCHEDULE = Object.freeze({
  schema: "cssmenger-oracle-frame-schedule@1",
  id: "fixed-depth-3-seed-26080801-common-prefix-0-45",
  sourceFrameDelayMilliseconds: 30,
  ticks: Object.freeze(Array.from({ length: 46 }, (_, tick) => tick)),
  note: "The common prefix compares the same numbered native draw and prepared browser state. Shell chrome and the product background gradient are excluded from scene pixels.",
});

export function resolveCssmengerOracleTicks(value = process.env.CSSMENGER_ORACLE_TICKS) {
  if (!value) return CSSMENGER_ORACLE_FRAME_SCHEDULE.ticks;
  const ticks = String(value).split(",").map((part) => Number(part.trim()));
  if (ticks.length === 0 || ticks.some((tick, index) =>
    !Number.isSafeInteger(tick) || tick < 0 || (index > 0 && tick <= ticks[index - 1]))) {
    throw new RangeError("CSSMENGER_ORACLE_TICKS must be strictly increasing non-negative integers");
  }
  return Object.freeze(ticks);
}
