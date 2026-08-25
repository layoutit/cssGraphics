// SPDX-License-Identifier: MIT
import { createBlackHolePreparedPlayer } from "./preparedPlayback.mjs";
import { mountPreparedBlackHoleSnapshot } from "./polycssScene.mjs";
import {
  createBlackHolePreparedBankWindow,
  createBlackHolePreparedBlockWindow,
  createBlackHolePreparedStreamLoader,
  loadBlackHolePreparedCatalog,
  loadBlackHolePreparedSnapshot,
} from "./preparedStream.mjs";
import { installBlackHoleStagePresentation } from "./stagePresentation.mjs";

export function mountBlackHoleClient(host) {
  let shouldPlay = true;
  let destroyed = false;
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    catalog: null,
    loader: null,
    player: null,
    dom: null,
    presentation: null,
  };
  const controller = Object.freeze({
    pause() {
      shouldPlay = false;
      return state.player?.pause();
    },
    resume() {
      shouldPlay = true;
      if (!destroyed) {
        return state.player?.resume();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      shouldPlay = false;
      state.player?.destroy();
      state.loader?.destroy();
      state.presentation?.destroy();
      state.dom?.destroy();
      state.ready = false;
      if (window.__cssBlackHoleDebug?.state === state) delete window.__cssBlackHoleDebug;
    },
  });
  installDebugApi(state, controller);
  setBodyState("loading");
  main().catch((error) => {
    if (destroyed) return;
    recordError(error);
    setBodyState("error");
  });
  return controller;

  async function main() {
    const metadata = await fetchJson("/cssblackhole/prepared.json");
    if (metadata?.schema !== "cssblackhole-prepared-scene@1" ||
        metadata.status !== "ready" ||
        metadata.renderer?.kind !== "retained-dom-polycss-prepared-playback" ||
        metadata.renderer.runtimePhysics !== false ||
        metadata.renderer.runtimeRasterization !== false ||
        metadata.renderer.retainedPointLeafCount !== 1979 ||
        metadata.viewport?.width !== 800 ||
        metadata.viewport?.height !== 600 ||
        metadata.presentation?.orbitalSpeedScale !== 0.5 ||
        JSON.stringify(metadata.presentation?.slotHoldSeconds) !==
          JSON.stringify([6, 2.5, 1, 2.5]) ||
        JSON.stringify(metadata.presentation?.slotDurationSeconds) !==
          JSON.stringify([8, 4.5, 3, 4.5]) ||
        metadata.presentation?.transitionSeconds !== 2 ||
        metadata.presentation?.publicationYearPointCount !== 1979 ||
        metadata.presentation?.displayPowerGamma !== 0.35 ||
        metadata.presentation?.displayOpacityFloor !== 0.22 ||
        metadata.presentation?.spaceContext?.schema !==
          "cssblackhole-prepared-space-context@1" ||
        metadata.presentation.spaceContext.sourceStarCountPerPlate !== 1000 ||
        metadata.presentation.spaceContext.runtimeDomNodeCount !== 0 ||
        metadata.presentation.spaceContext.runtimeAnimationCount !== 0 ||
        metadata.presentation.spaceContext.runtimeStyleWriteCount !== 0 ||
        metadata.presentation.spaceContext.runtimeRasterizationCount !== 0) {
      throw new Error("BlackHole prepared metadata drifted");
    }
    const catalog = await loadBlackHolePreparedCatalog(metadata.catalog);
    const loader = createBlackHolePreparedStreamLoader(catalog);
    state.metadata = metadata;
    state.catalog = catalog;
    state.loader = loader;
    loader.retainBankWindow(createBlackHolePreparedBankWindow(catalog, 0));
    loader.retainBlockWindow(createBlackHolePreparedBlockWindow(catalog, 0));
    const initialBlockPromise = loader.load(0, { eager: true });
    const snapshotHtml = await loadBlackHolePreparedSnapshot(catalog);
    if (destroyed) {
      loader.destroy();
      return;
    }
    const dom = mountPreparedBlackHoleSnapshot({ host, catalog, snapshotHtml });
    const presentation = installBlackHoleStagePresentation({
      host,
      camera: dom.camera,
      sourceViewport: metadata.viewport,
      sourceBounds: catalog.luminetPreparedState.bounds,
    });
    state.dom = dom;
    state.presentation = presentation;
    document.body.classList.replace("loading", "priming");
    performance.mark("cssblackhole-snapshot-mounted");
    await waitForPaint();
    performance.mark("cssblackhole-snapshot-painted");
    if (destroyed) return;
    const initialBlock = await initialBlockPromise;
    if (destroyed) return;
    const player = createBlackHolePreparedPlayer({
      catalog,
      transformPublisher: dom.transformPublisher,
      initialBlocks: [initialBlock],
      initialStreamFrame: 0,
      initialSnapshotPresented: true,
      loadBlock(index) { return loader.load(index); },
      onBlockWindow(indices) { loader.retainBlockWindow(indices); },
      onBankWindow(indices, prefetch) {
        loader.retainBankWindow(indices);
        if (prefetch) loader.prefetchBank(indices[1]).catch(recordError);
      },
      onError: recordError,
    });
    state.player = player;
    state.ready = true;
    document.body.classList.replace("priming", "ready");
    performance.mark("cssblackhole-ready");
    player.startLookahead();
    if (shouldPlay) player.resume();
  }

  function recordError(error) {
    state.errors.push(String(error?.stack || error));
    console.error(error);
  }
}

