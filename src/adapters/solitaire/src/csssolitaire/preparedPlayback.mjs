import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createCsssolitairePreparedPlayer({
  playback,
  board,
  leaves,
  randomUint32 = cryptoRandomUint32,
}) {
  if (playback?.schema !== "csssolitaire-prepared-playback@2" ||
      !(board instanceof HTMLElement) || !Array.isArray(leaves) ||
      leaves.length !== playback.retainedLeafCount) {
    throw new Error("Prepared cssSolitaire player input drifted");
  }
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: board,
      writeTransform(transform) {
        board.style.transform = transform;
        return true;
      },
    },
    shapes: [],
    leaves: [],
  });
  target.assertStableDomIdentity();

  const patterns = playback.patterns;
  const foundationLeafCount = playback.foundationLeafCount;
  const foundationLeaves = leaves.slice(0, foundationLeafCount);
  const trailLeaves = leaves.slice(foundationLeafCount);
  const initialFoundationPositions = foundationLeaves.map((leaf) => leaf.style.backgroundPosition);
  const foundationPositions = [...initialFoundationPositions];
  const foundationVisibility = new Uint8Array(foundationLeafCount);
  foundationVisibility.fill(1);
  const trailVisibility = new Uint8Array(trailLeaves.length);
  const trailLandscapeTransforms = trailLeaves.map((leaf) =>
    leaf.style.getPropertyValue("--csssolitaire-landscape-transform"));
  const trailPortraitTransformsByCardCount = Array.from({ length: 4 }, (_, profileIndex) =>
    trailLeaves.map((leaf) =>
      leaf.style.getPropertyValue(`--csssolitaire-portrait-${profileIndex + 1}-transform`)));
  const trailBackgroundPositions = trailLeaves.map((leaf) => leaf.style.backgroundPosition);
  let activePatternIndex = playback.initialPatternIndex;
  let pattern = patterns[activePatternIndex];
  let shuffleBag = [];
  let paused = true;
  let timer = null;
  let cycleStartedAt = performance.now();
  let playheadMs = 0;
  let frameIndex = 0;
  let visibleTrailCards = 0;
  let visibleFoundationCards = foundationLeafCount;
  let visibilityWrites = 0;
  let visibilityOperationsApplied = 0;
  let foundationStyleWrites = 0;
  let foundationOperationsApplied = 0;
  let patternLayoutWrites = 0;
  let patternLayoutLeavesVisited = 0;
  let patternSwitchCount = 0;
  let randomSelectionCount = 0;
  let timerCallbackCount = 0;
  let loopCount = 0;
  let resetCount = 0;
  let lastApply = Object.freeze({
    visibilityWrites: 0,
    foundationWrites: 0,
    layoutWrites: 0,
    dirtyLeavesVisited: 0,
  });

  function applyRow(row) {
    let writes = 0;
    for (const operation of row) {
      const leafIndex = Math.abs(operation) - 1;
      const trailIndex = leafIndex - foundationLeafCount;
      const visible = operation > 0;
      visibilityOperationsApplied += 1;
      if (Boolean(trailVisibility[trailIndex]) === visible) continue;
      trailVisibility[trailIndex] = Number(visible);
      leaves[leafIndex].style.visibility = visible ? "visible" : "hidden";
      visibleTrailCards += visible ? 1 : -1;
      visibilityWrites += 1;
      writes += 1;
    }
    return writes;
  }

  function applyFoundationRow(row) {
    let writes = 0;
    for (const [foundationIndex, atlasX, atlasY] of row) {
      foundationOperationsApplied += 1;
      const leaf = foundationLeaves[foundationIndex];
      if (atlasX < 0) {
        if (foundationVisibility[foundationIndex] === 0) continue;
        foundationVisibility[foundationIndex] = 0;
        leaf.style.visibility = "hidden";
        visibleFoundationCards -= 1;
        writes += 1;
        continue;
      }
      const position = `${-atlasX}px ${-atlasY}px`;
      if (foundationPositions[foundationIndex] !== position) {
        foundationPositions[foundationIndex] = position;
        leaf.style.backgroundPosition = position;
        writes += 1;
      }
      if (foundationVisibility[foundationIndex] === 0) {
        foundationVisibility[foundationIndex] = 1;
        leaf.style.visibility = "visible";
        visibleFoundationCards += 1;
        writes += 1;
      }
    }
    foundationStyleWrites += writes;
    return writes;
  }

  function applyPatternLayout(nextPattern) {
    let writes = 0;
    for (let index = 0; index < nextPattern.trailLeafCount; index += 1) {
      const leaf = trailLeaves[index];
      const landscapeTransform = nextPattern.leafMatrices[index];
      const backgroundPosition = playback.atlasPositions[nextPattern.leafAtlasIndices[index]];
      patternLayoutLeavesVisited += 1;
      if (trailLandscapeTransforms[index] !== landscapeTransform) {
        trailLandscapeTransforms[index] = landscapeTransform;
        leaf.style.setProperty("--csssolitaire-landscape-transform", landscapeTransform);
        writes += 1;
      }
      for (let profileIndex = 0; profileIndex < 4; profileIndex += 1) {
        const portraitTransform = nextPattern.leafPortraitMatricesByCardCount[profileIndex][index];
        if (portraitTransform === null ||
            trailPortraitTransformsByCardCount[profileIndex][index] === portraitTransform) continue;
        trailPortraitTransformsByCardCount[profileIndex][index] = portraitTransform;
        leaf.style.setProperty(
          `--csssolitaire-portrait-${profileIndex + 1}-transform`,
          portraitTransform,
        );
        writes += 1;
      }
      if (trailBackgroundPositions[index] !== backgroundPosition) {
        trailBackgroundPositions[index] = backgroundPosition;
        leaf.style.backgroundPosition = backgroundPosition;
        writes += 1;
      }
    }
    patternLayoutWrites += writes;
    return writes;
  }

  function resetInitial() {
    let writes = 0;
    for (let index = 0; index < trailVisibility.length; index += 1) {
      if (trailVisibility[index] === 0) continue;
      trailVisibility[index] = 0;
      trailLeaves[index].style.visibility = "hidden";
      writes += 1;
    }
    let foundationWrites = 0;
    for (let index = 0; index < foundationLeafCount; index += 1) {
      const leaf = foundationLeaves[index];
      const initialPosition = initialFoundationPositions[index];
      if (foundationPositions[index] !== initialPosition) {
        foundationPositions[index] = initialPosition;
        leaf.style.backgroundPosition = initialPosition;
        foundationWrites += 1;
      }
      if (foundationVisibility[index] === 0) {
        foundationVisibility[index] = 1;
        leaf.style.visibility = "visible";
        foundationWrites += 1;
      }
    }
    visibleTrailCards = 0;
    visibleFoundationCards = foundationLeafCount;
    frameIndex = 0;
    playheadMs = 0;
    visibilityWrites += writes;
    foundationStyleWrites += foundationWrites;
    resetCount += 1;
    lastApply = Object.freeze({
      visibilityWrites: writes,
      foundationWrites,
      layoutWrites: 0,
      dirtyLeavesVisited: writes + foundationWrites,
    });
  }

  function nextPatternIndex() {
    if (patterns.length === 1) return 0;
    if (shuffleBag.length === 0) {
      shuffleBag = patterns.map((_, index) => index).filter((index) => index !== activePatternIndex);
      for (let index = shuffleBag.length - 1; index > 0; index -= 1) {
        const value = randomUint32();
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
          throw new RangeError("cssSolitaire shuffled-bank random value must be uint32");
        }
        const swapIndex = value % (index + 1);
        [shuffleBag[index], shuffleBag[swapIndex]] = [shuffleBag[swapIndex], shuffleBag[index]];
        randomSelectionCount += 1;
      }
    }
    return shuffleBag.shift();
  }

  function activatePattern(nextIndex) {
    const nextPattern = patterns[nextIndex];
    if (!nextPattern || nextIndex === activePatternIndex) {
      throw new RangeError("Prepared cssSolitaire pattern handoff is invalid");
    }
    const layoutWrites = applyPatternLayout(nextPattern);
    activePatternIndex = nextIndex;
    pattern = nextPattern;
    patternSwitchCount += 1;
    lastApply = Object.freeze({
      visibilityWrites: 0,
      foundationWrites: 0,
      layoutWrites,
      dirtyLeavesVisited: nextPattern.trailLeafCount,
    });
  }

  function frameAt(timeMs) {
    let low = 0;
    let high = pattern.frameTimesMs.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (pattern.frameTimesMs[middle] <= timeMs) low = middle + 1;
      else high = middle - 1;
    }
    return Math.max(0, high);
  }

  function applyCycleTime(timeMs) {
    const targetFrame = frameAt(timeMs);
    if (targetFrame < frameIndex) resetInitial();
    for (let index = frameIndex + 1; index <= targetFrame; index += 1) {
      const visibilityRow = pattern.visibilityRows[index];
      const foundationRow = pattern.foundationRows[index];
      const trailWrites = applyRow(visibilityRow);
      const foundationWrites = applyFoundationRow(foundationRow);
      lastApply = Object.freeze({
        visibilityWrites: trailWrites,
        foundationWrites,
        layoutWrites: 0,
        dirtyLeavesVisited: visibilityRow.length + foundationRow.length,
      });
    }
    frameIndex = targetFrame;
    playheadMs = timeMs;
  }

  function publishNow(now = performance.now()) {
    let elapsed = Math.max(0, now - cycleStartedAt);
    while (elapsed >= pattern.durationMs) {
      cycleStartedAt += pattern.durationMs;
      elapsed = Math.max(0, now - cycleStartedAt);
      resetInitial();
      activatePattern(nextPatternIndex());
      loopCount += 1;
    }
    applyCycleTime(elapsed);
  }

  function schedule() {
    if (paused || timer !== null) return;
    const now = performance.now();
    const nextFrameTime = pattern.frameTimesMs[frameIndex + 1];
    const deadline = cycleStartedAt + (nextFrameTime ?? pattern.durationMs);
    timer = setTimeout(tick, Math.max(0, deadline - now));
  }

  function tick() {
    timer = null;
    if (paused) return;
    timerCallbackCount += 1;
    publishNow();
    schedule();
  }

  function snapshot() {
    target.assertStableDomIdentity();
    return Object.freeze({
      ready: true,
      playing: !paused,
      patternIndex: activePatternIndex,
      patternId: pattern.id,
      patternCount: patterns.length,
      playheadMs,
      frameIndex,
      rewinding: playheadMs >= pattern.rewindStartMilliseconds && playheadMs <= pattern.rewindEndMilliseconds,
      sourceStep: Math.min(
        pattern.sourceStepCount,
        Math.max(0, Math.floor((playheadMs - playback.initialHoldMilliseconds) / playback.sourceStepMilliseconds)),
      ),
      frameCount: pattern.frameTimesMs.length,
      visibleTrailCards,
      visibleFoundationCards,
      retainedLeafCount: leaves.length,
      identityStable: true,
      lastApply,
    });
  }

  return Object.freeze({
    get ready() { return true; },
    get durationMs() { return pattern.durationMs; },
    get loop() { return true; },
    pause() {
      if (!paused) publishNow();
      paused = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return snapshot();
    },
    resume() {
      if (!paused) return snapshot();
      paused = false;
      cycleStartedAt = performance.now() - playheadMs;
      schedule();
      return snapshot();
    },
    seek(timeMs) {
      if (!Number.isFinite(timeMs) || timeMs < 0) {
        throw new TypeError("cssSolitaire seek expects a finite non-negative time");
      }
      this.pause();
      resetInitial();
      applyCycleTime(timeMs % pattern.durationMs);
      return snapshot();
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      return true;
    },
    snapshot,
    stats() {
      target.assertStableDomIdentity();
      return Object.freeze({
        schema: "csssolitaire-prepared-player-stats@2",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        activePatternIndex,
        activePatternId: pattern.id,
        preparedPatternCount: patterns.length,
        playheadMs,
        frameIndex,
        preparedTimelineStateCount: patterns.reduce((sum, entry) => sum + entry.frameTimesMs.length, 0),
        preparedVisibilityOperationCount: patterns.reduce((sum, entry) =>
          sum + entry.visibilityRows.reduce((entrySum, row) => entrySum + row.length, 0), 0),
        preparedFoundationOperationCount: patterns.reduce((sum, entry) =>
          sum + entry.foundationRows.reduce((entrySum, row) => entrySum + row.length, 0), 0),
        preparedLeafLayoutCount: patterns.reduce((sum, entry) => sum + entry.trailLeafCount, 0),
        runtimeVisibilityOperationsApplied: visibilityOperationsApplied,
        runtimeFoundationOperationsApplied: foundationOperationsApplied,
        runtimeLeafVisibilityWrites: visibilityWrites,
        runtimeFoundationStyleWrites: foundationStyleWrites,
        runtimePatternLayoutWrites: patternLayoutWrites,
        runtimePatternLayoutLeavesVisited: patternLayoutLeavesVisited,
        runtimePreparedPatternSwitchCount: patternSwitchCount,
        runtimeRandomSelectionCount: randomSelectionCount,
        runtimeRandomSelectionPurpose: "prepared-pattern-shuffled-bag-index-only",
        runtimeTimerCallbackCount: timerCallbackCount,
        runtimeAnimationFrameCallbackCount: 0,
        runtimeSchedulerTransport: "deadline-setTimeout-prepared-visibility-publication",
        preparedLoopResetCount: resetCount,
        loopCount,
        runtimeGeometryCalculationCount: 0,
        runtimeTrajectoryCalculationCount: 0,
        runtimeAtlasRasterizationCount: 0,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      this.pause();
      target.destroy();
    },
  });
}

function cryptoRandomUint32() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}
