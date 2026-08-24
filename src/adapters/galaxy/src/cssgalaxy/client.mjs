// SPDX-License-Identifier: HPND
import { createGalaxyPreparedPlayer } from "./preparedPlayback.mjs";
import { mountPreparedGalaxySnapshot } from "./polycssScene.mjs";
import {
  createGalaxyPreparedBankWindow,
  createGalaxyPreparedBlockWindow,
  createGalaxyPreparedStreamLoader,
  loadGalaxyPreparedCatalog,
  loadGalaxyPreparedSnapshot,
} from "./preparedStream.mjs";
import { selectGalaxyStartupEncounter } from "./startupEncounterSelection.mjs";
import { selectGalaxyPreparedProfileForWindow } from "./profileSelection.mjs";

export async function mountGalaxyClient(host) {
  let shouldPlay = true;
  let destroyed = false;
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    catalog: null,
    profileId: null,
    galaxyCount: null,
    transportSeed: null,
    seed: null,
    startupSelection: null,
    starCount: null,
    pointSize: null,
    viewZoom: null,
    cameraMode: null,
    loader: null,
    player: null,
    dom: null,
  };
  installDebugApi(state);
  try {
    const metadata = await fetchJson("/cssgalaxy/prepared.json");
    if (metadata?.schema !== "cssgalaxy-prepared-scene@5" || metadata.status !== "ready") {
      throw new Error("Galaxy prepared metadata drifted");
    }
    const profileId = selectGalaxyPreparedProfileForWindow();
    const profile = metadata.profiles?.[profileId];
    const galaxyCount = profile?.galaxyCount;
    const starCount = profile?.starCount;
    const pointSize = 1;
    const viewZoom = 1;
    const seed = profile?.comparisonSeed;
    if (metadata.defaultProfile !== "desktop" ||
        metadata.profileSelection?.mobileBreakpointWidth !== 600 ||
        metadata.profileSelection?.mobileCapabilityQuery !== "(hover: none) and (pointer: coarse)" ||
        profile?.id !== profileId ||
        (profileId === "desktop" && (galaxyCount !== 3 || starCount !== 1500 || seed !== 2298)) ||
        (profileId === "mobile" && (galaxyCount !== 2 || starCount !== 1000 || seed !== 4947))) {
      throw new Error("Galaxy prepared profile drifted");
    }
    const catalog = await loadGalaxyPreparedCatalog(profile.catalog, seed, profile);
    if (catalog.curatedEncounterSeeds.length !== 10 ||
        new Set(catalog.curatedEncounterSeeds).size !== catalog.curatedEncounterSeeds.length ||
        !catalog.curatedEncounterSeeds.includes(seed)) {
      throw new Error("Galaxy qualified encounter bank drifted");
    }
    const startupSelection = selectGalaxyStartupEncounter(catalog);
    const initialBankIndex = startupSelection.initialBankIndex;
    const initialBlockIndex = startupSelection.initialBlockIndex;
    const loader = createGalaxyPreparedStreamLoader(catalog);
    loader.retainBankWindow(createGalaxyPreparedBankWindow(catalog, initialBankIndex));
    loader.retainBlockWindow(createGalaxyPreparedBlockWindow(catalog, initialBlockIndex));
    const [initialBlock, snapshotHtml] = await Promise.all([
      loader.load(initialBlockIndex),
      loadGalaxyPreparedSnapshot(catalog),
    ]);
    const dom = mountPreparedGalaxySnapshot({ host, catalog, snapshotHtml });
    const player = createGalaxyPreparedPlayer({
      catalog,
      transformPublisher: dom.transformPublisher,
      initialBlocks: [initialBlock],
      initialStreamFrame: startupSelection.initialStreamFrame,
      loadBlock(index) { return loader.load(index); },
      onBlockWindow(indices) { loader.retainBlockWindow(indices); },
      onBankWindow(indices, prefetch) {
        loader.retainBankWindow(indices);
        if (prefetch) loader.prefetchBank(indices[1]).catch(recordError);
      },
      onError: recordError,
    });
    state.metadata = metadata;
    state.catalog = catalog;
    state.profileId = profileId;
    state.galaxyCount = galaxyCount;
    state.transportSeed = seed;
    state.seed = startupSelection.sourceSeed;
    state.startupSelection = startupSelection;
    state.starCount = starCount;
    state.pointSize = pointSize;
    state.viewZoom = viewZoom;
    state.cameraMode = "fixed";
    state.loader = loader;
    state.player = player;
    state.dom = dom;
    state.pause = () => {
      shouldPlay = false;
      return player.pause();
    };
    state.resume = () => {
      if (destroyed) return;
      shouldPlay = true;
      return player.resume();
    };
    state.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      shouldPlay = false;
      player.destroy();
      loader.destroy();
      dom.destroy();
    };
    await waitForPaint();
    state.ready = true;
    document.body.classList.replace("loading", "ready");
    performance.mark("cssgalaxy-ready");
    if (shouldPlay) player.resume();
    player.startLookahead();
    return state;
  } catch (error) {
    recordError(error);
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    throw error;
  }

  function recordError(error) {
    state.errors.push(String(error?.stack || error));
    console.error(error);
  }
}

function installDebugApi(state) {
  Object.defineProperty(window, "__cssGalaxyDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { return state.player?.pause(); },
      resume() { return state.player?.resume(); },
      seekStreamFrame(index) { return state.player?.seekStreamFrame(index); },
      stepFrame() { return state.player?.stepFrame(); },
      assertStableDomIdentity() { return state.dom?.assertStableDomIdentity() ?? false; },
      stats() {
        if (!state.ready || !state.player || !state.loader || !state.dom) return null;
        return Object.freeze({
          selectedSeed: state.seed,
          profileId: state.profileId,
          transportSeed: state.transportSeed,
          startupEncounterIndex: state.startupSelection.encounterIndex,
          startupSelectionMode: state.startupSelection.mode,
          startupRemainingEncounterCount: state.startupSelection.remainingEncounterCount,
          starCount: state.starCount,
          pointSize: state.pointSize,
          viewZoom: state.viewZoom,
          cameraMode: state.cameraMode,
          galaxyCount: state.catalog.galaxyCount,
          domNodeCount: document.getElementsByTagName("*").length,
          runtimePhysicsCount: 0,
          runtimeRasterizationCount: 0,
          runtimeMatrixFormattingCount: 0,
          animationPathTransformFormattingCount: 0,
          runtimeDomReconstructionCount: 0,
          ...state.dom.stats(),
          ...state.loader.stats(),
          ...state.player.stats(),
        });
      },
      metadata() { return state.metadata; },
      catalog() { return state.catalog; },
    }),
  });
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Galaxy prepared asset failed: ${response.status} ${url}`);
  return response.json();
}
