// SPDX-License-Identifier: HPND
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { loadPolyMorphPackage, mountPolyMorphModel } from "@layoutit/polycss-morph";
import {
  createCityflowPreparedPlayer,
  loadCityflowPreparedPlayback,
} from "./preparedPlayback.mjs";
import { cleanCityflowPreparedDom } from "./preparedDom.mjs";
import { cityflowSourceProjection } from "./sourceProjection.mjs";
import {
  CSSCITYFLOW_PREPARED_BANKS,
  selectCityflowPreparedBank,
} from "./profileSelection.mjs";

export function mountCityflow(host) {
  let destroyed = false;
  const state = {
    ready: false,
    errors: [],
    metadata: null,
    bankId: null,
    dom: null,
    mounted: null,
    player: null,
  };
  const controller = Object.freeze({
    pause() {
      return state.player?.pause();
    },
    resume() {
      if (!destroyed) return state.player?.resume();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      state.player?.destroy();
      state.dom?.destroy();
      state.mounted?.destroy();
      state.ready = false;
      if (globalThis.__csscityflow === state) delete globalThis.__csscityflow;
    },
  });
  Object.defineProperty(globalThis, "__csscityflow", {
    configurable: true,
    value: state,
  });
  main().catch((error) => fail(error));
  return controller;

  async function main() {
    const bankId = selectCityflowPreparedBank({
      width: host.clientWidth || innerWidth,
      height: host.clientHeight || innerHeight,
    });
    const modelId = CSSCITYFLOW_PREPARED_BANKS[bankId].modelId;
    const metadataPromise = fetchPreparedMetadata("/csscityflow/prepared.json");
    const loadedPromise = loadPolyMorphPackage("/csscityflow/", { modelId });
    const playbackPromise = loadCityflowPreparedPlayback(
      `/csscityflow/${modelId}.playback.json`,
    );
    const metadata = await metadataPromise;
    const stylesheetAssetUrl = preparedStylesheetAssetUrl(metadata);
    const [loaded, playback] = await Promise.all([
      loadedPromise,
      playbackPromise,
      loadPreparedStylesheet(stylesheetAssetUrl),
    ]);
    assertPreparedMetadata(metadata, playback, bankId, modelId);
    if (destroyed) return;
    const perspective = cityflowSourceProjection(host.clientWidth, host.clientHeight).perspective;
    const stagingHost = host.ownerDocument.createElement("div");
    const mounted = mountPolyMorphModel(stagingHost, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: -perspective,
      }),
    });
    const dom = cleanCityflowPreparedDom(mounted, loaded.model.render.shapes.length);
    const player = createCityflowPreparedPlayer({ playback, dom });
    const cameraElement = dom.cameraElement;
    host.append(cameraElement);
    if (destroyed) {
      player.destroy();
      dom.destroy();
      mounted.destroy();
      return;
    }
    state.metadata = metadata;
    state.bankId = bankId;
    state.dom = dom;
    state.mounted = mounted;
    state.player = player;
    player.resume();
    await waitForPaint();
    if (destroyed) return;
    dom.finalizePreparedTarget();
    state.ready = true;
    document.body.classList.replace("loading", "ready");
    performance.mark("csscityflow-ready");
  }

  function fail(error) {
    if (destroyed) return;
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    console.error(error);
  }
}

