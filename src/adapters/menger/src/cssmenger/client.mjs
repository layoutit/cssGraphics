import { installCssmengerDebugApi } from "./debugApi.mjs";
import { loadPreparedManifest, loadPreparedScene } from "./manifestClient.mjs";
import { createCssmengerPreparedPlayer } from "./preparedPlayback.mjs";
import { mountPreparedPolycssSnapshot } from "./polycssScene.mjs";
import { selectCssmengerPlaneAtlasProfile } from "./profileSelection.mjs";
import { loadPreparedMengerPlaneAtlasAsset } from "./preparedPlaneAtlasAsset.mjs";
import { createRouteState, MOBILE_SCENE_ID } from "./routeState.mjs";

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
    const deviceProfile = selectCssmengerPlaneAtlasProfile();
    const preparedRoute = deviceProfile === "mobile" && !route.sceneExplicit
      ? { ...route, scene: MOBILE_SCENE_ID }
      : route;
    const { entry, sceneData, snapshotHtml } = await loadPreparedScene(state.manifest, preparedRoute);
    const planeAtlasProfile = deviceProfile;
    const lightingPresentation = route.lighting === "opacity" && deviceProfile === "desktop"
      ? "css-opacity"
      : "atlas";
    const planeAtlas = lightingPresentation === "css-opacity"
      ? sceneData.cssOpacityShadowAtlas
      : planeAtlasProfile === "mobile" ? sceneData.mobilePlaneAtlas : sceneData.planeAtlas;
    const renderAtlases = lightingPresentation === "css-opacity"
      ? [sceneData.cssOpacityBaseAtlas, sceneData.cssOpacityShadowAtlas]
      : [planeAtlas];
    const renderAtlasAssets = await Promise.all(renderAtlases.map(loadPreparedMengerPlaneAtlasAsset));
    state.sceneData = sceneData;
    state.route = Object.freeze({
      ...route,
      preparedScene: preparedRoute.scene,
      selectedScene: entry.id,
      selectedDeviceProfile: deviceProfile,
      selectedPlaneAtlasProfile: planeAtlasProfile,
      selectedLightingMode: lightingPresentation === "css-opacity"
        ? "prepared-css-opacity"
        : planeAtlas.lightingSampleCount === 1 ? "frozen" : "dynamic",
      selectedLightingPresentation: lightingPresentation,
    });
    setStatus("loading");
    const snapshot = mountPreparedPolycssSnapshot({
      host,
      sceneData,
      snapshotHtml,
      planeAtlas,
      planeAtlasProfile,
      renderAtlases,
      renderAtlasAssets,
      lightingPresentation,
    });
    const player = createCssmengerPreparedPlayer({
      playback: sceneData.playback,
      planeAtlas,
      baseAtlas: lightingPresentation === "css-opacity" ? sceneData.cssOpacityBaseAtlas : null,
      publicationRoot: snapshot.publicationRoot,
      rotationAnimation: snapshot.rotationAnimation,
      leaves: snapshot.leaves,
      axisLeafCounts: snapshot.axisLeaves.map((axisLeaves) => axisLeaves.length),
      lightingPresentation,
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
        for (const asset of renderAtlasAssets) asset.destroy();
      },
    });
    await waitForPreparedCssPaint();
    state.ready = true;
    setStatus("ready");
    requestAnimationFrame(() => player.resume());
  }
}

function waitForPreparedCssPaint() {
  return new Promise((resolvePaint) => {
    // A CSS background decode starts after its first requested paint. Waiting
    // across four display frames keeps that single decode behind the loader.
    let remainingFrames = 4;
    function frame() {
      remainingFrames -= 1;
      if (remainingFrames === 0) resolvePaint();
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
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
