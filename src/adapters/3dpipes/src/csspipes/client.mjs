import {
  loadCssPipesManifest,
  loadCssPipesScene,
  selectDefaultScene,
} from "./manifestClient.mjs";
import { createCssPipesPrebakedPlayer } from "./prebakedPlayback.mjs";
import { mountPreparedPolyCssSnapshot } from "./polycssScene.mjs";
import { mountCssPipesPresentation } from "./presentation.mjs";

const PREPARE_FAILURE = "cssPipes prepared clip scene unavailable. Run pnpm prepare:3dpipes.";
export async function startCssPipesClient(host, route) {
  let presentation = null;
  let player = null;
  let unsubscribePresentation = null;
  try {
    const manifest = await loadCssPipesManifest(route.manifestUrl);
    const descriptor = selectDefaultScene(manifest);
    const scene = await loadCssPipesScene(descriptor);
    const snapshot = await mountPreparedPolyCssSnapshot(host, scene);
    presentation = mountCssPipesPresentation({
      host,
      viewport: snapshot.viewport,
      camera: snapshot.camera,
      sourceViewport: scene.camera.sourceViewport,
      responsivePresentation: scene.camera.responsivePresentation,
    });
    const playbackRoot = host.querySelector("[data-csspipes-playback-root]");
    const shapeRoots = host.querySelectorAll("[data-csspipes-shape-index]");
    const leafRoots = host.querySelectorAll("[data-csspipes-leaf-index]");
    if (!(playbackRoot instanceof HTMLElement) || shapeRoots.length === 0 || leafRoots.length === 0) {
      throw new Error("Prepared cssPipes playback targets are missing");
    }
    player = await createCssPipesPrebakedPlayer({
      playback: scene.playback,
      sceneRoot: snapshot.scene,
      playbackRoot,
      shapeRoots,
      leafRoots,
      initialViewportProfile: presentation.viewportProfile,
    });
    unsubscribePresentation = presentation.subscribe((layout) => {
      void player.setViewportProfile(layout.viewportProfile);
    });
    const mounted = Object.freeze({
      ...snapshot,
      presentation,
      player,
      destroy() {
        unsubscribePresentation();
        presentation.destroy();
        player.destroy();
      },
    });
    host.dataset.csspipesReady = "true";
    globalThis.requestAnimationFrame(() => player.resume());
    return mounted;
  } catch (error) {
    unsubscribePresentation?.();
    player?.destroy();
    presentation?.destroy();
    host.dataset.csspipesReady = "error";
    host.textContent = `${PREPARE_FAILURE} ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}