async function fetchPreparedMetadata(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cityflow prepared metadata failed to load: ${response.status}`);
  return response.json();
}

function assertPreparedMetadata(metadata, playback, bankId, modelId) {
  const bank = metadata?.banks?.find((candidate) => candidate.id === bankId);
  if (metadata?.schema !== "csscityflow-prepared-product@3" || metadata.status !== "ready" ||
      metadata.defaultBank !== "desktop" ||
      metadata.profileSelection?.mobileBreakpointWidth !== 600 ||
      metadata.profileSelection?.mobileCapabilityQuery !== "(hover: none) and (pointer: coarse)" ||
      metadata.source?.revision !== "906693799e4fb7581436590cf84ecb2d3c9186ba" ||
      metadata.source?.license !== "HPND" || metadata.renderer?.runtimeGeometry !== false ||
      metadata.renderer?.runtimeRasterization !== false || metadata.renderer?.runtimeDomGrowth !== false ||
      metadata.banks?.length !== 2 || bank?.modelId !== modelId || bank?.seed !== 26081702 ||
      bank?.boxCount !== (bankId === "mobile" ? 100 : 200) ||
      bank?.leafCount !== bank.boxCount * 3 || bank?.frameCount !== 301 ||
      bank?.sourceFrameCount !== 251 || bank?.frameCount !== playback.frameCount ||
      playback.bankId !== bankId || playback.modelId !== modelId ||
      bank?.retainedFacePublication?.schema !== "csscityflow-retained-face-publication@3" ||
      bank.retainedFacePublication.policy !==
        "prepared-whole-box-visibility-no-face-culling" ||
      bank.retainedFacePublication.faceCount !== bank.leafCount ||
      bank.retainedFacePublication.boxCount !== bank.boxCount ||
      bank.retainedFacePublication.visibleFaceCount !==
        (bankId === "mobile" ? 300 : 585) ||
      bank.retainedFacePublication.hiddenFaceCount !==
        (bankId === "mobile" ? 0 : 15) ||
      bank.retainedFacePublication.visibleBoxCount !==
        (bankId === "mobile" ? 100 : 195) ||
      bank.retainedFacePublication.hiddenBoxCount !==
        (bankId === "mobile" ? 0 : 5) ||
      bank.retainedFacePublication.staticVisibility?.schema !==
        "csscityflow-prepared-static-visibility@3" ||
      bank.retainedFacePublication.sideDepth?.schema !==
        "csscityflow-prepared-side-depth@1" ||
      bank.retainedFacePublication.sideDepth.defaultDepthScale !==
        (bankId === "mobile" ? 0.28 : 0.1) ||
      bank.retainedFacePublication.sideDepth.maximumDepthScale !==
        0.28 ||
      bank.retainedFacePublication.sideDepth.overrideCount !==
        (bankId === "mobile" ? 0 : 19) ||
      bank?.diagnosticVisibility?.usage !==
        "diagnostic-only-never-consumed-by-product-playback" ||
      bank?.presentation?.kind !== "prepared-periodic-source-sample-reconstruction" ||
      bank.presentation.heightInterpolation !==
        "periodic-uniform-cubic-b-spline-c2-source-approximation" ||
      bank.presentation.temporalFilter !==
        "prepared-periodic-five-tap-fold-twelve-three-tap-refold-twelve-five-tap-refold-twelve-adaptive-smooth-sine-eased-extrema@1" ||
      bank.presentation.directionRunSuppression !==
        "prepared-circular-twelve-frame-or-short-direction-run-folding-zero-sum-adaptive-smooth-sine-24-54-0.6-eased@1" ||
      bank.presentation.colorInterpolation !==
        "prepared-srgb-interpolated-final-face-color" ||
      bank.presentation.transformPublication !==
        "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication" ||
      bank.presentation.statePublication?.schema !==
        "csscityflow-prepared-state-publication@22" ||
      bank.presentation.statePublication.frameCount !== 301 ||
      bank.presentation.statePublication.animationCount !== 0 ||
      bank.presentation.statePublication.runtimeFormatting !== false ||
      bank.presentation.statePublication.loadTimeAssembly !==
        "one-time-prepared-transform-component-table-expansion" ||
      bank.presentation.statePublication.sourceSeekAssembly !==
        "none-cached-expanded-transform-and-final-face-color-dictionaries" ||
      bank.presentation.statePublication.atomicProperties !==
        "prepared-root-transform-plus-direct-leaf-visibility-and-final-face-background-color" ||
      bank.presentation.statePublication.minimumShapeStyleWritesPerScheduledTick !== 0 ||
      bank.presentation.statePublication.maximumShapeStyleWritesPerScheduledTick !==
        playback.staticVisibility.presentation.maximumVisibleBoxes ||
      bank.presentation.statePublication.maximumLeafColorStyleWritesPerScheduledTick !==
        playback.colors.presentationTransitions.maximumWritesPerFrame ||
      bank.presentation.statePublication.maximumVisibilityStyleWritesPerScheduledTick !==
        playback.staticVisibility.presentation.maximumTransitionWritesPerFrame * 3 ||
      bank?.loop?.kind !== "prepared-periodic-source-sample-reconstruction" ||
      bank.loop.exactSourceLoop !== false ||
      bank.loop.presentationPeriodFrames !== 301 ||
      bank.loop.closureContinuity !==
        "periodic-zero-sum-twelve-frame-direction-run-folded-adaptive-smooth-sine-eased-sample-cycle") {
    throw new Error("Cityflow prepared metadata drifted");
  }
}

function preparedStylesheetAssetUrl(metadata) {
  const stylesheet = metadata?.stylesheet;
  const match = /^\/csscityflow\/assets\/presentation-([a-f0-9]{64})\.css$/u
    .exec(stylesheet?.assetUrl ?? "");
  if (metadata?.schema !== "csscityflow-prepared-product@3" ||
      stylesheet?.schema !== "csscityflow-prepared-stylesheet@1" ||
      stylesheet?.policy !== "one-content-addressed-rendering-contract-shared-by-all-banks" ||
      match?.[1] !== stylesheet.sha256 ||
      !Number.isSafeInteger(stylesheet.byteLength) || stylesheet.byteLength <= 0 ||
      JSON.stringify(stylesheet.compatibilityAssetUrls) !== JSON.stringify([
        "/csscityflow/cityflow.css",
        "/csscityflow/cityflow-mobile.css",
      ])) {
    throw new Error("Cityflow prepared stylesheet metadata drifted");
  }
  return stylesheet.assetUrl;
}

function waitForPaint() {
  return new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
}

function loadPreparedStylesheet(href) {
  return new Promise((resolveLoad, rejectLoad) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", resolveLoad, { once: true });
    link.addEventListener("error", () => rejectLoad(new Error(`Cityflow stylesheet failed: ${href}`)), { once: true });
    document.head.append(link);
  });
}
