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
  let shouldPlay = true;
  try {
    const manifest = await loadCssPipesManifest(route.manifestUrl);
    const descriptor = selectDefaultScene(manifest);
    const scene = await loadCssPipesScene(descriptor);
    const snapshot = await mountPreparedPolyCssSnapshot(host, scene);
    presentation = mountCssPipesPresentation({
      host,
      camera: snapshot.camera,
      sourceViewport: scene.camera.sourceViewport,
      responsivePresentation: scene.camera.responsivePresentation,
    });
    const shapeRoots = snapshot.scene.children;
    const leafRoots = snapshot.scene.querySelectorAll(":scope > div > b");
    if (shapeRoots.length === 0 || leafRoots.length === 0) {
      throw new Error("Prepared cssPipes playback targets are missing");
    }
    player = await createCssPipesPrebakedPlayer({
      playback: scene.playback,
      sceneRoot: snapshot.scene,
      shapeRoots,
      leafRoots,
      initialViewportProfile: presentation.viewportProfile,
    });
    const mounted = Object.freeze({
      ...snapshot,
      presentation,
      player,
      pause() {
        shouldPlay = false;
        return player.pause();
      },
      resume() {
        shouldPlay = true;
        return player.resume();
      },
      destroy() {
        shouldPlay = false;
        presentation.destroy();
        player.destroy();
      },
    });
    host.classList.add("csspipes-ready");
    globalThis.requestAnimationFrame(() => {
      if (shouldPlay) player.resume();
    });
    return mounted;
  } catch (error) {
    player?.destroy();
    presentation?.destroy();
    host.classList.add("csspipes-error");
    const message = document.createElement("p");
    message.className = "csspipes-error-message";
    message.textContent = `${PREPARE_FAILURE} ${error instanceof Error ? error.message : String(error)}`;
    host.append(message);
    return null;
  }
}
