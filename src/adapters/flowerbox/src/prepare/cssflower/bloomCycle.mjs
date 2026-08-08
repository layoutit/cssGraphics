import {
  CSSFLOWER_SOURCE_PROFILE,
  FLOAT,
  floatBits,
  floatHex,
  preparedRootTransform,
} from "./sourceProfile.mjs";

export const CSSFLOWER_PRODUCT_BLOOM_PEAK_GEOMETRY_STATE = 49;
export const CSSFLOWER_PRODUCT_BLOOM_PEAK_SF_NOMINAL = 2.45;
export const CSSFLOWER_PRODUCT_BLOOM_MINIMUM_GEOMETRY_STATE = 72;
export const CSSFLOWER_PRODUCT_BLOOM_MINIMUM_SF_NOMINAL = -1.15;
export const CSSFLOWER_PRODUCT_BLOOM_SOURCE_PATH_LENGTH = 144;
export const CSSFLOWER_PRODUCT_BLOOM_CYCLE_LENGTH = 180;
export const CSSFLOWER_PRODUCT_ROTATION_CYCLE_LENGTH = 360;

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

export function buildPreparedRoundedProductCycle() {
  const sourceBloom = buildPreparedBloomCycle();
  const peakGeometryStateIndex = CSSFLOWER_PRODUCT_BLOOM_PEAK_GEOMETRY_STATE;
  const positiveGeometryStates = sourceBloom.geometryStates.slice(0, peakGeometryStateIndex + 1);
  const firstNegativeDescentStateIndex = sourceBloom.states.findIndex(
    (state) => state.sf < 0 && state.sfi < 0,
  );
  const negativeDescentSourceStates = [];
  for (let index = firstNegativeDescentStateIndex; index < sourceBloom.states.length; index += 1) {
    const state = sourceBloom.states[index];
    if (state.sf >= 0) break;
    negativeDescentSourceStates.push(state);
    if (state.sfi > 0) break;
  }
  const negativeGeometryStates = negativeDescentSourceStates.map((state, index) => Object.freeze({
    index: positiveGeometryStates.length + index,
    sf: state.sf,
    sfHex: state.sfHex,
    firstTick: state.tick,
    sourceGeometryStateIndex: state.geometryStateIndex,
  }));
  const geometryStates = Object.freeze([
    ...positiveGeometryStates,
    ...negativeGeometryStates,
  ]);
  const sourcePathGeometryStateIndices = Object.freeze([
    ...Array.from({ length: peakGeometryStateIndex + 1 }, (_, index) => index),
    ...Array.from({ length: peakGeometryStateIndex }, (_, index) => peakGeometryStateIndex - 1 - index),
    ...negativeGeometryStates.map((state) => state.index),
    ...negativeGeometryStates.slice(0, -1).reverse().map((state) => state.index),
  ]);
  if (sourcePathGeometryStateIndices.length !== CSSFLOWER_PRODUCT_BLOOM_SOURCE_PATH_LENGTH ||
      geometryStates.length !== CSSFLOWER_PRODUCT_BLOOM_MINIMUM_GEOMETRY_STATE + 1 ||
      geometryStates[peakGeometryStateIndex]?.sfHex !== "401cccc8" ||
      geometryStates.at(-1)?.sfHex !== "bf933332") {
    throw new Error("cssFlower rounded product bloom contract drifted");
  }

  const sourceIncrement = Math.fround(CSSFLOWER_SOURCE_PROFILE.bloom.sfIncrement);
  const states = Array.from({ length: CSSFLOWER_PRODUCT_ROTATION_CYCLE_LENGTH }, (_, tick) => {
    const productBloomPhaseIndex = tick % CSSFLOWER_PRODUCT_BLOOM_CYCLE_LENGTH;
    const sourcePathPhaseIndex = productBloomPhaseIndex <= peakGeometryStateIndex
      ? productBloomPhaseIndex
      : peakGeometryStateIndex + 1 + Math.floor(
        (productBloomPhaseIndex - peakGeometryStateIndex - 1) *
        (CSSFLOWER_PRODUCT_BLOOM_SOURCE_PATH_LENGTH - peakGeometryStateIndex - 1) /
        (CSSFLOWER_PRODUCT_BLOOM_CYCLE_LENGTH - peakGeometryStateIndex - 1),
      );
    const geometryStateIndex = sourcePathGeometryStateIndices[sourcePathPhaseIndex];
    const geometryState = geometryStates[geometryStateIndex];
    const minimumSourcePathPhaseIndex = CSSFLOWER_PRODUCT_BLOOM_SOURCE_PATH_LENGTH -
      negativeGeometryStates.length;
    const sfi = Math.fround(sourcePathPhaseIndex < peakGeometryStateIndex ||
      sourcePathPhaseIndex >= minimumSourcePathPhaseIndex
      ? sourceIncrement
      : -sourceIncrement);
    return Object.freeze({
      tick,
      sf: geometryState.sf,
      sfHex: geometryState.sfHex,
      sfi,
      sfiHex: floatHex(sfi),
      rotationXDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate,
      rotationYDegrees: tick * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate,
      rotationZDegrees: 0,
      rootStateIndex: tick,
      geometryStateIndex,
      bloomStateIndex: productBloomPhaseIndex,
      productBloomPhaseIndex,
      sourcePathPhaseIndex,
    });
  });

  return Object.freeze({
    schema: "cssflower-prepared-rounded-product-cycle@2",
    scope: "source-derived-rounded-positive-petals-omitted-negative-cube-lobe-retained",
    initialState: 0,
    stateCount: CSSFLOWER_PRODUCT_ROTATION_CYCLE_LENGTH,
    cycleStartState: 0,
    cycleLength: CSSFLOWER_PRODUCT_ROTATION_CYCLE_LENGTH,
    repeatKey: `${floatBits(states[0].sf)}:${floatBits(states[0].sfi)}:${states[0].rootStateIndex}`,
    bloomTraceStateCount: CSSFLOWER_PRODUCT_BLOOM_CYCLE_LENGTH,
    bloomCycleStartState: 0,
    bloomCycleLength: CSSFLOWER_PRODUCT_BLOOM_CYCLE_LENGTH,
    bloomPeakGeometryStateIndex: peakGeometryStateIndex,
    bloomPeakSf: geometryStates[peakGeometryStateIndex].sf,
    bloomPeakSfHex: geometryStates[peakGeometryStateIndex].sfHex,
    bloomPeakSfNominal: CSSFLOWER_PRODUCT_BLOOM_PEAK_SF_NOMINAL,
    bloomMinimumGeometryStateIndex: CSSFLOWER_PRODUCT_BLOOM_MINIMUM_GEOMETRY_STATE,
    bloomMinimumSf: geometryStates[CSSFLOWER_PRODUCT_BLOOM_MINIMUM_GEOMETRY_STATE].sf,
    bloomMinimumSfHex: geometryStates[CSSFLOWER_PRODUCT_BLOOM_MINIMUM_GEOMETRY_STATE].sfHex,
    bloomMinimumSfNominal: CSSFLOWER_PRODUCT_BLOOM_MINIMUM_SF_NOMINAL,
    bloomSourcePathLength: CSSFLOWER_PRODUCT_BLOOM_SOURCE_PATH_LENGTH,
    bloomPacing: "source-exact-opening-then-evenly-held-source-step-path-to-180-states",
    omittedSourceSfAtOrAbove: 2.5,
    geometryStateCount: geometryStates.length,
    geometryStates,
    rootStateCount: sourceBloom.rootStateCount,
    rootTransforms: sourceBloom.rootTransforms,
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
