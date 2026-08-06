import {
  loadPreparedManifest,
  loadPreparedScene,
} from "./manifestClient.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { createCssflowerPreparedPlayer } from "./preparedPlayback.mjs";
import { createRouteState } from "./routeState.mjs";
import { installCssflowerDebugApi } from "./debugApi.mjs";
import { installCssflowerStagePresentation } from "./stagePresentation.mjs";

export function mountCssflowerClient() {
  const host = document.getElementById("scene");
  const status = document.getElementById("status");
  const presentation = installCssflowerStagePresentation(host);
  const state = {
    ready: false,
    route: null,
    manifest: null,
    sceneData: null,
    mount: null,
    errors: [],
  };
  installCssflowerDebugApi(state);

  window.addEventListener("error", (event) => {
    recordError(state, event.message || String(event.error || "error"), status);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"), status);
  });

  main().catch((error) => {
    recordError(state, error.stack || error.message || String(error), status);
  });

  async function main() {
    document.body.dataset.productView = "1";
    document.body.dataset.gameView = "polycss";
    document.body.dataset.portSlug = "cssflower";
    setStatus(status, "Loading Flower Box…", "loading");

    const route = createRouteState();
    state.route = route;
    document.body.dataset.routeScene = route.scene;

    const manifest = await loadPreparedManifest(route);
    state.manifest = manifest;

    setStatus(status, "Loading prepared scene…", "loading");
    const { entry, sceneData, snapshotHtml, projectedPages } = await loadPreparedScene(manifest, route);
    state.sceneData = sceneData;
    document.body.dataset.sceneUrl = entry.sceneUrl;
    if (entry.snapshotUrl) document.body.dataset.snapshotUrl = entry.snapshotUrl;

    setStatus(status, "Mounting retained PolyCSS scene…", "loading");
    const snapshot = mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, projectedPages });
    const player = await createCssflowerPreparedPlayer({
      playback: sceneData.playback,
      rotationRoot: snapshot.rotationRoot,
      mesh: snapshot.mesh,
      leaves: snapshot.leaves,
      projectedPages,
    });
    state.mount = Object.freeze({
      ...snapshot,
      player,
      stats() {
        return Object.freeze({
          ...player.stats(),
          ...snapshot.stats(),
          ...presentation.stats(),
        });
      },
      destroy() {
        presentation.destroy();
        player.destroy();
        projectedPages.destroy();
        snapshot.destroy();
      },
    });
    state.ready = true;
    setStatus(status, "Ready — 1,200 retained PolyCSS triangles", "ready");
    requestAnimationFrame(() => player.resume());
  }
}

function recordError(state, message, status) {
  state.errors.push(message);
  setStatus(status, message, "error");
}

function setStatus(status, message, kind = "loading") {
  document.body.dataset.portStatus = kind;
  if (status) status.textContent = message;
}
