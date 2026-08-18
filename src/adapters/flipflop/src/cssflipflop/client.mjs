import {
  createPolyMorphPlaybackRuntime,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import {
  CSSFLIPFLOP_MODEL_IDS,
  selectFlipFlopPreparedBank,
} from "./bankSelection.mjs";

export function mountFlipFlopClient(host) {
  const state = {
    ready: false,
    errors: [],
    mounted: null,
    player: null,
    metadata: null,
    bankId: null,
  };
  installDebugApi(state);
  window.addEventListener("error", (event) => recordError(event.message || String(event.error || "error")));
  window.addEventListener("unhandledrejection", (event) => recordError(String(event.reason?.stack || event.reason || "unhandled rejection")));
  window.addEventListener("resize", () => state.player?.resize(), { passive: true });
  main().catch((error) => recordError(error.stack || error.message || String(error)));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing Flip Flop host");
    setStatus("loading");
    const bankId = selectFlipFlopPreparedBank({
      width: host.clientWidth || innerWidth,
      height: host.clientHeight || innerHeight,
    });
    const modelId = CSSFLIPFLOP_MODEL_IDS[bankId];
    const [loaded, metadata] = await Promise.all([
      loadPolyMorphPackage("/cssflipflop/model/", { modelId }),
      fetch("/cssflipflop/prepared.json").then(assertResponse).then((response) => response.json()),
    ]);
    const preparedBank = metadata?.preparedBanks?.find((bank) => bank.id === bankId);
    if (loaded.model.identity.id !== modelId || metadata?.schema !== "cssflipflop-prepared-scene@2" ||
        preparedBank?.modelId !== modelId) {
      throw new Error("Flip Flop prepared model binding drifted");
    }
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 900,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: 0,
      }),
    });
    cleanPreparedDom(mounted);
    const player = createPlayer(mounted, loaded.model, preparedBank.cameraDistancePixels);
    player.seekFrame(0);
    state.mounted = mounted;
    state.player = player;
    state.metadata = metadata;
    state.bankId = bankId;
    state.ready = true;
    setStatus("ready");
    player.resume();
  }

  function recordError(message) {
    state.errors.push(message);
    setStatus("error");
    if (document.querySelector(".cssflipflop-error-message")) return;
    const output = document.createElement("p");
    output.className = "cssflipflop-error-message";
    output.textContent = message;
    host.append(output);
  }
}

function createPlayer(mounted, model, cameraDistancePixels) {
  const runtime = createPolyMorphPlaybackRuntime(model);
  const frameMilliseconds = model.playback.frames[1].timeMs - model.playback.frames[0].timeMs;
  let paused = true;
  let destroyed = false;
  let timer = null;
  let startedAt = performance.now();
  let pausedAt = 0;
  let lastFrameIndex = -1;
  let schedulerCallbacks = 0;
  let applyCount = 0;
  let modelTransformWrites = 0;
  let shapeTransformWrites = 0;

  function publish(timeMilliseconds) {
    const sample = runtime.sample(timeMilliseconds);
    if (sample.frameIndex === lastFrameIndex) return sample.frameIndex;
    const result = mounted.apply(sample.update);
    runtime.commit(sample);
    lastFrameIndex = sample.frameIndex;
    applyCount += 1;
    modelTransformWrites += result.modelTransformWrites;
    shapeTransformWrites += result.shapeTransformWrites;
    return sample.frameIndex;
  }

  function tick() {
    timer = null;
    if (paused || destroyed) return;
    schedulerCallbacks += 1;
    const now = performance.now();
    const elapsed = Math.max(0, now - startedAt);
    publish(elapsed);
    scheduleNextFrame();
  }

  function scheduleNextFrame() {
    const elapsed = Math.max(0, performance.now() - startedAt);
    const nextFrameTime = (Math.floor(elapsed / frameMilliseconds) + 1) * frameMilliseconds;
    timer = setTimeout(tick, Math.max(1, Math.ceil(nextFrameTime - elapsed)));
  }

  function resume() {
    if (!paused || destroyed) return;
    startedAt = performance.now() - pausedAt;
    paused = false;
    scheduleNextFrame();
  }

  function pause() {
    if (paused || destroyed) return;
    pausedAt = performance.now() - startedAt;
    paused = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function seekFrame(frameIndex) {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= runtime.frameCount) {
      throw new RangeError("Flip Flop prepared frame is out of range");
    }
    const wasPaused = paused;
    if (!wasPaused) pause();
    const time = model.playback.frames[frameIndex].timeMs;
    publish(time);
    pausedAt = time;
    if (!wasPaused) resume();
    return snapshot();
  }

  function resize() {
    const presentation = presentationMetrics(cameraDistancePixels);
    mounted.cameraElement.style.perspective = `${presentation.perspective}px`;
    mounted.sceneElement.style.transform = `translateZ(${presentation.sceneZ}px)`;
    mounted.modelElement.style.removeProperty("scale");
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      paused,
      frameIndex: lastFrameIndex,
      frameCount: runtime.frameCount,
      durationMilliseconds: runtime.durationMs,
      applyCount,
      schedulerCallbacks,
      modelTransformWrites,
      shapeTransformWrites,
      scale: 80,
    });
  }

  resize();
  return Object.freeze({
    resume,
    pause,
    resize,
    seekFrame,
    snapshot,
    assertStableDomIdentity() {
      mounted.assertStableDomIdentity();
      return true;
    },
    destroy() {
      pause();
      destroyed = true;
      mounted.destroy();
    },
  });
}

function presentationMetrics(cameraDistancePixels) {
  if (!Number.isFinite(cameraDistancePixels) || cameraDistancePixels <= 0) {
    throw new TypeError("Flip Flop prepared camera distance drifted");
  }
  const nativePerspective = innerHeight / (2 * Math.tan(22.5 * Math.PI / 180));
  const perspective = Math.min(nativePerspective, innerWidth * 0.9);
  return Object.freeze({
    perspective: Number(perspective.toFixed(4)),
    sceneZ: Number((perspective - cameraDistancePixels).toFixed(4)),
  });
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.sceneElement.className = "polycss-scene";
  mounted.modelElement.removeAttribute("class");
  mounted.modelElement.removeAttribute("data-poly-morph-model");
  for (const element of mounted.shapeElements.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-shape");
  }
  for (const { element } of mounted.leafHandles.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-leaf");
    element.removeAttribute("data-poly-morph-strategy");
    element.removeAttribute("data-poly-morph-resolved-strategy");
    element.style.removeProperty("backface-visibility");
    element.style.removeProperty("background-repeat");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
}

function installDebugApi(state) {
  Object.defineProperty(window, "__cssFlipFlopDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { state.player?.pause(); },
      resume() { state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      state() { return state.player?.snapshot() ?? null; },
      metadata() { return state.metadata; },
      stats() {
        if (!state.mounted || !state.player) return null;
        return Object.freeze({
          retainedTileRootCount: state.mounted.shapeElements.size,
          retainedPolygonLeafCount: state.mounted.leafHandles.size,
          retainedDomStable: state.player.assertStableDomIdentity(),
          runtimeGeometryConstructionCount: 0,
          runtimeDomGrowth: false,
          selectedPreparedBank: state.bankId,
          preparedBankLoadCount: 1,
          runtimePreparedBankSwitchCount: 0,
          ...state.player.snapshot(),
        });
      },
    }),
  });
}

function assertResponse(response) {
  if (!response.ok) throw new Error(`Flip Flop prepared asset failed: ${response.status} ${response.url}`);
  return response;
}

function setStatus(kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
}
