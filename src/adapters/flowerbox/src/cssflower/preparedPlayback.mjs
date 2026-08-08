import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";
import {
  CSSFLOWER_FRONT_FACE_DILATION_TICKS,
  CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING,
  CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA,
  CSSFLOWER_VISIBILITY_POLICY,
} from "./renderContract.mjs";

export function timelineStateIndexForTick(tick, cycle) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssFlower tick must be a non-negative safe integer");
  if (tick < cycle.stateCount) return tick;
  return cycle.cycleStartState + ((tick - cycle.cycleStartState) % cycle.cycleLength);
}

export async function createCssflowerPreparedPlayer(options) {
  const {
    lighting,
    lightingPages,
    mesh,
    playback,
    rotationRoot,
    transformBlocks,
  } = options;
  const leaves = [...options.leaves];
  validatePlayback({ playback, lighting, transformBlocks, lightingPages, rotationRoot, mesh, leaves });
  const requestFrame = options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const setDelay = options.setDelay ?? globalThis.setTimeout.bind(globalThis);
  const clearDelay = options.clearDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = options.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const frameMilliseconds = 1000 / playback.sourceTicksPerSecond;
  const schedulerLeadMilliseconds = Math.min(4, frameMilliseconds / 4);
  let paused = true;
  let destroyed = false;
  let request = null;
  let delayRequest = null;
  let nextFrameAt = null;
  let globalTick = 0;
  let timelineStateIndex = -1;
  let geometryStateIndex = -1;
  let rootStateIndex = -1;
  let lightingPageIndex = -1;
  let lightingPageRowIndex = -1;
  let preparedStatesApplied = 0;
  let preparedGeometryStatePublishes = 0;
  let modelTransformWrites = 0;
  let leafTransformWrites = 0;
  let selectedLeafTransformAttempts = 0;
  let leafTransformSelectionTests = 0;
  let suppressedLeafTransformWrites = 0;
  let preparedSelectedTransformIndexReads = 0;
  let visibilityCatchupTransformAttempts = 0;
  let visibilityCatchupTransformWrites = 0;
  let leafVisibilityWrites = 0;
  let preparedVisibilityAssignmentReads = 0;
  let visibilityFullScanTests = 0;
  let visibilityCoalescedNoopAssignments = 0;
  let visibilitySkippedStateSelections = 0;
  let preparedFrontFacingStateSelections = 0;
  let presentedFrontFacingStateIndex = -1;
  let currentFrontFacingLeafCount = 0;
  let lightingAtlasWrites = 0;
  let lightingColumnWrites = 0;
  let lightingRowWrites = 0;
  let preparedLightingAddressWrites = 0;
  let preparedLightingStateSelections = 0;
  let preparedLightingSkippedStateSelections = 0;
  let runtimeSchedulerCallbacks = 0;
  let runtimeSchedulerTimerCallbacks = 0;
  let runtimeSchedulerTimerSchedules = 0;
  const lightingAddressSchedule = decodePreparedLightingAddressSchedule(lighting.addressSchedule);
  const frontFacingSchedule = decodePreparedFrontFacingSchedule(playback.frontFacingSchedule);
  const selectedFrontFacingByFace = new Uint8Array(leaves.length);
  selectedFrontFacingByFace.fill(255);
  const newlySelectedFaces = [];
  const pendingVisibilityByFace = new Int8Array(leaves.length);
  pendingVisibilityByFace.fill(-1);
  const pendingVisibilityFaces = [];
  const selectedLightingStateByFace = new Uint16Array(leaves.length);
  const pendingLightingStateByFace = new Int16Array(leaves.length);
  pendingLightingStateByFace.fill(-1);
  const pendingLightingFaces = [];
  let presentedLightingStateIndex = -1;

  const morphTarget = createPolyMorphPreparedDomTarget({
    model: {
      element: rotationRoot,
      writeTransform(transform) {
        if (rotationRoot.style.transform === transform) return false;
        rotationRoot.style.transform = transform;
        return true;
      },
    },
    shapes: [{ element: mesh }],
    leaves: leaves.map((element) => ({ element })),
  });

  function applyPreparedVisibilityAssignment(assignment) {
    const faceIndex = assignment >> 1;
    const selectedByte = assignment & 1;
    const previous = selectedFrontFacingByFace[faceIndex];
    if (previous === selectedByte) {
      visibilityCoalescedNoopAssignments += 1;
      return;
    }
    if (selectedByte === 1 && previous === 0) newlySelectedFaces.push(faceIndex);
    if (previous === 1) currentFrontFacingLeafCount -= 1;
    if (selectedByte === 1) currentFrontFacingLeafCount += 1;
    if (morphTarget.leaves[faceIndex].writeVisibility(selectedByte === 1)) leafVisibilityWrites += 1;
    selectedFrontFacingByFace[faceIndex] = selectedByte;
  }

  function applyPreparedFrontFacingSelection(nextStateIndex) {
    newlySelectedFaces.length = 0;
    if (presentedFrontFacingStateIndex === nextStateIndex) return;
    if (presentedFrontFacingStateIndex === -1) {
      if (nextStateIndex !== playback.cycle.initialState) {
        throw new Error("Prepared cssFlower visibility must initialize at the prepared initial state");
      }
      for (const assignment of frontFacingSchedule.initialVisibilityAssignments) {
        preparedVisibilityAssignmentReads += 1;
        applyPreparedVisibilityAssignment(assignment);
      }
      presentedFrontFacingStateIndex = nextStateIndex;
      preparedFrontFacingStateSelections += 1;
      return;
    }
    const advance = (
      nextStateIndex - presentedFrontFacingStateIndex + frontFacingSchedule.stateCount
    ) % frontFacingSchedule.stateCount;
    if (advance > 1) visibilitySkippedStateSelections += advance - 1;
    if (advance === 1) {
      const start = frontFacingSchedule.visibilityChangeOffsets[nextStateIndex];
      const end = frontFacingSchedule.visibilityChangeOffsets[nextStateIndex + 1];
      for (let update = start; update < end; update += 1) {
        preparedVisibilityAssignmentReads += 1;
        applyPreparedVisibilityAssignment(frontFacingSchedule.visibilityChangeAssignments[update]);
      }
      presentedFrontFacingStateIndex = nextStateIndex;
      preparedFrontFacingStateSelections += 1;
      return;
    }
    pendingVisibilityFaces.length = 0;
    for (let offset = 1; offset <= advance; offset += 1) {
      const stateIndex = (presentedFrontFacingStateIndex + offset) % frontFacingSchedule.stateCount;
      const start = frontFacingSchedule.visibilityChangeOffsets[stateIndex];
      const end = frontFacingSchedule.visibilityChangeOffsets[stateIndex + 1];
      for (let update = start; update < end; update += 1) {
        const assignment = frontFacingSchedule.visibilityChangeAssignments[update];
        const faceIndex = assignment >> 1;
        preparedVisibilityAssignmentReads += 1;
        if (pendingVisibilityByFace[faceIndex] < 0) pendingVisibilityFaces.push(faceIndex);
        pendingVisibilityByFace[faceIndex] = assignment & 1;
      }
    }
    for (const faceIndex of pendingVisibilityFaces) {
      const selected = pendingVisibilityByFace[faceIndex];
      pendingVisibilityByFace[faceIndex] = -1;
      applyPreparedVisibilityAssignment((faceIndex << 1) | selected);
    }
    presentedFrontFacingStateIndex = nextStateIndex;
    preparedFrontFacingStateSelections += 1;
  }

  function applyPreparedLightingAddress(faceIndex, stateIndex) {
    if (selectedLightingStateByFace[faceIndex] === stateIndex) return;
    const addressState = playback.cycle.states[stateIndex];
    const face = lighting.faces[faceIndex];
    const x = -(addressState.lightingPageIndex * lighting.atlasWidth + face.contentX);
    const y = -(addressState.lightingPageRowIndex * lighting.stateSliceHeight + face.contentY);
    leaves[faceIndex].style.backgroundPosition = `${x}px ${y}px`;
    selectedLightingStateByFace[faceIndex] = stateIndex;
    preparedLightingAddressWrites += 1;
  }

  function applyPreparedLightingAddresses(nextStateIndex) {
    if (presentedLightingStateIndex === -1) {
      if (nextStateIndex !== playback.cycle.initialState) {
        throw new Error("Prepared cssFlower lighting addresses must initialize at the prepared initial state");
      }
      presentedLightingStateIndex = nextStateIndex;
      return;
    }
    if (nextStateIndex === presentedLightingStateIndex) return;
    const advance = (
      nextStateIndex - presentedLightingStateIndex + lightingAddressSchedule.stateCount
    ) % lightingAddressSchedule.stateCount;
    if (advance > 1) preparedLightingSkippedStateSelections += advance - 1;
    if (advance === 1) {
      const start = lightingAddressSchedule.offsets[nextStateIndex];
      const end = lightingAddressSchedule.offsets[nextStateIndex + 1];
      for (let update = start; update < end; update += 1) {
        applyPreparedLightingAddress(lightingAddressSchedule.faceIndices[update], nextStateIndex);
      }
      presentedLightingStateIndex = nextStateIndex;
      preparedLightingStateSelections += 1;
      return;
    }
    pendingLightingFaces.length = 0;
    for (let offset = 1; offset <= advance; offset += 1) {
      const stateIndex = (presentedLightingStateIndex + offset) % lightingAddressSchedule.stateCount;
      const start = lightingAddressSchedule.offsets[stateIndex];
      const end = lightingAddressSchedule.offsets[stateIndex + 1];
      for (let update = start; update < end; update += 1) {
        const faceIndex = lightingAddressSchedule.faceIndices[update];
        if (pendingLightingStateByFace[faceIndex] < 0) pendingLightingFaces.push(faceIndex);
        pendingLightingStateByFace[faceIndex] = stateIndex;
      }
    }
    for (const faceIndex of pendingLightingFaces) {
      const stateIndex = pendingLightingStateByFace[faceIndex];
      pendingLightingStateByFace[faceIndex] = -1;
      applyPreparedLightingAddress(faceIndex, stateIndex);
    }
    presentedLightingStateIndex = nextStateIndex;
    preparedLightingStateSelections += 1;
  }

  async function applyTick(tick) {
    if (destroyed) throw new Error("Prepared cssFlower player is destroyed");
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("cssFlower tick must be a non-negative safe integer");
    const nextTimelineStateIndex = timelineStateIndexForTick(tick, playback.cycle);
    const state = playback.cycle.states[nextTimelineStateIndex];
    if (!state) throw new Error(`Prepared cssFlower timeline state ${nextTimelineStateIndex} is missing`);
    const geometryChanged = state.geometryStateIndex !== geometryStateIndex;
    const lightingPageChanged = state.lightingPageIndex !== lightingPageIndex;
    applyPreparedFrontFacingSelection(nextTimelineStateIndex);

    if (geometryChanged) {
      await transformBlocks.activate(
        state.geometryStateIndex,
        state.nextTransformBlockGeometryStateIndex,
      );
      const selectedStart = frontFacingSchedule.selectedFaceOffsets[nextTimelineStateIndex];
      const selectedEnd = frontFacingSchedule.selectedFaceOffsets[nextTimelineStateIndex + 1];
      transformBlocks.forEachTransformAtIndices(
        state.geometryStateIndex,
        frontFacingSchedule.selectedFaceIndices,
        selectedStart,
        selectedEnd,
        (transform, leafIndex) => {
        preparedSelectedTransformIndexReads += 1;
        selectedLeafTransformAttempts += 1;
        if (morphTarget.leaves[leafIndex].writeTransform(transform)) leafTransformWrites += 1;
      });
      preparedGeometryStatePublishes += 1;
      transformBlocks.commitPresented(
        state.geometryStateIndex,
        state.nextTransformBlockGeometryStateIndex,
      );
    } else if (newlySelectedFaces.length > 0) {
      for (const leafIndex of newlySelectedFaces) {
        visibilityCatchupTransformAttempts += 1;
        const transform = transformBlocks.transformAt(state.geometryStateIndex, leafIndex);
        if (morphTarget.leaves[leafIndex].writeTransform(transform)) {
          leafTransformWrites += 1;
          visibilityCatchupTransformWrites += 1;
        }
      }
    }

    if (lightingPageChanged) {
      await lightingPages.activate(
        state.lightingPageIndex,
        state.nextLightingPageIndex,
      );
      lightingPages.commitPresented(state.lightingPageIndex, state.nextLightingPageIndex);
    }
    applyPreparedLightingAddresses(nextTimelineStateIndex);
    if (morphTarget.model.writeTransform(playback.cycle.rootTransforms[state.rootStateIndex])) {
      modelTransformWrites += 1;
    }

    globalTick = tick;
    timelineStateIndex = nextTimelineStateIndex;
    geometryStateIndex = state.geometryStateIndex;
    rootStateIndex = state.rootStateIndex;
    lightingPageIndex = state.lightingPageIndex;
    lightingPageRowIndex = state.lightingPageRowIndex;
    preparedStatesApplied += 1;
    morphTarget.assertStableDomIdentity();
    return globalTick;
  }

  function scheduleNextFrame() {
    if (paused || request !== null || delayRequest !== null) return;
    const delay = nextFrameAt === null
      ? 0
      : Math.max(0, nextFrameAt - readNow() - schedulerLeadMilliseconds);
    if (delay <= 1) {
      request = requestFrame(loop);
      return;
    }
    runtimeSchedulerTimerSchedules += 1;
    delayRequest = setDelay(() => {
      delayRequest = null;
      runtimeSchedulerTimerCallbacks += 1;
      if (!paused && request === null) request = requestFrame(loop);
    }, delay);
  }

  async function loop(timestamp) {
    request = null;
    runtimeSchedulerCallbacks += 1;
    if (paused) return;
    if (nextFrameAt === null) {
      nextFrameAt = timestamp + frameMilliseconds;
    } else if (timestamp >= nextFrameAt - 0.5) {
      const elapsedSteps = Math.max(1, Math.floor((timestamp - nextFrameAt) / frameMilliseconds) + 1);
      await applyTick(globalTick + elapsedSteps);
      nextFrameAt += elapsedSteps * frameMilliseconds;
    }
    scheduleNextFrame();
  }

  function pause() {
    paused = true;
    nextFrameAt = null;
    if (request !== null) cancelFrame(request);
    request = null;
    if (delayRequest !== null) clearDelay(delayRequest);
    delayRequest = null;
    return globalTick;
  }

  await applyTick(0);
  return Object.freeze({
    get tick() { return globalTick; },
    get paused() { return paused; },
    pause,
    resume() {
      if (!paused) return globalTick;
      paused = false;
      nextFrameAt = null;
      scheduleNextFrame();
      return globalTick;
    },
    async step(count = 1) {
      pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("cssFlower step count must be a positive integer");
      return applyTick(globalTick + amount);
    },
    async setTick(value) {
      pause();
      const tick = Math.trunc(Number(value));
      return applyTick(tick);
    },
    assertStableDomIdentity() {
      morphTarget.assertStableDomIdentity();
      return true;
    },
    sample() {
      return Object.freeze({
        globalTick,
        timelineStateIndex,
        geometryStateIndex,
        rootStateIndex,
        lightingPageIndex,
        lightingPageRowIndex,
      });
    },
    stats() {
      morphTarget.assertStableDomIdentity();
      const state = playback.cycle.states[timelineStateIndex];
      return Object.freeze({
        schema: "cssflower-prepared-player-stats@1",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        globalTick,
        timelineStateIndex,
        geometryStateIndex,
        transformBlockIndex: state.transformBlockIndex,
        rootStateIndex,
        lightingPageIndex,
        lightingPageRowIndex,
        sourceSf: state.sf,
        sourceSfHex: state.sfHex,
        sourceSfi: state.sfi,
        sourceSfiHex: state.sfiHex,
        sourceRotationDegrees: [state.rotationXDegrees, state.rotationYDegrees, state.rotationZDegrees],
        sourceRotationIncrementDegrees: [3, 2, 0],
        retainedTriangleLeafCount: leaves.length,
        retainedRotationRootCount: 1,
        retainedPreparedShapeCount: 1,
        preparedTimelineStateCount: playback.cycle.stateCount,
        preparedGeometryStateCount: playback.cycle.geometryStateCount,
        preparedRootStateCount: playback.cycle.rootStateCount,
        preparedTransformBlockCount: playback.transformAsset.blockCount,
        preparedLightingPageCount: lighting.pageCount,
        preparedStatesApplied,
        runtimePreparedGeometryStatePublishes: preparedGeometryStatePublishes,
        runtimeModelTransformWrites: modelTransformWrites,
        runtimeShapeTransformWrites: 0,
        runtimeLeafTransformWrites: leafTransformWrites,
        runtimeSelectedLeafTransformAttempts: selectedLeafTransformAttempts,
        runtimeLeafTransformSelectionTests: leafTransformSelectionTests,
        runtimeSuppressedLeafTransformWrites: suppressedLeafTransformWrites,
        runtimePreparedSelectedTransformIndexReads: preparedSelectedTransformIndexReads,
        runtimeVisibilityCatchupTransformAttempts: visibilityCatchupTransformAttempts,
        runtimeVisibilityCatchupTransformWrites: visibilityCatchupTransformWrites,
        runtimeLeafVisibilityWrites: leafVisibilityWrites,
        runtimePreparedVisibilityAssignmentReads: preparedVisibilityAssignmentReads,
        runtimeVisibilityFullScanTests: visibilityFullScanTests,
        runtimeVisibilityCoalescedNoopAssignments: visibilityCoalescedNoopAssignments,
        runtimeVisibilitySkippedStateSelections: visibilitySkippedStateSelections,
        runtimePreparedFrontFacingStateSelections: preparedFrontFacingStateSelections,
        preparedFrontFacingDilationTicks: frontFacingSchedule.dilationTicks,
        preparedFrontFacingSelectedFaceCount: frontFacingSchedule.selectedFaceCount,
        preparedFrontFacingVisibilityChangeCount: frontFacingSchedule.visibilityChangeCount,
        preparedVisibilitySelectionDomain: frontFacingSchedule.selectionDomain,
        preparedVisibilityMinimumOwnedPixels: frontFacingSchedule.minimumOwnedPixels,
        preparedVisibilitySampleGrid: frontFacingSchedule.sampleGrid,
        preparedVisibilityAdjacencyRings: frontFacingSchedule.adjacencyRings,
        currentFrontFacingLeafCount,
        runtimeLightingAtlasWrites: lightingAtlasWrites,
        runtimeLightingColumnWrites: lightingColumnWrites,
        runtimeLightingRowWrites: lightingRowWrites,
        runtimePreparedLightingAddressWrites: preparedLightingAddressWrites,
        runtimePreparedLightingStateSelections: preparedLightingStateSelections,
        runtimePreparedLightingSkippedStateSelections: preparedLightingSkippedStateSelections,
        runtimeDirectLeafCssTextWrites: 0,
        runtimeProjectedFrameWrites: 0,
        runtimeProjectedAtlasWrites: 0,
        runtimePreparedPageLayoutAdoptions: 0,
        runtimePreparedPageBoundaryLeafStyleWrites: 0,
        transformBlockLoader: transformBlocks.stats(),
        lightingPageLoader: lightingPages.stats(),
        pendingLightingCommitCount: 0,
        runtimeSchedulerCallbacks,
        runtimeSchedulerTimerCallbacks,
        runtimeSchedulerTimerSchedules,
        runtimePolygonConstructionCount: 0,
        runtimeGeometryConstructionCount: 0,
        runtimeRadialProjectionCount: 0,
        runtimeProjectionCalculationCount: 0,
        runtimeRasterizationCount: 0,
        runtimeNormalCalculationCount: 0,
        runtimeLightingCalculationCount: 0,
        runtimeAtlasConstructionCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomGrowth: false,
      });
    },
    nodes() {
      return Object.freeze({ rotationRoot, mesh, leaves: Object.freeze([...leaves]) });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pause();
      morphTarget.destroy();
    },
  });
}

