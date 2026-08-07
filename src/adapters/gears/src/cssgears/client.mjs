import {
  loadPreparedManifest,
  loadPreparedScene,
} from "./manifestClient.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { loadPreparedLightingAsset } from "./preparedLightingAsset.mjs";
import { createCssgearsPreparedPlayer } from "./preparedPlayback.mjs";
import { installCssgearsStagePresentation } from "./stagePresentation.mjs";
import { createRouteState } from "./routeState.mjs";
import { installCssgearsDebugApi } from "./debugApi.mjs";

export function mountCssgearsClient() {
  const host = document.getElementById("scene");
  const state = {
    ready: false,
    route: null,
    manifest: null,
    sceneData: null,
    mount: null,
    errors: [],
  };

  installCssgearsDebugApi(state);

  window.addEventListener("error", (event) => {
    recordError(state, event.message || String(event.error || "error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"));
  });

  main().catch((error) => {
    recordError(state, error.stack || error.message || String(error));
  });

  async function main() {
    const route = createRouteState();
    state.route = route;

    const manifest = await loadPreparedManifest(route);
    state.manifest = manifest;

    const { entry, entries, sceneData, scenes, bankTokens, snapshotHtml, selection } = await loadPreparedScene(manifest, route);
    state.route = Object.freeze({
      ...route,
      selectedScene: entry.id,
      selectedSeed: entry.nativeSeed,
      selectedBankIndex: selection.bankIndex,
      activeScene: entry.id,
      activeSeed: entry.nativeSeed,
      activeBankIndex: selection.bankIndex,
      selection: selection.mode,
    });
    state.sceneData = sceneData;

    const lightingAssets = await Promise.all(scenes.map((scene) => loadPreparedLightingAsset(scene.lighting)));
    const snapshot = mountPreparedPolycssSnapshot({
      host,
      sceneData,
      sceneBank: scenes,
      snapshotHtml,
      lightingAsset: lightingAssets[0],
      lightingAssets,
      bankTokens,
    });
    const presentation = installCssgearsStagePresentation(
      host,
      snapshot.camera,
      sceneData.camera.sourceViewport,
      sceneData.showreel.responsivePresentation,
    );
    const player = await createCssgearsPreparedPlayer({
      playbacks: route.scene ? [sceneData.playback] : scenes.map((scene) => scene.showreel),
      lightings: scenes.map((scene) => scene.lighting),
      bankTokens,
      initialBankIndex: selection.bankIndex,
      modelRoot: snapshot.modelRoot,
      gearRoots: snapshot.gearRoots,
      onBankChange(bankIndex) {
        state.sceneData = scenes[bankIndex];
        presentation.setScene(state.sceneData);
        state.route = Object.freeze({
          ...state.route,
          activeScene: entries[bankIndex].id,
          activeSeed: entries[bankIndex].nativeSeed,
          activeBankIndex: bankIndex,
        });
      },
    });
    state.mount = Object.freeze({
      ...snapshot,
      player,
      stats() {
        return Object.freeze({
          ...player.stats(),
          ...snapshot.stats(),
          ...presentation.stats(),
          activePreparedLeafCount: state.sceneData.metrics.preparedLeafCount,
          preparedRenderBundleCount: state.sceneData.metrics.preparedRenderBundleCount,
          preparedMergedSourceFaceCount: state.sceneData.metrics.mergedSourceFaceCount,
          preparedSourceFaceCoverageExact: state.sceneData.metrics.sourceFaceCoverageExact,
        });
      },
      destroy() {
        presentation.destroy();
        player.destroy();
        snapshot.destroy();
        for (const asset of lightingAssets) asset.destroy();
      },
    });
    state.ready = true;
    setBodyState("ready");
    requestAnimationFrame(() => player.resume());
  }
}

function recordError(state, message) {
  state.errors.push(message);
  setBodyState("error");
}

function setBodyState(kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
}
