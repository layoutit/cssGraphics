export const COLOR_PUBLICATION_INTERVAL_TICKS = 2;
export const MOBILE_COLOR_PUBLICATION_INTERVAL_TICKS = 1_440;
const LEGACY_COLOR_PUBLICATION_INTERVAL_TICKS = 4;

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
  const addressSchedule = decodePreparedAddressSchedule(planeAtlas);
  const schedulerLeadMilliseconds = Math.min(4, frameMilliseconds / 4);
  let paused = true;
  let tick = playback.initial.stateIndex;
  let animationFrame = null;
  let delay = null;
  let nextFrameAt = null;

  function backgroundPositionForSlot(slotIndex) {
    const column = slotIndex % planeAtlas.columns;
    const row = Math.floor(slotIndex / planeAtlas.columns);
    return `${-(column * planeAtlas.slotWidth + planeAtlas.gutterPixels)}px ` +
      `${-(row * planeAtlas.slotHeight + planeAtlas.gutterPixels)}px`;
  }

  function publishAddressRange(start, end) {
    for (let cursor = start; cursor < end; cursor += 1) {
      leaves[addressSchedule.leafIndices[cursor]].style.backgroundPosition =
        backgroundPositionForSlot(addressSchedule.slotIndices[cursor]);
    }
    return end - start;
  }

  function publishSequentialState(stateIndex, profile = null) {
    const startedAt = profile ? readNow() : 0;
    publicationRoot.style.transform = playback.transforms[stateIndex];
    const transformPublishedAt = profile ? readNow() : 0;
    const targetCount = publishAddressRange(
      addressSchedule.offsets[stateIndex],
      addressSchedule.offsets[stateIndex + 1],
    );
    tick = stateIndex;
    if (profile) {
      Object.assign(profile, {
        schema: "cssmenger-profiled-publication@3",
        stateIndex,
        preparedTransformPublicationMilliseconds: transformPublishedAt - startedAt,
        preparedLightingAddressPublicationMilliseconds: readNow() - transformPublishedAt,
        preparedLightingAddressWriteCount: targetCount,
        totalPublicationMilliseconds: readNow() - startedAt,
      });
    }
    return tick;
  }

  function publishAbsoluteState(stateIndex) {
    const slotsByLeaf = new Int32Array(leaves.length).fill(-1);
    const end = addressSchedule.offsets[stateIndex + 1];
    for (let cursor = 0; cursor < end; cursor += 1) {
      slotsByLeaf[addressSchedule.leafIndices[cursor]] = addressSchedule.slotIndices[cursor];
    }
    publicationRoot.style.transform = playback.transforms[stateIndex];
    for (let leafIndex = 0; leafIndex < slotsByLeaf.length; leafIndex += 1) {
      if (slotsByLeaf[leafIndex] >= 0) {
        leaves[leafIndex].style.backgroundPosition = backgroundPositionForSlot(slotsByLeaf[leafIndex]);
      }
    }
    tick = stateIndex;
    return tick;
  }

  function advanceOne(profile = null) {
    if (!playback.loop && tick >= playback.segmentEndState) {
      paused = true;
      return tick;
    }
    const stateIndex = playback.loop
      ? playback.segmentStartState + ((tick - playback.segmentStartState + 1) % playback.stateCount)
      : tick + 1;
    if (stateIndex > tick) publishSequentialState(stateIndex, profile);
    else publishAbsoluteState(stateIndex);
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

  publishSequentialState(tick);
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
      if (!paused || (!playback.loop && tick >= playback.segmentEndState)) return tick;
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
        preparedSchedulerCatchUpMode: "one-adjacent-prepared-state-no-skip",
        preparedColorPublicationIntervalTicks: planeAtlas.lightingSampleIntervalTicks,
        preparedColorPublicationDelayMilliseconds: planeAtlas.lightingSampleDelayMilliseconds,
        preparedColorPublicationMode: "prepared-held-lighting-sample-plus-per-state-front-face-address",
        preparedLightingAddressPublicationIntervalTicks: 1,
        preparedLightingAddressPublicationDelayMilliseconds: frameMilliseconds,
        preparedLightingAtlasSlotCount: planeAtlas.slotCount,
        preparedLightingAtlasAssetCount: 1,
        preparedFrontFacingAxisSelectionsPerScheduledTick: 3,
        preparedFrontFacingLeafWritesPerScheduledTick: Object.freeze({
          minimum: playback.frontFacingSchedule.minimumSelectedLeafCountPerState,
          maximum: playback.frontFacingSchedule.maximumSelectedLeafCountPerState,
          average: playback.frontFacingSchedule.averageSelectedLeafCountPerState,
        }),
        preparedLightingAddressWritesPerScheduledTick: Object.freeze({
          ...planeAtlas.addressWriteCountPerState,
        }),
        preparedLightingAddressUpdateCount: planeAtlas.addressUpdateCount,
        preparedRedundantLightingAddressWriteCountRemoved: planeAtlas.redundantAddressWriteCountRemoved,
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
      planeAtlas.slotCount > planeAtlas.visibleLeafFieldCount ||
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
      planeAtlas.addressScheduleSchema !== "cssmenger-prepared-exact-delta-lighting-address-schedule@1" ||
      planeAtlas.addressEncoding !==
        "base64-u16le-state-offsets-plus-u8-leaf-indices-plus-u16le-exact-deduplicated-slot-indices" ||
      planeAtlas.addressStateOffsetByteLength !== (playback.stateCount + 1) * 2 ||
      planeAtlas.addressLeafIndexByteLength !== planeAtlas.addressUpdateCount ||
      planeAtlas.addressSlotIndexByteLength !== planeAtlas.addressUpdateCount * 2 ||
      planeAtlas.addressUpdateCount + planeAtlas.redundantAddressWriteCountRemoved !==
        planeAtlas.visibleLeafFieldCount ||
      !planeAtlas.addressWriteCountPerState ||
      typeof planeAtlas.addressStateOffsetsBase64 !== "string" ||
      typeof planeAtlas.addressLeafIndicesBase64 !== "string" ||
      typeof planeAtlas.addressSlotIndicesBase64 !== "string" ||
      !(playback.sourceFrameDelayMilliseconds > 0)) {
    throw new Error("Prepared cssMenger playback contract is invalid");
  }
}

function decodePreparedAddressSchedule(planeAtlas) {
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
  if (offsets[0] !== 0 || offsets.at(-1) !== planeAtlas.addressUpdateCount) {
    throw new Error("Prepared cssMenger lighting address offsets are invalid");
  }
  const slotIndices = new Uint16Array(planeAtlas.addressUpdateCount);
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
