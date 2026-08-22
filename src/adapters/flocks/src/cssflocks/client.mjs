// SPDX-License-Identifier: GPL-2.0-or-later
import { loadPolyMorphPackage } from "@layoutit/polycss-morph";
import {
  CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS,
  CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS,
  selectReallySlickPaletteVariant,
} from "../../../shared/reallyslickPalette.mjs";
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
    paletteSelection: null,
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
    const paletteSelection = route.paletteVariantId === null
      ? selectReallySlickPaletteVariant(CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS, {
        weights: CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS,
      })
      : Object.freeze({
        paletteVariantId: route.paletteVariantId,
        remainingPaletteVariantCount: null,
        sessionPersistence: false,
      });
    const blockLoader = createFlocksPreparedBlockLoader(catalog, {
      paletteVariantId: paletteSelection.paletteVariantId,
    });
    const startupWindow = selectFlocksStartupWindow({
      profileId,
      requestedId: route.startupWindowId,
      previousId: readPreviousStartupWindowId(),
    });
    const lookaheadBlockIndices = Array.from(
      { length: catalog.runtimeLookaheadBlockCount },
      (unused, offset) => (startupWindow.blockIndex + offset + 1) % catalog.blockCount,
    );
    const residentBlockIndices = [startupWindow.blockIndex, ...lookaheadBlockIndices];
    const startupLookaheadBlockIndices = lookaheadBlockIndices.slice(
      0,
      catalog.startupMaterializedLookaheadBlockCount,
    );
    blockLoader.retain(residentBlockIndices);
    const [initialBlock, initialLookaheadBlocks] = await Promise.all([
      blockLoader.load(startupWindow.blockIndex, { eager: true }),
      Promise.all(startupLookaheadBlockIndices.map((index) =>
        blockLoader.load(index, { eager: true }))),
      blockLoader.prime(residentBlockIndices),
    ]);
    const mounted = mountFlocksPolycssScene(host, loaded, { sceneId: route.sceneId, profileId });
    const shapeElements = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
    const player = createFlocksPreparedPlayer({
      shapeElements,
      catalog,
      initialBlock,
      initialLookaheadBlocks,
      loadBlock: blockLoader.load,
      onBlockWindow(indices) {
        blockLoader.retain(indices);
        for (const index of indices) blockLoader.prefetch(index);
      },
      onError(error) {
        state.errors.push(String(error?.stack || error));
        document.body.classList.add("error");
      },
      assertStableDom() { assertFlocksDirectRoots(mounted); },
      setPerspective(perspective) {
        mounted.cameraElement.style.setProperty("--flocks-perspective", `${perspective}px`);
      },
    });
    const resize = () => player.resize();
    resize();
    addEventListener("resize", resize, { passive: true });
    state.manifest = manifest;
    state.scene = scene;
    state.route = route;
    state.profile = profile;
    state.mounted = mounted;
    state.blockLoader = blockLoader;
    state.player = player;
    state.startupWindow = startupWindow;
    state.paletteSelection = paletteSelection;
    state.destroy = () => {
      removeEventListener("resize", resize);
      player.destroy();
      mounted.cameraElement.remove();
    };
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
