import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export async function createGravityWellPreparedPlayer({
  mounted,
  bank,
  bankCount,
  initialBankIndex,
  loadBank,
  cycleBanks = true,
  randomUint32 = cryptoRandomUint32,
  onBankChange = () => undefined,
  onError = () => undefined,
  requestFrame = globalThis.requestAnimationFrame.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis),
  setDelay = globalThis.setTimeout.bind(globalThis),
  clearDelay = globalThis.clearTimeout.bind(globalThis),
  readNow = globalThis.performance.now.bind(globalThis.performance),
  viewportSize = defaultViewportSize(),
}) {
  const leaves = mounted.model.render.leaves.map((leaf) => mounted.leafHandles.get(leaf.id)?.element);
  const shapes = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
  if (leaves.some((leaf) => !(leaf instanceof HTMLElement)) ||
      shapes.some((shape) => !(shape instanceof HTMLElement)) ||
      !Number.isSafeInteger(bankCount) || bankCount < 1 ||
      !Number.isSafeInteger(initialBankIndex) || initialBankIndex < 0 || initialBankIndex >= bankCount) {
    throw new Error("Gravity Well retained playback targets are incomplete");
  }
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.modelElement,
      writeTransform(transform) {
        if (mounted.modelElement.style.transform === transform) return false;
        mounted.modelElement.style.transform = transform;
        return true;
      },
    },
    shapes: shapes.map((element) => ({ element })),
    leaves: leaves.map((element) => ({ element })),
  });
  const leafStyles = leaves.map((element) => element.style);
  const leafTargets = target.leaves;
  const cachedTransforms = new Array(leaves.length);
  const cachedColorValues = new Uint16Array(leaves.length);
  const selectedVisibilityByLeaf = new Uint8Array(leaves.length);
  const newlyVisibleFlags = new Uint8Array(leaves.length);
  const newlyVisibleLeaves = [];
  let activeBankIndex = initialBankIndex;
  let activeBank = validateBank(bank, activeBankIndex, leaves.length);
  let playback = activeBank.playback;
  let transformBlocks = activeBank.transformBlocks;
  let changeSchedule = activeBank.changeSchedule;
  let selectedViewportSize = validateViewportSize(viewportSize.width, viewportSize.height);
  let visibilitySchedule = playback.visibilitySchedule;
  let selectedVisibilityProfile = selectVisibilityProfile(
    visibilitySchedule,
    selectedViewportSize.width,
    selectedViewportSize.height,
  );
  let presentedVisibilityFrameIndex = -1;
  let visibilityInitialized = false;
  let currentVisibleLeafCount = 0;
  let firstBlockLookaheadFrameIndex = Math.max(1, Math.floor(playback.blockFrameCount / 2));
  const frameMilliseconds = playback.frameMilliseconds;
  const schedulerLeadMilliseconds = Math.min(10, frameMilliseconds / 3);
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let delayRequest = null;
  let nextFrameAt = null;
  let tick = 0;
  let frameIndex = -1;
  let preparedFramesApplied = 0;
  let leafTransformWrites = 0;
  let leafColorWrites = 0;
  let preparedTransformValueReads = 0;
  let preparedColorValueReads = 0;
  let leafVisibilityWrites = 0;
  let preparedVisibilityAssignmentReads = 0;
  let visibilityCatchupTransformWrites = 0;
  let visibilityCatchupColorWrites = 0;
  let viewportProfileSwitchCount = 0;
  let viewportProfileRebuildLeafScanCount = 0;
  let schedulerCallbacks = 0;
  let schedulerFrameRequests = 0;
  let schedulerTimerCallbacks = 0;
  let schedulerTimerSchedules = 0;
  let bankSwitchCount = 0;
  let runtimeBankWaitCount = 0;
  let randomSelectionCount = 0;
  let shuffleBag = [];
  let pendingBankIndex = null;
  let pendingBankPromise = null;
  let pendingBank = null;

  function applyFrame(nextFrameIndex) {
    if (destroyed) throw new Error("Gravity Well player is destroyed");
    if (!Number.isSafeInteger(nextFrameIndex) || nextFrameIndex < 0 || nextFrameIndex >= playback.frameCount) {
      throw new RangeError("Gravity Well prepared frame is out of range");
    }
    const previousFrameIndex = frameIndex;
    const activation = transformBlocks.activate(nextFrameIndex);
    if (activation) return activation.then(() => publishFrame(nextFrameIndex, previousFrameIndex));
    return publishFrame(nextFrameIndex, previousFrameIndex);
  }

  function setLeafVisibility(leafIndex, visible) {
    if (leafTargets[leafIndex].writeVisibility(visible)) leafVisibilityWrites += 1;
  }

  function markVisibility(leafIndex, visible) {
    const selected = visible ? 1 : 0;
    if (selectedVisibilityByLeaf[leafIndex] === selected) return;
    selectedVisibilityByLeaf[leafIndex] = selected;
    currentVisibleLeafCount += selected === 1 ? 1 : -1;
    if (selected === 0) {
      setLeafVisibility(leafIndex, false);
      return;
    }
    newlyVisibleFlags[leafIndex] = 1;
    newlyVisibleLeaves.push(leafIndex);
  }

  function rebuildVisibilityFrame(profile, nextFrameIndex) {
    const selected = new Uint8Array(leaves.length);
    if (profile === null) {
      selected.fill(1);
      return selected;
    }
    for (const leafIndex of profile.initialVisibleIndices) selected[leafIndex] = 1;
    for (let frameIndex = 1; frameIndex <= nextFrameIndex; frameIndex += 1) {
      const start = profile.changeOffsets[frameIndex];
      const end = profile.changeOffsets[frameIndex + 1];
      for (let index = start; index < end; index += 1) {
        const assignment = profile.assignments[index];
        selected[assignment >> 1] = assignment & 1;
        preparedVisibilityAssignmentReads += 1;
      }
    }
    return selected;
  }

  function selectVisibilityFrame(nextFrameIndex, previousFrameIndex) {
    newlyVisibleLeaves.length = 0;
    if (!visibilityInitialized) {
      const selected = rebuildVisibilityFrame(selectedVisibilityProfile, nextFrameIndex);
      viewportProfileRebuildLeafScanCount += leaves.length;
      for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
        selectedVisibilityByLeaf[leafIndex] = selected[leafIndex];
        currentVisibleLeafCount += selected[leafIndex];
        if (selected[leafIndex] === 0) setLeafVisibility(leafIndex, false);
      }
      visibilityInitialized = true;
      presentedVisibilityFrameIndex = nextFrameIndex;
      return;
    }
    if (selectedVisibilityProfile === null && currentVisibleLeafCount === leaves.length) {
      presentedVisibilityFrameIndex = nextFrameIndex;
      return;
    }
    if (selectedVisibilityProfile !== null &&
        previousFrameIndex === presentedVisibilityFrameIndex &&
        nextFrameIndex === previousFrameIndex + 1) {
      const start = selectedVisibilityProfile.changeOffsets[nextFrameIndex];
      const end = selectedVisibilityProfile.changeOffsets[nextFrameIndex + 1];
      for (let index = start; index < end; index += 1) {
        const assignment = selectedVisibilityProfile.assignments[index];
        preparedVisibilityAssignmentReads += 1;
        markVisibility(assignment >> 1, (assignment & 1) === 1);
      }
      presentedVisibilityFrameIndex = nextFrameIndex;
      return;
    }
    const selected = rebuildVisibilityFrame(selectedVisibilityProfile, nextFrameIndex);
    viewportProfileRebuildLeafScanCount += leaves.length;
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
      markVisibility(leafIndex, selected[leafIndex] === 1);
    }
    presentedVisibilityFrameIndex = nextFrameIndex;
  }

  function publishNewlyVisibleLeaves() {
    for (const leafIndex of newlyVisibleLeaves) {
      const transform = cachedTransforms[leafIndex];
      if (typeof transform !== "string") throw new Error(`Prepared visible transform ${leafIndex} is missing`);
      leafStyles[leafIndex].transform = transform;
      leafStyles[leafIndex].color = playback.colorAsset.palette[cachedColorValues[leafIndex]];
      leafTransformWrites += 1;
      leafColorWrites += 1;
      visibilityCatchupTransformWrites += 1;
      visibilityCatchupColorWrites += 1;
      setLeafVisibility(leafIndex, true);
      newlyVisibleFlags[leafIndex] = 0;
    }
    newlyVisibleLeaves.length = 0;
  }

  function publishFrame(nextFrameIndex, previousFrameIndex) {
    selectVisibilityFrame(nextFrameIndex, previousFrameIndex);
    const changes = changeSchedule.selectFrame(nextFrameIndex, previousFrameIndex);
    const transformView = transformBlocks.selectFrame(nextFrameIndex, changes !== null);
    const colorView = transformBlocks.selectColorFrame(nextFrameIndex, changes !== null);
    const transforms = transformView.transforms;
    const transformStart = transformView.start;
    let transformWriteCount = 0;
    let colorWriteCount = 0;
    if (changes) {
      for (let index = changes.transformStart; index < changes.transformEnd; index += 1) {
        const leafIndex = changes.transformIndices[index];
        const transform = transforms[transformStart + index - changes.transformStart];
        cachedTransforms[leafIndex] = transform;
        preparedTransformValueReads += 1;
        if (selectedVisibilityByLeaf[leafIndex] === 0 || newlyVisibleFlags[leafIndex] === 1) continue;
        leafStyles[leafIndex].transform = transform;
        transformWriteCount += 1;
      }
      for (let index = changes.colorStart; index < changes.colorEnd; index += 1) {
        const leafIndex = changes.colorIndices[index];
        const colorValue = colorView.values[colorView.start + index - changes.colorStart];
        cachedColorValues[leafIndex] = colorValue;
        preparedColorValueReads += 1;
        if (selectedVisibilityByLeaf[leafIndex] === 0 || newlyVisibleFlags[leafIndex] === 1) continue;
        leafStyles[leafIndex].color = playback.colorAsset.palette[colorValue];
        colorWriteCount += 1;
      }
    } else {
      for (let leafIndex = 0; leafIndex < playback.leafCount; leafIndex += 1) {
        const transform = transforms[transformStart + leafIndex];
        const colorValue = colorView.values[colorView.start + leafIndex];
        cachedTransforms[leafIndex] = transform;
        cachedColorValues[leafIndex] = colorValue;
        preparedTransformValueReads += 1;
        preparedColorValueReads += 1;
        if (selectedVisibilityByLeaf[leafIndex] === 0 || newlyVisibleFlags[leafIndex] === 1) continue;
        leafStyles[leafIndex].transform = transform;
        leafStyles[leafIndex].color = playback.colorAsset.palette[colorValue];
        transformWriteCount += 1;
        colorWriteCount += 1;
      }
    }
    leafTransformWrites += transformWriteCount;
    leafColorWrites += colorWriteCount;
    publishNewlyVisibleLeaves();
    frameIndex = nextFrameIndex;
    preparedFramesApplied += 1;
    if (nextFrameIndex === firstBlockLookaheadFrameIndex) {
      firstBlockLookaheadFrameIndex = -1;
      const lookahead = transformBlocks.prefetchLookahead();
      if (lookahead) void lookahead.catch(onError);
      queueNextBank();
    }
    if (nextFrameIndex === activeBank.scene.timeline.sourceFrameEndIndex) queueNextBank();
    return frameIndex;
  }

  function nextBankIndex() {
    if (bankCount === 1) return activeBankIndex;
    if (shuffleBag.length === 0) {
      shuffleBag = Array.from({ length: bankCount }, (_, index) => index)
        .filter((index) => index !== activeBankIndex);
      for (let index = shuffleBag.length - 1; index > 0; index -= 1) {
        const value = randomUint32();
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
          throw new RangeError("Gravity Well shuffled-bank random value must be uint32");
        }
        const swapIndex = value % (index + 1);
        [shuffleBag[index], shuffleBag[swapIndex]] = [shuffleBag[swapIndex], shuffleBag[index]];
        randomSelectionCount += 1;
      }
    }
    return shuffleBag.shift();
  }

  function queueNextBank() {
    if (!cycleBanks || bankCount === 1 || pendingBankPromise || pendingBank) return pendingBankPromise;
    pendingBankIndex = nextBankIndex();
    pendingBankPromise = Promise.resolve(loadBank(pendingBankIndex, {
      lookahead: true,
      incremental: true,
      complete: true,
    })).then((loaded) => {
      pendingBank = validateBank(loaded, pendingBankIndex, leaves.length);
      pendingBankPromise = null;
      return pendingBank;
    }).catch((error) => {
      pendingBankPromise = null;
      onError(error);
      return null;
    });
    return pendingBankPromise;
  }

  function activatePendingBank() {
    if (!pendingBank) {
      runtimeBankWaitCount += 1;
      return Promise.resolve(queueNextBank()).then((loaded) => loaded ? activatePendingBank() : frameIndex);
    }
    const previousBlocks = transformBlocks;
    activeBank = pendingBank;
    activeBankIndex = pendingBankIndex;
    playback = activeBank.playback;
    transformBlocks = activeBank.transformBlocks;
    changeSchedule = activeBank.changeSchedule;
    visibilitySchedule = playback.visibilitySchedule;
    selectedVisibilityProfile = selectVisibilityProfile(
      visibilitySchedule,
      selectedViewportSize.width,
      selectedViewportSize.height,
    );
    firstBlockLookaheadFrameIndex = Math.max(1, Math.floor(playback.blockFrameCount / 2));
    frameIndex = 0;
    selectVisibilityFrame(frameIndex, -1);
    publishNewlyVisibleLeaves();
    pendingBank = null;
    pendingBankIndex = null;
    bankSwitchCount += 1;
    previousBlocks.destroy();
    onBankChange(activeBankIndex, activeBank.scene);
    return frameIndex;
  }

  function advanceOne() {
    if (frameIndex >= activeBank.scene.timeline.terminalFlatFrameIndex) {
      if (!cycleBanks || bankCount === 1) return frameIndex;
      return activatePendingBank();
    }
    tick += 1;
    return applyFrame(frameIndex + 1);
  }

  function requestPaintAlignedPublication() {
    frameRequest = requestFrame(loop);
    schedulerFrameRequests += 1;
  }

  function schedule() {
    if (paused || frameRequest !== null || delayRequest !== null) return;
    const delay = Math.max(0, nextFrameAt - readNow() - schedulerLeadMilliseconds);
    if (delay <= 1) {
      requestPaintAlignedPublication();
      return;
    }
    schedulerTimerSchedules += 1;
    delayRequest = setDelay(() => {
      delayRequest = null;
      schedulerTimerCallbacks += 1;
      if (!paused && frameRequest === null) requestPaintAlignedPublication();
    }, delay);
  }

  function loop(timestamp) {
    frameRequest = null;
    schedulerCallbacks += 1;
    if (paused) return;
    nextFrameAt += frameMilliseconds;
    if (nextFrameAt <= timestamp) nextFrameAt = timestamp + frameMilliseconds;
    const pending = advanceOne();
    if (pending && typeof pending.then === "function") void pending.then(schedule);
    else schedule();
  }

  function pause() {
    paused = true;
    nextFrameAt = null;
    if (frameRequest !== null) cancelFrame(frameRequest);
    frameRequest = null;
    if (delayRequest !== null) clearDelay(delayRequest);
    delayRequest = null;
    return tick;
  }

  await applyFrame(0);
  return Object.freeze({
    get tick() { return tick; },
    get frameIndex() { return frameIndex; },
    get sourceFrameIndex() {
      const value = frameIndex - activeBank.scene.timeline.sourceFrameStartIndex;
      return value >= 0 && value < activeBank.scene.source.frameCount ? value : null;
    },
    get activeBankIndex() { return activeBankIndex; },
    get paused() { return paused; },
    pause,
    resume() {
      if (!paused) return tick;
      paused = false;
      nextFrameAt = readNow() + frameMilliseconds;
      schedule();
      return tick;
    },
    async step(count = 1) {
      pause();
      const amount = Math.trunc(Number(count));
      if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError("Step count must be positive");
      for (let index = 0; index < amount; index += 1) await advanceOne();
      return frameIndex;
    },
    setTick(value) {
      pause();
      const next = Math.trunc(Number(value));
      if (!Number.isSafeInteger(next) || next < 0 || next >= playback.frameCount) {
        throw new RangeError("Gravity Well tick must be a prepared bank frame");
      }
      tick = next;
      return applyFrame(next);
    },
    seekSourceTick(value) {
      const sourceTick = Math.trunc(Number(value));
      if (!Number.isSafeInteger(sourceTick) || sourceTick < 0 || sourceTick >= activeBank.scene.source.frameCount) {
        throw new RangeError("Gravity Well source tick is out of range");
      }
      return this.setTick(activeBank.scene.timeline.sourceFrameStartIndex + sourceTick);
    },
    setViewportSize(width, height) {
      const nextViewportSize = validateViewportSize(width, height);
      const nextProfile = selectVisibilityProfile(
        visibilitySchedule,
        nextViewportSize.width,
        nextViewportSize.height,
      );
      selectedViewportSize = nextViewportSize;
      if (nextProfile === selectedVisibilityProfile) return profileDimensions(nextProfile);
      selectedVisibilityProfile = nextProfile;
      viewportProfileSwitchCount += 1;
      selectVisibilityFrame(frameIndex, -1);
      publishNewlyVisibleLeaves();
      return profileDimensions(nextProfile);
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      mounted.assertStableDomIdentity();
      return true;
    },
    stats() {
      return Object.freeze({
        tick,
        frameIndex,
        sourceFrameIndex: this.sourceFrameIndex,
        paused,
        activeBankIndex,
        activeSeed: activeBank.scene.seed,
        preparedBankCount: bankCount,
        pendingBankIndex,
        pendingBankReady: pendingBank !== null,
        preparedBankSwitchCount: bankSwitchCount,
        runtimePreparedBankWaitCount: runtimeBankWaitCount,
        runtimeRandomSelectionCount: randomSelectionCount,
        preparedFramesApplied,
        leafTransformAttempts: leafTransformWrites,
        leafTransformWrites,
        leafColorAttempts: leafColorWrites,
        leafColorWrites,
        preparedTransformValueReads,
        preparedColorValueReads,
        leafVisibilityWrites,
        preparedVisibilityAssignmentReads,
        visibilityCatchupTransformWrites,
        visibilityCatchupColorWrites,
        viewportProfileSwitchCount,
        viewportProfileRebuildLeafScanCount,
        selectedViewportWidth: selectedViewportSize.width,
        selectedViewportHeight: selectedViewportSize.height,
        selectedViewportProfileWidth: selectedVisibilityProfile?.width ?? null,
        selectedViewportProfileHeight: selectedVisibilityProfile?.height ?? null,
        currentVisibleLeafCount,
        schedulerCallbacks,
        schedulerFrameRequests,
        schedulerTimerCallbacks,
        schedulerTimerSchedules,
        schedulerLeadMilliseconds,
        runtimeSchedulerTransport: "deadline-setTimeout-requestAnimationFrame-prepared-publication",
        preparedTransformChangeIndexCount: changeSchedule.transformCount,
        preparedColorChangeIndexCount: changeSchedule.colorCount,
        runtimeGeometryConstructionCount: 0,
        runtimeTopologyConstructionCount: 0,
        runtimeAffineEvaluationCount: 0,
        runtimeColorCalculationCount: 0,
        runtimeViewportProjectionCount: 0,
        runtimePerFrameViewportLeafScanCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeApplyStableDomIdentityChecks: 0,
        transformBlocks: transformBlocks.stats(),
      });
    },
    destroy() {
      pause();
      destroyed = true;
      target.destroy();
      transformBlocks.destroy();
      if (pendingBank) pendingBank.transformBlocks.destroy();
    },
  });
}

