export const COLOR_PUBLICATION_INTERVAL_TICKS = 2;
export const MOBILE_COLOR_PUBLICATION_INTERVAL_TICKS = 1_536;
const LEGACY_COLOR_PUBLICATION_INTERVAL_TICKS = 4;

export function timelineStateIndexForTick(tick, playback) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssMenger tick must be a non-negative safe integer");
  return playback.loop
    ? playback.segmentStartState + ((tick - playback.segmentStartState) % playback.stateCount)
    : Math.min(playback.segmentEndState, Math.max(playback.segmentStartState, tick));
}

export function createCssmengerPreparedPlayer({
  playback,
  planeAtlas,
  baseAtlas = null,
  publicationRoot,
  rotationAnimation = null,
  leaves,
  lightingPresentation = "atlas",
  axisLeafCounts = null,
  ...overrides
}) {
  validatePlayback(playback, planeAtlas, publicationRoot, leaves);
  const compositorRotationMode = rotationAnimation !== null;
  if (compositorRotationMode &&
      (typeof rotationAnimation.play !== "function" || typeof rotationAnimation.pause !== "function" ||
        !("currentTime" in rotationAnimation))) {
    throw new Error("Prepared cssMenger compositor rotation animation contract is invalid");
  }
  const cssOpacityMode = lightingPresentation === "css-opacity";
  if (!["atlas", "css-opacity"].includes(lightingPresentation) || cssOpacityMode &&
      !validCssOpacityPlayback({ playback, planeAtlas, baseAtlas, leaves, axisLeafCounts })) {
    throw new Error("Prepared cssMenger lighting presentation contract is invalid");
  }
  const requestFrame = overrides.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = overrides.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const requestDelay = overrides.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = overrides.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = overrides.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const frameMilliseconds = playback.sourceFrameDelayMilliseconds;
  const addressSchedule = decodePreparedAddressSchedule(planeAtlas);
  const frozenLighting = !cssOpacityMode && planeAtlas.lightingSampleCount === 1;
  const animationCycleMilliseconds = playback.stateCount * frameMilliseconds;
  const axisLeafOffsets = cssOpacityMode
    ? [0, axisLeafCounts[0], axisLeafCounts[0] + axisLeafCounts[1], leaves.length]
    : null;
  const shadowBackgroundPositions = cssOpacityMode ? Array(leaves.length).fill("0px 0px") : null;
  const baseBackgroundPositions = cssOpacityMode ? Array(leaves.length).fill("0px 0px") : null;
  const currentSlotIndices = new Int32Array(leaves.length).fill(-1);
  const deferredAddressLeaves = new Uint8Array(leaves.length);
  let paused = true;
  let tick = playback.initial.stateIndex;
  let animationFrame = null;
  let delay = null;
  let preparedTimelineOrigin = null;
  let nextCompositorBoundary = null;
  let preparedTimelineCallbackCount = 0;
  let collapsedLightingResyncCount = 0;
  let maximumCollapsedStateCount = 0;

  function publishPreparedRotation(stateIndex, force = false) {
    if (compositorRotationMode) {
      if (force || paused) rotationAnimation.currentTime = stateIndex * frameMilliseconds;
      return;
    }
    publicationRoot.style.transform = playback.transforms[stateIndex];
  }

  function publishCssOpacityBasePositions(stateIndex, force = false) {
    const preparedStateIndex = stateIndex - stateIndex % planeAtlas.lightingSampleIntervalTicks;
    if (!force && stateIndex % planeAtlas.lightingSampleIntervalTicks !== 0) return 0;
    const colorRow = playback.colorRows[preparedStateIndex];
    let writeCount = 0;
    for (let axis = 0; axis < planeAtlas.preparedAxisPaletteSourceIndices.length; axis += 1) {
      const paletteIndex = colorRow[planeAtlas.preparedAxisPaletteSourceIndices[axis]];
      if (force) {
        for (let leafIndex = axisLeafOffsets[axis]; leafIndex < axisLeafOffsets[axis + 1]; leafIndex += 1) {
          baseBackgroundPositions[leafIndex] = baseBackgroundPositionForLeaf(leafIndex, paletteIndex);
          publishCssOpacityBackgroundPosition(leafIndex);
          writeCount += 1;
        }
        continue;
      }
      const segment = preparedStateIndex * playback.frontFacingSchedule.axisCount + axis;
      const start = playback.frontFacingSchedule.offsets[segment];
      const end = playback.frontFacingSchedule.offsets[segment + 1];
      for (let cursor = start; cursor < end; cursor += 1) {
        const leafIndex = playback.frontFacingSchedule.leafIndices[cursor];
        baseBackgroundPositions[leafIndex] = baseBackgroundPositionForLeaf(leafIndex, paletteIndex);
        publishCssOpacityBackgroundPosition(leafIndex);
        writeCount += 1;
      }
    }
    return writeCount;
  }

  function baseBackgroundPositionForLeaf(leafIndex, paletteIndex) {
    const patternIndex = baseAtlas.leafPatternIndices[leafIndex];
    const patternX = baseAtlas.patternRows[patternIndex][0];
    return `${-patternX}px ${baseAtlas.paletteBackgroundPositionYs[paletteIndex]}`;
  }

  function publishCssOpacityBackgroundPosition(leafIndex) {
    leaves[leafIndex].style.backgroundPosition =
      `${shadowBackgroundPositions[leafIndex]}, ${baseBackgroundPositions[leafIndex]}`;
  }

  function backgroundPositionForSlot(slotIndex) {
    const column = slotIndex % planeAtlas.columns;
    const row = Math.floor(slotIndex / planeAtlas.columns);
    return `${-(column * planeAtlas.slotWidth + planeAtlas.gutterPixels)}px ` +
      `${-(row * planeAtlas.slotHeight + planeAtlas.gutterPixels)}px`;
  }

  function publishAddressRange(schedule, start, end, deferredLeaves = null) {
    for (let cursor = start; cursor < end; cursor += 1) {
      const leafIndex = schedule.leafIndices[cursor];
      const slotIndex = schedule.slotIndices[cursor];
      const address = backgroundPositionForSlot(slotIndex);
      currentSlotIndices[leafIndex] = slotIndex;
      if (cssOpacityMode) shadowBackgroundPositions[leafIndex] = address;
      else if (deferredLeaves) deferredLeaves[leafIndex] = 1;
      else leaves[leafIndex].style.backgroundPosition = address;
    }
    return end - start;
  }

  function publishPreparedAddressState(stateIndex, deferredLeaves = null) {
    return publishAddressRange(
      addressSchedule,
      addressSchedule.offsets[stateIndex],
      addressSchedule.offsets[stateIndex + 1],
      deferredLeaves,
    );
  }

  function publishSequentialState(stateIndex, profile = null) {
    const startedAt = profile ? readNow() : 0;
    publishPreparedRotation(stateIndex);
    const transformPublishedAt = profile ? readNow() : 0;
    const targetCount = frozenLighting ? 0 : publishPreparedAddressState(stateIndex);
    const colorWriteCount = cssOpacityMode
      ? publishCssOpacityBasePositions(stateIndex)
      : 0;
    tick = stateIndex;
    if (profile) {
      Object.assign(profile, {
        schema: "cssmenger-profiled-publication@3",
        stateIndex,
        preparedPlaybackDirection: 1,
        preparedTransformPublicationMilliseconds: transformPublishedAt - startedAt,
        preparedLightingAddressPublicationMilliseconds: readNow() - transformPublishedAt,
        preparedLightingAddressWriteCount: targetCount,
        preparedCssOpacityWriteCount: 0,
        preparedCssPaletteWriteCount: colorWriteCount,
        totalPublicationMilliseconds: readNow() - startedAt,
      });
    }
    return tick;
  }

  function publishAbsoluteState(stateIndex) {
    if (frozenLighting) {
      publishPreparedRotation(stateIndex, true);
      tick = stateIndex;
      return tick;
    }
    const slotsByLeaf = new Int32Array(leaves.length).fill(-1);
    const end = addressSchedule.offsets[stateIndex + 1];
    for (let cursor = 0; cursor < end; cursor += 1) {
      slotsByLeaf[addressSchedule.leafIndices[cursor]] = addressSchedule.slotIndices[cursor];
    }
    publishPreparedRotation(stateIndex, true);
    for (let leafIndex = 0; leafIndex < slotsByLeaf.length; leafIndex += 1) {
      if (slotsByLeaf[leafIndex] >= 0) {
        const slotIndex = slotsByLeaf[leafIndex];
        const address = backgroundPositionForSlot(slotIndex);
        currentSlotIndices[leafIndex] = slotIndex;
        if (cssOpacityMode) shadowBackgroundPositions[leafIndex] = address;
        else leaves[leafIndex].style.backgroundPosition = address;
      }
    }
    if (cssOpacityMode) publishCssOpacityBasePositions(stateIndex, true);
    tick = stateIndex;
    return tick;
  }

  function preparedStateCodeForAnimationTime(value) {
    const currentTime = Number(value);
    if (!Number.isFinite(currentTime) || currentTime < 0 || animationCycleMilliseconds <= 0) return null;
    const cycleTime = currentTime % animationCycleMilliseconds;
    return Math.min(playback.stateCount - 1, Math.floor((cycleTime + 0.001) / frameMilliseconds));
  }

  function publishCollapsedPreparedState(targetStateIndex, stateCount) {
    deferredAddressLeaves.fill(0);
    let stateIndex = tick;
    for (let index = 0; index < stateCount; index += 1) {
      stateIndex = (stateIndex + 1) % playback.stateCount;
      publishPreparedAddressState(stateIndex, deferredAddressLeaves);
    }
    publishPreparedRotation(targetStateIndex);
    if (cssOpacityMode) {
      publishCssOpacityBasePositions(targetStateIndex);
    } else {
      for (let leafIndex = 0; leafIndex < deferredAddressLeaves.length; leafIndex += 1) {
        if (deferredAddressLeaves[leafIndex] !== 0) {
          leaves[leafIndex].style.backgroundPosition =
            backgroundPositionForSlot(currentSlotIndices[leafIndex]);
        }
      }
    }
    tick = targetStateIndex;
    collapsedLightingResyncCount += 1;
    maximumCollapsedStateCount = Math.max(maximumCollapsedStateCount, stateCount);
    return tick;
  }

  function publishPreparedTimelineState(stateIndex) {
    if (frozenLighting) {
      publishPreparedRotation(stateIndex);
      tick = stateIndex;
      return tick;
    }
    if (stateIndex === tick) return tick;
    const stateCount = (stateIndex - tick + playback.stateCount) % playback.stateCount;
    if (stateCount === 1) {
      publishSequentialState(stateIndex);
      return tick;
    }
    return publishCollapsedPreparedState(stateIndex, stateCount);
  }

  function advanceOne(profile = null) {
    if (!playback.loop && tick >= playback.segmentEndState) {
      paused = true;
      return tick;
    }
    let stateIndex;
    if (playback.loop) {
      stateIndex = tick >= playback.segmentEndState ? playback.segmentStartState : tick + 1;
    } else {
      stateIndex = tick + 1;
    }
    publishSequentialState(stateIndex, profile);
    if (!playback.loop && tick >= playback.segmentEndState) paused = true;
    return tick;
  }

  function scheduleNextDraw() {
    if (paused || animationFrame !== null || delay !== null) return;
    if (compositorRotationMode) {
      const animationTime = readNow() - preparedTimelineOrigin;
      if (!Number.isFinite(nextCompositorBoundary)) {
        nextCompositorBoundary = (Math.floor(animationTime / frameMilliseconds) + 1) * frameMilliseconds;
      }
      const wait = Math.max(0, nextCompositorBoundary - animationTime);
      delay = requestDelay(() => {
        delay = null;
        if (!paused) loopFast(readNow());
      }, Math.max(1, Math.ceil(wait)));
      return;
    }
    animationFrame = requestFrame(loopFast);
  }

  function loopFast(timestamp) {
    animationFrame = null;
    if (paused) return;
    preparedTimelineCallbackCount += 1;
    const animationTime = timestamp - preparedTimelineOrigin;
    const stateCode = preparedStateCodeForAnimationTime(animationTime);
    if (stateCode !== null) publishPreparedTimelineState(stateCode);
    if (compositorRotationMode) {
      nextCompositorBoundary =
        (Math.floor(animationTime / frameMilliseconds) + 1) * frameMilliseconds;
    }
    if (paused) return;
    scheduleNextDraw();
  }

  if (frozenLighting) {
    publishPreparedRotation(tick, true);
    publishAddressRange(addressSchedule, 0, addressSchedule.slotIndices.length);
  } else if (cssOpacityMode) {
    publishAbsoluteState(tick);
  } else {
    publishSequentialState(tick);
  }
  return Object.freeze({
    get tick() { return tick; },
    get paused() { return paused; },
    pause() {
      paused = true;
      if (compositorRotationMode) rotationAnimation.pause();
      preparedTimelineOrigin = null;
      nextCompositorBoundary = null;
      if (animationFrame !== null) cancelFrame(animationFrame);
      if (delay !== null) cancelDelay(delay);
      animationFrame = null;
      delay = null;
      return tick;
    },
    resume() {
      if (!paused || (!playback.loop && tick >= playback.segmentEndState)) return tick;
      paused = false;
      const now = readNow();
      if (compositorRotationMode) {
        const animationTime = Number(rotationAnimation.currentTime);
        preparedTimelineOrigin = now -
          (Number.isFinite(animationTime) ? animationTime : tick * frameMilliseconds);
        nextCompositorBoundary =
          (Math.floor((now - preparedTimelineOrigin) / frameMilliseconds) + 1) * frameMilliseconds;
        rotationAnimation.play();
      } else {
        preparedTimelineOrigin = now - tick * frameMilliseconds;
      }
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
      const before = Object.freeze({ tick });
      const publication = {};
      advanceOne(publication);
      return Object.freeze({ ...publication, before, after: Object.freeze({ tick }) });
    },
    setTick(value) {
      this.pause();
      return publishAbsoluteState(timelineStateIndexForTick(Math.trunc(Number(value)), playback));
    },
    stats() {
      return Object.freeze({
        schema: "cssmenger-prepared-player-stats@3",
        paused,
        tick,
        sourceFrameDelayMilliseconds: frameMilliseconds,
        preparedTimelineStateCount: playback.stateCount,
        preparedPaletteColorCount: playback.palette.length,
        preparedSchedulerCatchUpMode: "anchored-prepared-timeline-adjacent-or-collapsed-resync",
        runtimeSchedulerTransport: compositorRotationMode
          ? "anchored-deadline-setTimeout-prepared-timeline-publication"
          : "continuous-requestAnimationFrame-prepared-timeline-publication",
        runtimePreparedTimelineCallbackCount: preparedTimelineCallbackCount,
        preparedCollapsedLightingResyncCount: collapsedLightingResyncCount,
        preparedMaximumCollapsedLightingStateCount: maximumCollapsedStateCount,
        preparedLoopPresentationMode: playback.loop
          ? "prepared-forward-cyclic-c2-no-turnaround-no-reset"
          : "prepared-forward-once",
        preparedCompositorRotationMode: compositorRotationMode
          ? "prepared-css-keyframes-on-existing-scene-node"
          : "prepared-inline-transform-publication",
        runtimeRotationStyleWriteCountPerScheduledTick: compositorRotationMode ? 0 : 1,
        preparedFlatSceneLeafLightingSeparation: true,
        preparedColorPublicationIntervalTicks: planeAtlas.lightingSampleIntervalTicks,
        preparedColorPublicationDelayMilliseconds: planeAtlas.lightingSampleDelayMilliseconds,
        preparedColorPublicationMode: cssOpacityMode
          ? "prepared-palette-base-plus-cadence-batched-black-alpha-shadow-atlas"
          : frozenLighting
            ? "prepared-frozen-lighting-all-leaf-initialization-only"
            : "prepared-held-lighting-sample-plus-per-state-front-face-address",
        preparedLightingAddressPublicationIntervalTicks: planeAtlas.addressPublicationIntervalTicks,
        preparedLightingAddressPublicationDelayMilliseconds: planeAtlas.addressPublicationDelayMilliseconds,
        preparedLightingAtlasSlotCount: planeAtlas.slotCount,
        preparedLightingAtlasAssetCount: cssOpacityMode ? 2 : 1,
        preparedCssOpacityWriteCountPerScheduledTick: 0,
        preparedCssPaletteWriteCountPerScheduledTick:
          cssOpacityMode
            ? playback.frontFacingSchedule.averageSelectedLeafCountPerState /
              planeAtlas.lightingSampleIntervalTicks
            : 0,
        preparedCssOpacityLightingFit: null,
        preparedFrontFacingAxisSelectionsPerScheduledTick: 3,
        preparedFrontFacingLeafWritesPerScheduledTick: Object.freeze({
          minimum: playback.frontFacingSchedule.minimumSelectedLeafCountPerState,
          maximum: playback.frontFacingSchedule.maximumSelectedLeafCountPerState,
          average: playback.frontFacingSchedule.averageSelectedLeafCountPerState,
        }),
        preparedLightingAddressWritesPerScheduledTick:
          Object.freeze({ ...planeAtlas.addressWriteCountPerState }),
        preparedLightingAddressUpdateCount: planeAtlas.addressUpdateCount,
        preparedLightingInitializationAddressWriteCount: frozenLighting
          ? planeAtlas.addressUpdateCount
          : 0,
        preparedRedundantLightingAddressWriteCountRemoved:
          planeAtlas.redundantAddressWriteCountRemoved,
        runtimeLightingAddressComparisonCount: 0,
        runtimeHotPathDomStyleReadCount: 0,
        runtimeGeometryConstructionCount: 0,
        runtimeRecursionCount: 0,
        runtimeMergeCount: 0,
        runtimeColorGenerationCount: 0,
        runtimeLightingCalculationCount: 0,
        runtimeRotationCalculationCount: 0,
        runtimeCameraCalculationCount: 0,
        runtimeDomGrowth: false,
      });
    },
    destroy() { this.pause(); },
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
      planeAtlas?.schema !== "cssmenger-prepared-sparse-leaf-lighting-atlas@1" ||
      planeAtlas.visibleLeafFieldCount !== playback.frontFacingSchedule.leafIndices.length ||
      !Number.isSafeInteger(planeAtlas.addressedVisibleLeafFieldCount) ||
      planeAtlas.addressedVisibleLeafFieldCount < planeAtlas.slotCount ||
      planeAtlas.addressedVisibleLeafFieldCount > planeAtlas.visibleLeafFieldCount ||
      planeAtlas.sourceStateCount !== playback.stateCount ||
      ![
        1,
        LEGACY_COLOR_PUBLICATION_INTERVAL_TICKS,
        COLOR_PUBLICATION_INTERVAL_TICKS,
        MOBILE_COLOR_PUBLICATION_INTERVAL_TICKS,
      ]
        .includes(planeAtlas.lightingSampleIntervalTicks) ||
      planeAtlas.lightingSampleDelayMilliseconds !==
        playback.sourceFrameDelayMilliseconds * planeAtlas.lightingSampleIntervalTicks ||
      planeAtlas.lightingSampleCount !== Math.ceil(playback.stateCount / planeAtlas.lightingSampleIntervalTicks) ||
      planeAtlas.transformPublicationIntervalTicks !== 1 ||
      planeAtlas.transformPublicationDelayMilliseconds !== playback.sourceFrameDelayMilliseconds ||
      ![1, planeAtlas.lightingSampleIntervalTicks].includes(planeAtlas.addressPublicationIntervalTicks) ||
      planeAtlas.addressPublicationDelayMilliseconds !==
        playback.sourceFrameDelayMilliseconds * planeAtlas.addressPublicationIntervalTicks ||
      planeAtlas.addressScheduleSchema !== "cssmenger-prepared-exact-delta-lighting-address-schedule@1" ||
      planeAtlas.addressEncoding !==
        "base64-u16le-state-offsets-plus-u8-leaf-indices-plus-u16le-exact-deduplicated-slot-indices" ||
      planeAtlas.addressStateOffsetByteLength !== (playback.stateCount + 1) * 2 ||
      planeAtlas.addressLeafIndexByteLength !== planeAtlas.addressUpdateCount ||
      planeAtlas.addressSlotIndexByteLength !== planeAtlas.addressUpdateCount * 2 ||
      planeAtlas.addressUpdateCount + planeAtlas.redundantAddressWriteCountRemoved !==
        planeAtlas.addressedVisibleLeafFieldCount ||
      !planeAtlas.addressWriteCountPerState ||
      typeof planeAtlas.addressStateOffsetsBase64 !== "string" ||
      typeof planeAtlas.addressLeafIndicesBase64 !== "string" ||
      typeof planeAtlas.addressSlotIndicesBase64 !== "string" ||
      !(playback.sourceFrameDelayMilliseconds > 0)) {
    throw new Error("Prepared cssMenger playback contract is invalid");
  }
}

function validCssOpacityPlayback({
  playback,
  planeAtlas,
  baseAtlas,
  leaves,
  axisLeafCounts,
}) {
  return planeAtlas.presentation === "css-black-alpha" &&
    planeAtlas.addressPublicationIntervalTicks === planeAtlas.lightingSampleIntervalTicks &&
    planeAtlas.leafCount === leaves.length &&
    Array.isArray(planeAtlas.preparedAxisPaletteSourceIndices) &&
    planeAtlas.preparedAxisPaletteSourceIndices.join(",") === "1,0,2" &&
    baseAtlas?.schema === "cssmenger-prepared-coplanar-plane-atlas@1" &&
    baseAtlas.paletteRole === "css-opacity-base" &&
    baseAtlas.rgbScale === 0.75 &&
    baseAtlas.paletteStateCount === playback.palette.length &&
    baseAtlas.leafCount === leaves.length &&
    Array.isArray(baseAtlas.patternRows) && baseAtlas.patternRows.length === baseAtlas.patternCount &&
    Array.isArray(baseAtlas.leafPatternIndices) && baseAtlas.leafPatternIndices.length === leaves.length &&
    baseAtlas.leafPatternIndices.every((patternIndex) =>
      Number.isSafeInteger(patternIndex) && patternIndex >= 0 && patternIndex < baseAtlas.patternCount) &&
    Array.isArray(baseAtlas.paletteBackgroundPositionYs) &&
    baseAtlas.paletteBackgroundPositionYs.length === playback.palette.length &&
    Array.isArray(axisLeafCounts) && axisLeafCounts.length === 3 &&
    axisLeafCounts.every((count) => Number.isSafeInteger(count) && count > 0) &&
    axisLeafCounts.reduce((sum, count) => sum + count, 0) === leaves.length;
}

function decodePreparedAddressSchedule(planeAtlas) {
  const updateCount = planeAtlas.addressUpdateCount;
  const offsetBytes = decodeBase64Bytes(
    planeAtlas.addressStateOffsetsBase64,
    planeAtlas.addressStateOffsetByteLength,
  );
  const leafIndices = decodeBase64Bytes(
    planeAtlas.addressLeafIndicesBase64,
    planeAtlas.addressLeafIndexByteLength,
  );
  const slotBytes = decodeBase64Bytes(
    planeAtlas.addressSlotIndicesBase64,
    planeAtlas.addressSlotIndexByteLength,
  );
  const offsets = new Uint16Array(planeAtlas.sourceStateCount + 1);
  for (let index = 0; index < offsets.length; index += 1) {
    offsets[index] = offsetBytes[index * 2] | offsetBytes[index * 2 + 1] << 8;
    if (index > 0 && offsets[index] < offsets[index - 1]) {
      throw new Error("Prepared cssMenger lighting address offsets are not monotonic");
    }
  }
  if (offsets[0] !== 0 || offsets.at(-1) !== updateCount) {
    throw new Error("Prepared cssMenger lighting address offsets are invalid");
  }
  const slotIndices = new Uint16Array(updateCount);
  const seen = new Uint8Array(planeAtlas.slotCount);
  for (let index = 0; index < slotIndices.length; index += 1) {
    const slotIndex = slotBytes[index * 2] | slotBytes[index * 2 + 1] << 8;
    if (leafIndices[index] >= planeAtlas.leafCount || slotIndex >= planeAtlas.slotCount) {
      throw new Error("Prepared cssMenger lighting address index is invalid");
    }
    slotIndices[index] = slotIndex;
    seen[slotIndex] = 1;
  }
  if (seen.some((selected) => selected === 0)) {
    throw new Error("Prepared cssMenger lighting atlas contains an unreachable slot");
  }
  if (planeAtlas.lightingSampleCount === 1) {
    const seenLeaves = new Uint8Array(planeAtlas.leafCount);
    for (const leafIndex of leafIndices) seenLeaves[leafIndex] += 1;
    if (leafIndices.length !== planeAtlas.leafCount || seenLeaves.some((count) => count !== 1)) {
      throw new Error("Frozen cssMenger lighting must initialize every retained leaf exactly once");
    }
  }
  return Object.freeze({ offsets, leafIndices, slotIndices });
}

function decodeBase64Bytes(value, expectedLength) {
  const binary = globalThis.atob(value);
  if (binary.length !== expectedLength) {
    throw new Error("Prepared cssMenger lighting address byte length drifted");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