function validatePlayback({ playback, lighting, transformBlocks, lightingPages, rotationRoot, mesh, leaves }) {
  if (playback?.schema !== "cssflower-prepared-playback@1" ||
      playback.target !== "createPolyMorphPreparedDomTarget" ||
      playback.scope !== "rounded-product-cycle-positive-petals-omitted-negative-cube-lobe-retained" ||
      playback.sourceTicksPerSecond !== 30 ||
      playback.cycle?.schema !== "cssflower-prepared-rounded-product-cycle@2" ||
      playback.cycle?.stateCount !== 360 ||
      playback.cycle?.cycleStartState !== 0 ||
      playback.cycle?.cycleLength !== 360 ||
      playback.cycle?.bloomTraceStateCount !== 180 ||
      playback.cycle?.bloomCycleLength !== 180 ||
      playback.cycle?.bloomPeakGeometryStateIndex !== 49 ||
      playback.cycle?.bloomPeakSfHex !== "401cccc8" ||
      playback.cycle?.bloomPeakSfNominal !== 2.45 ||
      playback.cycle?.bloomMinimumGeometryStateIndex !== 72 ||
      playback.cycle?.bloomMinimumSfHex !== "bf933332" ||
      playback.cycle?.bloomMinimumSfNominal !== -1.15 ||
      playback.cycle?.bloomSourcePathLength !== 144 ||
      playback.cycle?.omittedSourceSfAtOrAbove !== 2.5 ||
      playback.cycle?.geometryStateCount !== 73 ||
      playback.cycle?.rootStateCount !== 360 ||
      playback.cycle?.states?.length !== 360 ||
      playback.cycle?.rootTransforms?.length !== 360 ||
      playback.cycle.states.some((state) =>
        !Number.isSafeInteger(state.rootStateIndex) || state.rootStateIndex < 0 || state.rootStateIndex >= 360 ||
        !Number.isSafeInteger(state.geometryStateIndex) || state.geometryStateIndex < 0 ||
        state.geometryStateIndex >= playback.cycle.geometryStateCount ||
        !Number.isSafeInteger(state.transformBlockIndex) ||
        !Number.isSafeInteger(state.nextTransformBlockGeometryStateIndex) ||
        !Number.isSafeInteger(state.lightingPageIndex) ||
        !Number.isSafeInteger(state.lightingPageRowIndex) ||
        !Number.isSafeInteger(state.nextLightingPageIndex)) ||
      lighting?.backgroundPositionXs?.length !== lighting?.pageCount ||
      lighting?.backgroundPositionYs?.length !== lighting?.pageRowCount ||
      !transformBlocks?.activate || !transformBlocks?.forEachTransformAtIndices ||
      !transformBlocks?.commitPresented || !transformBlocks?.stats ||
      !lightingPages?.activate || !lightingPages?.commitPresented ||
      !lightingPages?.urlFor || !lightingPages?.stats ||
      !(rotationRoot instanceof HTMLElement) || !(mesh instanceof HTMLElement) ||
      leaves.length !== 1_200) {
    throw new Error("Complete prepared cssFlower retained PolyCSS Morph playback is required");
  }
}

