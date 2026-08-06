import {
  CSSFLOWER_SOURCE_PROFILE,
  FLOAT,
  floatBits,
  floatHex,
  preparedRootTransform,
} from "./sourceProfile.mjs";

export function buildPreparedBloomCycle() {
  const bloom = CSSFLOWER_SOURCE_PROFILE.bloom;
  let sf = FLOAT(bloom.resetSf);
  let sfi = FLOAT(bloom.sfIncrement);
  const min = FLOAT(bloom.minSf);
  const max = FLOAT(bloom.maxSf);
  const seen = new Map();
  const states = [];

  while (states.length < 10_000) {
    const key = `${floatBits(sf)}:${floatBits(sfi)}`;
    if (seen.has(key)) {
      const cycleStartState = seen.get(key);
      const geometryBySf = new Map();
      const geometryStates = [];
      for (const state of states) {
        const sfKey = floatBits(state.sf);
        let geometryStateIndex = geometryBySf.get(sfKey);
        if (geometryStateIndex === undefined) {
          geometryStateIndex = geometryStates.length;
          geometryBySf.set(sfKey, geometryStateIndex);
          geometryStates.push(Object.freeze({
            index: geometryStateIndex,
            sf: state.sf,
            sfHex: state.sfHex,
            firstTick: state.tick,
          }));
        }
        state.geometryStateIndex = geometryStateIndex;
      }
      const rootTransforms = Object.freeze(Array.from({ length: 360 }, (_, tick) =>
        preparedRootTransform(
          tick * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate,
          tick * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate,
        )));
      return Object.freeze({
        schema: "cssflower-prepared-bloom-cycle@1",
        initialState: 0,
        stateCount: states.length,
        cycleStartState,
        cycleLength: states.length - cycleStartState,
        repeatKey: key,
        geometryStateCount: geometryStates.length,
        geometryStates: Object.freeze(geometryStates),
        rootStateCount: rootTransforms.length,
        rootTransforms,
        states: Object.freeze(states.map((state) => Object.freeze(state))),
      });
    }
    const tick = states.length;
    seen.set(key, tick);
    states.push({
      tick,
      sf,
      sfHex: floatHex(sf),
      sfi,
      sfiHex: floatHex(sfi),
      rotationXDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate,
      rotationYDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate,
      rotationZDegrees: 0,
      rootStateIndex: tick % 360,
      geometryStateIndex: -1,
    });
    sf = FLOAT(sf + sfi);
    if (sf > max || sf < min) sfi = FLOAT(-sfi);
  }
  throw new Error("cssFlower bloom state failed to enter a repeatable binary32 cycle");
}

export function buildPreparedFullRotationCycle() {
  const bloomCycle = buildPreparedBloomCycle();
  const combinedCycleLength = leastCommonMultiple(
    bloomCycle.cycleLength,
    bloomCycle.rootStateCount,
  );
  const stateCount = bloomCycle.cycleStartState + combinedCycleLength;
  const states = Array.from({ length: stateCount }, (_, tick) => {
    const bloomStateIndex = tick < bloomCycle.stateCount
      ? tick
      : bloomCycle.cycleStartState + ((tick - bloomCycle.cycleStartState) % bloomCycle.cycleLength);
    const bloomState = bloomCycle.states[bloomStateIndex];
    return Object.freeze({
      ...bloomState,
      tick,
      bloomStateIndex,
      rotationXDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate,
      rotationYDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate,
      rotationZDegrees: 0,
      rootStateIndex: tick % bloomCycle.rootStateCount,
    });
  });
  const repeatState = states[bloomCycle.cycleStartState];
  return Object.freeze({
    schema: "cssflower-prepared-full-rotation-cycle@1",
    initialState: 0,
    stateCount,
    cycleStartState: bloomCycle.cycleStartState,
    cycleLength: combinedCycleLength,
    repeatKey: `${floatBits(repeatState.sf)}:${floatBits(repeatState.sfi)}:${repeatState.rootStateIndex}`,
    bloomTraceStateCount: bloomCycle.stateCount,
    bloomCycleStartState: bloomCycle.cycleStartState,
    bloomCycleLength: bloomCycle.cycleLength,
    geometryStateCount: bloomCycle.geometryStateCount,
    geometryStates: bloomCycle.geometryStates,
    rootStateCount: bloomCycle.rootStateCount,
    rootTransforms: bloomCycle.rootTransforms,
    states: Object.freeze(states),
  });
}

function leastCommonMultiple(left, right) {
  return left / greatestCommonDivisor(left, right) * right;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
