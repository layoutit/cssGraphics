import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function timelineStateIndexForTick(tick, playback) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssGears tick must be a non-negative safe integer");
  if (playback.loop) {
    return playback.segmentStartState + ((tick - playback.segmentStartState) % playback.stateCount);
  }
  return Math.min(playback.segmentEndState, Math.max(playback.segmentStartState, tick));
}

export async function createCssgearsPreparedPlayer(options) {
  const { modelRoot } = options;
  const playbacks = [...(options.playbacks ?? [options.playback])];
  const lightings = [...(options.lightings ?? [options.lighting])];
  const bankTokens = [...(options.bankTokens ?? playbacks.map(() => null))];
  const gearRoots = [...options.gearRoots];
  if (playbacks.length !== lightings.length || playbacks.length !== bankTokens.length ||
      playbacks.length < 1 || playbacks.length > 24 ||
      (playbacks.length > 1 && bankTokens.some((token) =>
        !/^[a-z]$/u.test(token) || token === "d" || token === "g"))) {
    throw new Error("Prepared cssGears player requires one source segment or one retained showreel bank");
  }
  for (let index = 0; index < playbacks.length; index += 1) {
    validatePlayback(playbacks[index], lightings[index], modelRoot, gearRoots);
  }
  const requestFrame = options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const requestDelay = options.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = options.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = options.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const frameMilliseconds = playbacks[0].sourceFrameDelayMilliseconds;
  const schedulerLeadMilliseconds = Math.min(4, frameMilliseconds / 4);
  const initialBankIndex = Number(options.initialBankIndex ?? 0);
  if (!Number.isSafeInteger(initialBankIndex) || initialBankIndex < 0 || initialBankIndex >= playbacks.length) {
    throw new RangeError("Prepared cssGears initial bank index is invalid");
  }
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  let activeBankIndex = initialBankIndex;
  let playback = playbacks[activeBankIndex];
  let lighting = lightings[activeBankIndex];
  const shapeTransformIndices = Uint32Array.from(playback.initial.shapeTransformIndices);
  let paused = true;
  let frame = null;
  let delay = null;
  let nextFrameAt = null;
  let globalTick = playback.initial.stateIndex;
  let preparedStatesApplied = 1;
  let logicalRowsEvaluated = 0;
  let preparedRowLookups = 0;
  let gearTransformComparisons = 0;
  let gearTransformWrites = 0;
  let physicalPublicationPasses = 0;
  let schedulerCallbackCount = 0;
  let schedulerNoopCallbackCount = 0;
  let schedulerDeadlineComparisonCount = 0;
  let schedulerRequestCount = 0;
  let schedulerCancelCount = 0;
  let schedulerDelayRequestCount = 0;
  let schedulerDelayCallbackCount = 0;
  let schedulerDelayCancelCount = 0;
  let schedulerTransitions = 0;
  let schedulerPostPublicationDelayScheduleCount = 0;
  let schedulerPostPublicationDeadlineResetCount = 0;
  let schedulerLateResetCount = 0;
  let bankSwitchCount = 0;
  let rootClassWrites = 0;
  let startupRootClassWrites = 0;
  let randomSelectionCount = 0;
  let shuffleBag = [];

  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: modelRoot,
      writeTransform() { return false; },
    },
    shapes: gearRoots.map((element) => ({
      element,
      writeTransform(transform) {
        if (element.style.transform === transform) return false;
        element.style.transform = transform;
        return true;
      },
    })),
    leaves: [],
  });
  target.assertStableDomIdentity();

  function activateBank(nextBankIndex) {
    activeBankIndex = nextBankIndex;
    playback = playbacks[activeBankIndex];
    lighting = lightings[activeBankIndex];
    shapeTransformIndices.set(playback.initial.shapeTransformIndices);
    globalTick = playback.initial.stateIndex;
    const bankToken = bankTokens[activeBankIndex];
    if (bankToken) {
      for (const root of gearRoots) {
        const nextClassName = `g ${bankToken}`;
        if (root.className === nextClassName) continue;
        root.className = nextClassName;
        rootClassWrites += 1;
      }
    }
    publishShapes();
    bankSwitchCount += 1;
    options.onBankChange?.(activeBankIndex);
  }

  function nextBankIndex() {
    if (playbacks.length === 1) return 0;
    if (shuffleBag.length === 0) {
      shuffleBag = playbacks.map((_, index) => index).filter((index) => index !== activeBankIndex);
      for (let index = shuffleBag.length - 1; index > 0; index -= 1) {
        const value = randomUint32();
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
          throw new RangeError("cssGears shuffled-bank random value must be uint32");
        }
        const swapIndex = value % (index + 1);
        [shuffleBag[index], shuffleBag[swapIndex]] = [shuffleBag[swapIndex], shuffleBag[index]];
        randomSelectionCount += 1;
      }
    }
    return shuffleBag.shift();
  }

  function publishShapes() {
    for (let shapeIndex = 0; shapeIndex < gearRoots.length; shapeIndex += 1) {
      gearTransformComparisons += 1;
      const transform = playback.transforms[shapeTransformIndices[shapeIndex]];
      if (target.shapes[shapeIndex].writeTransform(transform)) gearTransformWrites += 1;
    }
    physicalPublicationPasses += 1;
  }

  function applyLogicalRow(stateIndex) {
    const row = playback.frameRows[stateIndex];
    preparedRowLookups += 1;
    for (let index = 0; index < row[2]; index += 1) {
      const offset = (row[1] + index) * 2;
      const shapeIndex = playback.shapeChanges[offset];
      const transformIndex = playback.shapeChanges[offset + 1];
      shapeTransformIndices[shapeIndex] = transformIndex;
    }
    globalTick = stateIndex;
    logicalRowsEvaluated += 1;
    preparedStatesApplied += 1;
  }

  function advanceOne(publish) {
    if (globalTick >= playback.segmentEndState) {
      if (playbacks.length === 1) return globalTick;
      activateBank(nextBankIndex());
      return globalTick;
    }
    applyLogicalRow(globalTick + 1);
    if (publish) publishShapes();
    return globalTick;
  }

  function seek(targetTick) {
    const targetTickIndex = timelineStateIndexForTick(targetTick, playback);
    if (targetTickIndex <= globalTick) {
      shapeTransformIndices.set(playback.initial.shapeTransformIndices);
      globalTick = playback.initial.stateIndex;
    }
    while (globalTick < targetTickIndex) applyLogicalRow(globalTick + 1);
    publishShapes();
    return globalTick;
  }

  function requestPaintAlignedDraw() {
    frame = requestFrame(loop);
    schedulerRequestCount += 1;
  }

  function scheduleNextDraw() {
    if (paused || frame !== null || delay !== null) return;
    schedulerDeadlineComparisonCount += 1;
    const waitMilliseconds = Math.max(
      0,
      nextFrameAt - readNow() - schedulerLeadMilliseconds,
    );
    if (waitMilliseconds <= 1) {
      requestPaintAlignedDraw();
      return;
    }
    delay = requestDelay(() => {
      delay = null;
      schedulerDelayCallbackCount += 1;
      if (paused) return;
      requestPaintAlignedDraw();
    }, waitMilliseconds);
    schedulerDelayRequestCount += 1;
    schedulerPostPublicationDelayScheduleCount += 1;
  }

  function loop(timestamp) {
    frame = null;
    schedulerCallbackCount += 1;
    if (paused) {
      schedulerNoopCallbackCount += 1;
      return;
    }
    advanceOne(true);
    schedulerTransitions += 1;
    if (playbacks.length === 1 && globalTick >= playback.segmentEndState) {
      paused = true;
      return;
    }
    nextFrameAt += frameMilliseconds;
    if (nextFrameAt <= timestamp) {
      nextFrameAt = timestamp + frameMilliseconds;
      schedulerPostPublicationDeadlineResetCount += 1;
      schedulerLateResetCount += 1;
    }
    scheduleNextDraw();
  }

  const initialBankToken = bankTokens[activeBankIndex];
  if (initialBankToken) {
    for (const root of gearRoots) {
      const nextClassName = `g ${initialBankToken}`;
      if (root.className === nextClassName) continue;
      root.className = nextClassName;
      startupRootClassWrites += 1;
    }
  }
  publishShapes();
  return Object.freeze({
    get tick() { return globalTick; },
    get activeBankIndex() { return activeBankIndex; },
    get paused() { return paused; },
    pause() {
      paused = true;
      nextFrameAt = null;
      if (frame !== null) {
        cancelFrame(frame);
        schedulerCancelCount += 1;
      }
      frame = null;
      if (delay !== null) {
        cancelDelay(delay);
        schedulerDelayCancelCount += 1;
      }
      delay = null;
      return globalTick;
    },
    resume() {
      if (!paused || (playbacks.length === 1 && globalTick >= playback.segmentEndState)) return globalTick;
      paused = false;
      nextFrameAt = readNow() + frameMilliseconds;
      scheduleNextDraw();
      return globalTick;
    },
    step(count = 1) {
      this.pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("cssGears step count must be positive");
      for (let index = 0; index < amount; index += 1) advanceOne(true);
      return globalTick;
    },
    setTick(value) {
      this.pause();
      return seek(Math.trunc(Number(value)));
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      return true;
    },
    stats() {
      target.assertStableDomIdentity();
      return Object.freeze({
        schema: "cssgears-prepared-player-stats@14",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        playbackLayout: playback.layout,
        playbackPrecedent: "domformat@0/polycss-playback@0@7b853099",
        sourceScheduler: playback.sourceScheduler,
        runtimeSchedulerTransport: "deadline-setTimeout-requestAnimationFrame-prepared-publication",
        sourceFrameDelayMilliseconds: playback.sourceFrameDelayMilliseconds,
        sourceCatchUp: playback.sourceCatchUp,
        paused,
        globalTick,
        timelineStateIndex: globalTick,
        preparedTimelineStateCount: playback.stateCount,
        preparedTimelineLoop: playback.loop,
        preparedTimelineCloses: playback.closes,
        activeBankIndex,
        retainedSceneBankCount: playbacks.length,
        runtimePreparedBankSwitchCount: bankSwitchCount,
        runtimeRootClassWrites: rootClassWrites,
        startupRootClassWrites,
        runtimeRandomUint32Count: randomSelectionCount,
        runtimeRandomSelectionPurpose: "prepared-bank-index-only",
        preparedTransformTableCount: playback.transforms.length,
        preparedShapeChangeCount: playback.shapeChanges.length / 2,
        retainedAssemblyRootCount: 1,
        retainedGearRootCount: gearRoots.length,
        retainedLightingGroupCount: 0,
        retainedPlaybackLeafTargetCount: 0,
        preparedStatesApplied,
        runtimeLogicalRowsEvaluated: logicalRowsEvaluated,
        runtimePreparedRowLookups: preparedRowLookups,
        runtimePhysicalPublicationPasses: physicalPublicationPasses,
        runtimeAssemblyTransformComparisons: 0,
        runtimeGearTransformComparisons: gearTransformComparisons,
        runtimeAssemblyTransformWrites: 0,
        runtimeGearTransformWrites: gearTransformWrites,
        runtimeDirtyShapeSetCreations: 0,
        runtimeShapeIndexSorts: 0,
        runtimeLightingRowComparisons: 0,
        runtimeLightingRowWrites: 0,
        runtimeLightingPublicationCount: 0,
        preparedLightingAtlasStateCount: lightings.reduce((total, entry) => total + entry.atlasStateCount, 0),
        preparedLightingSourceStateCount: lighting.sourceStateCount,
        preparedLightingAtlasFaceCount: lightings.reduce((total, entry) => total + entry.faceCount, 0),
        preparedLightingAtlasDecodedBytes: lightings.reduce((total, entry) => total + entry.decodedBytes, 0),
        runtimeDatasetAttributeWrites: 0,
        mountStableDomIdentityChecks: 1,
        runtimeApplyStableDomIdentityChecks: 0,
        runtimeLeafTransformWrites: 0,
        runtimePerFrameLeafStyleWrites: 0,
        runtimeSchedulerCallbackCount: schedulerCallbackCount,
        runtimeSchedulerNoopCallbackCount: schedulerNoopCallbackCount,
        runtimeSchedulerDeadlineComparisonCount: schedulerDeadlineComparisonCount,
        runtimeSchedulerRequestCount: schedulerRequestCount,
        runtimeSchedulerCancelCount: schedulerCancelCount,
        runtimeSchedulerDelayRequestCount: schedulerDelayRequestCount,
        runtimeSchedulerDelayCallbackCount: schedulerDelayCallbackCount,
        runtimeSchedulerDelayCancelCount: schedulerDelayCancelCount,
        runtimeSchedulerStateTransitions: schedulerTransitions,
        runtimeSchedulerCatchUpPublicationCount: 0,
        runtimeSchedulerCoalescedLogicalTickCount: 0,
        runtimeSchedulerPostPublicationDeadlineResetCount: 0,
        runtimeSchedulerPostPublicationDelayScheduleCount: schedulerPostPublicationDelayScheduleCount,
        runtimeSchedulerSkippedPreparedStateCount: 0,
        runtimeSchedulerLateResetCount: 0,
        runtimeGeometryConstructionCount: 0,
        runtimeCameraCalculationCount: 0,
        runtimeRatioCalculationCount: 0,
        runtimeMeshingPhaseCalculationCount: 0,
        runtimeLightingCalculationCount: 0,
        runtimeDomGrowth: false,
      });
    },
    nodes() {
      return Object.freeze({ modelRoot, gearRoots: Object.freeze([...gearRoots]) });
    },
    destroy() {
      this.pause();
      target.destroy();
    },
  });
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

