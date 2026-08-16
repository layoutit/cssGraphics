import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createCsssolitairePreparedPlayer({
  playback,
  scene,
  leaves,
  layoutRulesByProfile,
  randomUint32 = cryptoRandomUint32,
}) {
  if (playback?.schema !== "csssolitaire-prepared-playback@2" ||
      !(scene instanceof HTMLElement) || !Array.isArray(leaves) ||
      leaves.length !== playback.retainedLeafCount || !Array.isArray(layoutRulesByProfile) ||
      layoutRulesByProfile.length !== 5 ||
      layoutRulesByProfile.some((rules) => !Array.isArray(rules) || rules.length !== leaves.length)) {
    throw new Error("Prepared cssSolitaire player input drifted");
  }
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: scene,
      writeTransform(transform) {
        scene.style.transform = transform;
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
  const initialFoundationFaceIndices = foundationLeaves.map(readFaceIndex);
  const foundationFaceIndices = [...initialFoundationFaceIndices];
  const foundationVisibility = new Uint8Array(foundationLeafCount);
  foundationVisibility.fill(1);
  const trailVisibility = new Uint8Array(trailLeaves.length);
  const trailLandscapeTransforms = layoutRulesByProfile[0]
    .slice(foundationLeafCount)
    .map((rule) => rule?.style.transform ?? "");
  const trailPortraitTransformsByCardCount = Array.from({ length: 4 }, (_, profileIndex) =>
    layoutRulesByProfile[profileIndex + 1]
      .slice(foundationLeafCount)
      .map((rule) => rule?.style.transform ?? ""));
  const trailLaneIndices = trailLeaves.map(readLaneIndex);
  const trailFaceIndices = trailLeaves.map(readFaceIndex);
  const atlasFaceIndices = new Map(playback.atlasPositions.map((position, index) => [position, index]));
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
  let foundationClassWrites = 0;
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
      leaves[leafIndex].classList.toggle("v", visible);
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
        leaf.classList.remove("v");
        visibleFoundationCards -= 1;
        writes += 1;
        continue;
      }
      const position = `${-atlasX}px ${-atlasY}px`;
      const faceIndex = atlasFaceIndices.get(position);
      if (!Number.isInteger(faceIndex)) throw new Error("Prepared cssSolitaire atlas position drifted");
      if (foundationFaceIndices[foundationIndex] !== faceIndex) {
        setFaceClass(leaf, foundationFaceIndices[foundationIndex], faceIndex);
        foundationFaceIndices[foundationIndex] = faceIndex;
        writes += 1;
      }
      if (foundationVisibility[foundationIndex] === 0) {
        foundationVisibility[foundationIndex] = 1;
        leaf.classList.add("v");
        visibleFoundationCards += 1;
        writes += 1;
      }
    }
    foundationClassWrites += writes;
    return writes;
  }

  function applyPatternLayout(nextPattern) {
    let writes = 0;
    for (let index = 0; index < nextPattern.trailLeafCount; index += 1) {
      const leaf = trailLeaves[index];
      const leafIndex = foundationLeafCount + index;
      const landscapeTransform = nextPattern.leafMatrices[index];
      const laneIndex = nextPattern.leafFoundationIndices[index];
      const faceIndex = nextPattern.leafAtlasIndices[index];
      patternLayoutLeavesVisited += 1;
      if (trailLandscapeTransforms[index] !== landscapeTransform) {
        trailLandscapeTransforms[index] = landscapeTransform;
        layoutRulesByProfile[0][leafIndex].style.transform = landscapeTransform;
        writes += 1;
      }
      for (let profileIndex = 0; profileIndex < 4; profileIndex += 1) {
        const portraitTransform = nextPattern.leafPortraitMatricesByCardCount[profileIndex][index];
        if (portraitTransform === null ||
            trailPortraitTransformsByCardCount[profileIndex][index] === portraitTransform) continue;
        const rule = layoutRulesByProfile[profileIndex + 1][leafIndex];
        if (!rule) throw new Error("Prepared cssSolitaire portrait rule bank drifted");
        trailPortraitTransformsByCardCount[profileIndex][index] = portraitTransform;
        rule.style.transform = portraitTransform;
        writes += 1;
      }
      if (trailLaneIndices[index] !== laneIndex) {
        leaf.classList.remove(`lane-${trailLaneIndices[index]}`);
        leaf.classList.add(`lane-${laneIndex}`);
        trailLaneIndices[index] = laneIndex;
        writes += 1;
      }
      if (trailFaceIndices[index] !== faceIndex) {
        setFaceClass(leaf, trailFaceIndices[index], faceIndex);
        trailFaceIndices[index] = faceIndex;
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
      trailLeaves[index].classList.remove("v");
      writes += 1;
    }
    let foundationWrites = 0;
    for (let index = 0; index < foundationLeafCount; index += 1) {
      const leaf = foundationLeaves[index];
      const initialFaceIndex = initialFoundationFaceIndices[index];
      if (foundationFaceIndices[index] !== initialFaceIndex) {
        setFaceClass(leaf, foundationFaceIndices[index], initialFaceIndex);
        foundationFaceIndices[index] = initialFaceIndex;
        foundationWrites += 1;
      }
      if (foundationVisibility[index] === 0) {
        foundationVisibility[index] = 1;
        leaf.classList.add("v");
        foundationWrites += 1;
      }
    }
    visibleTrailCards = 0;
    visibleFoundationCards = foundationLeafCount;
    frameIndex = 0;
    playheadMs = 0;
    visibilityWrites += writes;
    foundationClassWrites += foundationWrites;
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
        runtimeFoundationClassWrites: foundationClassWrites,
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

function readFaceIndex(leaf) {
  for (const className of leaf.classList) {
    if (!/^f[0-9a-z]+$/u.test(className)) continue;
    const index = Number.parseInt(className.slice(1), 36);
    if (Number.isSafeInteger(index) && index >= 0 && index < 52) return index;
  }
  throw new Error("Prepared cssSolitaire face class drifted");
}

function readLaneIndex(leaf) {
  for (const className of leaf.classList) {
    const match = className.match(/^lane-([0-3])$/u);
    if (match) return Number(match[1]);
  }
  throw new Error("Prepared cssSolitaire lane class drifted");
}

function setFaceClass(leaf, previousIndex, nextIndex) {
  leaf.classList.remove(`f${previousIndex.toString(36)}`);
  leaf.classList.add(`f${nextIndex.toString(36)}`);
}

function cryptoRandomUint32() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}
