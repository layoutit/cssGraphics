import {
  CSSLED_RETAINED_LED_COUNT,
  CSSLED_SCENE_HTML,
} from "./sceneMarkup.mjs";

export const CSSLED_SOURCE_ANIMATION_DURATION_MS = 4_500;
export const CSSLED_INITIAL_DARK_MS = 400;
export const CSSLED_LOOP_DURATION_MS =
  CSSLED_SOURCE_ANIMATION_DURATION_MS * 2 + CSSLED_INITIAL_DARK_MS;

export function mountLedAnimation(host) {
  if (!(host instanceof HTMLElement)) throw new TypeError("LED host must be an element");

  host.innerHTML = CSSLED_SCENE_HTML;
  const root = host.querySelector(".cssled-stage");
  if (!(root instanceof HTMLElement) ||
      root.querySelectorAll(".cssled-cell").length !== CSSLED_RETAINED_LED_COUNT) {
    throw new Error("LED retained scene failed to mount");
  }

  let destroyed = false;
  let paused = false;
  let ready = false;
  let loopCount = 0;
  let timer = null;
  let cycleStartedAt = performance.now();
  let remainingMilliseconds = CSSLED_LOOP_DURATION_MS;

  const scheduleRestart = (delay = remainingMilliseconds) => {
    clearTimeout(timer);
    remainingMilliseconds = delay;
    timer = setTimeout(restart, delay);
  };

  const resetAnimations = () => {
    root.classList.remove("is-running");
    void root.offsetWidth;
    root.classList.add("is-running");
  };

  const restart = () => {
    if (destroyed || paused) return;
    resetAnimations();
    loopCount += 1;
    cycleStartedAt = performance.now();
    scheduleRestart(CSSLED_LOOP_DURATION_MS);
  };

  const pause = () => {
    if (destroyed || paused) return;
    paused = true;
    remainingMilliseconds = Math.max(
      0,
      CSSLED_LOOP_DURATION_MS - (performance.now() - cycleStartedAt),
    );
    clearTimeout(timer);
    root.classList.add("is-paused");
  };

  const resume = () => {
    if (destroyed || !paused) return;
    paused = false;
    cycleStartedAt = performance.now() - (CSSLED_LOOP_DURATION_MS - remainingMilliseconds);
    root.classList.remove("is-paused");
    scheduleRestart(remainingMilliseconds);
  };

  const seek = (milliseconds) => {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("LED seek time must be a non-negative finite number");
    }
    pause();
    const cycleTime = milliseconds % CSSLED_LOOP_DURATION_MS;
    resetAnimations();
    for (const animation of root.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = cycleTime;
    }
    remainingMilliseconds = CSSLED_LOOP_DURATION_MS - cycleTime;
    cycleStartedAt = performance.now() - cycleTime;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(timer);
    host.replaceChildren();
    if (globalThis.__cssLedDebug === debug) delete globalThis.__cssLedDebug;
  };

  const stats = () => Object.freeze({
    ready,
    paused,
    loopCount,
    loopDurationMilliseconds: CSSLED_LOOP_DURATION_MS,
    initialDarkMilliseconds: CSSLED_INITIAL_DARK_MS,
    sourceAnimationDurationMilliseconds: CSSLED_SOURCE_ANIMATION_DURATION_MS,
    retainedLedCount: root.querySelectorAll(".cssled-cell").length,
    retainedFaceCount: root.querySelectorAll(".cssled-grid").length,
    retainedRoomLightCount: root.querySelectorAll(".cssled-light").length,
    runtimeDomGrowth: false,
    runtimeFrameConstruction: false,
  });

  const debug = Object.freeze({
    get ready() { return ready; },
    pause,
    resume,
    restart,
    seek,
    stats,
  });
  Object.defineProperty(globalThis, "__cssLedDebug", { configurable: true, value: debug });

  scheduleRestart();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (destroyed) return;
    ready = true;
    document.body.classList.remove("loading", "priming", "error");
    document.body.classList.add("ready");
  }));

  return Object.freeze({ pause, resume, destroy });
}
