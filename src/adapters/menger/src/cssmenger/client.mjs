import { installCssmengerDebugApi } from "./debugApi.mjs";
import { loadPreparedManifest, loadPreparedScene } from "./manifestClient.mjs";
import { createCssmengerPreparedPlayer } from "./preparedPlayback.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { loadPreparedMengerPlaneAtlasAsset } from "./preparedPlaneAtlasAsset.mjs";
import { createRouteState } from "./routeState.mjs";

export function mountCssmengerClient() {
  const host = document.getElementById("scene");
  const status = document.getElementById("status");
  const state = { ready: false, route: null, manifest: null, sceneData: null, mount: null, errors: [] };
  installCssmengerDebugApi(state);
  window.addEventListener("error", (event) => recordError(state, event.message || String(event.error || "error"), status));
  window.addEventListener("unhandledrejection", (event) => recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"), status));
  main().catch((error) => recordError(state, error.stack || error.message || String(error), status));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
    setStatus(status, "Loading prepared Menger source state…", "loading");
    const route = createRouteState();
    state.route = route;
    state.manifest = await loadPreparedManifest(route);
    const { entry, sceneData, snapshotHtml } = await loadPreparedScene(state.manifest, route);
    const planeAtlasAsset = await loadPreparedMengerPlaneAtlasAsset(sceneData.planeAtlas);
    state.sceneData = sceneData;
    state.route = Object.freeze({ ...route, selectedScene: entry.id });
    setStatus(status, "Adopting retained PolyCSS sponge…", "loading");
    const snapshot = mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, planeAtlasAsset });
    const player = createCssmengerPreparedPlayer({
      playback: sceneData.playback,
      planeAtlas: sceneData.planeAtlas,
      modelRoot: snapshot.modelRoot,
      axisRoots: snapshot.axisRoots,
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
    document.body.dataset.productView = "1";
    document.body.dataset.gameView = "polycss";
    document.body.dataset.portSlug = "cssmenger";
    document.body.dataset.scene = entry.id;
    setStatus(status, `Ready — ${sceneData.metrics.preparedLeafCount} retained face bundles`, "ready");
    requestAnimationFrame(() => player.resume());
  }
}

function recordError(state, message, status) {
  state.errors.push(message);
  setStatus(status, message, "error");
}

function setStatus(status, message, kind) {
  document.body.dataset.portStatus = kind;
  if (status) status.textContent = message;
}
