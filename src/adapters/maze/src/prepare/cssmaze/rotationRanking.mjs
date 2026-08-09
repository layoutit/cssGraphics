export function scoreNativeCameraRotation(state) {
  if (!Array.isArray(state?.frames) || state.frames.length < 2) {
    throw new Error("cssMaze rotation scoring requires a prepared native camera trace");
  }
  let totalAngularTravelDegrees = 0;
  let turningFrameCount = 0;
  let turnEventCount = 0;
  let turningRunFrameCount = 0;
  let turningRunDegrees = 0;
  let longestTurningRunFrameCount = 0;
  let longestTurningRunDegrees = 0;
  let wasTurning = false;
  for (let index = 1; index < state.frames.length; index += 1) {
    const previous = state.frames[index - 1][3];
    const current = state.frames[index][3];
    const delta = wrappedAngularDelta(current, previous);
    const turning = Math.abs(delta) > 0.000001;
    totalAngularTravelDegrees += Math.abs(delta);
    if (turning) {
      turningFrameCount += 1;
      turningRunFrameCount += 1;
      turningRunDegrees += Math.abs(delta);
      longestTurningRunFrameCount = Math.max(longestTurningRunFrameCount, turningRunFrameCount);
      longestTurningRunDegrees = Math.max(longestTurningRunDegrees, turningRunDegrees);
    } else {
      turningRunFrameCount = 0;
      turningRunDegrees = 0;
    }
    if (turning && !wasTurning) turnEventCount += 1;
    wasTurning = turning;
  }
  const stateCount = state.frames.length;
  const durationMilliseconds = stateCount * (state.frameDelayMicroseconds / 1000);
  const quarterTurnCount = Math.round(totalAngularTravelDegrees / 90);
  const roundedLongestTurningRunDegrees = rounded(longestTurningRunDegrees);
  const loopOrientationChangeDegrees = rounded(Math.abs(wrappedAngularDelta(
    state.frames.at(-1)[3],
    state.frames[0][3],
  )));
  const loopOrientationDegrees = normalizedDegrees(state.frames[0][3]);
  return Object.freeze({
    schema: "cssmaze-prepared-rotation-score@2",
    seed: state.seed,
    stateCount,
    durationMilliseconds,
    totalAngularTravelDegrees: rounded(totalAngularTravelDegrees),
    turningFrameCount,
    turningFrameRatio: rounded(turningFrameCount / stateCount),
    turnEventCount,
    longestTurningRunFrameCount,
    longestTurningRunDurationMilliseconds:
      longestTurningRunFrameCount * (state.frameDelayMicroseconds / 1000),
    longestTurningRunDegrees: roundedLongestTurningRunDegrees,
    maximumConsecutiveQuarterTurnCount: Math.ceil(
      Math.max(0, roundedLongestTurningRunDegrees - 0.01) / 90,
    ),
    loopOrientationChangeDegrees,
    loopOrientationQuarterTurnCount: Math.round(loopOrientationChangeDegrees / 90),
    loopOrientationDegrees,
    quarterTurnCount,
    fullRotationEquivalentCount: rounded(quarterTurnCount / 4),
    angularDegreesPerSecond: rounded(totalAngularTravelDegrees / (durationMilliseconds / 1000)),
    runtimeScoring: false,
  });
}

