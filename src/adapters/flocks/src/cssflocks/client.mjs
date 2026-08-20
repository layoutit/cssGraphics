// SPDX-License-Identifier: GPL-2.0-or-later
import { loadPolyMorphPackage } from "@layoutit/polycss-morph";
import { installFlocksDebugApi } from "./debugApi.mjs";
import { loadFlocksJson, loadFlocksManifest } from "./manifestClient.mjs";
import { createFlocksPreparedPlayer } from "./preparedPlayback.mjs";
import { createFlocksPreparedBlockLoader, loadFlocksPreparedCatalog } from "./preparedStream.mjs";
import { mountFlocksPolycssScene, assertFlocksDirectRoots } from "./polycssScene.mjs";
import { selectFlocksPreparedProfile } from "./profileSelection.mjs";
import { resolveFlocksRoute } from "./routeState.mjs";
import { selectFlocksStartupWindow } from "../shared/cssflocks/startupWindows.mjs";

export async function mountFlocksClient(host) {
  const state = {
    ready: false,
    errors: [],
    manifest: null,
    scene: null,
    route: null,
    profile: null,
    mounted: null,
    blockLoader: null,
    player: null,
    startupWindow: null,
  };
  installFlocksDebugApi(state);
  try {
    const manifest = await loadFlocksManifest();
    const route = resolveFlocksRoute({ manifest });
    const [prepared, scene] = await Promise.all([
      loadFlocksJson("/cssflocks/prepared.json"),
      loadFlocksJson(manifest.scenes.find((entry) => entry.id === route.sceneId).url),
    ]);
    const profileId = selectFlocksPreparedProfile({ width: host.clientWidth || innerWidth });
    const profile = prepared.profiles?.[profileId];
    if (prepared?.schema !== "cssflocks-prepared-scene@1" || prepared.status !== "ready" ||
        prepared.defaultScene !== route.sceneId || scene?.id !== route.sceneId || profile?.id !== profileId) {
      throw new Error("Flocks manifest, scene, and profile binding drifted");
    }
    const [loaded, catalog] = await Promise.all([
      loadPolyMorphPackage("/cssflocks/model/", { modelId: profile.model.id }),
      loadFlocksPreparedCatalog(profile.playback),
    ]);
    if (loaded.model.identity.id !== profile.model.id || catalog.modelId !== profile.model.id ||
        catalog.bugCount !== profile.presentation.productBugCount) {
      throw new Error("Flocks prepared model binding drifted");
    }
    const blockLoader = createFlocksPreparedBlockLoader(catalog);
    const startupWindow = selectFlocksStartupWindow({
      requestedId: route.startupWindowId,
      previousId: readPreviousStartupWindowId(),
    });
    const startupBlockIndices = [0, 1, 2].map((offset) => (startupWindow.blockIndex + offset) % catalog.blockCount);
    blockLoader.retain(startupBlockIndices);
    const initialBlock = await blockLoader.load(startupWindow.blockIndex, { eager: true });
    const mounted = mountFlocksPolycssScene(host, loaded, { sceneId: route.sceneId, profileId });
    const shapeElements = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
    const player = createFlocksPreparedPlayer({
      shapeElements,
      catalog,
      initialBlock,
      initialLookaheadBlocks: [],
      loadBlock: blockLoader.load,
      onBlockWindow: blockLoader.retain,
      onError(error) {
        state.errors.push(String(error?.stack || error));
        document.body.classList.add("error");
      },
      assertStableDom() { assertFlocksDirectRoots(mounted); },
      setPerspective(perspective) {
        mounted.cameraElement.style.setProperty("--flocks-perspective", `${perspective}px`);
      },
    });
    player.resize();
    addEventListener("resize", () => player.resize(), { passive: true });
    state.manifest = manifest;
    state.scene = scene;
    state.route = route;
    state.profile = profile;
    state.mounted = mounted;
    state.blockLoader = blockLoader;
    state.player = player;
    state.startupWindow = startupWindow;
    writePreviousStartupWindowId(startupWindow.id);
    document.body.classList.replace("loading", "priming");
    await waitForPaint();
    await waitForPaint();
    state.ready = true;
    document.body.classList.replace("priming", "ready");
    player.resume();
    return state;
  } catch (error) {
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading", "priming");
    document.body.classList.add("error");
    console.error(error);
    throw error;
  }
}

const STARTUP_WINDOW_STORAGE_KEY = "cssflocks:last-startup-window";

function readPreviousStartupWindowId() {
  try { return sessionStorage.getItem(STARTUP_WINDOW_STORAGE_KEY); } catch { return null; }
}

function writePreviousStartupWindowId(id) {
  try { sessionStorage.setItem(STARTUP_WINDOW_STORAGE_KEY, id); } catch {}
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
