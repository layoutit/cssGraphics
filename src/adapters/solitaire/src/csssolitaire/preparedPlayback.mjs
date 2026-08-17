import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createCsssolitairePreparedPlayer({
  playback,
  host,
  renderer,
  scene,
  leaves,
  width = host?.clientWidth,
  height = host?.clientHeight,
  initialPatternIndex,
  randomUint32 = cryptoRandomUint32,
}) {
  if (playback?.schema !== "csssolitaire-prepared-profile@1" ||
      !(host instanceof HTMLElement) || !validRenderer(renderer) ||
      !(scene instanceof HTMLElement) || !Array.isArray(leaves) ||
      leaves.length !== playback.retainedLeafCount || playback.phoneProfileIndex !== 1 ||
      !["mobile", "small-desktop", "large-desktop"].includes(playback.bankId) ||
      !Number.isSafeInteger(playback.profileIndex) || playback.profileIndex < 0 ||
      playback.profileIndex > 4 || !Number.isFinite(width) || width <= 0 ||
      !Number.isFinite(height) || height <= 0 ||
      !Array.isArray(playback.snapshotPlayfield) || playback.snapshotPlayfield.length !== 2 ||
      !Number.isFinite(playback.snapshotPresentationScale)) {
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
  const selectedInitialPatternIndex = initialPatternIndex === undefined
    ? selectInitialPatternIndex(patterns.length, randomUint32)
    : validatedPatternIndex(initialPatternIndex, patterns.length);
  const foundationLeafCount = playback.foundationLeafCount;
  const foundationLeaves = leaves.slice(0, foundationLeafCount);
  const trailLeaves = leaves.slice(foundationLeafCount);
  const atlasFaceIndices = new Map(playback.atlasPositions.map((position, index) => [position, index]));
  const initialFoundationFaceIndices = foundationLeaves.map((leaf) => readFaceIndex(leaf, atlasFaceIndices));
  const foundationFaceIndices = [...initialFoundationFaceIndices];
  const foundationVisibility = new Uint8Array(foundationLeafCount);
  foundationVisibility.fill(1);
  const trailVisibility = new Uint8Array(trailLeaves.length);
  const visibleTrailIndices = new Set();
  const trailFaceIndices = trailLeaves.map((leaf) => readFaceIndex(leaf, atlasFaceIndices));
  let activePatternIndex = selectedInitialPatternIndex;
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
  let patternLayoutLeavesRequired = 0;
  let resetTrailLeavesVisited = 0;
  let resetTrailLeavesRequired = 0;
  let responsiveTransformWrites = 0;
  let responsiveMatrixResolutionCount = 0;
  let presentationUpdateCount = 0;
  let patternSwitchCount = 0;
  let randomSelectionCount = initialPatternIndex === undefined && patterns.length > 1 ? 1 : 0;
  let timerCallbackCount = 0;
  let loopCount = 0;
  let resetCount = 0;
  let presentationWidth = width;
  let presentationHeight = height;
  let presentationScale = resolvePresentationScale(renderer, width, height, playback.profileIndex);
  let patternFaceInitializedLeafCount = 0;
  let lastApply = Object.freeze({
    visibilityWrites: 0,
    foundationWrites: 0,
    layoutWrites: 0,
    dirtyLeavesVisited: 0,
  });

  function faceIndexForPattern(nextPattern, index) {
    return Number.isSafeInteger(nextPattern.atlasIndex)
      ? nextPattern.atlasIndex
      : nextPattern.leafAtlasIndices[index];
  }

  function matrixForLayout(layout, nextWidth = presentationWidth, nextHeight = presentationHeight,
    scale = presentationScale) {
    responsiveMatrixResolutionCount += 1;
    return preparedMatrix(layout, nextWidth, nextHeight, scale, renderer);
  }

  function applyFoundationLayouts(nextWidth, nextHeight, scale) {
    let writes = 0;
    for (let index = 0; index < foundationLeafCount; index += 1) {
      const transform = matrixForLayout(playback.foundationLayouts[index], nextWidth, nextHeight, scale);
      if (foundationLeaves[index].style.transform === transform) continue;
      foundationLeaves[index].style.transform = transform;
      writes += 1;
    }
    return writes;
  }

  function applyPatternLayout(nextPattern, nextWidth = presentationWidth,
    nextHeight = presentationHeight, scale = presentationScale) {
    let writes = 0;
    patternLayoutLeavesRequired += nextPattern.trailLeafCount;
    for (let index = 0; index < nextPattern.trailLeafCount; index += 1) {
      const leaf = trailLeaves[index];
      const transform = matrixForLayout(nextPattern.layouts[index], nextWidth, nextHeight, scale);
      const faceIndex = faceIndexForPattern(nextPattern, index);
      patternLayoutLeavesVisited += 1;
      if (leaf.style.transform !== transform) {
        leaf.style.transform = transform;
        writes += 1;
      }
      if (trailFaceIndices[index] !== faceIndex) {
        leaf.style.backgroundPosition = playback.atlasPositions[faceIndex];
        trailFaceIndices[index] = faceIndex;
        writes += 1;
      }
    }
    patternFaceInitializedLeafCount = nextPattern.trailLeafCount;
    patternLayoutWrites += writes;
    return writes;
  }

  function applyInitialPresentation() {
    const snapshotMatches = playback.snapshotProfileIndex === playback.profileIndex &&
      activePatternIndex === playback.initialPatternIndex &&
      width === playback.snapshotPlayfield[0] && height === playback.snapshotPlayfield[1] &&
      presentationScale === playback.snapshotPresentationScale;
    if (snapshotMatches) {
      patternFaceInitializedLeafCount = pattern.trailLeafCount;
      return;
    }
    const snapshotFoundationMatches = playback.snapshotProfileIndex === playback.profileIndex &&
      width === playback.snapshotPlayfield[0] && height === playback.snapshotPlayfield[1] &&
      presentationScale === playback.snapshotPresentationScale;
    const foundationWrites = snapshotFoundationMatches
      ? 0
      : applyFoundationLayouts(width, height, presentationScale);
    const layoutWrites = applyPatternLayout(pattern, width, height, presentationScale);
    responsiveTransformWrites += foundationWrites + layoutWrites;
    presentationUpdateCount += 1;
    lastApply = Object.freeze({
      visibilityWrites: 0,
      foundationWrites,
      layoutWrites,
      dirtyLeavesVisited: pattern.trailLeafCount + (snapshotFoundationMatches ? 0 : foundationLeafCount),
    });
  }

  function resize(nextWidth, nextHeight) {
    if (!Number.isFinite(nextWidth) || nextWidth <= 0 ||
        !Number.isFinite(nextHeight) || nextHeight <= 0) {
      throw new TypeError("Prepared cssSolitaire resize drifted");
    }
    const scale = resolvePresentationScale(renderer, nextWidth, nextHeight, playback.profileIndex);
    if (nextWidth === presentationWidth && nextHeight === presentationHeight &&
        scale === presentationScale) return snapshot();
    let writes = applyFoundationLayouts(nextWidth, nextHeight, scale);
    for (let index = 0; index < pattern.trailLeafCount; index += 1) {
      const transform = matrixForLayout(pattern.layouts[index], nextWidth, nextHeight, scale);
      if (trailLeaves[index].style.transform === transform) continue;
      trailLeaves[index].style.transform = transform;
      writes += 1;
    }
    presentationWidth = nextWidth;
    presentationHeight = nextHeight;
    presentationScale = scale;
    responsiveTransformWrites += writes;
    presentationUpdateCount += 1;
    return snapshot();
  }

  function applyRow(row) {
    let writes = 0;
    for (const operation of row) {
      const leafIndex = Math.abs(operation) - 1;
      const trailIndex = leafIndex - foundationLeafCount;
      const visible = operation > 0;
      visibilityOperationsApplied += 1;
      if (Boolean(trailVisibility[trailIndex]) === visible) continue;
      trailVisibility[trailIndex] = Number(visible);
      leaves[leafIndex].style.visibility = visible ? "visible" : "";
      if (visible) visibleTrailIndices.add(trailIndex);
      else visibleTrailIndices.delete(trailIndex);
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
        leaf.style.visibility = "";
        visibleFoundationCards -= 1;
        writes += 1;
        continue;
      }
      const position = `${-atlasX}px ${-atlasY}px`;
      const faceIndex = atlasFaceIndices.get(position);
      if (!Number.isInteger(faceIndex)) throw new Error("Prepared cssSolitaire atlas position drifted");
      if (foundationFaceIndices[foundationIndex] !== faceIndex) {
        leaf.style.backgroundPosition = position;
        foundationFaceIndices[foundationIndex] = faceIndex;
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

  function resetInitial() {
    const writes = visibleTrailIndices.size;
    resetTrailLeavesRequired += writes;
    for (const index of visibleTrailIndices) {
      resetTrailLeavesVisited += 1;
      trailVisibility[index] = 0;
      trailLeaves[index].style.visibility = "";
    }
    visibleTrailIndices.clear();
    let foundationWrites = 0;
    for (let index = 0; index < foundationLeafCount; index += 1) {
      const leaf = foundationLeaves[index];
      const initialFaceIndex = initialFoundationFaceIndices[index];
      if (foundationFaceIndices[index] !== initialFaceIndex) {
        leaf.style.backgroundPosition = playback.atlasPositions[initialFaceIndex];
        foundationFaceIndices[index] = initialFaceIndex;
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
        const value = validatedRandomUint32(randomUint32);
        const swapIndex = value % (index + 1);
        [shuffleBag[index], shuffleBag[swapIndex]] = [shuffleBag[swapIndex], shuffleBag[index]];
        randomSelectionCount += 1;
      }
    }
    const oppositeDirection = -Math.sign(pattern.phoneHorizontalVelocity);
    const oppositeIndex = shuffleBag.findIndex((patternIndex) =>
      Math.sign(patterns[patternIndex].phoneHorizontalVelocity) === oppositeDirection);
    return oppositeIndex < 0 ? shuffleBag.shift() : shuffleBag.splice(oppositeIndex, 1)[0];
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
      responsiveProfileIndex: playback.profileIndex,
      playheadMs,
      frameIndex,
      durationMs: pattern.durationMs,
      launchCardCount: pattern.launchCardCount,
      timelineTrailLeafCount: pattern.trailLeafCount,
      rewinding: playheadMs >= pattern.rewindStartMilliseconds &&
        playheadMs <= pattern.rewindEndMilliseconds,
      sourceStep: Math.min(pattern.sourceStepCount, Math.max(0, Math.floor(
        (playheadMs - playback.initialHoldMilliseconds) / pattern.sourceStepMilliseconds,
      ))),
      frameCount: pattern.frameTimesMs.length,
      visibleTrailCards,
      visibleFoundationCards,
      retainedLeafCount: leaves.length,
      identityStable: true,
      lastApply,
    });
  }

  applyInitialPresentation();

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
    resize,
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      return true;
    },
    snapshot,
    stats() {
      target.assertStableDomIdentity();
      return Object.freeze({
        schema: "csssolitaire-prepared-player-stats@3",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        activePatternIndex,
        activePatternId: pattern.id,
        preparedBankId: playback.bankId,
        preparedPatternCount: patterns.length,
        preparedProfileIndex: playback.profileIndex,
        preparedProfileName: playback.profileName,
        playheadMs,
        frameIndex,
        preparedTimelineStateCount: patterns.reduce((sum, entry) => sum + entry.frameTimesMs.length, 0),
        preparedPhoneTimelineStateCount: playback.profileIndex === playback.phoneProfileIndex
          ? patterns.reduce((sum, entry) => sum + entry.frameTimesMs.length, 0)
          : 0,
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
        runtimePatternLayoutLeavesRequired: patternLayoutLeavesRequired,
        runtimePatternLayoutUnusedLeavesVisited: patternLayoutLeavesVisited - patternLayoutLeavesRequired,
        runtimeResponsiveFaceLeavesVisited: 0,
        runtimeResponsiveFaceLeavesRequired: 0,
        runtimeResponsiveFaceUnusedLeavesVisited: 0,
        runtimeResetTrailLeavesVisited: resetTrailLeavesVisited,
        runtimeResetTrailLeavesRequired: resetTrailLeavesRequired,
        runtimeResetUnusedLeavesVisited: resetTrailLeavesVisited - resetTrailLeavesRequired,
        activePatternFaceInitializedLeafCount: patternFaceInitializedLeafCount,
        runtimeResponsiveTransformWrites: responsiveTransformWrites,
        runtimeResponsiveMatrixResolutionCount: responsiveMatrixResolutionCount,
        runtimeFitCalculationPurpose: "prepared-layout-inline-matrix-resolution",
        runtimePresentationScale: presentationScale,
        runtimePresentationUpdateCount: presentationUpdateCount,
        responsiveProfileIndex: playback.profileIndex,
        runtimePreparedPatternSwitchCount: patternSwitchCount,
        runtimeRandomSelectionCount: randomSelectionCount,
        runtimeRandomSelectionPurpose:
          "prepared-pattern-random-initial-and-shuffled-bag-alternating-phone-direction-unique-angle",
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

function resolvePresentationScale(renderer, width, height, profileIndex) {
  if (profileIndex > 0) {
    return Math.min(
      width / renderer.portraitPresentationBase[0],
      height / renderer.portraitPresentationBase[1],
    );
  }
  return Math.min(
    renderer.landscapeCardMaximumWidthCssPixels / renderer.cardSourceSize[0],
    renderer.landscapePresentationBaseScale * Math.min(
      width / renderer.landscapePresentationBase[0],
      height / renderer.landscapePresentationBase[1],
    ),
  );
}

function preparedMatrix(layout, width, height, presentationScale, renderer) {
  const [xViewport, xCardWidthFactor, yViewport, yPixels, yCardHeightFactor] = layout;
  const [cardWidth, cardHeight] = renderer.cardSourceSize;
  const [primitiveWidth, primitiveHeight] = renderer.cardPrimitiveSize;
  const scaleX = cardHeight / primitiveWidth * presentationScale;
  const scaleY = cardWidth / primitiveHeight * presentationScale;
  const x = xViewport / 100 * width + xCardWidthFactor * cardWidth * presentationScale;
  const y = yViewport / 100 * height + yPixels + yCardHeightFactor * cardHeight * presentationScale;
  return `matrix(0,${rounded(scaleX)},${rounded(-scaleY)},0,${rounded(x)},${rounded(y)})`;
}

function rounded(value) {
  const next = Math.round(value * 1e6) / 1e6;
  return Object.is(next, -0) ? 0 : next;
}

function validRenderer(renderer) {
  return Array.isArray(renderer?.cardSourceSize) && renderer.cardSourceSize.length === 2 &&
    Array.isArray(renderer.cardPrimitiveSize) && renderer.cardPrimitiveSize.length === 2 &&
    Array.isArray(renderer.landscapePresentationBase) && renderer.landscapePresentationBase.length === 2 &&
    Array.isArray(renderer.portraitPresentationBase) && renderer.portraitPresentationBase.length === 2 &&
    Number.isFinite(renderer.landscapePresentationBaseScale) &&
    Number.isFinite(renderer.landscapeCardMaximumWidthCssPixels);
}

function readFaceIndex(leaf, atlasFaceIndices) {
  const index = atlasFaceIndices.get(leaf.style.backgroundPosition);
  if (Number.isSafeInteger(index)) return index;
  throw new Error("Prepared cssSolitaire inline atlas position drifted");
}

function cryptoRandomUint32() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function selectInitialPatternIndex(patternCount, randomUint32) {
  if (patternCount <= 1) return 0;
  return validatedRandomUint32(randomUint32) % patternCount;
}

function validatedPatternIndex(index, patternCount) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= patternCount) {
    throw new RangeError("cssSolitaire prepared pattern index drifted");
  }
  return index;
}

function validatedRandomUint32(randomUint32) {
  const value = randomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("cssSolitaire prepared-bank random value must be uint32");
  }
  return value;
}
