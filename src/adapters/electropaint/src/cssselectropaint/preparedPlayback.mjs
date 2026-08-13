// SPDX-License-Identifier: GPL-2.0-only
import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";
import { createPreparedElectropaintChunkStore } from "./preparedChunkStore.mjs";

export async function createPreparedElectropaintPlayer({
  playback,
  sceneRoot,
  quads,
  ...overrides
}) {
  validate(playback, sceneRoot, quads);
  const requestDelay = overrides.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = overrides.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = overrides.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const requestIdle = overrides.requestIdle ?? globalThis.requestIdleCallback?.bind(globalThis) ??
    ((callback) => requestDelay(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0));
  const cancelIdle = overrides.cancelIdle ?? globalThis.cancelIdleCallback?.bind(globalThis) ?? cancelDelay;
  const chunkStore = createPreparedElectropaintChunkStore(playback, overrides.fetchImpl);
  const decodedChunks = new Map();
  let activeChunk = null;
  let stateIndex = playback.initialStateIndex;
  let chunkIndex = 0;
  let localStateIndex = 0;
  let paused = true;
  let delay = null;
  let nextFrameAt = null;
  let statesApplied = 1;
  let preparedTransformAssignments = 0;
  let preparedColorAssignments = 0;
  let schedulerCallbackCount = 0;
  let innerChunkBoundaryCount = 0;
  let loopCount = 0;
  let debugAbsoluteSeekCount = 0;
  let debugLeafWideComparisonCount = 0;
  let debugTransformWrites = 0;
  let debugColorClassWrites = 0;
  let preloadError = null;
  let horizonRequest = 0;
  let horizonMaintenance = null;
  let horizonDecodeSlice = null;
  let horizonDecodeDelay = null;
  let horizonMaintenanceRequestCount = 0;
  let horizonMaintenanceCallbackCount = 0;
  let horizonIncrementalDecodeSliceCount = 0;
  let horizonIncrementalDecodeDelayCount = 0;
  let horizonIncrementalDecodeDelayCallbackCount = 0;
  let horizonIncrementalDecodedTransformCount = 0;
  const frameMilliseconds = playback.sourceFrameDelayMilliseconds;

  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: sceneRoot,
      writeTransform() { return false; },
    },
    shapes: [],
    leaves: quads.map((element) => ({ element })),
  });
  target.assertStableDomIdentity();

  function horizonIndices(startChunkIndex) {
    return Array.from({ length: playback.chunks.runtimeLookaheadChunkCount }, (_, offset) =>
      (startChunkIndex + offset) % playback.chunks.count);
  }

  async function prepareHorizon(startChunkIndex, incremental = false) {
    const requestId = ++horizonRequest;
    const indices = horizonIndices(startChunkIndex);
    await chunkStore.preload(indices);
    if (requestId !== horizonRequest) return;
    for (const index of indices) {
      if (decodedChunks.has(index)) continue;
      const loaded = chunkStore.loaded(index);
      if (!loaded) throw new Error(`Prepared ElectroPaint chunk ${index} is not loaded`);
      const decoded = incremental
        ? await decodeChunkIncrementally(loaded, playback.palette.length, requestId)
        : decodeChunk(loaded, playback.palette.length);
      if (requestId !== horizonRequest || decoded === null) return;
      decodedChunks.set(index, decoded);
    }
    chunkStore.retain(indices);
    const retained = new Set(indices);
    for (const index of decodedChunks.keys()) {
      if (!retained.has(index)) decodedChunks.delete(index);
    }
  }

  function scheduleHorizonMaintenance(startChunkIndex) {
    if (horizonMaintenance !== null) cancelIdle(horizonMaintenance);
    horizonMaintenanceRequestCount += 1;
    horizonMaintenance = requestIdle(() => {
      horizonMaintenance = null;
      horizonMaintenanceCallbackCount += 1;
      void prepareHorizon(startChunkIndex, true).catch((error) => { preloadError = error; });
    }, { timeout: 1_000 });
  }

  function cancelHorizonWork() {
    horizonRequest += 1;
    if (horizonMaintenance !== null) cancelIdle(horizonMaintenance);
    if (horizonDecodeSlice !== null) cancelIdle(horizonDecodeSlice);
    if (horizonDecodeDelay !== null) cancelDelay(horizonDecodeDelay);
    horizonMaintenance = null;
    horizonDecodeSlice = null;
    horizonDecodeDelay = null;
  }

  function decodedChunk(index) {
    let decoded = decodedChunks.get(index);
    if (decoded) return decoded;
    const loaded = chunkStore.loaded(index);
    if (!loaded) throw new Error(`Prepared ElectroPaint chunk ${index} is not loaded`);
    decoded = decodeChunk(loaded, playback.palette.length);
    decodedChunks.set(index, decoded);
    return decoded;
  }

  function applyPreparedState(chunk, nextLocalStateIndex) {
    const transformStart = chunk.transformSchedule.offsets[nextLocalStateIndex];
    const transformEnd = chunk.transformSchedule.offsets[nextLocalStateIndex + 1];
    for (let assignment = transformStart; assignment < transformEnd; assignment += 1) {
      const physicalIndex = chunk.transformSchedule.physicalIndices[assignment];
      target.leaves[physicalIndex].writeTransform(chunk.transformSchedule.transforms[assignment]);
    }
    preparedTransformAssignments += transformEnd - transformStart;
    const colorStart = chunk.colorSchedule.offsets[nextLocalStateIndex];
    const colorEnd = chunk.colorSchedule.offsets[nextLocalStateIndex + 1];
    for (let assignment = colorStart; assignment < colorEnd; assignment += 1) {
      const physicalIndex = chunk.colorSchedule.physicalIndices[assignment];
      const colorIndex = chunk.colorSchedule.colorIndices[assignment];
      quads[physicalIndex].className = playback.palette[colorIndex].className;
    }
    preparedColorAssignments += colorEnd - colorStart;
    chunkIndex = chunk.chunkIndex;
    activeChunk = chunk;
    localStateIndex = nextLocalStateIndex;
    stateIndex = chunk.startStateIndex + nextLocalStateIndex;
    statesApplied += 1;
    return stateIndex;
  }

  function applyPreparedRestart() {
    for (let physicalIndex = 0; physicalIndex < quads.length; physicalIndex += 1) {
      target.leaves[physicalIndex].writeTransform(playback.restart.leafTransforms[physicalIndex]);
      quads[physicalIndex].className = playback.palette[playback.restart.colorIndices[physicalIndex]].className;
    }
    preparedTransformAssignments += playback.restart.transformCount;
    preparedColorAssignments += playback.restart.colorCount;
    chunkIndex = 0;
    activeChunk = decodedChunk(0);
    localStateIndex = 0;
    stateIndex = 0;
    statesApplied += 1;
    loopCount += 1;
    return stateIndex;
  }

  function advance() {
    if (preloadError) throw preloadError;
    const chunk = activeChunk;
    if (!chunk) throw new Error("Prepared ElectroPaint active chunk is missing");
    if (localStateIndex + 1 < chunk.stateCount) {
      const nextLocalStateIndex = localStateIndex + 1;
      const result = applyPreparedState(chunk, nextLocalStateIndex);
      if (nextLocalStateIndex + 1 === chunk.stateCount) {
        scheduleHorizonMaintenance((chunkIndex + 1) % playback.chunks.count);
      }
      return result;
    }
    if (chunkIndex + 1 >= playback.chunks.count) return applyPreparedRestart();
    const nextChunkIndex = chunkIndex + 1;
    const nextChunk = decodedChunk(nextChunkIndex);
    innerChunkBoundaryCount += 1;
    return applyPreparedState(nextChunk, 0);
  }

  async function applyAbsoluteState(nextStateIndex) {
    if (nextStateIndex === stateIndex) return stateIndex;
    cancelHorizonWork();
    const selectedChunkIndex = Math.floor(nextStateIndex / playback.chunks.framesPerChunk);
    const selectedLocalStateIndex = nextStateIndex % playback.chunks.framesPerChunk;
    await prepareHorizon(selectedChunkIndex);
    const chunk = decodedChunk(selectedChunkIndex);
    const selected = materializeChunkState(chunk, selectedLocalStateIndex);
    for (let physicalIndex = 0; physicalIndex < quads.length; physicalIndex += 1) {
      debugLeafWideComparisonCount += 1;
      target.leaves[physicalIndex].writeTransform(selected.transforms[physicalIndex]);
      quads[physicalIndex].className = playback.palette[selected.colors[physicalIndex]].className;
      debugTransformWrites += 1;
      debugColorClassWrites += 1;
    }
    chunkIndex = selectedChunkIndex;
    activeChunk = chunk;
    localStateIndex = selectedLocalStateIndex;
    stateIndex = nextStateIndex;
    statesApplied += 1;
    debugAbsoluteSeekCount += 1;
    if (selectedLocalStateIndex + 1 === chunk.stateCount) {
      scheduleHorizonMaintenance((selectedChunkIndex + 1) % playback.chunks.count);
    }
    return stateIndex;
  }

  function materializeChunkState(chunk, selectedLocalStateIndex) {
    const transforms = [...chunk.initial.leafTransforms];
    const colors = [...chunk.initial.colorIndices];
    for (let localIndex = 1; localIndex <= selectedLocalStateIndex; localIndex += 1) {
      for (let assignment = chunk.transformSchedule.offsets[localIndex];
        assignment < chunk.transformSchedule.offsets[localIndex + 1]; assignment += 1) {
        transforms[chunk.transformSchedule.physicalIndices[assignment]] =
          chunk.transformSchedule.transforms[assignment];
      }
      for (let assignment = chunk.colorSchedule.offsets[localIndex];
        assignment < chunk.colorSchedule.offsets[localIndex + 1]; assignment += 1) {
        colors[chunk.colorSchedule.physicalIndices[assignment]] =
          chunk.colorSchedule.colorIndices[assignment];
      }
    }
    return { transforms, colors };
  }

  function schedule(now) {
    if (paused || delay !== null) return;
    delay = requestDelay(loop, nextFrameAt - now);
  }

  function loop() {
    delay = null;
    schedulerCallbackCount += 1;
    if (paused) return;
    advance();
    nextFrameAt += frameMilliseconds;
    const now = readNow();
    if (nextFrameAt <= now) nextFrameAt = now + frameMilliseconds;
    schedule(now);
  }

  await prepareHorizon(0);
  activeChunk = decodedChunk(0);
  return Object.freeze({
    get stateIndex() { return stateIndex; },
    get paused() { return paused; },
    pause() {
      paused = true;
      nextFrameAt = null;
      if (delay !== null) cancelDelay(delay);
      delay = null;
      return stateIndex;
    },
    resume() {
      if (!paused) return stateIndex;
      paused = false;
      const now = readNow();
      nextFrameAt = now + frameMilliseconds;
      schedule(now);
      return stateIndex;
    },
    step(count = 1) {
      this.pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("Step count must be positive");
      if (amount === 1) return advance();
      return applyAbsoluteState((stateIndex + amount) % playback.stateCount);
    },
    setState(value) {
      this.pause();
      const selected = Math.trunc(Number(value));
      if (!Number.isSafeInteger(selected) || selected < 0 || selected >= playback.stateCount) {
        throw new RangeError(`ElectroPaint state must be between 0 and ${playback.stateCount - 1}`);
      }
      return applyAbsoluteState(selected);
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      return true;
    },
    stats() {
      target.assertStableDomIdentity();
      const storeStats = chunkStore.stats();
      return Object.freeze({
        schema: "cssselectropaint-prepared-player-stats@4",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        stateIndex,
        chunkIndex,
        localStateIndex,
        paused,
        preparedTimelineStateCount: playback.stateCount,
        preparedTimelineChunkCount: playback.chunks.count,
        preparedFramesPerChunk: playback.chunks.framesPerChunk,
        preparedStatesApplied: statesApplied,
        preparedTransformAssignmentCount: playback.metrics.transformAssignmentCount,
        preparedColorAssignmentCount: playback.metrics.colorAssignmentCount,
        preparedMeanTransformAssignmentsPerSequentialState: playback.metrics.meanTransformAssignmentsPerSequentialState,
        preparedMeanColorAssignmentsPerSequentialState: playback.metrics.meanColorAssignmentsPerSequentialState,
        preparedCadenceScheduleStateCount: 0,
        preparedCadenceEffectiveMeanStatesPerSecond: playback.presentationCadence.effectiveMeanStatesPerSecond,
        preparedChunkRequestCount: storeStats.requestCount,
        preparedLoadedChunkCount: storeStats.loadedChunkCount,
        preparedDecodedChunkCount: decodedChunks.size,
        preparedRetainedChunkRequestCount: storeStats.retainedRequestCount,
        runtimeRootTransformWrites: 0,
        runtimeTransformWrites: preparedTransformAssignments + debugTransformWrites,
        runtimeColorWrites: 0,
        runtimeColorClassWrites: preparedColorAssignments + debugColorClassWrites,
        runtimeOutlineWrites: 0,
        runtimePreparedTransformAssignments: preparedTransformAssignments,
        runtimePreparedColorAssignments: preparedColorAssignments,
        runtimeLeafWideComparisonCount: 0,
        runtimeRingIndexCalculationCount: 0,
        runtimeSchedulerCallbackCount: schedulerCallbackCount,
        runtimeAnimationFrameCallbackCount: 0,
        preparedInnerChunkBoundaryCount: innerChunkBoundaryCount,
        runtimeInnerChunkBoundaryResetCount: 0,
        deterministicBankLoopCount: loopCount,
        debugAbsoluteSeekCount,
        debugLeafWideComparisonCount,
        debugTransformWrites,
        debugColorClassWrites,
        runtimeGeometryConstructionCount: 0,
        runtimeMatrixCalculationCount: 0,
        runtimeColorCalculationCount: 0,
        runtimeRandomGenerationCount: 0,
        runtimeCameraCalculationCount: 0,
        runtimeCadenceCalculationCount: 0,
        runtimeCadenceDelayLookupCount: 0,
        runtimeHorizonMaintenanceRequestCount: horizonMaintenanceRequestCount,
        runtimeHorizonMaintenanceCallbackCount: horizonMaintenanceCallbackCount,
        runtimeHorizonIncrementalDecodeSliceCount: horizonIncrementalDecodeSliceCount,
        runtimeHorizonIncrementalDecodeDelayCount: horizonIncrementalDecodeDelayCount,
        runtimeHorizonIncrementalDecodeDelayCallbackCount: horizonIncrementalDecodeDelayCallbackCount,
        runtimeHorizonIncrementalDecodedTransformCount: horizonIncrementalDecodedTransformCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      this.pause();
      cancelHorizonWork();
    },
  });

  async function decodeChunkIncrementally(chunk, paletteCount, requestId) {
    let firstSlice = true;
    const transformSchedule = await decodePreparedElectropaintTransformScheduleIncrementally(
      chunk.transformSchedule,
      chunk.stateCount,
      40,
      (callback) => {
        const scheduleIdleSlice = () => {
          horizonDecodeSlice = requestIdle((deadline) => {
            horizonDecodeSlice = null;
            callback(deadline);
          }, { timeout: 1_000 });
        };
        if (firstSlice) {
          firstSlice = false;
          scheduleIdleSlice();
          return;
        }
        horizonIncrementalDecodeDelayCount += 1;
        horizonDecodeDelay = requestDelay(() => {
          horizonDecodeDelay = null;
          horizonIncrementalDecodeDelayCallbackCount += 1;
          scheduleIdleSlice();
        }, frameMilliseconds);
      },
      () => requestId === horizonRequest,
      (count) => {
        horizonIncrementalDecodeSliceCount += 1;
        horizonIncrementalDecodedTransformCount += count;
      },
    );
    if (transformSchedule === null) return null;
    const colorSchedule = decodeColorSchedule(chunk.colorSchedule, chunk.stateCount, 40, paletteCount);
    return Object.freeze({ ...chunk, transformSchedule, colorSchedule });
  }
}

function validate(playback, sceneRoot, quads) {
  if (playback?.schema !== "cssselectropaint-prepared-playback@4" ||
      !(sceneRoot instanceof HTMLElement) || sceneRoot.hasAttribute("style") ||
      getComputedStyle(sceneRoot).transform === "none" ||
      quads?.length !== 40 ||
      quads.some((quad) => !(quad instanceof HTMLElement) || quad.localName !== "b" ||
        quad.parentElement !== sceneRoot || quad.children.length !== 0) ||
      playback.stateCount !== playback.chunks?.count * playback.chunks?.framesPerChunk ||
      playback.chunks?.continuity !== "single-prepared-state-stream-split-without-inner-resets" ||
      playback.initialStateIndex !== 0 || playback.initial?.stateIndex !== 0 ||
      playback.initial?.leafTransforms?.length !== 40 || playback.initial?.colorIndices?.length !== 40 ||
      playback.restart?.schema !== "cssselectropaint-prepared-restart@1" ||
      playback.restart.transformCount !== 40 || playback.restart.colorCount !== 40 ||
      playback.restart.leafTransforms?.length !== 40 || playback.restart.colorIndices?.length !== 40 ||
      playback.rootTransform !== "translateY(135px) rotateX(45deg)" ||
      playback.outline?.invariant !== true || playback.outline.style !== "solid-white-1px" ||
      playback.outline.runtimeWrites !== 0 || playback.sourceFrameDelayMilliseconds !== 1_000 / 60 ||
      playback.presentationCadence?.policy !== "fixed-kent-animation-interval" ||
      playback.presentationCadence.dynamic !== false ||
      playback.presentationCadence.statesPerDisplay !== 1 ||
      playback.presentationCadence.sourceTicksPerSecond !== 60 ||
      playback.presentationCadence.runtimeSelection !== "single-constant-frame-period-no-cadence-table" ||
      playback.metrics?.maximumTransformAssignmentsPerSequentialState !== 40 ||
      playback.metrics.maximumColorAssignmentsPerSequentialState !== 1 ||
      playback.metrics.innerChunkBoundaryResetCount !== 0 ||
      !Array.isArray(playback.palette) || playback.palette.length < 1 ||
      playback.palette.some((entry, index) => entry?.className !== `cp${index}`) ||
      playback.initial.colorIndices.some((index) => !validPaletteIndex(index, playback.palette.length)) ||
      playback.restart.colorIndices.some((index) => !validPaletteIndex(index, playback.palette.length))) {
    throw new Error("Prepared ElectroPaint playback target is invalid");
  }
}

function decodeChunk(chunk, paletteCount) {
  const transformSchedule = decodePreparedElectropaintTransformSchedule(
    chunk.transformSchedule,
    chunk.stateCount,
    40,
  );
  const colorSchedule = decodeColorSchedule(chunk.colorSchedule, chunk.stateCount, 40, paletteCount);
  return Object.freeze({ ...chunk, transformSchedule, colorSchedule });
}

export function decodePreparedElectropaintTransformSchedule(schedule, stateCount, leafCount) {
  const { isBinary, physicalIndices } = validateTransformSchedule(schedule, stateCount, leafCount);
  const transforms = decodePredictedAffineValues(
    isBinary ? schedule.affineDeltas : schedule.affineDeltasBase64,
    physicalIndices,
    schedule.assignmentCount,
    schedule.affineQuantizationScale,
    leafCount,
  );
  return Object.freeze({ ...schedule, physicalIndices, transforms });
}

async function decodePreparedElectropaintTransformScheduleIncrementally(
  schedule,
  stateCount,
  leafCount,
  scheduleSlice,
  isCurrent,
  onSlice,
) {
  const { isBinary, physicalIndices } = validateTransformSchedule(schedule, stateCount, leafCount);
  const transforms = await decodePredictedAffineValuesIncrementally(
    isBinary ? schedule.affineDeltas : schedule.affineDeltasBase64,
    physicalIndices,
    schedule.assignmentCount,
    schedule.affineQuantizationScale,
    leafCount,
    scheduleSlice,
    isCurrent,
    onSlice,
  );
  return transforms === null ? null : Object.freeze({ ...schedule, physicalIndices, transforms });
}

function validateTransformSchedule(schedule, stateCount, leafCount) {
  const isBinary = schedule?.affineDeltas instanceof Uint8Array &&
    schedule.physicalIndices instanceof Uint8Array;
  if (schedule?.schema !== "cssselectropaint-prepared-chunk-transform-schedule@2" ||
      schedule.stateCount !== stateCount || schedule.offsets?.length !== stateCount + 1 ||
      !validOffsets(schedule.offsets, schedule.assignmentCount) ||
      schedule.maximumAssignmentsPerState > 40 ||
      schedule.encoding !== (isBinary
        ? "implicit-ring-addresses-plus-third-order-zigzag-varint-quantized-affine12"
        : "base64-u8-physical-indices-plus-third-order-zigzag-varint-quantized-affine12") ||
      schedule.affineComponentCount !== 12 || schedule.affineQuantizationScale !== 1_000 ||
      schedule.affinePredictorOrder !== 3 ||
      schedule.decodedMatrixStringCount !== schedule.assignmentCount ||
      schedule.runtimeSelection !== "prepared-state-range-only-no-leaf-wide-transform-comparisons") {
    throw new Error("Prepared ElectroPaint chunk transform schedule is invalid");
  }
  const physicalIndices = isBinary
    ? schedule.physicalIndices
    : decodeUint8(schedule.physicalIndicesBase64, schedule.assignmentCount);
  if (physicalIndices.some((index) => index >= leafCount)) {
    throw new Error("Prepared ElectroPaint chunk transform schedule addresses an invalid leaf");
  }
  return { isBinary, physicalIndices };
}

function decodePredictedAffineValues(encoded, physicalIndices, assignmentCount, scale, leafCount) {
  const binary = encoded instanceof Uint8Array
    ? encoded
    : Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
  const histories = Array.from({ length: leafCount }, () =>
    Array.from({ length: 12 }, () => [0, 0, 0]));
  const transforms = new Array(assignmentCount);
  let byteIndex = 0;
  for (let assignmentIndex = 0; assignmentIndex < assignmentCount; assignmentIndex += 1) {
    const history = histories[physicalIndices[assignmentIndex]];
    const affine = new Array(12);
    for (let componentIndex = 0; componentIndex < 12; componentIndex += 1) {
      const decoded = decodeUnsignedVarint(binary, byteIndex);
      byteIndex = decoded.nextByteIndex;
      const componentHistory = history[componentIndex];
      const predicted = 3 * componentHistory[0] - 3 * componentHistory[1] + componentHistory[2];
      const value = predicted + unzigzag(decoded.value);
      if (!Number.isSafeInteger(value)) {
        throw new Error("Prepared ElectroPaint affine predictor exceeded safe integer range");
      }
      componentHistory[2] = componentHistory[1];
      componentHistory[1] = componentHistory[0];
      componentHistory[0] = value;
      affine[componentIndex] = value / scale;
    }
    transforms[assignmentIndex] = matrix3dFromAffine(affine);
  }
  if (byteIndex !== binary.length) throw new Error("Prepared ElectroPaint affine payload has trailing bytes");
  return Object.freeze(transforms);
}

function decodePredictedAffineValuesIncrementally(
  encoded,
  physicalIndices,
  assignmentCount,
  scale,
  leafCount,
  scheduleSlice,
  isCurrent,
  onSlice,
) {
  const binary = encoded instanceof Uint8Array
    ? encoded
    : Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
  const histories = Array.from({ length: leafCount }, () =>
    Array.from({ length: 12 }, () => [0, 0, 0]));
  const transforms = new Array(assignmentCount);
  let assignmentIndex = 0;
  let byteIndex = 0;
  return new Promise((resolveDecode, rejectDecode) => {
    scheduleSlice(runSlice);

    function runSlice() {
      if (!isCurrent()) {
        resolveDecode(null);
        return;
      }
      try {
        const start = assignmentIndex;
        const end = Math.min(assignmentCount, assignmentIndex + 256);
        for (; assignmentIndex < end; assignmentIndex += 1) {
          const history = histories[physicalIndices[assignmentIndex]];
          const affine = new Array(12);
          for (let componentIndex = 0; componentIndex < 12; componentIndex += 1) {
            const decoded = decodeUnsignedVarint(binary, byteIndex);
            byteIndex = decoded.nextByteIndex;
            const componentHistory = history[componentIndex];
            const predicted = 3 * componentHistory[0] - 3 * componentHistory[1] + componentHistory[2];
            const value = predicted + unzigzag(decoded.value);
            if (!Number.isSafeInteger(value)) {
              throw new Error("Prepared ElectroPaint affine predictor exceeded safe integer range");
            }
            componentHistory[2] = componentHistory[1];
            componentHistory[1] = componentHistory[0];
            componentHistory[0] = value;
            affine[componentIndex] = value / scale;
          }
          transforms[assignmentIndex] = matrix3dFromAffine(affine);
        }
        onSlice(assignmentIndex - start);
        if (assignmentIndex < assignmentCount) {
          scheduleSlice(runSlice);
          return;
        }
        if (byteIndex !== binary.length) {
          throw new Error("Prepared ElectroPaint affine payload has trailing bytes");
        }
        resolveDecode(Object.freeze(transforms));
      } catch (error) {
        rejectDecode(error);
      }
    }
  });
}

function decodeUnsignedVarint(binary, startByteIndex) {
  let value = 0;
  let multiplier = 1;
  let byteIndex = startByteIndex;
  for (let count = 0; count < 8; count += 1) {
    if (byteIndex >= binary.length) throw new Error("Prepared ElectroPaint affine payload ended early");
    const byte = binary[byteIndex];
    byteIndex += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error("Prepared ElectroPaint affine varint overflowed");
      return { value, nextByteIndex: byteIndex };
    }
    multiplier *= 0x80;
  }
  throw new Error("Prepared ElectroPaint affine varint is too long");
}

