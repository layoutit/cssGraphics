import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function timelineStateIndexForTick(tick, playback) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssMaze tick must be a non-negative safe integer");
  return playback.loop
    ? playback.segmentStartState + ((tick - playback.segmentStartState) % playback.stateCount)
    : Math.min(playback.segmentEndState, Math.max(playback.segmentStartState, tick));
}

export async function createCssmazePreparedPlayer({ playback, worldRoot, wallRoot, visibilityLeaves, ...overrides }) {
  validatePlayback(playback, worldRoot, wallRoot, visibilityLeaves);
  const requestDelay = overrides.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = overrides.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = overrides.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const frameMilliseconds = playback.sourceFrameDelayMilliseconds;
  let paused = true;
  let tick = playback.initial.stateIndex;
  let delay = null;
  let nextFrameAt = null;
  let preparedStatesApplied = 0;
  let cameraTransformWrites = 0;
  let wallTransformWrites = 0;
  let leafVisibilityWrites = 0;
  let leafVisibilitySelections = 0;
  let runtimeLeafVisibilityComparisonCount = 0;
  let debugLeafVisibilityComparisonCount = 0;
  let cameraTransformIndex = playback.initial.cameraTransformIndex;
  let wallTransformIndex = playback.initial.wallTransformIndex;
  let leafVisibilityIndex = playback.initial.leafVisibilityIndex;
  let schedulerCallbackCount = 0;
  let loopCount = 0;
  let preparedLoopSnapCount = 0;
  let runtimeForcedStyleReadCount = 0;

  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: worldRoot,
      writeTransform(transform) {
        worldRoot.style.transform = transform;
        return true;
      },
    },
    shapes: [{
      element: wallRoot,
      writeTransform(transform) {
        wallRoot.style.transform = transform;
        return true;
      },
    }],
    leaves: [],
  });
  target.assertStableDomIdentity();

  function applyPreparedVisibilityOperations(operations) {
    for (const operation of operations) {
      const index = Math.abs(operation) - 1;
      visibilityLeaves[index].style.visibility = operation > 0 ? "" : "hidden";
      leafVisibilityWrites += 1;
    }
  }

  function applyDebugAbsoluteVisibility(visibilityIndex) {
    const visibility = playback.leafVisibilitySets[visibilityIndex];
    for (let index = 0; index < visibilityLeaves.length; index += 1) {
      debugLeafVisibilityComparisonCount += 1;
      const value = visibility[index] === "1" ? "" : "hidden";
      if (visibilityLeaves[index].style.visibility === value) continue;
      visibilityLeaves[index].style.visibility = value;
      leafVisibilityWrites += 1;
    }
  }

  function publish(stateIndex, visibilityMode = "sequential") {
    const row = playback.frameRows[stateIndex];
    if (cameraTransformIndex !== row[0]) {
      target.model.writeTransform(playback.cameraTransforms[row[0]]);
      cameraTransformIndex = row[0];
      cameraTransformWrites += 1;
    }
    if (wallTransformIndex !== row[1]) {
      target.shapes[0].writeTransform(playback.wallTransforms[row[1]]);
      wallTransformIndex = row[1];
      wallTransformWrites += 1;
    }
    if (leafVisibilityIndex !== row[2]) {
      if (visibilityMode === "absolute") applyDebugAbsoluteVisibility(row[2]);
      else applyPreparedVisibilityOperations(playback.leafVisibilityChangeRows[stateIndex]);
      leafVisibilityIndex = row[2];
      leafVisibilitySelections += 1;
    }
    tick = stateIndex;
    preparedStatesApplied += 1;
    return tick;
  }

  function advanceOne() {
    if (tick >= playback.segmentEndState) {
      if (!playback.loop) {
        paused = true;
        return tick;
      }
      loopCount += 1;
      const transitionProperty = worldRoot.style.transitionProperty;
      worldRoot.style.transitionProperty = "none";
      const result = publish(playback.segmentStartState);
      getComputedStyle(worldRoot).transform;
      runtimeForcedStyleReadCount += 1;
      worldRoot.style.transitionProperty = transitionProperty;
      preparedLoopSnapCount += 1;
      return result;
    }
    return publish(tick + 1);
  }

  function scheduleNextDraw() {
    if (paused || delay !== null) return;
    const wait = Math.max(0, nextFrameAt - readNow());
    delay = requestDelay(loop, wait);
  }

  function loop() {
    delay = null;
    schedulerCallbackCount += 1;
    if (paused) return;
    advanceOne();
    nextFrameAt += frameMilliseconds;
    const now = readNow();
    if (nextFrameAt <= now) nextFrameAt = now + frameMilliseconds;
    scheduleNextDraw();
  }

  applyPreparedVisibilityOperations(playback.initialLeafVisibilityChanges);
  if (playback.initialLeafVisibilityChanges.length > 0) leafVisibilitySelections += 1;
  preparedStatesApplied += 1;
  return Object.freeze({
    get tick() { return tick; },
    get paused() { return paused; },
    pause() {
      paused = true;
      nextFrameAt = null;
      if (delay !== null) cancelDelay(delay);
      delay = null;
      return tick;
    },
    resume() {
      if (!paused) return tick;
      paused = false;
      nextFrameAt = readNow() + frameMilliseconds;
      scheduleNextDraw();
      return tick;
    },
    step(count = 1) {
      this.pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("cssMaze step count must be positive");
      for (let index = 0; index < amount; index += 1) advanceOne();
      return tick;
    },
    setTick(value) {
      this.pause();
      return publish(timelineStateIndexForTick(Math.trunc(Number(value)), playback), "absolute");
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      return true;
    },
    stats() {
      target.assertStableDomIdentity();
      return Object.freeze({
        schema: "cssmaze-prepared-player-stats@1",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        tick,
        sourceFrameDelayMilliseconds: frameMilliseconds,
        preparedCompositorInterpolation: playback.preparedCompositorInterpolation,
        preparedCompositorInterpolationMilliseconds: playback.preparedCompositorInterpolationMilliseconds,
        runtimeCameraInterpolationCalculationCount: 0,
        preparedLoopSnapCount,
        runtimeForcedStyleReadCount,
        preparedTimelineStateCount: playback.stateCount,
        preparedCameraTransformCount: playback.cameraTransforms.length,
        preparedWallTransformCount: playback.wallTransforms.length,
        preparedStatesApplied,
        runtimeCameraTransformWrites: cameraTransformWrites,
        runtimeWallTransformWrites: wallTransformWrites,
        runtimeLeafVisibilityWrites: leafVisibilityWrites,
        runtimeLeafVisibilityComparisonCount,
        debugLeafVisibilityComparisonCount,
        preparedLeafVisibilitySelections: leafVisibilitySelections,
        runtimeSchedulerCallbackCount: schedulerCallbackCount,
        runtimeTimerCallbackCount: schedulerCallbackCount,
        runtimeAnimationFrameCallbackCount: 0,
        deterministicSeedReplayLoopCount: loopCount,
        runtimeGeometryConstructionCount: 0,
        runtimeMazeGenerationCount: 0,
        runtimeCameraCalculationCount: 0,
        runtimeVisibilityCalculationCount: 0,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      this.pause();
    },
  });
}

function validatePlayback(playback, worldRoot, wallRoot, visibilityLeaves) {
  if (playback?.schema !== "cssmaze-prepared-playback@1" ||
      !(worldRoot instanceof HTMLElement) || !(wallRoot instanceof HTMLElement) ||
      !Array.isArray(visibilityLeaves) || visibilityLeaves.some((leaf) => !(leaf instanceof HTMLElement)) ||
      !Array.isArray(playback.cameraTransforms) || playback.cameraTransforms.length < 1 ||
      !Array.isArray(playback.wallTransforms) || playback.wallTransforms.length < 1 ||
      !Array.isArray(playback.leafVisibilitySets) || playback.leafVisibilitySets.length < 1 ||
      playback.leafVisibilitySets.some((set) => typeof set !== "string" || set.length !== visibilityLeaves.length || /[^01]/u.test(set)) ||
      !validVisibilityOperations(playback.initialLeafVisibilityChanges, visibilityLeaves.length) ||
      !Array.isArray(playback.leafVisibilityChangeRows) ||
      playback.leafVisibilityChangeRows.length !== playback.stateCount ||
      playback.leafVisibilityChangeRows.some((row) => !validVisibilityOperations(row, visibilityLeaves.length)) ||
      !Array.isArray(playback.frameRows) || playback.frameRows.length !== playback.stateCount ||
      playback.segmentStartState !== 0 || playback.segmentEndState !== playback.stateCount - 1 ||
      playback.preparedCompositorInterpolation !== true ||
      playback.preparedCompositorInterpolationMilliseconds !== playback.sourceFrameDelayMilliseconds ||
      playback.preparedCompositorTimingFunction !== "linear" ||
      playback.preparedLoopResetTransition !== "instant" ||
      !(playback.sourceFrameDelayMilliseconds > 0)) {
    throw new Error("Prepared cssMaze playback contract is invalid");
  }
}

function validVisibilityOperations(operations, leafCount) {
  return Array.isArray(operations) && operations.every((operation) =>
    Number.isSafeInteger(operation) && operation !== 0 && Math.abs(operation) <= leafCount);
}
