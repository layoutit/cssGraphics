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
    bankLoading: true,
    errors: [],
  };
  let disposed = false;
  const onError = (event) => {
    recordError(state, event.message || String(event.error || "error"));
  };
  const onUnhandledRejection = (event) => {
    recordError(state, String(event.reason?.message || event.reason || "unhandled rejection"));
  };
  const controller = Object.freeze({
    destroy() {
      if (disposed) return;
      disposed = true;
      state.mount?.destroy();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    },
  });

  installCssgearsDebugApi(state);
  setBodyState("loading");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  main().catch((error) => {
    if (!disposed) recordError(state, error.stack || error.message || String(error));
  });
  return controller;

  async function main() {
    const route = createRouteState();
    state.route = route;

    const manifest = await loadPreparedManifest(route);
    state.manifest = manifest;

    const { entry, entries, sceneData, sceneStore, bankTokens, snapshotHtml, selection } = await loadPreparedScene(manifest, route);
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

    const scenes = Array(entries.length).fill(null);
    const lightingAssets = Array(entries.length).fill(null);
    scenes[selection.bankIndex] = sceneData;
    lightingAssets[selection.bankIndex] = await loadPreparedLightingAsset(sceneData.lighting);
    if (disposed) {
      lightingAssets[selection.bankIndex]?.destroy();
      return;
    }
    const snapshot = mountPreparedPolycssSnapshot({
      host,
      sceneData,
      sceneBank: entries,
      snapshotHtml,
      lightingAsset: lightingAssets[selection.bankIndex],
      lightingAssets,
      bankTokens,
    });
    const presentation = installCssgearsStagePresentation(
      host,
      snapshot.camera,
      sceneData.camera.sourceViewport,
      sceneData.showreel.responsivePresentation,
    );
    let player;
    const bankRequests = new Map();
    const loadBank = (bankIndex) => {
      let request = bankRequests.get(bankIndex);
      if (!request) {
        request = sceneStore.load(bankIndex).then(async (scene) => {
          scenes[bankIndex] = scene;
          if (!lightingAssets[bankIndex]) {
            lightingAssets[bankIndex] = await loadPreparedLightingAsset(scene.lighting);
          }
          return Object.freeze({
            scene,
            playback: route.scene ? scene.playback : scene.showreel,
            lighting: scene.lighting,
          });
        });
        bankRequests.set(bankIndex, request);
      }
      return request;
    };
    const playbacks = entries.map((_, index) =>
      index === selection.bankIndex ? (route.scene ? sceneData.playback : sceneData.showreel) : null);
    const lightings = entries.map((_, index) =>
      index === selection.bankIndex ? sceneData.lighting : null);
    player = await createCssgearsPreparedPlayer({
      playbacks,
      lightings,
      lightingContracts: entries.map((candidate) => candidate.lighting),
      bankTokens,
      initialBankIndex: selection.bankIndex,
      modelRoot: snapshot.modelRoot,
      gearRoots: snapshot.gearRoots,
      loadBank,
      onError(error) {
        recordError(state, error instanceof Error ? error.stack || error.message : String(error));
      },
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
        for (const asset of lightingAssets) asset?.destroy();
      },
    });
    setBodyState("ready");
    player.resume();
    const unloadedIndices = entries.map((_, index) => index)
      .filter((index) => index !== selection.bankIndex);
    if (unloadedIndices.length === 0) {
      state.bankLoading = false;
      state.ready = true;
      return;
    }
    sceneStore.preload(unloadedIndices, {
      concurrency: 4,
      async onLoad(_, bankIndex) {
        const loaded = await loadBank(bankIndex);
        if (disposed) return;
        player.installBank(bankIndex, loaded);
      },
    }).then(() => {
      if (disposed) return;
      state.bankLoading = false;
      state.ready = true;
    }).catch((error) => {
      recordError(state, error instanceof Error ? error.stack || error.message : String(error));
    });
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
