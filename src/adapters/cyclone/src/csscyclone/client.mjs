// SPDX-License-Identifier: GPL-2.0-or-later
import { loadPolyMorphPackage } from "@layoutit/polycss-morph";
import { prepareCycloneDom } from "./preparedDom.mjs";
import { loadCyclonePreparedLightingColors } from "./preparedLightingColors.mjs";
import { createCyclonePreparedPlayer } from "./preparedPlayback.mjs";
import {
  createCyclonePreparedBlockLoader,
  loadCyclonePreparedCatalog,
  selectInitialCyclonePosition,
} from "./preparedStream.mjs";
import {
  CSSCYCLONE_PREPARED_PROFILES,
  selectCyclonePreparedProfile,
} from "./profileSelection.mjs";
import { selectCycloneStartupPaletteVariant } from "./startupPaletteSelection.mjs";

const LAST_START_SELECTION_STORAGE_KEY = "csscyclone:last-start-selection";

export async function mountCycloneClient(host) {
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    profile: null,
    catalog: null,
    selection: null,
    blockLoader: null,
    mounted: null,
    player: null,
  };
  let lightingColors = null;
  installDebugApi(state);
  try {
    const profileId = selectCyclonePreparedProfile({
      width: host.clientWidth || innerWidth,
      height: host.clientHeight || innerHeight,
    });
    const profileBinding = CSSCYCLONE_PREPARED_PROFILES[profileId];
    const [loaded, metadata] = await Promise.all([
      loadPolyMorphPackage("/csscyclone/model/", { modelId: profileBinding.modelId }),
      fetchJson("/csscyclone/prepared.json", { cache: "no-store" }),
    ]);
    const profile = metadata?.profiles?.[profileId];
    const catalog = await loadCyclonePreparedCatalog(profile?.playback);
    if (metadata?.schema !== "csscyclone-prepared-scene@2" ||
        metadata.status !== "ready" ||
        profile?.id !== profileId ||
        profile.model?.id !== profileBinding.modelId ||
        loaded.model.identity.id !== profileBinding.modelId ||
        profile.presentation?.preparedStream?.id !== catalog.streamId ||
        profile.playback?.chunkCount !== catalog.chunkCount ||
        profile.playback?.preparedBlockCount !== catalog.blockCount ||
        !Array.isArray(profile.lighting?.paletteVariantIds) ||
        profile.lighting.paletteVariantIds.length !== catalog.startupPaletteVariantIds.length ||
        profile.lighting.paletteVariantIds.some((variantId, index) =>
          variantId !== catalog.startupPaletteVariantIds[index])) {
      throw new Error("Cyclone prepared model binding drifted");
    }
    const route = new URLSearchParams(globalThis.location?.search ?? "");
    const paletteSelection = route.has("chunk") || route.has("frame")
      ? null
      : selectCycloneStartupPaletteVariant(catalog.startupPaletteVariantIds, {
        weights: catalog.startupPaletteVariantWeights,
      });
    const selection = selectInitialCyclonePosition(catalog, {
      previousSelectionId: readPreviousStartSelection(catalog.startupSelections),
      preferredPaletteVariantId: paletteSelection?.paletteVariantId ?? null,
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
    const startupLookaheadBlockIndices = lookaheadBlockIndices.slice(
      0,
      catalog.startupMaterializedLookaheadBlockCount,
    );
    blockLoader.retain(residentBlockIndices);
    const [initialBlock, initialLookaheadBlocks, loadedLightingColors] = await Promise.all([
      blockLoader.load(initialBlockIndex, { offMainThread: true }),
      Promise.all(startupLookaheadBlockIndices.map((streamBlockIndex) =>
        blockLoader.load(streamBlockIndex, { offMainThread: true }))),
      loadCyclonePreparedLightingColors(profile.lighting, selection.paletteVariantId),
      blockLoader.prime(residentBlockIndices),
    ]);
    lightingColors = loadedLightingColors;
    const preparedDom = prepareCycloneDom(host, loaded);
    const { mounted, modelTransform } = preparedDom;
    const player = createCyclonePreparedPlayer({
      mounted,
      modelTransform,
      catalog,
      initialBlock,
      initialLookaheadBlocks,
      initialFrameIndex: initialBlockFrameIndex,
      lighting: profile.lighting,
      lightingColors,
      schedulerMode: "continuous-raf",
      loadBlock(streamBlockIndex) {
        return blockLoader.load(streamBlockIndex, { incremental: true, offMainThread: true });
      },
      onBlockWindow(streamBlockIndices) {
        blockLoader.retain(streamBlockIndices);
        for (const streamBlockIndex of streamBlockIndices) blockLoader.prefetch(streamBlockIndex);
      },
    });
    player.resize();
    preparedDom.attach();
    addEventListener("resize", player.resize, { passive: true });
    state.metadata = metadata;
    state.profile = profile;
    state.catalog = catalog;
    state.selection = selection;
    state.blockLoader = blockLoader;
    state.mounted = mounted;
    state.player = player;
    document.body.classList.replace("loading", "priming");
    const primingFrameIndex = initialBlockFrameIndex + 1 < catalog.blockFrameCount
      ? initialBlockFrameIndex + 1
      : initialBlockFrameIndex - 1;
    player.seekFrame(primingFrameIndex);
    await waitForCycloneScenePaint();
    player.seekFrame(initialBlockFrameIndex);
    await waitForCycloneScenePaint();
    await waitForCycloneScenePaint();
    state.ready = true;
    document.body.classList.replace("priming", "ready");
    player.resume();
    return state;
  } catch (error) {
    lightingColors?.destroy();
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading", "priming");
    document.body.classList.add("error");
    console.error(error);
    throw error;
  }
}

function waitForCycloneScenePaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
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
          preparedProfileId: state.profile.id,
          preparedProfileParticleCount: state.profile.presentation.productParticleCount,
          initialChunkIndex: state.selection.chunkIndex,
          initialFrameIndex: state.selection.frameIndex,
          startupSelectionId: state.selection.selectionId ?? null,
          startupPaletteVariantId: state.selection.paletteVariantId ?? null,
          startupSourcePaletteFamily: state.selection.sourcePaletteFamily ?? null,
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
