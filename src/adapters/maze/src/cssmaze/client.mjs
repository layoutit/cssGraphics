import { installCssmazeDebugApi } from "./debugApi.mjs";
import { loadPreparedManifest, loadPreparedScene } from "./manifestClient.mjs";
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
    mount: null,
    errors: [],
  };
  installCssmazeDebugApi(state);

  window.addEventListener("error", (event) => {
    recordError(state, event.message || String(event.error || "error"), host);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"), host);
  });

  main().catch((error) => {
    recordError(state, error.stack || error.message || String(error), host);
  });

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
    setBodyState(host, "loading");
    const route = createRouteState();
    state.route = route;
    state.manifest = await loadPreparedManifest(route);
    const prepared = await loadPreparedScene(state.manifest, route);
    await adoptPreparedScene(prepared, route.selection);
  }

  async function adoptPreparedScene({ entry, sceneData, snapshotHtml }, selection) {
    setBodyState(host, "loading");
    state.mount?.destroy();
    const snapshot = mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml });
    const presentation = installCssmazeStagePresentation(
      host,
      snapshot.camera,
      sceneData.camera.sourceViewport,
    );
    const player = await createCssmazePreparedPlayer({
      playback: sceneData.playback,
      worldRoot: snapshot.worldRoot,
      wallRoot: snapshot.wallRoot,
      visibilityLeaves: snapshot.wallLeaves,
    });
    state.mount = Object.freeze({
      ...snapshot,
      player,
      stats() {
        return Object.freeze({
          ...snapshot.stats(),
          ...player.stats(),
          ...presentation.stats(),
          preparedSourceWallCoverageExact: sceneData.metrics.sourceWallCoverageExact,
          preparedMergeCount: sceneData.metrics.preparedMergeCount,
          preparedBankSceneCount: state.manifest.preparedBank.sceneIds.length,
          preparedBankRank: entry.bankRank,
          preparedSceneSeed: entry.nativeSeed,
          runtimeRotationScoringCount: 0,
          runtimeSceneGenerationCount: 0,
          mountedSceneCount: 1,
        });
      },
      destroy() {
        presentation.destroy();
        player.destroy();
        snapshot.destroy();
      },
    });
    state.sceneData = sceneData;
    state.route = Object.freeze({
      requestedScene: selection === "explicit-prepared-scene" ? entry.id : null,
      scene: entry.id,
      selectedScene: entry.id,
      selectedSeed: entry.nativeSeed,
      selectedBankRank: entry.bankRank,
      explicitScene: selection === "explicit-prepared-scene",
      selection,
    });
    state.ready = true;
    setBodyState(host, "ready");
    requestAnimationFrame(() => player.resume());
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