function decodePreparedLightingAddressSchedule(schedule) {
  if (schedule?.schema !== "cssflower-prepared-exact-sparse-lighting-address-schedule@1" ||
      schedule.stateCount !== 360 || schedule.faceCount !== 1_200 || schedule.threshold !== 0 ||
      schedule.faceIndicesEncoding !== "base64-u16le-state-major-updated-face-indices" ||
      schedule.offsets?.length !== 361 || schedule.offsets[0] !== 0 ||
      schedule.offsets.at(-1) !== schedule.updateCount ||
      !schedule.offsets.every((value, index) => Number.isSafeInteger(value) && value >= 0 &&
        (index === 0 || value >= schedule.offsets[index - 1])) ||
      typeof schedule.faceIndicesBase64 !== "string") {
    throw new Error("Prepared cssFlower exact sparse-lighting schedule is invalid");
  }
  const encoded = atob(schedule.faceIndicesBase64);
  if (encoded.length !== schedule.faceIndicesByteLength || encoded.length !== schedule.updateCount * 2) {
    throw new Error("Prepared cssFlower sparse-lighting schedule byte length drifted");
  }
  const faceIndices = new Uint16Array(schedule.updateCount);
  for (let index = 0; index < faceIndices.length; index += 1) {
    faceIndices[index] = encoded.charCodeAt(index * 2) | (encoded.charCodeAt(index * 2 + 1) << 8);
    if (faceIndices[index] >= schedule.faceCount) {
      throw new Error(`Prepared cssFlower sparse-lighting face ${index} is out of range`);
    }
  }
  return Object.freeze({
    stateCount: schedule.stateCount,
    faceCount: schedule.faceCount,
    offsets: Object.freeze([...schedule.offsets]),
    faceIndices,
  });
}

