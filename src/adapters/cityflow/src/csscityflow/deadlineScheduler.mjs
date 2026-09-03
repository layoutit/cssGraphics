// SPDX-License-Identifier: HPND
const EARLY_DEADLINE_TOLERANCE_RATIO = 1 / 4;
const MINIMUM_DISTINCT_PUBLICATION_SPACING_RATIO =
  1 - EARLY_DEADLINE_TOLERANCE_RATIO;

export function createCityflowDeadlineScheduler({
  frameMilliseconds,
  publishDue,
  readNow = () => globalThis.performance.now(),
  requestFrame = globalThis.requestAnimationFrame.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis),
}) {
  if (!Number.isFinite(frameMilliseconds) || frameMilliseconds <= 0 ||
      typeof publishDue !== "function" || typeof readNow !== "function") {
    throw new TypeError("Cityflow deadline scheduler contract drifted");
  }
  let paused = true;
  let request = null;
  let nextFrameAt = null;
  let tick = 0;
  let animationFrameCallbackCount = 0;
  let earlyCallbackCount = 0;
  let displayPhaseResyncCount = 0;
  let lateDeadlineResetCount = 0;
  let publishedAdjacentTransitionCount = 0;
  let firstFramePending = false;
  let lastPublicationAt = null;

  function cancelScheduled() {
    if (request !== null) cancelFrame(request);
    request = null;
  }

  function schedule() {
    if (paused || request !== null) return;
    request = requestFrame(loop);
  }

  function loop(timestamp) {
    request = null;
    if (paused) return;
    animationFrameCallbackCount += 1;
    if (!Number.isFinite(timestamp)) {
      paused = true;
      throw new TypeError("Cityflow animation-frame timestamp drifted");
    }
    const deliveredAt = readNow();
    if (!Number.isFinite(deliveredAt)) {
      paused = true;
      throw new TypeError("Cityflow callback-delivery timestamp drifted");
    }
    const publicationTime = Math.max(timestamp, deliveredAt);
    const earlyTolerance = frameMilliseconds * EARLY_DEADLINE_TOLERANCE_RATIO;
    const minimumDistinctPublicationSpacing =
      frameMilliseconds * MINIMUM_DISTINCT_PUBLICATION_SPACING_RATIO;
    let resyncDisplayPhase = false;
    if (publicationTime + earlyTolerance < nextFrameAt) {
      const timeSinceLastPublication = lastPublicationAt === null
        ? null
        : publicationTime - lastPublicationAt;
      if (timeSinceLastPublication === null ||
          timeSinceLastPublication < minimumDistinctPublicationSpacing) {
        earlyCallbackCount += 1;
        schedule();
        return;
      }
      resyncDisplayPhase = true;
      displayPhaseResyncCount += 1;
    }
    tick += 1;
    publishDue(tick, 1);
    publishedAdjacentTransitionCount += 1;
    lastPublicationAt = publicationTime;
    if (firstFramePending || resyncDisplayPhase) {
      firstFramePending = false;
      nextFrameAt = publicationTime + frameMilliseconds;
      schedule();
      return;
    }
    nextFrameAt += frameMilliseconds;
    if (nextFrameAt <= publicationTime) {
      nextFrameAt = publicationTime + frameMilliseconds;
      lateDeadlineResetCount += 1;
    }
    schedule();
  }

  function stats() {
    return Object.freeze({
      paused,
      tick,
      frameMilliseconds,
      timerCallbackCount: 0,
      animationFrameCallbackCount,
      earlyCallbackCount,
      earlyDeadlineToleranceMilliseconds:
        frameMilliseconds * EARLY_DEADLINE_TOLERANCE_RATIO,
      minimumDistinctPublicationSpacingMilliseconds:
        frameMilliseconds * MINIMUM_DISTINCT_PUBLICATION_SPACING_RATIO,
      displayPhaseResyncCount,
      lateDeadlineResetCount,
      publishedAdjacentTransitionCount,
      preparedStateSkipCount: 0,
      schedulerTimeSource: "maximum-animation-frame-timestamp-and-callback-delivery",
      publicationPacingTimeSource: "adjacent-state-deadline-schedule",
      resumePublicationPolicy: "first-animation-frame-immediate-then-deadline-paced",
    });
  }

  return Object.freeze({
    get paused() { return paused; },
    pause() {
      paused = true;
      cancelScheduled();
      return stats();
    },
    resume() {
      if (!paused) return stats();
      paused = false;
      const now = readNow();
      if (!Number.isFinite(now)) {
        paused = true;
        throw new TypeError("Cityflow resume timestamp drifted");
      }
      firstFramePending = true;
      lastPublicationAt = null;
      nextFrameAt = now;
      schedule();
      return stats();
    },
    seekTick(value) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("Cityflow scheduler tick is out of range");
      }
      cancelScheduled();
      tick = value;
      firstFramePending = false;
      lastPublicationAt = null;
      nextFrameAt = paused ? null : readNow() + frameMilliseconds;
      schedule();
      return stats();
    },
    stats,
    destroy() {
      paused = true;
      cancelScheduled();
    },
  });
}
