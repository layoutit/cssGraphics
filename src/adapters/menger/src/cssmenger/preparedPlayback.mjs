export function timelineStateIndexForTick(tick, playback) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssMenger tick must be a non-negative safe integer");
  return playback.loop
    ? playback.segmentStartState + ((tick - playback.segmentStartState) % playback.stateCount)
    : Math.min(playback.segmentEndState, Math.max(playback.segmentStartState, tick));
}

export function createCssmengerPreparedPlayer({ playback, planeAtlas, publicationRoot, ...overrides }) {
  validatePlayback(playback, planeAtlas, publicationRoot);
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

  function publishAdjacentFast(stateIndex) {
    const transform = playback.transforms[stateIndex];
    publicationRoot.style.setProperty("--m", transform);
    const colorRow = playback.colorRows[stateIndex];
    publicationRoot.style.setProperty("--x", planeAtlas.paletteBackgroundPositionYs[colorRow[0]]);
    publicationRoot.style.setProperty("--y", planeAtlas.paletteBackgroundPositionYs[colorRow[1]]);
    publicationRoot.style.setProperty("--z", planeAtlas.paletteBackgroundPositionYs[colorRow[2]]);
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
      publicationRoot.style.setProperty("--m", transform);
    }
    const transformPublishedAt = profile ? readNow() : 0;
    const colorRow = playback.colorRows[stateIndex];
    const colorRowResolvedAt = profile ? readNow() : 0;
    const axisPublications = profile ? [] : null;
    let lastAxisPublishedAt = colorRowResolvedAt;
    for (let axis = 0; axis < 3; axis += 1) {
      const axisStartedAt = profile ? readNow() : 0;
      const backgroundPositionY = planeAtlas.paletteBackgroundPositionYs[colorRow[axis]];
      const previousBackgroundPositionY = planeAtlas.paletteBackgroundPositionYs[playback.colorRows[tick][axis]];
      const axisComparedAt = profile ? readNow() : 0;
      const axisChanged = adjacentState || previousBackgroundPositionY !== backgroundPositionY;
      if (axisChanged) {
        publicationRoot.style.setProperty(`--${"xyz"[axis]}`, backgroundPositionY);
      }
      const axisPublishedAt = profile ? readNow() : 0;
      lastAxisPublishedAt = axisPublishedAt;
      if (profile) {
        axisPublications.push(Object.freeze({
          axis,
          paletteIndex: colorRow[axis],
          previousBackgroundPositionY,
          backgroundPositionY,
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
    if (tick >= playback.segmentEndState) {
      if (!playback.loop) {
        paused = true;
        return tick;
      }
      return publishAdjacentFast(playback.segmentStartState);
    }
    return publishAdjacentFast(tick + 1);
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
    advanceOne();
    if (paused) return;
    nextFrameAt += frameMilliseconds;
    if (nextFrameAt <= timestamp) nextFrameAt = timestamp + frameMilliseconds;
    scheduleNextDraw();
  }

  publishAdjacentFast(playback.initial.stateIndex);
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

function validatePlayback(playback, planeAtlas, publicationRoot) {
  if (playback?.schema !== "cssmenger-prepared-playback@1" ||
      !(publicationRoot instanceof HTMLElement) ||
      !Array.isArray(playback.transforms) || playback.transforms.length !== playback.stateCount ||
      !Array.isArray(playback.colorRows) || playback.colorRows.length !== playback.stateCount ||
      playback.colorRows.some((row) => !Array.isArray(row) || row.length !== 3) ||
      !Array.isArray(playback.palette) || playback.palette.length !== 128 ||
      playback.adjacentPublicationMode !== "all-fields-change" ||
      planeAtlas?.schema !== "cssmenger-prepared-coplanar-plane-atlas@1" ||
      planeAtlas.paletteStateCount !== playback.palette.length ||
      planeAtlas.paletteBackgroundPositionYs?.length !== playback.palette.length ||
      !(playback.sourceFrameDelayMilliseconds > 0)) {
    throw new Error("Prepared cssMenger playback contract is invalid");
  }
}
