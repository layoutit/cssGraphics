import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createCsssolitairePreparedPlayer({ playback, board, leaves }) {
  if (playback?.schema !== "csssolitaire-prepared-playback@1" ||
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

  const foundationLeafCount = playback.foundationLeafCount;
  const trailVisibility = new Uint8Array(leaves.length - foundationLeafCount);
  let paused = true;
  let timer = null;
  let cycleStartedAt = performance.now();
  let playheadMs = 0;
  let frameIndex = 0;
  let visibleTrailCards = 0;
  let visibilityWrites = 0;
  let visibilityOperationsApplied = 0;
  let timerCallbackCount = 0;
  let loopCount = 0;
  let resetCount = 0;
  let lastApply = Object.freeze({ visibilityWrites: 0, dirtyLeavesVisited: 0 });

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
    lastApply = Object.freeze({ visibilityWrites: writes, dirtyLeavesVisited: row.length });
  }

  function resetInitial() {
    let writes = 0;
    for (let index = 0; index < trailVisibility.length; index += 1) {
      if (trailVisibility[index] === 0) continue;
      trailVisibility[index] = 0;
      leaves[index + foundationLeafCount].style.visibility = "hidden";
      writes += 1;
    }
    visibleTrailCards = 0;
    frameIndex = 0;
    visibilityWrites += writes;
    resetCount += 1;
    lastApply = Object.freeze({ visibilityWrites: writes, dirtyLeavesVisited: writes });
  }

  function frameAt(timeMs) {
    let low = 0;
    let high = playback.frameTimesMs.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (playback.frameTimesMs[middle] <= timeMs) low = middle + 1;
      else high = middle - 1;
    }
    return Math.max(0, high);
  }

  function applyCycleTime(timeMs) {
    const targetFrame = frameAt(timeMs);
    if (targetFrame < frameIndex) resetInitial();
    for (let index = frameIndex + 1; index <= targetFrame; index += 1) {
      applyRow(playback.visibilityRows[index]);
    }
    frameIndex = targetFrame;
    playheadMs = timeMs;
  }

  function publishNow(now = performance.now()) {
    let elapsed = Math.max(0, now - cycleStartedAt);
    if (elapsed >= playback.durationMs) {
      const completedLoops = Math.floor(elapsed / playback.durationMs);
      cycleStartedAt += completedLoops * playback.durationMs;
      elapsed -= completedLoops * playback.durationMs;
      loopCount += completedLoops;
      resetInitial();
    }
    applyCycleTime(elapsed);
  }

  function schedule() {
    if (paused || timer !== null) return;
    const now = performance.now();
    const elapsed = Math.max(0, now - cycleStartedAt);
    const nextFrameTime = playback.frameTimesMs[frameIndex + 1];
    const deadline = cycleStartedAt + (nextFrameTime ?? playback.durationMs);
    timer = setTimeout(tick, Math.max(0, deadline - now));
    if (elapsed >= playback.durationMs) timer.refresh?.();
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
      playheadMs,
      frameIndex,
      sourceStep: Math.min(9131, Math.max(0, Math.floor((playheadMs - 500) / 7.5))),
      frameCount: playback.frameTimesMs.length,
      visibleTrailCards,
      retainedLeafCount: leaves.length,
      identityStable: true,
      lastApply,
    });
  }

  return Object.freeze({
    get ready() { return true; },
    get durationMs() { return playback.durationMs; },
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
      applyCycleTime(timeMs % playback.durationMs);
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
        schema: "csssolitaire-prepared-player-stats@1",
        morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
        morphAdopted: true,
        morphStableDomIdentity: true,
        paused,
        playheadMs,
        frameIndex,
        preparedTimelineStateCount: playback.frameTimesMs.length,
        preparedVisibilityOperationCount: playback.visibilityRows.reduce((sum, row) => sum + row.length, 0),
        runtimeVisibilityOperationsApplied: visibilityOperationsApplied,
        runtimeLeafVisibilityWrites: visibilityWrites,
        runtimeTimerCallbackCount: timerCallbackCount,
        runtimeAnimationFrameCallbackCount: 0,
        runtimeSchedulerTransport: "deadline-setTimeout-prepared-visibility-publication",
        preparedLoopResetCount: resetCount,
        loopCount,
        runtimeGeometryCalculationCount: 0,
        runtimeTrajectoryCalculationCount: 0,
        runtimeRandomNumberCount: 0,
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
