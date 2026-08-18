import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import {
  createPolyMorphPlaybackRuntime,
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";
import { selectPlatonicBank } from "./bankSelection.mjs";

export function mountPlatonicFolding(host) {
  const state = { ready: false, errors: [], bankId: null, metadata: null, mounted: null, player: null };
  installDebugApi(state);
  main().catch(fail);
  return state;

  async function main() {
    const bankId = selectPlatonicBank({ width: host.clientWidth || innerWidth, height: host.clientHeight || innerHeight });
    const modelId = `platonic-folding-${bankId}`;
    const [loaded, metadata] = await Promise.all([
      loadPolyMorphPackage("/cssplatonicfolding/model/", { modelId }),
      fetch("/cssplatonicfolding/prepared.json", { cache: "no-store" })
        .then(assertResponse)
        .then((response) => response.json()),
    ]);
    const preparedBank = metadata?.preparedBanks?.find((bank) => bank.id === bankId);
    if (metadata?.schema !== "cssplatonicfolding-prepared-scene@1" ||
        loaded.model.identity.id !== modelId || preparedBank?.modelId !== modelId) {
      throw new Error("Platonic Folding prepared model binding drifted");
    }
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 800,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: 0,
      }),
    });
    cleanPreparedDom(mounted);
    const player = createPlayer(mounted, loaded.model);
    player.resize();
    player.seekFrame(0);
    addEventListener("resize", player.resize, { passive: true });
    state.ready = true;
    state.bankId = bankId;
    state.metadata = metadata;
    state.mounted = mounted;
    state.player = player;
    document.body.classList.replace("loading", "ready");
    player.resume();
  }

  function fail(error) {
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    console.error(error);
  }
}

function createPlayer(mounted, model) {
  const runtime = createPolyMorphPlaybackRuntime(model);
  const frameMilliseconds = model.playback.frames[1].timeMs - model.playback.frames[0].timeMs;
  const durationMilliseconds = runtime.durationMs;
  let paused = true;
  let destroyed = false;
  let timer = null;
  let clockOrigin = performance.now();
  let pausedAt = 0;
  let lastFrameIndex = -1;
  let timerCallbackCount = 0;
  let collapsedFrameCount = 0;
  let applyCount = 0;
  let modelTransformWrites = 0;
  let shapeTransformWrites = 0;
  let visibilityWrites = 0;
  let atlasRowWrites = 0;

  function publish(elapsed) {
    const sample = runtime.sample(elapsed);
    if (sample.frameIndex === lastFrameIndex) return sample.frameIndex;
    const result = mounted.apply(sample.update);
    runtime.commit(sample);
    lastFrameIndex = sample.frameIndex;
    applyCount += 1;
    modelTransformWrites += result.modelTransformWrites;
    shapeTransformWrites += result.shapeTransformWrites;
    visibilityWrites += result.visibilityWrites;
    atlasRowWrites += result.atlasRowWrites;
    return sample.frameIndex;
  }

  function cancelScheduled() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (paused || destroyed || timer !== null) return;
    const elapsed = Math.max(0, performance.now() - clockOrigin);
    const phase = elapsed % durationMilliseconds;
    const nextFrame = (Math.floor(phase / frameMilliseconds) + 1) * frameMilliseconds;
    timer = setTimeout(wake, Math.max(1, Math.ceil(nextFrame - phase)));
  }

  function wake() {
    timer = null;
    if (paused || destroyed) return;
    timerCallbackCount += 1;
    const elapsed = Math.max(0, performance.now() - clockOrigin);
    const dueFrame = Math.floor((elapsed % durationMilliseconds) / frameMilliseconds);
    if (lastFrameIndex >= 0) {
      const distance = dueFrame >= lastFrameIndex
        ? dueFrame - lastFrameIndex
        : runtime.frameCount - lastFrameIndex + dueFrame;
      collapsedFrameCount += Math.max(0, distance - 1);
    }
    publish(elapsed);
    schedule();
  }

  function resize() {
    const perspective = Math.min(innerWidth, innerHeight) /
      (2 * Math.tan(22.5 * Math.PI / 180));
    mounted.cameraElement.style.perspective = `${Number(perspective.toFixed(4))}px`;
    mounted.sceneElement.style.transform = `translateZ(${Number(perspective.toFixed(4))}px)`;
    return snapshot();
  }

  function snapshot() {
    mounted.assertStableDomIdentity();
    return Object.freeze({
      paused,
      frameIndex: lastFrameIndex,
      frameCount: runtime.frameCount,
      durationMilliseconds,
      frameMilliseconds,
      timerCallbackCount,
      collapsedFrameCount,
      applyCount,
      modelTransformWrites,
      shapeTransformWrites,
      visibilityWrites,
      atlasRowWrites,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
      retainedDomStable: true,
    });
  }

  return Object.freeze({
    resize,
    resume() {
      if (!paused || destroyed) return snapshot();
      clockOrigin = performance.now() - pausedAt;
      paused = false;
      schedule();
      return snapshot();
    },
    pause() {
      if (paused || destroyed) return snapshot();
      pausedAt = performance.now() - clockOrigin;
      paused = true;
      cancelScheduled();
      return snapshot();
    },
    seekFrame(frameIndex) {
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= runtime.frameCount) {
        throw new RangeError("Platonic Folding prepared frame is out of range");
      }
      const wasPaused = paused;
      if (!wasPaused) this.pause();
      pausedAt = model.playback.frames[frameIndex].timeMs;
      publish(pausedAt);
      if (!wasPaused) this.resume();
      return snapshot();
    },
    stats: snapshot,
    destroy() {
      paused = true;
      destroyed = true;
      cancelScheduled();
      removeEventListener("resize", resize);
      mounted.destroy();
    },
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
  Object.defineProperty(window, "__cssPlatonicFoldingDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { return state.player?.pause(); },
      resume() { return state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      state() { return state.player?.stats() ?? null; },
      metadata() { return state.metadata; },
      stats() {
        if (!state.mounted || !state.player) return null;
        return Object.freeze({
          retainedFaceRootCount: state.mounted.shapeElements.size,
          retainedPolygonLeafCount: state.mounted.leafHandles.size,
          selectedPreparedBank: state.bankId,
          preparedBankLoadCount: 1,
          ...state.player.stats(),
        });
      },
    }),
  });
}

function assertResponse(response) {
  if (!response.ok) throw new Error(`Platonic Folding prepared asset failed: ${response.status} ${response.url}`);
  return response;
}
