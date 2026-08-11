export const COLOR_PUBLICATION_INTERVAL_TICKS = 2;
export const MOBILE_COLOR_PUBLICATION_INTERVAL_TICKS = 1_440;
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
  const addressSchedule = decodePreparedAddressSchedule(planeAtlas, "forward");
  const reverseAddressSchedule = decodePreparedAddressSchedule(planeAtlas, "reverse");
  const frozenLighting = !cssOpacityMode && planeAtlas.lightingSampleCount === 1;
  const axisLeafOffsets = cssOpacityMode
    ? [0, axisLeafCounts[0], axisLeafCounts[0] + axisLeafCounts[1], leaves.length]
    : null;
  const shadowBackgroundPositions = cssOpacityMode ? Array(leaves.length).fill("0px 0px") : null;
  const baseBackgroundPositions = cssOpacityMode ? Array(leaves.length).fill("0px 0px") : null;
  const schedulerLeadMilliseconds = Math.min(4, frameMilliseconds / 4);
  let paused = true;
  let tick = playback.initial.stateIndex;
  let animationFrame = null;
  let delay = null;
  let nextFrameAt = null;
  let loopDirection = 1;

  function publishPreparedRotation(stateIndex, force = false) {
    if (compositorRotationMode) {
      if (force || paused) rotationAnimation.currentTime = stateIndex * frameMilliseconds;
      return;
    }
    publicationRoot.style.transform = playback.transforms[stateIndex];
  }

  function publishCssOpacityBasePositions(stateIndex, force = false, direction = 1) {
    const preparedStateIndex = stateIndex - stateIndex % planeAtlas.lightingSampleIntervalTicks;
    const publicationRemainder = direction > 0
      ? 0
      : planeAtlas.lightingSampleIntervalTicks - 1;
    if (!force && stateIndex % planeAtlas.lightingSampleIntervalTicks !== publicationRemainder) return 0;
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

  function publishAddressRange(schedule, start, end) {
    for (let cursor = start; cursor < end; cursor += 1) {
      const leafIndex = schedule.leafIndices[cursor];
      const address = backgroundPositionForSlot(schedule.slotIndices[cursor]);
      if (cssOpacityMode) shadowBackgroundPositions[leafIndex] = address;
      else leaves[leafIndex].style.backgroundPosition = address;
    }
    return end - start;
  }

  function publishSequentialState(stateIndex, profile = null, direction = 1) {
    const startedAt = profile ? readNow() : 0;
    publishPreparedRotation(stateIndex);
    const transformPublishedAt = profile ? readNow() : 0;
    const selectedAddressSchedule = direction > 0 ? addressSchedule : reverseAddressSchedule;
    const targetCount = frozenLighting ? 0 : publishAddressRange(
        selectedAddressSchedule,
        selectedAddressSchedule.offsets[stateIndex],
        selectedAddressSchedule.offsets[stateIndex + 1],
      );
    const colorWriteCount = cssOpacityMode
      ? publishCssOpacityBasePositions(stateIndex, false, direction)
      : 0;
    tick = stateIndex;
    if (profile) {
      Object.assign(profile, {
        schema: "cssmenger-profiled-publication@3",
        stateIndex,
        preparedPlaybackDirection: direction,
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
        const address = backgroundPositionForSlot(slotsByLeaf[leafIndex]);
        if (cssOpacityMode) shadowBackgroundPositions[leafIndex] = address;
        else leaves[leafIndex].style.backgroundPosition = address;
      }
    }
    if (cssOpacityMode) publishCssOpacityBasePositions(stateIndex, true);
    tick = stateIndex;
    return tick;
  }

  function advanceOne(profile = null) {
    if (!playback.loop && tick >= playback.segmentEndState) {
      paused = true;
      return tick;
    }
    let stateIndex;
    if (playback.loop) {
      if (tick >= playback.segmentEndState) loopDirection = -1;
      else if (tick <= playback.segmentStartState) loopDirection = 1;
      stateIndex = tick + loopDirection;
    } else {
      stateIndex = tick + 1;
    }
    publishSequentialState(stateIndex, profile, loopDirection);
    if (!playback.loop && tick >= playback.segmentEndState) paused = true;
    return tick;
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
    nextFrameAt = Math.max(nextFrameAt + frameMilliseconds, timestamp);
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
      nextFrameAt = null;
      if (animationFrame !== null) cancelFrame(animationFrame);
      if (delay !== null) cancelDelay(delay);
      animationFrame = null;
      delay = null;
      return tick;
    },
    resume() {
      if (!paused || (!playback.loop && tick >= playback.segmentEndState)) return tick;
      paused = false;
      nextFrameAt = readNow() + frameMilliseconds;
      if (compositorRotationMode) rotationAnimation.play();
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
      loopDirection = 1;
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
        preparedSchedulerCatchUpMode: "one-adjacent-prepared-state-no-skip",
        preparedLoopPresentationMode: playback.loop
          ? "prepared-adjacent-state-ping-pong-no-reset"
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
        preparedReverseLightingAddressWritesPerScheduledTick:
          Object.freeze({ ...planeAtlas.reverseAddressWriteCountPerState }),
        preparedReverseLightingAddressUpdateCount: planeAtlas.reverseAddressUpdateCount,
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
      planeAtlas.reverseAddressScheduleSchema !==
        "cssmenger-prepared-exact-reverse-delta-lighting-address-schedule@1" ||
      !Number.isSafeInteger(planeAtlas.reverseAddressUpdateCount) ||
      planeAtlas.reverseAddressUpdateCount < 0 ||
      planeAtlas.reverseAddressStateOffsetByteLength !== (playback.stateCount + 1) * 2 ||
      planeAtlas.reverseAddressLeafIndexByteLength !== planeAtlas.reverseAddressUpdateCount ||
      planeAtlas.reverseAddressSlotIndexByteLength !== planeAtlas.reverseAddressUpdateCount * 2 ||
      !planeAtlas.reverseAddressWriteCountPerState ||
      typeof planeAtlas.addressStateOffsetsBase64 !== "string" ||
      typeof planeAtlas.addressLeafIndicesBase64 !== "string" ||
      typeof planeAtlas.addressSlotIndicesBase64 !== "string" ||
      typeof planeAtlas.reverseAddressStateOffsetsBase64 !== "string" ||
      typeof planeAtlas.reverseAddressLeafIndicesBase64 !== "string" ||
      typeof planeAtlas.reverseAddressSlotIndicesBase64 !== "string" ||
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

function decodePreparedAddressSchedule(planeAtlas, direction) {
  const reverse = direction === "reverse";
  const updateCount = reverse ? planeAtlas.reverseAddressUpdateCount : planeAtlas.addressUpdateCount;
  const offsetBytes = decodeBase64Bytes(
    reverse ? planeAtlas.reverseAddressStateOffsetsBase64 : planeAtlas.addressStateOffsetsBase64,
    reverse ? planeAtlas.reverseAddressStateOffsetByteLength : planeAtlas.addressStateOffsetByteLength,
  );
  const leafIndices = decodeBase64Bytes(
    reverse ? planeAtlas.reverseAddressLeafIndicesBase64 : planeAtlas.addressLeafIndicesBase64,
    reverse ? planeAtlas.reverseAddressLeafIndexByteLength : planeAtlas.addressLeafIndexByteLength,
  );
  const slotBytes = decodeBase64Bytes(
    reverse ? planeAtlas.reverseAddressSlotIndicesBase64 : planeAtlas.addressSlotIndicesBase64,
    reverse ? planeAtlas.reverseAddressSlotIndexByteLength : planeAtlas.addressSlotIndexByteLength,
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
  if (!reverse && seen.some((selected) => selected === 0)) {
    throw new Error("Prepared cssMenger lighting atlas contains an unreachable slot");
  }
  if (!reverse && planeAtlas.lightingSampleCount === 1) {
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