function validatePlayback(playback, lighting, modelRoot, gearRoots) {
  const sourceSegment = playback?.schema === "cssgears-prepared-playback@3" &&
    playback.precedent?.format === "domformat@0" &&
    playback.precedent?.commit === "7b853099ec089e43aefd547f237385b99fe746aa" &&
    playback.stateCount === 720 && playback.segmentEndState === 719 &&
    playback.assemblyTransformPublication === "prepared-folded-into-gear-root-transforms";
  const showreel = playback?.schema === "cssgears-prepared-showreel@1" &&
    playback.stateCount === 580 && playback.segmentEndState === 579 &&
    playback.switchPreparedBankAtEnd === true &&
    playback.phases?.entry?.stateCount === 40 &&
    playback.phases?.spin?.stateCount === 500 &&
    playback.phases?.spin?.durationMilliseconds === 15_000 &&
    playback.phases?.exit?.stateCount === 40 &&
    playback.runtimeInterpolation === false && playback.runtimeEasingCalculation === false;
  if ((!sourceSegment && !showreel) ||
      playback.layout !== "directly-indexed-shape-change-stream@1" ||
      Math.abs(playback.sourceTicksPerSecond - (100 / 3)) > 1e-12 ||
      playback.sourceFrameDelayMilliseconds !== 30 ||
      playback.sourceScheduler !== "xscreensaver-post-draw-delay-no-catch-up" ||
      playback.sourceCatchUp !== false ||
      playback.segmentStartState !== 0 || playback.loop !== false || playback.closes !== false ||
      playback.initial?.stateIndex !== 0 || playback.initial?.shapeTransformIndices?.length !== gearRoots.length ||
      playback.frameRows?.length !== playback.stateCount ||
      playback.shapeChanges?.length !== (playback.stateCount - 1) * gearRoots.length * 2 ||
      playback.transforms?.length !== playback.stateCount * gearRoots.length ||
      playback.retainedAssemblyRootCount !== 1 ||
      playback.retainedGearRootCount !== gearRoots.length || playback.retainedLeafTargetCount !== 0 ||
      lighting?.schema !== "cssgears-prepared-opengl-static-render-atlas@1" ||
      lighting.atlasStateCount !== 1 || lighting.sourceStateCount !== 720 ||
      lighting.canonicalSourceStateIndex !== 0 || !Number.isSafeInteger(lighting.faceCount) || lighting.faceCount < 1 ||
      lighting.sourceFaceCount !== lighting.faceCount ||
      lighting.leafCount !== lighting.leafRows?.length ||
      lighting.sourceFaceCoverageCount !== lighting.faceCount || lighting.sourceFaceCoverageExact !== true ||
      lighting.animatedFaceCount !== 0 || lighting.staticFaceCount !== lighting.faceCount ||
      lighting.animatedFaceIndices?.length !== 0 ||
      lighting.runtime?.lightingCalculations !== 0 || lighting.runtime?.perLeafStyleWrites !== 0 ||
      lighting.runtime?.stylesheetRuleWritesPerPublishedState !== 0 ||
      lighting.runtime?.backgroundPositionWritesPerPublishedState !== 0 ||
      lighting.runtime?.rootLightingRowDependentFaceCount !== 0 ||
      !(modelRoot instanceof HTMLElement) || gearRoots.length !== 3) {
    throw new Error("Complete DOMFormat-style source-bound cssGears playback segment is required");
  }
  for (let transformIndex = 0; transformIndex < playback.transforms.length; transformIndex += 1) {
    if (typeof playback.transforms[transformIndex] !== "string") {
      throw new Error(`Prepared cssGears transform ${transformIndex} is invalid`);
    }
  }
  let expectedShapeChangeOffset = 0;
  for (let stateIndex = 0; stateIndex < playback.frameRows.length; stateIndex += 1) {
    const row = playback.frameRows[stateIndex];
    if (!Array.isArray(row) || row.length !== 3 || row[0] !== stateIndex ||
        row[1] !== expectedShapeChangeOffset || !Number.isSafeInteger(row[2]) || row[2] < 0) {
      throw new Error(`Prepared cssGears frame row ${stateIndex} is not directly indexed`);
    }
    for (let index = 0; index < row[2]; index += 1) {
      const changeIndex = row[1] + index;
      const shapeIndex = playback.shapeChanges[changeIndex * 2];
      const transformIndex = playback.shapeChanges[changeIndex * 2 + 1];
      if (!Number.isSafeInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= gearRoots.length ||
          !Number.isSafeInteger(transformIndex) || transformIndex < 0 || transformIndex >= playback.transforms.length) {
        throw new Error(`Prepared cssGears shape change ${changeIndex} is invalid`);
      }
    }
    expectedShapeChangeOffset += row[2];
  }
  if (expectedShapeChangeOffset * 2 !== playback.shapeChanges.length ||
      lighting.leafRows.some((row) => !Array.isArray(row) || row.length !== 4 ||
        row.some((value) => !Number.isSafeInteger(value) || value < 0))) {
    throw new Error("Prepared cssGears indexed playback tables drifted");
  }
}
