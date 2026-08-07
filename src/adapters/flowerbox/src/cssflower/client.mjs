import {
  loadPreparedManifest,
  loadPreparedScene,
} from "./manifestClient.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { createCssflowerPreparedPlayer } from "./preparedPlayback.mjs";
import { createRouteState } from "./routeState.mjs";
import { installCssflowerDebugApi } from "./debugApi.mjs";
import { installCssflowerStagePresentation } from "./stagePresentation.mjs";

export function mountCssflowerClient(host) {
  if (!(host instanceof HTMLElement)) throw new TypeError("cssFlower scene host is missing");
  const state = {
    ready: false,
    status: "loading",
    route: null,
    manifest: null,
    sceneData: null,
    mount: null,
    errors: [],
  };
  installCssflowerDebugApi(state);

  window.addEventListener("error", (event) => {
    recordError(state, host, event.message || String(event.error || "error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordError(state, host, String(event.reason?.message || event.reason || "unhandled rejection"));
  });

  main().catch((error) => {
    recordError(state, host, error.stack || error.message || String(error));
  });

  async function main() {
    const route = createRouteState();
    state.route = route;

    const manifest = await loadPreparedManifest(route);
    state.manifest = manifest;

    const { entry, sceneData, snapshotHtml, preparedAssets } = await loadPreparedScene(manifest, route);
    state.sceneData = sceneData;

    const snapshot = mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, preparedAssets });
    const presentation = installCssflowerStagePresentation({ host, camera: snapshot.camera });
    const player = await createCssflowerPreparedPlayer({
      playback: sceneData.playback,
      lighting: sceneData.lighting,
      rotationRoot: snapshot.rotationRoot,
      mesh: snapshot.mesh,
      leaves: snapshot.leaves,
      transformBlocks: preparedAssets.transformBlocks,
      lightingPages: preparedAssets.lightingPages,
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
        preparedAssets.transformBlocks.destroy();
        preparedAssets.lightingPages.destroy();
        snapshot.destroy();
      },
    });
    state.ready = true;
    state.status = "ready";
    host.classList.add("r");
    requestAnimationFrame(() => player.resume());
  }
}

function recordError(state, host, message) {
  state.errors.push(message);
  state.status = "error";
  host.classList.remove("r");
  host.classList.add("e");
}