function unzigzag(value) { return value % 2 === 0 ? value / 2 : -((value + 1) / 2); }

function matrix3dFromAffine(values) {
  return `matrix3d(${[
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ].map(canonicalNumber).join(",")})`;
}

function canonicalNumber(value) {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(12)).toString();
}

function decodeColorSchedule(schedule, stateCount, leafCount, paletteCount) {
  if (schedule?.schema !== "cssselectropaint-prepared-chunk-color-schedule@1" ||
      schedule.stateCount !== stateCount || schedule.offsets?.length !== stateCount + 1 ||
      !validOffsets(schedule.offsets, schedule.assignmentCount) ||
      schedule.maximumAssignmentsPerState > 1 ||
      schedule.runtimeSelection !== "prepared-state-range-only-no-leaf-wide-color-comparisons") {
    throw new Error("Prepared ElectroPaint chunk color schedule is invalid");
  }
  const physicalIndices = schedule.physicalIndices instanceof Uint8Array
    ? schedule.physicalIndices
    : decodeUint8(schedule.physicalIndicesBase64, schedule.assignmentCount);
  const colorIndices = schedule.colorIndices instanceof Uint16Array
    ? schedule.colorIndices
    : decodeUint16(schedule.colorIndicesBase64, schedule.assignmentCount);
  if (physicalIndices.some((index) => index >= leafCount) ||
      colorIndices.some((index) => index >= paletteCount)) {
    throw new Error("Prepared ElectroPaint chunk color schedule addresses an invalid leaf or palette entry");
  }
  return Object.freeze({ ...schedule, physicalIndices, colorIndices });
}

function validOffsets(offsets, assignmentCount) {
  return offsets[0] === 0 && offsets.at(-1) === assignmentCount && offsets.every((value, index) =>
    Number.isSafeInteger(value) && value >= 0 && (index === 0 || value >= offsets[index - 1]));
}

function validPaletteIndex(index, paletteCount) {
  return Number.isSafeInteger(index) && index >= 0 && index < paletteCount;
}

function decodeUint8(base64, expectedLength) {
  const binary = atob(base64);
  if (binary.length !== expectedLength) throw new Error("Prepared ElectroPaint uint8 schedule length drifted");
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}

function decodeUint16(base64, expectedLength) {
  const binary = atob(base64);
  if (binary.length !== expectedLength * 2) throw new Error("Prepared ElectroPaint uint16 schedule length drifted");
  const output = new Uint16Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    output[index] = binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8);
  }
  return output;
}
