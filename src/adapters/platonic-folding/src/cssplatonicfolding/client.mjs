import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import {
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";
import { selectPlatonicBank } from "./bankSelection.mjs";
import { createPlatonicPreparedPlayer } from "./preparedPlayback.mjs";

const MODEL_ID = "platonic-folding";

export function mountPlatonicFolding(host) {
  const state = { ready: false, errors: [], bankId: null, metadata: null, mounted: null, player: null };
  installDebugApi(state);
  main().catch(fail);
  return state;

  async function main() {
    const bankId = selectPlatonicBank({ width: host.clientWidth || innerWidth, height: host.clientHeight || innerHeight });
    const playbackPath = `/cssplatonicfolding/banks/${bankId}/playback.json`;
    const [loaded, metadata, playback] = await Promise.all([
      loadPolyMorphPackage("/cssplatonicfolding/model/", { modelId: MODEL_ID }),
      fetch("/cssplatonicfolding/prepared.json", { cache: "no-store" })
        .then(assertResponse)
        .then((response) => response.json()),
      fetch(playbackPath)
        .then(assertResponse)
        .then((response) => response.json()),
    ]);
    const preparedBank = metadata?.preparedBanks?.find((bank) => bank.id === bankId);
    if (metadata?.schema !== "cssplatonicfolding-prepared-scene@1" ||
        loaded.model.identity.id !== MODEL_ID || preparedBank?.modelId !== MODEL_ID ||
        preparedBank?.playbackPath !== playbackPath || playback?.bankId !== bankId ||
        playback?.modelId !== MODEL_ID) {
      throw new Error("Platonic Folding prepared model binding drifted");
    }
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 800,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: 0,
      }),
    });
    cleanPreparedDom(mounted);
    const player = createPlatonicPreparedPlayer({ mounted, playback });
    player.resize();
    addEventListener("resize", player.resize, { passive: true });
    state.ready = true;
    state.bankId = bankId;
    state.metadata = metadata;
    state.mounted = mounted;
    state.player = player;
    document.body.classList.replace("loading", "ready");
    player.resume();
  }

  function fail(error) {
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    console.error(error);
  }
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.sceneElement.className = "polycss-scene";
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
    element.style.removeProperty("background-repeat");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
}

function installDebugApi(state) {
  Object.defineProperty(window, "__cssPlatonicFoldingDebug", {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      pause() { return state.player?.pause(); },
      resume() { return state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      state() { return state.player?.stats() ?? null; },
      metadata() { return state.metadata; },
      stats() {
        if (!state.mounted || !state.player) return null;
        return Object.freeze({
          retainedFaceRootCount: state.mounted.shapeElements.size,
          retainedPolygonLeafCount: state.mounted.leafHandles.size,
          selectedPreparedBank: state.bankId,
          preparedBankLoadCount: 1,
          ...state.player.stats(),
        });
      },
    }),
  });
}

function assertResponse(response) {
  if (!response.ok) throw new Error(`Platonic Folding prepared asset failed: ${response.status} ${response.url}`);
  return response;
}
