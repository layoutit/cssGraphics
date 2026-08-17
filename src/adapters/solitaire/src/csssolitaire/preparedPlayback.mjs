import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createCsssolitairePreparedPlayer({
  playback,
  host,
  renderer,
  scene,
  leaves,
  portraitBreakpoints,
  randomUint32 = cryptoRandomUint32,
}) {
  if (playback?.schema !== "csssolitaire-prepared-playback@2" ||
      !(host instanceof HTMLElement) || !validRenderer(renderer) ||
      !(scene instanceof HTMLElement) || !Array.isArray(leaves) ||
      leaves.length !== playback.retainedLeafCount ||
      JSON.stringify(portraitBreakpoints) !== "[520,720,920]") {
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
  const atlasFaceIndices = new Map(playback.atlasPositions.map((position, index) => [position, index]));
  const initialFoundationFaceIndices = foundationLeaves.map((leaf) => readFaceIndex(leaf, atlasFaceIndices));
  const foundationFaceIndices = [...initialFoundationFaceIndices];
  const foundationVisibility = new Uint8Array(foundationLeafCount);
  foundationVisibility.fill(1);
  const trailVisibility = new Uint8Array(trailLeaves.length);
  const trailFaceIndices = trailLeaves.map((leaf) => readFaceIndex(leaf, atlasFaceIndices));
  let activePatternIndex = playback.initialPatternIndex;
  let pattern = patterns[activePatternIndex];
  let activeProfileIndex = 0;
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
  let responsiveTransformWrites = 0;
  let responsiveProfileSwitchCount = 0;
  let responsiveMatrixResolutionCount = 0;
  let presentationUpdateCount = 0;
  let patternSwitchCount = 0;
  let randomSelectionCount = 0;
  let timerCallbackCount = 0;
  let loopCount = 0;
  let resetCount = 0;
  let presentationWidth = renderer.landscapePresentationBase[0];
  let presentationHeight = renderer.landscapePresentationBase[1];
  let presentationScale = renderer.landscapePresentationBaseScale;
  let lastApply = Object.freeze({
    visibilityWrites: 0,
    foundationWrites: 0,
    layoutWrites: 0,
    dirtyLeavesVisited: 0,
  });

  function layoutForPattern(nextPattern, index, profileIndex = activeProfileIndex) {
    return profileIndex === 0
      ? nextPattern.leafLayouts[index]
      : nextPattern.leafPortraitLayoutsByCardCount[profileIndex - 1][index];
  }

  function matrixForLayout(layout, width = presentationWidth, height = presentationHeight,
    scale = presentationScale) {
    responsiveMatrixResolutionCount += 1;
    return preparedMatrix(layout, width, height, scale, renderer);
  }

  function applyPresentation(nextProfileIndex, width, height, scale) {
    let writes = 0;
    for (let index = 0; index < foundationLeafCount; index += 1) {
      const layout = nextProfileIndex === 0
        ? playback.foundationLayouts[index]
        : playback.foundationPortraitLayoutsByCardCount[nextProfileIndex - 1][index];
      const transform = matrixForLayout(layout, width, height, scale);
      if (foundationLeaves[index].style.transform === transform) continue;
      foundationLeaves[index].style.transform = transform;
      writes += 1;
    }
    for (let index = 0; index < pattern.trailLeafCount; index += 1) {
      const transform = matrixForLayout(layoutForPattern(pattern, index, nextProfileIndex), width, height, scale);
      if (trailLeaves[index].style.transform === transform) continue;
      trailLeaves[index].style.transform = transform;
      writes += 1;
    }
    if (nextProfileIndex !== activeProfileIndex) responsiveProfileSwitchCount += 1;
    activeProfileIndex = nextProfileIndex;
    presentationWidth = width;
    presentationHeight = height;
    presentationScale = scale;
    responsiveTransformWrites += writes;
    presentationUpdateCount += 1;
  }

  function syncPresentation() {
    const width = host.clientWidth || renderer.landscapePresentationBase[0];
    const height = host.clientHeight || renderer.landscapePresentationBase[1];
    const nextProfileIndex = resolveResponsiveProfileIndex(portraitBreakpoints, width, height);
    const scale = resolvePresentationScale(renderer, width, height);
    if (nextProfileIndex === activeProfileIndex && width === presentationWidth &&
        height === presentationHeight && scale === presentationScale) return;
    applyPresentation(nextProfileIndex, width, height, scale);
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

  function applyPatternLayout(nextPattern) {
    let writes = 0;
    for (let index = 0; index < nextPattern.trailLeafCount; index += 1) {
      const leaf = trailLeaves[index];
      const transform = matrixForLayout(layoutForPattern(nextPattern, index));
      const faceIndex = nextPattern.leafAtlasIndices[index];
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
    patternLayoutWrites += writes;
    return writes;
  }

  function resetInitial() {
    let writes = 0;
    for (let index = 0; index < trailVisibility.length; index += 1) {
      if (trailVisibility[index] === 0) continue;
      trailVisibility[index] = 0;
      trailLeaves[index].style.visibility = "";
      writes += 1;
    }
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
      responsiveProfileIndex: activeProfileIndex,
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

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncPresentation) : null;
  resizeObserver?.observe(host);
  globalThis.addEventListener?.("resize", syncPresentation);
  syncPresentation();

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
        runtimeResponsiveTransformWrites: responsiveTransformWrites,
        runtimeResponsiveProfileSwitchCount: responsiveProfileSwitchCount,
        runtimeResponsiveMatrixResolutionCount: responsiveMatrixResolutionCount,
        runtimeFitCalculationPurpose: "prepared-layout-inline-matrix-resolution",
        runtimePresentationScale: presentationScale,
        runtimePresentationUpdateCount: presentationUpdateCount,
        responsiveProfileIndex: activeProfileIndex,
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
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", syncPresentation);
      target.destroy();
    },
  });
}

function resolveResponsiveProfileIndex(portraitBreakpoints, width, height) {
  if (height < width) return 0;
  if (width < portraitBreakpoints[0]) return 1;
  if (width < portraitBreakpoints[1]) return 2;
  if (width < portraitBreakpoints[2]) return 3;
  return 4;
}

function resolvePresentationScale(renderer, width, height) {
  if (height >= width) {
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
