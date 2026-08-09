export function scoreNativeCameraRotation(state) {
  if (!Array.isArray(state?.frames) || state.frames.length < 2) {
    throw new Error("cssMaze rotation scoring requires a prepared native camera trace");
  }
  let totalAngularTravelDegrees = 0;
  let turningFrameCount = 0;
  let turnEventCount = 0;
  let wasTurning = false;
  for (let index = 1; index < state.frames.length; index += 1) {
    const previous = state.frames[index - 1][3];
    const current = state.frames[index][3];
    const delta = wrappedAngularDelta(current, previous);
    const turning = Math.abs(delta) > 0.000001;
    totalAngularTravelDegrees += Math.abs(delta);
    if (turning) turningFrameCount += 1;
    if (turning && !wasTurning) turnEventCount += 1;
    wasTurning = turning;
  }
  const stateCount = state.frames.length;
  const durationMilliseconds = stateCount * (state.frameDelayMicroseconds / 1000);
  return Object.freeze({
    schema: "cssmaze-prepared-rotation-score@1",
    seed: state.seed,
    stateCount,
    durationMilliseconds,
    totalAngularTravelDegrees: rounded(totalAngularTravelDegrees),
    turningFrameCount,
    turningFrameRatio: rounded(turningFrameCount / stateCount),
    turnEventCount,
    angularDegreesPerSecond: rounded(totalAngularTravelDegrees / (durationMilliseconds / 1000)),
    runtimeScoring: false,
  });
}

export function compareRotationScores(left, right) {
  return left.turningFrameRatio - right.turningFrameRatio ||
    left.angularDegreesPerSecond - right.angularDegreesPerSecond ||
    left.totalAngularTravelDegrees - right.totalAngularTravelDegrees ||
    left.seed - right.seed;
}

function wrappedAngularDelta(current, previous) {
  return ((current - previous + 540) % 360) - 180;
}

function rounded(value) {
  return Number(value.toFixed(9));
}