function decodePreparedFrontFacingSchedule(schedule) {
  if (schedule?.schema !== CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA ||
      schedule.stateCount !== 360 || schedule.faceCount !== 1_200 ||
      schedule.dilationTicks !== CSSFLOWER_FRONT_FACE_DILATION_TICKS ||
      schedule.selectionDomain !== CSSFLOWER_VISIBILITY_POLICY.selectionDomain ||
      schedule.depthComparison !== CSSFLOWER_VISIBILITY_POLICY.depthComparison ||
      schedule.minimumOwnedPixels !== CSSFLOWER_VISIBILITY_POLICY.minimumOwnedPixels ||
      schedule.sampleGrid !== CSSFLOWER_VISIBILITY_POLICY.sampleGrid ||
      schedule.adjacency !== CSSFLOWER_VISIBILITY_POLICY.adjacency ||
      schedule.adjacencyRings !== CSSFLOWER_VISIBILITY_POLICY.adjacencyRings ||
      schedule.dilationPolicy !== CSSFLOWER_VISIBILITY_POLICY.dilationPolicy ||
      schedule.encoding !== CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING ||
      !Number.isSafeInteger(schedule.selectedFaceCount) || schedule.selectedFaceCount < 1 ||
      schedule.suppressedFaceCount !== schedule.stateCount * schedule.faceCount - schedule.selectedFaceCount ||
      schedule.initialVisibilitySelectionCount !== schedule.faceCount ||
      !Number.isSafeInteger(schedule.visibilityChangeCount) || schedule.visibilityChangeCount < 1 ||
      schedule.selectedFaceOffsets?.length !== schedule.stateCount + 1 ||
      schedule.selectedFaceOffsets[0] !== 0 ||
      schedule.selectedFaceOffsets.at(-1) !== schedule.selectedFaceCount ||
      !validMonotonicOffsets(schedule.selectedFaceOffsets) ||
      schedule.selectedFaceIndicesEncoding !== "base64-u16le-state-major-selected-face-indices" ||
      schedule.selectedFaceIndicesByteLength !== schedule.selectedFaceCount * 2 ||
      typeof schedule.selectedFaceIndicesBase64 !== "string" ||
      schedule.visibilityChangeOffsets?.length !== schedule.stateCount + 1 ||
      schedule.visibilityChangeOffsets[0] !== 0 ||
      schedule.visibilityChangeOffsets.at(-1) !== schedule.visibilityChangeCount ||
      !validMonotonicOffsets(schedule.visibilityChangeOffsets) ||
      schedule.visibilityChangeAssignmentsEncoding !== "base64-u16le-state-major-face-index-shift-1-or-selected" ||
      schedule.visibilityChangeAssignmentsByteLength !== schedule.visibilityChangeCount * 2 ||
      typeof schedule.visibilityChangeAssignmentsBase64 !== "string" ||
      schedule.initialVisibilityAssignmentsEncoding !== "base64-u16le-face-major-face-index-shift-1-or-selected" ||
      schedule.initialVisibilityAssignmentsByteLength !== schedule.faceCount * 2 ||
      typeof schedule.initialVisibilityAssignmentsBase64 !== "string") {
    throw new Error("Prepared cssFlower owned-pixel visibility transform schedule is invalid");
  }
  const selectedFaceIndices = decodeUint16Le(
    schedule.selectedFaceIndicesBase64,
    schedule.selectedFaceIndicesByteLength,
    "selected transform indices",
  );
  const visibilityChangeAssignments = decodeUint16Le(
    schedule.visibilityChangeAssignmentsBase64,
    schedule.visibilityChangeAssignmentsByteLength,
    "visibility-change assignments",
  );
  const initialVisibilityAssignments = decodeUint16Le(
    schedule.initialVisibilityAssignmentsBase64,
    schedule.initialVisibilityAssignmentsByteLength,
    "initial visibility assignments",
  );
  const selectedByFace = new Uint8Array(schedule.faceCount);
  let selectedCount = 0;
  for (let index = 0; index < initialVisibilityAssignments.length; index += 1) {
    const assignment = initialVisibilityAssignments[index];
    const faceIndex = assignment >> 1;
    const selected = assignment & 1;
    if (faceIndex !== index) throw new Error("Prepared cssFlower initial visibility assignment order drifted");
    selectedByFace[faceIndex] = selected;
    selectedCount += selected;
  }
  assertPreparedSelectedState(0, selectedByFace, selectedCount);
  for (let stateIndex = 1; stateIndex < schedule.stateCount; stateIndex += 1) {
    selectedCount = applyPreparedTransitionState(stateIndex, selectedByFace, selectedCount);
    assertPreparedSelectedState(stateIndex, selectedByFace, selectedCount);
  }
  selectedCount = applyPreparedTransitionState(0, selectedByFace, selectedCount);
  assertPreparedSelectedState(0, selectedByFace, selectedCount);

  function applyPreparedTransitionState(stateIndex, current, currentCount) {
    const start = schedule.visibilityChangeOffsets[stateIndex];
    const end = schedule.visibilityChangeOffsets[stateIndex + 1];
    let previousFaceIndex = -1;
    for (let update = start; update < end; update += 1) {
      const assignment = visibilityChangeAssignments[update];
      const faceIndex = assignment >> 1;
      const selected = assignment & 1;
      if (faceIndex >= schedule.faceCount || faceIndex <= previousFaceIndex || current[faceIndex] === selected) {
        throw new Error(`Prepared cssFlower visibility transition ${stateIndex} is invalid`);
      }
      previousFaceIndex = faceIndex;
      currentCount += selected === 1 ? 1 : -1;
      current[faceIndex] = selected;
    }
    return currentCount;
  }

  function assertPreparedSelectedState(stateIndex, current, currentCount) {
    const start = schedule.selectedFaceOffsets[stateIndex];
    const end = schedule.selectedFaceOffsets[stateIndex + 1];
    if (end - start !== currentCount) {
      throw new Error(`Prepared cssFlower selected transform count ${stateIndex} drifted`);
    }
    let previousFaceIndex = -1;
    for (let index = start; index < end; index += 1) {
      const faceIndex = selectedFaceIndices[index];
      if (faceIndex >= schedule.faceCount || faceIndex <= previousFaceIndex || current[faceIndex] !== 1) {
        throw new Error(`Prepared cssFlower selected transform range ${stateIndex} is invalid`);
      }
      previousFaceIndex = faceIndex;
    }
  }
  return Object.freeze({
    stateCount: schedule.stateCount,
    faceCount: schedule.faceCount,
    dilationTicks: schedule.dilationTicks,
    selectionDomain: schedule.selectionDomain,
    minimumOwnedPixels: schedule.minimumOwnedPixels,
    sampleGrid: schedule.sampleGrid,
    adjacencyRings: schedule.adjacencyRings,
    selectedFaceOffsets: Object.freeze([...schedule.selectedFaceOffsets]),
    selectedFaceIndices,
    visibilityChangeOffsets: Object.freeze([...schedule.visibilityChangeOffsets]),
    visibilityChangeAssignments,
    initialVisibilityAssignments,
    selectedFaceCount: schedule.selectedFaceCount,
    visibilityChangeCount: schedule.visibilityChangeCount,
  });
}

function validMonotonicOffsets(offsets) {
  return offsets.every((value, index) => Number.isSafeInteger(value) && value >= 0 &&
    (index === 0 || value >= offsets[index - 1]));
}

function decodeUint16Le(base64, expectedByteLength, label) {
  const encoded = atob(base64);
  if (encoded.length !== expectedByteLength || encoded.length % 2 !== 0) {
    throw new Error(`Prepared cssFlower ${label} byte length drifted`);
  }
  const values = new Uint16Array(encoded.length / 2);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = encoded.charCodeAt(index * 2) | (encoded.charCodeAt(index * 2 + 1) << 8);
  }
  return values;
}
