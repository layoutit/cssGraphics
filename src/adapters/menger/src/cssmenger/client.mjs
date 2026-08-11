import { installCssmengerDebugApi } from "./debugApi.mjs";
import { loadPreparedManifest, loadPreparedScene } from "./manifestClient.mjs";
import { createCssmengerPreparedPlayer } from "./preparedPlayback.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { selectCssmengerPlaneAtlasProfile } from "./profileSelection.mjs";
import { loadPreparedMengerPlaneAtlasAsset } from "./preparedPlaneAtlasAsset.mjs";
import { createRouteState } from "./routeState.mjs";

export function mountCssmengerClient(host) {
  const state = { ready: false, route: null, manifest: null, sceneData: null, mount: null, errors: [] };
  installCssmengerDebugApi(state);
  window.addEventListener("error", (event) => recordError(state, event.message || String(event.error || "error"), host));
  window.addEventListener("unhandledrejection", (event) => recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"), host));
  main().catch((error) => recordError(state, error.stack || error.message || String(error), host));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing cssMenger host");
    setStatus("loading");
    const route = createRouteState();
    state.route = route;
    state.manifest = await loadPreparedManifest(route);
    const { entry, sceneData, snapshotHtml } = await loadPreparedScene(state.manifest, route);
    const planeAtlasProfile = selectCssmengerPlaneAtlasProfile();
    const planeAtlas = planeAtlasProfile === "mobile" ? sceneData.mobilePlaneAtlas : sceneData.planeAtlas;
    const planeAtlasAsset = await loadPreparedMengerPlaneAtlasAsset(planeAtlas);
    state.sceneData = sceneData;
    state.route = Object.freeze({ ...route, selectedScene: entry.id });
    setStatus("loading");
    const snapshot = mountPreparedPolycssSnapshot({
      host,
      sceneData,
      snapshotHtml,
      planeAtlas,
      planeAtlasProfile,
      planeAtlasAsset,
    });
    const player = createCssmengerPreparedPlayer({
      playback: sceneData.playback,
      planeAtlas,
      publicationRoot: snapshot.publicationRoot,
      leaves: snapshot.leaves,
    });
    state.mount = Object.freeze({
      ...snapshot,
      player,
      stats() {
        return Object.freeze({
          ...snapshot.stats(),
          ...player.stats(),
          preparedSourceFaceCoverageExact: sceneData.metrics.sourceFaceCoverageExact,
          preparedRenderBundleCount: sceneData.metrics.preparedRenderBundleCount,
          preparedMergedSourceFaceCount: sceneData.metrics.mergedSourceFaceCount,
        });
      },
      destroy() {
        player.destroy();
        snapshot.destroy();
        planeAtlasAsset.destroy();
      },
    });
    state.ready = true;
    setStatus("ready");
    requestAnimationFrame(() => player.resume());
  }
}

function recordError(state, message, host) {
  state.errors.push(message);
  setStatus("error");
  if (!(host instanceof HTMLElement) || host.querySelector(":scope > .cssmenger-error-message")) return;
  const output = document.createElement("p");
  output.className = "cssmenger-error-message";
  output.setAttribute("role", "alert");
  output.textContent = message;
  host.append(output);
}

function setStatus(kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
}
