// SPDX-License-Identifier: GPL-2.0-or-later
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { loadPolyMorphPackage, mountPolyMorphModel } from "@layoutit/polycss-morph";
import { loadCyclonePreparedLightingAsset } from "./preparedLightingAsset.mjs";
import { createCyclonePreparedPlayer } from "./preparedPlayback.mjs";
import {
  createCyclonePreparedBlockLoader,
  loadCyclonePreparedCatalog,
  selectInitialCyclonePosition,
} from "./preparedStream.mjs";

const MODEL_ID = "cyclone";
const LAST_START_SELECTION_STORAGE_KEY = "csscyclone:last-start-selection";

export async function mountCycloneClient(host) {
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    catalog: null,
    selection: null,
    blockLoader: null,
    mounted: null,
    player: null,
  };
  let lightingAsset = null;
  installDebugApi(state);
  try {
    const [loaded, metadata] = await Promise.all([
      loadPolyMorphPackage("/csscyclone/model/", { modelId: MODEL_ID }),
      fetchJson("/csscyclone/prepared.json", { cache: "no-store" }),
    ]);
    const catalog = await loadCyclonePreparedCatalog(metadata?.playback);
    if (metadata?.schema !== "csscyclone-prepared-scene@1" ||
        metadata.status !== "ready" ||
        loaded.model.identity.id !== MODEL_ID ||
        metadata.model?.id !== MODEL_ID ||
        metadata.presentation?.preparedStream?.id !== catalog.streamId ||
        metadata.playback?.chunkCount !== catalog.chunkCount ||
        metadata.playback?.preparedBlockCount !== catalog.blockCount ||
        metadata.lighting?.maximumColorFamilyCount !== catalog.maximumColorFamilyCount ||
        metadata.lighting?.paletteFamilies?.some((family, index) =>
          family !== catalog.startupPaletteFamilies[index])) {
      throw new Error("Cyclone prepared model binding drifted");
    }
    const selection = selectInitialCyclonePosition(catalog, {
      previousSelectionId: readPreviousStartSelection(catalog.startupSelections),
    });
    rememberStartSelection(selection.selectionId);
    const initialStreamFrameIndex = selection.chunkIndex * catalog.chunkFrameCount + selection.frameIndex;
    const initialBlockIndex = Math.floor(initialStreamFrameIndex / catalog.blockFrameCount);
    const initialBlockFrameIndex = initialStreamFrameIndex % catalog.blockFrameCount;
    const blockLoader = createCyclonePreparedBlockLoader(catalog);
    const lookaheadBlockIndices = Array.from(
      { length: catalog.runtimeLookaheadBlockCount },
      (unused, offset) => (initialBlockIndex + offset + 1) % catalog.blockCount,
    );
    const residentBlockIndices = [initialBlockIndex, ...lookaheadBlockIndices];
    blockLoader.retain(residentBlockIndices);
    const [initialBlock, initialLookaheadBlocks, loadedLightingAsset] = await Promise.all([
      blockLoader.load(initialBlockIndex),
      Promise.all(lookaheadBlockIndices.map((streamBlockIndex) => blockLoader.load(streamBlockIndex))),
      loadCyclonePreparedLightingAsset(metadata.lighting, selection.paletteFamily),
    ]);
    lightingAsset = loadedLightingAsset;
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({ perspective: 800, target: [0, 0, 0], rotX: 0, rotY: 0, zoom: 50 }),
    });
    cleanPreparedDom(mounted);
    const player = createCyclonePreparedPlayer({
      mounted,
      catalog,
      initialBlock,
      initialLookaheadBlocks,
      initialFrameIndex: initialBlockFrameIndex,
      lighting: metadata.lighting,
      lightingAsset,
      loadBlock(streamBlockIndex) {
        return blockLoader.load(streamBlockIndex);
      },
      onBlockWindow(streamBlockIndices) {
        blockLoader.retain(streamBlockIndices);
      },
    });
    player.resize();
    addEventListener("resize", player.resize, { passive: true });
    state.ready = true;
    state.metadata = metadata;
    state.catalog = catalog;
    state.selection = selection;
    state.blockLoader = blockLoader;
    state.mounted = mounted;
    state.player = player;
    document.body.classList.replace("loading", "ready");
    player.resume();
    return state;
  } catch (error) {
    lightingAsset?.destroy();
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    console.error(error);
    throw error;
  }
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.cameraElement.removeAttribute("data-polycss-camera-perspective");
  mounted.sceneElement.className = "polycss-scene";
  mounted.sceneElement.removeAttribute("aria-hidden");
  mounted.modelElement.removeAttribute("class");
  mounted.modelElement.removeAttribute("data-poly-morph-model");
  for (const element of mounted.shapeElements.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-shape");
  }
  for (const { element } of mounted.leafHandles.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-leaf");
    element.removeAttribute("data-poly-morph-strategy");
    element.removeAttribute("data-poly-morph-resolved-strategy");
    element.style.removeProperty("backface-visibility");
    element.style.removeProperty("color");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
}

function installDebugApi(state) {
  Object.defineProperty(window, "__cssCycloneDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { return state.player?.pause(); },
      resume() { return state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      metadata() { return state.metadata; },
      stats() {
        if (!state.mounted || !state.player) return null;
        return Object.freeze({
          retainedParticleRootCount: state.mounted.shapeElements.size,
          retainedPolygonLeafCount: state.mounted.leafHandles.size,
          initialChunkIndex: state.selection.chunkIndex,
          initialFrameIndex: state.selection.frameIndex,
          startupSelectionId: state.selection.selectionId ?? null,
          startupPaletteFamily: state.selection.paletteFamily ?? null,
          startupSelectionMode: state.selection.mode,
          ...state.blockLoader.stats(),
          ...state.player.stats(),
        });
      },
    }),
  });
}

function readPreviousStartSelection(startupSelections) {
  try {
    const stored = globalThis.sessionStorage?.getItem(LAST_START_SELECTION_STORAGE_KEY);
    if (stored === null || stored === undefined) return null;
    return startupSelections.some((selection) => selection.id === stored) ? stored : null;
  } catch {
    return null;
  }
}

function rememberStartSelection(selectionId) {
  if (typeof selectionId !== "string") return;
  try {
    globalThis.sessionStorage?.setItem(LAST_START_SELECTION_STORAGE_KEY, selectionId);
  } catch {
    // Startup remains cryptographically random when storage is unavailable.
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Cyclone prepared asset failed: ${response.status} ${url}`);
  return response.json();
}