function installDebugApi(state, controller) {
  Object.defineProperty(window, "__cssBlackHoleDebug", {
    configurable: true,
    value: Object.freeze({
      state,
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { return controller.pause(); },
      resume() { return controller.resume(); },
      destroy() { return controller.destroy(); },
      seekStreamFrame(index) { return state.player?.seekStreamFrame(index); },
      stepFrame() { return state.player?.stepFrame(); },
      assertStableDomIdentity() { return state.dom?.assertStableDomIdentity() ?? false; },
      stats() {
        if (!state.ready || !state.player || !state.loader || !state.dom || !state.presentation) {
          return null;
        }
        return Object.freeze({
          adapterId: "luminet",
          transportSeed: state.catalog.transportSeed,
          starCount: state.catalog.starCount,
          configurationCount: state.catalog.configurationCount,
          sourceFramesPerSecond: state.catalog.sourceFramesPerSecond,
          framesPerSecond: state.catalog.framesPerSecond,
          orbitalSpeedScale: state.catalog.configurationLoop.orbitalSpeedScale,
          presentationSlotHoldSeconds:
            state.catalog.configurationLoop.presentationSlotHoldSeconds,
          transitionCadenceSecondsBySlot:
            state.catalog.configurationLoop.transitionCadenceSecondsBySlot,
          transitionDurationSeconds: state.catalog.configurationLoop.transitionSeconds,
          pointSize: 2,
          pointSizePolicy: "2px-all-resolution-tiers",
          cameraMode: "fixed",
          domNodeCount: document.getElementsByTagName("*").length,
          runtimePhysicsCount: 0,
          runtimeRasterizationCount: 0,
          runtimeMatrixFormattingCount: 0,
          animationPathTransformFormattingCount: 0,
          runtimeDomReconstructionCount: 0,
          spaceContextSourceStarCountPerPlate: state.catalog.spaceContext.sourceStarCountPerPlate,
          spaceContextPointPrimitive: state.catalog.spaceContext.pointPrimitive.shape,
          spaceContextRuntimeDomNodeCount: state.catalog.spaceContext.runtimeDomNodeCount,
          spaceContextRuntimeAnimationCount: state.catalog.spaceContext.runtimeAnimationCount,
          spaceContextRuntimeStyleWriteCount: state.catalog.spaceContext.runtimeStyleWriteCount,
          spaceContextRuntimeRasterizationCount: state.catalog.spaceContext.runtimeRasterizationCount,
          ...state.presentation.stats(),
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

function setBodyState(kind) {
  document.body.classList.remove("loading", "priming", "ready", "error");
  document.body.classList.add(kind);
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`BlackHole prepared asset failed: ${response.status} ${url}`);
  return response.json();
}