function validateBank(bank, bankIndex, leafCount) {
  if (bank?.scene?.schema !== "cssgravitywell-prepared-bank@1" || bank.scene.bankIndex !== bankIndex ||
      bank.playback !== bank.scene.playback || bank.playback.leafCount !== leafCount ||
      typeof bank.transformBlocks?.activate !== "function" ||
      typeof bank.transformBlocks?.selectColorFrame !== "function" ||
      typeof bank.changeSchedule?.selectFrame !== "function" ||
      bank.playback.visibilitySchedule?.schema !== "cssgravitywell-prepared-viewport-visibility@2" ||
      bank.playback.visibilitySchedule.frameCount !== bank.playback.frameCount ||
      bank.playback.visibilitySchedule.leafCount !== leafCount ||
      bank.scene.timeline?.firstAndLastGroundFlat !== true ||
      bank.scene.timeline?.allWellsCompleteBeforeSwitch !== true) {
    throw new Error(`Gravity Well prepared bank ${bankIndex} is incomplete`);
  }
  return bank;
}

function defaultViewportSize() {
  const width = Number(globalThis.innerWidth);
  const height = Number(globalThis.innerHeight);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? Object.freeze({ width, height })
    : Object.freeze({ width: Infinity, height: Infinity });
}

function validateViewportSize(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if ((width !== Infinity && (!Number.isFinite(width) || width <= 0)) ||
      (height !== Infinity && (!Number.isFinite(height) || height <= 0))) {
    throw new RangeError("Gravity Well viewport dimensions must be positive");
  }
  return Object.freeze({ width, height });
}

function selectVisibilityProfile(schedule, viewportWidth, viewportHeight) {
  if (schedule?.schema !== "cssgravitywell-prepared-viewport-visibility@2" ||
      !Array.isArray(schedule.profiles) || schedule.profiles.length < 1) {
    throw new Error("Gravity Well prepared viewport visibility schedule is incomplete");
  }
  return schedule.profiles
    .filter((profile) => profile.width >= viewportWidth && profile.height >= viewportHeight)
    .sort((left, right) => left.width * left.height - right.width * right.height ||
      left.width + left.height - right.width - right.height)[0] ?? null;
}

function profileDimensions(profile) {
  return profile ? Object.freeze({ width: profile.width, height: profile.height }) : null;
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
