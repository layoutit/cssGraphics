import { installCssmazeDebugApi } from "./debugApi.mjs";
import { loadPreparedManifest, loadPreparedScene, loadPreparedSceneData } from "./manifestClient.mjs";
import { createPreparedSceneShuffledBag } from "./preparedBankSelection.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { createCssmazePreparedPlayer } from "./preparedPlayback.mjs";
import { createRouteState } from "./routeState.mjs";
import { installCssmazeStagePresentation } from "./stagePresentation.mjs";

export function mountCssmazeClient() {
  const host = document.getElementById("scene");
  const state = {
    ready: false,
    route: null,
    manifest: null,
    sceneData: null,
    player: null,
    mount: null,
    errors: [],
  };
  let shuffledBag = null;
  let pendingNextScene = null;
  let snapshot = null;
  let presentation = null;
  let preparedSceneSwitchCount = 0;
  let preparedScenePrefetchCount = 0;
  let preparedTransitionFrameCallbackCount = 0;
  let destroyed = false;
  let shouldPlay = true;
  const onError = (event) => {
    recordError(state, event.message || String(event.error || "error"), host);
  };
  const onUnhandledRejection = (event) => {
    recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"), host);
  };
  const controller = Object.freeze({
    pause() {
      shouldPlay = false;
      return state.player?.pause() ?? null;
    },
    resume() {
      shouldPlay = true;
      return state.player?.resume() ?? null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      shouldPlay = false;
      state.mount?.destroy();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    },
  });
  installCssmazeDebugApi(state);

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  main().catch((error) => {
    if (!destroyed) recordError(state, error.stack || error.message || String(error), host);
  });
  return controller;

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
    setBodyState(host, "loading");
    const route = createRouteState();
    state.route = route;
    state.manifest = await loadPreparedManifest(route);
    const entry = route.explicitScene
      ? null
      : (shuffledBag = createPreparedSceneShuffledBag(state.manifest)).nextEntry();
    const prepared = await loadPreparedScene(state.manifest, route, { entry });
    if (destroyed) return;
    await mountInitialPreparedScene(prepared, route.selection);
  }

  async function mountInitialPreparedScene({ entry, sceneData, snapshotHtml }, selection) {
    setBodyState(host, "loading");
    snapshot = mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml });
    presentation = installCssmazeStagePresentation(
      host,
      snapshot.camera,
      sceneData.camera.sourceViewport,
    );
    state.sceneData = sceneData;
    state.route = selectedRoute(entry, selection);
    state.player = await createPlayer(sceneData, false);
    state.mount = Object.freeze({
      ...snapshot,
      get player() { return state.player; },
      stats() {
        const bagStats = shuffledBag?.stats();
        return Object.freeze({
          ...snapshot.stats(),
          ...state.player.stats(),
          ...presentation.stats(),
          preparedSourceWallCoverageExact: state.sceneData.metrics.sourceWallCoverageExact,
          preparedMergeCount: state.sceneData.metrics.preparedMergeCount,
          preparedBankSceneCount: state.manifest.preparedBank.sceneIds.length,
          preparedBankRank: state.route.selectedBankRank,
          preparedSceneSeed: state.route.selectedSeed,
          preparedBankRemainingSceneCount: bagStats?.remainingSceneCount ?? 0,
          runtimePreparedSceneSwitchCount: preparedSceneSwitchCount,
          runtimePreparedScenePrefetchCount: preparedScenePrefetchCount,
          runtimePreparedTransitionFrameCallbackCount: preparedTransitionFrameCallbackCount,
          runtimeRandomUint32Count: bagStats?.randomUint32Count ?? 0,
          runtimeRandomSelectionPurpose: shuffledBag ? "prepared-bank-shuffled-index-only" : "none",
          automaticPreparedSceneChange: Boolean(shuffledBag),
          runtimeRotationScoringCount: 0,
          runtimeSceneGenerationCount: 0,
          mountedSceneCount: 1,
        });
      },
      destroy() {
        destroyed = true;
        presentation.destroy();
        state.player?.destroy();
        snapshot.destroy();
      },
    });
    state.ready = true;
    setBodyState(host, "ready");
    requestAnimationFrame(() => {
      if (!destroyed && shouldPlay) state.player.resume();
    });
    queueNextPreparedScene();
  }

  function createPlayer(sceneData, initialVisibilityApplied) {
    return createCssmazePreparedPlayer({
      playback: sceneData.playback,
      worldRoot: snapshot.worldRoot,
      wallRoot: snapshot.wallRoot,
      visibilityLeaves: snapshot.wallLeaves,
      initialVisibilityApplied,
      onPlaybackEnd: shuffledBag ? switchPreparedScene : null,
      onError: (error) => recordError(state, error.stack || error.message || String(error), host),
    });
  }

  function queueNextPreparedScene() {
    if (!shuffledBag || pendingNextScene || destroyed) return;
    const entry = shuffledBag.peekEntry();
    preparedScenePrefetchCount += 1;
    pendingNextScene = Object.freeze({
      entry,
      result: loadPreparedSceneData(state.manifest, entry).then(
        (sceneData) => Object.freeze({ sceneData, error: null }),
        (error) => Object.freeze({ sceneData: null, error }),
      ),
    });
  }

  async function switchPreparedScene() {
    if (!shuffledBag || !pendingNextScene || destroyed) return;
    const queued = pendingNextScene;
    pendingNextScene = null;
    const entry = shuffledBag.nextEntry();
    if (entry.id !== queued.entry.id) {
      throw new Error("cssMaze shuffled-bank prefetch order drifted");
    }
    const { sceneData, error } = await queued.result;
    if (error) throw error;
    state.player.destroy();
    const restoreCameraTransition = snapshot.applyPreparedSceneTransition(sceneData);
    state.sceneData = sceneData;
    state.route = selectedRoute(entry, "session-shuffled-prepared-scene");
    state.player = await createPlayer(sceneData, true);
    preparedSceneSwitchCount += 1;
    try {
      await new Promise((resolveTransition) => requestAnimationFrame(() => {
        preparedTransitionFrameCallbackCount += 1;
        requestAnimationFrame(() => {
          preparedTransitionFrameCallbackCount += 1;
          resolveTransition();
        });
      }));
    } finally {
      restoreCameraTransition();
    }
    if (destroyed) return;
    if (shouldPlay) state.player.resume();
    queueNextPreparedScene();
  }

  function selectedRoute(entry, selection) {
    return Object.freeze({
      requestedScene: selection === "explicit-prepared-scene" ? entry.id : null,
      scene: entry.id,
      selectedScene: entry.id,
      selectedSeed: entry.nativeSeed,
      selectedBankRank: entry.bankRank,
      explicitScene: selection === "explicit-prepared-scene",
      selection,
    });
  }
}

function recordError(state, message, host) {
  state.errors.push(message);
  setBodyState(host, "error");
  if (!(host instanceof HTMLElement) || host.querySelector(":scope > .cssmaze-error-message")) return;
  const output = document.createElement("p");
  output.className = "cssmaze-error-message";
  output.setAttribute("role", "alert");
  output.textContent = message;
  host.append(output);
}

function setBodyState(host, kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
  host?.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
}