export function scoreNativeCameraRotationSummary(summary) {
  if (summary?.schema !== "cssmaze-native-rotation-summary@1" ||
      !Number.isSafeInteger(summary.seed) || summary.seed <= 0 ||
      !Number.isSafeInteger(summary.stateCount) || summary.stateCount < 2 ||
      summary.frameDelayMicroseconds !== 20_000 ||
      !Number.isSafeInteger(summary.turningFrameCount) || summary.turningFrameCount < 0 ||
      summary.turningFrameCount > summary.stateCount - 1 ||
      !Number.isSafeInteger(summary.turnEventCount) || summary.turnEventCount < 0 ||
      summary.turnEventCount > summary.turningFrameCount ||
      !Number.isSafeInteger(summary.longestTurningRunFrameCount) ||
      summary.longestTurningRunFrameCount < 0 ||
      summary.longestTurningRunFrameCount > summary.turningFrameCount ||
      summary.completeTraversal !== true ||
      !Number.isFinite(summary.totalAngularTravelDegrees) || summary.totalAngularTravelDegrees < 0 ||
      !Number.isFinite(summary.longestTurningRunDegrees) || summary.longestTurningRunDegrees < 0 ||
      summary.longestTurningRunDegrees > summary.totalAngularTravelDegrees ||
      (summary.turningFrameCount === 0 &&
        (summary.turnEventCount !== 0 || summary.longestTurningRunFrameCount !== 0 ||
          summary.totalAngularTravelDegrees !== 0 || summary.longestTurningRunDegrees !== 0)) ||
      (summary.turningFrameCount > 0 &&
        (summary.turnEventCount === 0 || summary.longestTurningRunFrameCount === 0 ||
          summary.totalAngularTravelDegrees <= 0 || summary.longestTurningRunDegrees <= 0)) ||
      !Number.isFinite(summary.initialRotationDegrees) || summary.initialRotationDegrees < 0 ||
      !Number.isFinite(summary.finalRotationDegrees) || summary.finalRotationDegrees < 0) {
    throw new Error("cssMaze rotation scoring requires a valid native summary");
  }
  const durationMilliseconds = summary.stateCount * (summary.frameDelayMicroseconds / 1000);
  const totalAngularTravelDegrees = rounded(summary.totalAngularTravelDegrees);
  const longestTurningRunDegrees = rounded(summary.longestTurningRunDegrees);
  const loopOrientationChangeDegrees = rounded(Math.abs(wrappedAngularDelta(
    summary.finalRotationDegrees,
    summary.initialRotationDegrees,
  )));
  const loopOrientationDegrees = normalizedDegrees(summary.initialRotationDegrees);
  const quarterTurnCount = Math.round(totalAngularTravelDegrees / 90);
  return Object.freeze({
    schema: "cssmaze-prepared-rotation-score@2",
    seed: summary.seed,
    stateCount: summary.stateCount,
    durationMilliseconds,
    totalAngularTravelDegrees,
    turningFrameCount: summary.turningFrameCount,
    turningFrameRatio: rounded(summary.turningFrameCount / summary.stateCount),
    turnEventCount: summary.turnEventCount,
    longestTurningRunFrameCount: summary.longestTurningRunFrameCount,
    longestTurningRunDurationMilliseconds:
      summary.longestTurningRunFrameCount * (summary.frameDelayMicroseconds / 1000),
    longestTurningRunDegrees,
    maximumConsecutiveQuarterTurnCount: Math.ceil(
      Math.max(0, longestTurningRunDegrees - 0.01) / 90,
    ),
    loopOrientationChangeDegrees,
    loopOrientationQuarterTurnCount: Math.round(loopOrientationChangeDegrees / 90),
    loopOrientationDegrees,
    quarterTurnCount,
    fullRotationEquivalentCount: rounded(quarterTurnCount / 4),
    angularDegreesPerSecond: rounded(totalAngularTravelDegrees / (durationMilliseconds / 1000)),
    runtimeScoring: false,
  });
}

export function compareRotationScores(left, right) {
  return left.maximumConsecutiveQuarterTurnCount - right.maximumConsecutiveQuarterTurnCount ||
    left.quarterTurnCount - right.quarterTurnCount ||
    left.turningFrameRatio - right.turningFrameRatio ||
    left.angularDegreesPerSecond - right.angularDegreesPerSecond ||
    left.totalAngularTravelDegrees - right.totalAngularTravelDegrees ||
    left.seed - right.seed;
}

function wrappedAngularDelta(current, previous) {
  return ((current - previous + 540) % 360) - 180;
}

function normalizedDegrees(value) {
  const normalized = rounded(((value % 360) + 360) % 360);
  return normalized === 360 ? 0 : normalized;
}

function rounded(value) {
  return Number(value.toFixed(9));
}
