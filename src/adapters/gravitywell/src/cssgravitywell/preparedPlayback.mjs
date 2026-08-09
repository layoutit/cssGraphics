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
  setDelay = globalThis.setTimeout.bind(globalThis),
  clearDelay = globalThis.clearTimeout.bind(globalThis),
  readNow = globalThis.performance.now.bind(globalThis.performance),
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
  let activeBankIndex = initialBankIndex;
  let activeBank = validateBank(bank, activeBankIndex, leaves.length);
  let playback = activeBank.playback;
  let transformBlocks = activeBank.transformBlocks;
  let changeSchedule = activeBank.changeSchedule;
  let firstBlockLookaheadFrameIndex = Math.max(1, Math.floor(playback.blockFrameCount / 2));
  const frameMilliseconds = playback.frameMilliseconds;
  let paused = true;
  let destroyed = false;
  let delayRequest = null;
  let nextFrameAt = null;
  let tick = 0;
  let frameIndex = -1;
  let preparedFramesApplied = 0;
  let leafTransformWrites = 0;
  let leafColorWrites = 0;
  let schedulerCallbacks = 0;
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

  function publishFrame(nextFrameIndex, previousFrameIndex) {
    const changes = changeSchedule.selectFrame(nextFrameIndex, previousFrameIndex);
    const transformView = transformBlocks.selectFrame(nextFrameIndex, changes !== null);
    const colorView = transformBlocks.selectColorFrame(nextFrameIndex, changes !== null);
    const transforms = transformView.transforms;
    const transformStart = transformView.start;
    let transformWriteCount = playback.leafCount;
    let colorWriteCount = playback.leafCount;
    if (changes) {
      transformWriteCount = changes.transformEnd - changes.transformStart;
      colorWriteCount = changes.colorEnd - changes.colorStart;
      for (let index = changes.transformStart; index < changes.transformEnd; index += 1) {
        const leafIndex = changes.transformIndices[index];
        leafStyles[leafIndex].transform = transforms[transformStart + index - changes.transformStart];
      }
      for (let index = changes.colorStart; index < changes.colorEnd; index += 1) {
        const leafIndex = changes.colorIndices[index];
        leafStyles[leafIndex].color = playback.colorAsset.palette[
          colorView.values[colorView.start + index - changes.colorStart]
        ];
      }
    } else {
      for (let leafIndex = 0; leafIndex < playback.leafCount; leafIndex += 1) {
        leafStyles[leafIndex].transform = transforms[transformStart + leafIndex];
        leafStyles[leafIndex].color = playback.colorAsset.palette[colorView.values[colorView.start + leafIndex]];
      }
    }
    leafTransformWrites += transformWriteCount;
    leafColorWrites += colorWriteCount;
    frameIndex = nextFrameIndex;
    preparedFramesApplied += 1;
    if (nextFrameIndex === firstBlockLookaheadFrameIndex) {
      firstBlockLookaheadFrameIndex = -1;
      const lookahead = transformBlocks.prefetchLookahead();
      if (lookahead) void lookahead.catch(onError);
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
    pendingBankPromise = Promise.resolve(loadBank(pendingBankIndex)).then((loaded) => {
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
    firstBlockLookaheadFrameIndex = Math.max(1, Math.floor(playback.blockFrameCount / 2));
    frameIndex = 0;
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

  function schedule() {
    if (paused || delayRequest !== null) return;
    const delay = nextFrameAt === null ? 0 : Math.ceil(Math.max(0, nextFrameAt - readNow()));
    schedulerTimerSchedules += 1;
    delayRequest = setDelay(loop, delay);
  }

  function loop() {
    delayRequest = null;
    schedulerCallbacks += 1;
    if (paused) return;
    const timestamp = readNow();
    if (nextFrameAt === null) {
      nextFrameAt = timestamp + frameMilliseconds;
      schedule();
      return;
    }
    if (timestamp < nextFrameAt) {
      schedule();
      return;
    }
    nextFrameAt += frameMilliseconds;
    if (nextFrameAt <= timestamp) nextFrameAt = timestamp + frameMilliseconds;
    const pending = advanceOne();
    if (pending && typeof pending.then === "function") void pending.then(schedule);
    else schedule();
  }

  function pause() {
    paused = true;
    nextFrameAt = null;
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
      nextFrameAt = null;
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
        schedulerCallbacks,
        schedulerTimerCallbacks: schedulerCallbacks,
        schedulerTimerSchedules,
        preparedTransformChangeIndexCount: changeSchedule.transformCount,
        preparedColorChangeIndexCount: changeSchedule.colorCount,
        runtimeGeometryConstructionCount: 0,
        runtimeTopologyConstructionCount: 0,
        runtimeAffineEvaluationCount: 0,
        runtimeColorCalculationCount: 0,
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
      bank.scene.timeline?.firstAndLastGroundFlat !== true ||
      bank.scene.timeline?.allWellsCompleteBeforeSwitch !== true) {
    throw new Error(`Gravity Well prepared bank ${bankIndex} is incomplete`);
  }
  return bank;
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
