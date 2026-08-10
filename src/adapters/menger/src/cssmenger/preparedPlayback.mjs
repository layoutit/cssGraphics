export const COLOR_PUBLICATION_INTERVAL_TICKS = 3;

export function timelineStateIndexForTick(tick, playback) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssMenger tick must be a non-negative safe integer");
  return playback.loop
    ? playback.segmentStartState + ((tick - playback.segmentStartState) % playback.stateCount)
    : Math.min(playback.segmentEndState, Math.max(playback.segmentStartState, tick));
}

export function createCssmengerPreparedPlayer({ playback, planeAtlas, publicationRoot, leaves, ...overrides }) {
  validatePlayback(playback, planeAtlas, publicationRoot, leaves);
  const requestFrame = overrides.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = overrides.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const requestDelay = overrides.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = overrides.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = overrides.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const frameMilliseconds = playback.sourceFrameDelayMilliseconds;
  const schedulerLeadMilliseconds = Math.min(4, frameMilliseconds / 4);
  let paused = true;
  let tick = playback.initial.stateIndex;
  let animationFrame = null;
  let delay = null;
  let nextFrameAt = null;

  function publishAxisColor(stateIndex, axis) {
    const backgroundPositionY = planeAtlas.paletteBackgroundPositionYs[playback.colorRows[stateIndex][axis]];
    const schedule = playback.frontFacingSchedule;
    const segmentIndex = stateIndex * schedule.axisCount + axis;
    const start = schedule.offsets[segmentIndex];
    const end = schedule.offsets[segmentIndex + 1];
    for (let index = start; index < end; index += 1) {
      leaves[schedule.leafIndices[index]].style.backgroundPositionY = backgroundPositionY;
    }
    return { scheduleStart: start, backgroundPositionY, targetCount: end - start };
  }

  function publishInitial(stateIndex) {
    publicationRoot.style.transform = playback.transforms[stateIndex];
    const colorRow = playback.colorRows[stateIndex];
    const leavesPerAxis = planeAtlas.leafCount / 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const backgroundPositionY = planeAtlas.paletteBackgroundPositionYs[colorRow[axis]];
      const end = (axis + 1) * leavesPerAxis;
      for (let leafIndex = axis * leavesPerAxis; leafIndex < end; leafIndex += 1) {
        leaves[leafIndex].style.backgroundPositionY = backgroundPositionY;
      }
    }
    tick = stateIndex;
    return tick;
  }

  function publishAdjacentFast(stateIndex) {
    const transform = playback.transforms[stateIndex];
    publicationRoot.style.transform = transform;
    if ((stateIndex - playback.segmentStartState) % COLOR_PUBLICATION_INTERVAL_TICKS === 0) {
      for (let axis = 0; axis < 3; axis += 1) publishAxisColor(stateIndex, axis);
    }
    tick = stateIndex;
    return tick;
  }

  function publish(stateIndex, profile = null, adjacentState = false) {
    const publicationStartedAt = profile ? readNow() : 0;
    const transform = playback.transforms[stateIndex];
    const transformResolvedAt = profile ? readNow() : 0;
    const previousTransform = playback.transforms[tick];
    const transformComparedAt = profile ? readNow() : 0;
    const transformChanged = adjacentState || previousTransform !== transform;
    if (transformChanged) {
      publicationRoot.style.transform = transform;
    }
    const transformPublishedAt = profile ? readNow() : 0;
    const colorRow = playback.colorRows[stateIndex];
    const colorRowResolvedAt = profile ? readNow() : 0;
    const axisPublications = profile ? [] : null;
    let lastAxisPublishedAt = colorRowResolvedAt;
    for (let axis = 0; axis < 3; axis += 1) {
      const axisStartedAt = profile ? readNow() : 0;
      const previousBackgroundPositionY = planeAtlas.paletteBackgroundPositionYs[playback.colorRows[tick][axis]];
      const axisComparedAt = profile ? readNow() : 0;
      const axisChanged = adjacentState || tick !== stateIndex;
      const publication = axisChanged
        ? publishAxisColor(stateIndex, axis)
        : {
            scheduleStart: playback.frontFacingSchedule.offsets[
              stateIndex * playback.frontFacingSchedule.axisCount + axis
            ],
            backgroundPositionY: previousBackgroundPositionY,
            targetCount: 0,
          };
      const axisPublishedAt = profile ? readNow() : 0;
      lastAxisPublishedAt = axisPublishedAt;
      if (profile) {
        axisPublications.push(Object.freeze({
          axis,
          paletteIndex: colorRow[axis],
          previousBackgroundPositionY,
          backgroundPositionY: publication.backgroundPositionY,
          scheduleStart: publication.scheduleStart,
          targetCount: publication.targetCount,
          changed: axisChanged,
          resolveAndCompareMilliseconds: axisComparedAt - axisStartedAt,
          conditionalStyleWriteMilliseconds: axisPublishedAt - axisComparedAt,
          totalMilliseconds: axisPublishedAt - axisStartedAt,
        }));
      }
    }
    tick = stateIndex;
    if (profile) {
      const publicationCompletedAt = readNow();
      Object.assign(profile, {
        schema: "cssmenger-profiled-publication@1",
        stateIndex,
        modelTransform: Object.freeze({
          previous: previousTransform,
          next: transform,
          changed: transformChanged,
          preparedLookupMilliseconds: transformResolvedAt - publicationStartedAt,
          comparisonMilliseconds: transformComparedAt - transformResolvedAt,
          conditionalStyleWriteMilliseconds: transformPublishedAt - transformComparedAt,
        }),
        colorRow: Object.freeze([...colorRow]),
        colorRowLookupMilliseconds: colorRowResolvedAt - transformPublishedAt,
        axes: Object.freeze(axisPublications),
        bookkeepingMilliseconds: publicationCompletedAt - lastAxisPublishedAt,
        totalPublicationMilliseconds: publicationCompletedAt - publicationStartedAt,
      });
    }
    return tick;
  }

  function advanceOne() {
    return advancePreparedStates(1);
  }

  function advancePreparedStates(count) {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError("cssMenger prepared advance count must be positive");
    }
    if (!playback.loop && tick >= playback.segmentEndState) {
      paused = true;
      return tick;
    }
    const stateIndex = playback.loop
      ? playback.segmentStartState + ((tick - playback.segmentStartState + count) % playback.stateCount)
      : Math.min(playback.segmentEndState, tick + count);
    if (stateIndex !== tick) publishAdjacentFast(stateIndex);
    if (!playback.loop && tick >= playback.segmentEndState) paused = true;
    return tick;
  }

  function advanceOneProfiled(profile) {
    if (tick >= playback.segmentEndState) {
      if (!playback.loop) {
        paused = true;
        return tick;
      }
      return publish(playback.segmentStartState, profile, true);
    }
    return publish(tick + 1, profile, true);
  }

  function scheduleNextDraw() {
    if (paused || animationFrame !== null || delay !== null) return;
    const wait = Math.max(0, nextFrameAt - readNow() - schedulerLeadMilliseconds);
    if (wait <= 1) {
      animationFrame = requestFrame(loopFast);
      return;
    }
    delay = requestDelay(() => {
      delay = null;
      if (!paused) animationFrame = requestFrame(loopFast);
    }, wait);
  }

  function loopFast(timestamp) {
    animationFrame = null;
    if (paused) return;
    const elapsedSteps = Math.max(1, Math.floor((timestamp - nextFrameAt) / frameMilliseconds) + 1);
    advancePreparedStates(elapsedSteps);
    if (paused) return;
    nextFrameAt += elapsedSteps * frameMilliseconds;
    scheduleNextDraw();
  }

  publishInitial(playback.initial.stateIndex);
  return Object.freeze({
    get tick() { return tick; },
    get paused() { return paused; },
    pause() {
      paused = true;
      nextFrameAt = null;
      if (animationFrame !== null) cancelFrame(animationFrame);
      if (delay !== null) cancelDelay(delay);
      animationFrame = null;
      delay = null;
      return tick;
    },
    resume() {
      if (!paused || tick >= playback.segmentEndState) return tick;
      paused = false;
      nextFrameAt = readNow() + frameMilliseconds;
      scheduleNextDraw();
      return tick;
    },
    step(count = 1) {
      this.pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("cssMenger step count must be positive");
      for (let index = 0; index < amount; index += 1) advanceOne();
      return tick;
    },
    profileStep() {
      this.pause();
      const before = Object.freeze({
        tick,
      });
      const publication = {};
      advanceOneProfiled(publication);
      return Object.freeze({
        ...publication,
        before,
        after: Object.freeze({
          tick,
        }),
      });
    },
    setTick(value) {
      this.pause();
      return publish(timelineStateIndexForTick(Math.trunc(Number(value)), playback));
    },
    stats() {
      return Object.freeze({
        schema: "cssmenger-prepared-player-stats@1",
        paused,
        tick,
        sourceFrameDelayMilliseconds: frameMilliseconds,
        preparedTimelineStateCount: playback.stateCount,
        preparedPaletteColorCount: playback.palette.length,
        runtimeInstrumentationEnabled: false,
        preparedStatesApplied: null,
        runtimeModelTransformWrites: null,
        runtimeAxisColorWrites: null,
        runtimeSchedulerCallbackCount: null,
        runtimeHotPathDomStyleReadCount: 0,
        runtimeAdjacentPublicationComparisonCount: 0,
        runtimeHotPathProfilingBranchCount: 0,
        runtimeHotPathDebugCounterWritesPerScheduledTick: 0,
        preparedSchedulerCatchUpMode: "coalesced-latest-prepared-state",
        preparedColorPublicationIntervalTicks: COLOR_PUBLICATION_INTERVAL_TICKS,
        preparedColorPublicationDelayMilliseconds: frameMilliseconds * COLOR_PUBLICATION_INTERVAL_TICKS,
        preparedColorPublicationMode: "fixed-prepared-source-state-interval",
        preparedFrontFacingAxisSelectionsPerScheduledTick: Object.freeze({
          minimum: 0,
          maximum: 3,
          nominalAverage: 3 / COLOR_PUBLICATION_INTERVAL_TICKS,
        }),
        preparedFrontFacingLeafWritesPerScheduledTick: Object.freeze({
          minimum: 0,
          maximum: playback.frontFacingSchedule.maximumSelectedLeafCountPerState,
          nominalAverage: playback.frontFacingSchedule.averageSelectedLeafCountPerState /
            COLOR_PUBLICATION_INTERVAL_TICKS,
        }),
        preparedFrontFacingLeafWritesPerColorPublication: Object.freeze({
          minimum: playback.frontFacingSchedule.minimumSelectedLeafCountPerState,
          maximum: playback.frontFacingSchedule.maximumSelectedLeafCountPerState,
          average: playback.frontFacingSchedule.averageSelectedLeafCountPerState,
        }),
        preparedAdjacentPublicationMode: playback.adjacentPublicationMode,
        runtimeGeometryConstructionCount: 0,
        runtimeRecursionCount: 0,
        runtimeMergeCount: 0,
        runtimeColorGenerationCount: 0,
        runtimeRotationCalculationCount: 0,
        runtimeCameraCalculationCount: 0,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      this.pause();
    },
  });
}

function validatePlayback(playback, planeAtlas, publicationRoot, leaves) {
  if (playback?.schema !== "cssmenger-prepared-playback@1" ||
      !(publicationRoot instanceof HTMLElement) ||
      !Array.isArray(leaves) || leaves.length !== planeAtlas?.leafCount ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement)) ||
      !Array.isArray(playback.transforms) || playback.transforms.length !== playback.stateCount ||
      !Array.isArray(playback.colorRows) || playback.colorRows.length !== playback.stateCount ||
      playback.colorRows.some((row) => !Array.isArray(row) || row.length !== 3) ||
      !Array.isArray(playback.palette) || playback.palette.length !== 128 ||
      playback.frontFacingSchedule?.schema !== "cssmenger-prepared-front-facing-leaf-schedule@1" ||
      playback.frontFacingSchedule.encoding !== "state-axis-offsets-plus-global-leaf-indices" ||
      playback.frontFacingSchedule.stateCount !== playback.stateCount ||
      playback.frontFacingSchedule.axisCount !== 3 ||
      playback.frontFacingSchedule.frontFaceDilationTicks !== 1 ||
      playback.frontFacingSchedule.offsets?.length !== playback.stateCount * 3 + 1 ||
      playback.frontFacingSchedule.offsets[0] !== 0 ||
      playback.frontFacingSchedule.offsets.at(-1) !== playback.frontFacingSchedule.leafIndices?.length ||
      playback.frontFacingSchedule.offsets.some((offset, index, offsets) =>
        !Number.isSafeInteger(offset) || offset < 0 || (index > 0 && offset < offsets[index - 1])) ||
      playback.frontFacingSchedule.leafIndices.some((leafIndex) =>
        !Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= planeAtlas.leafCount) ||
      playback.adjacentPublicationMode !== "all-fields-change" ||
      planeAtlas?.schema !== "cssmenger-prepared-coplanar-plane-atlas@1" ||
      planeAtlas.paletteStateCount !== playback.palette.length ||
      planeAtlas.paletteBackgroundPositionYs?.length !== playback.palette.length ||
      !(playback.sourceFrameDelayMilliseconds > 0)) {
    throw new Error("Prepared cssMenger playback contract is invalid");
  }
}
