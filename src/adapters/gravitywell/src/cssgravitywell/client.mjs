import {
  loadPolyMorphPackage,
  mountPolyMorphModel,
} from "@layoutit/polycss-morph";
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { installGravityWellDebugApi } from "./debugApi.mjs";
import {
  createTransformBlockLoader,
  loadPreparedGravityWellBankScene,
  loadPreparedGravityWellCatalog,
  selectInitialGravityWellBank,
} from "./preparedAssets.mjs";
import {
  createGravityWellPreparedPlayer,
  defaultGravityWellCarrierCoverageScale,
} from "./preparedPlayback.mjs";

export function mountGravityWellClient(host) {
  const state = {
    ready: false,
    errors: [],
    catalog: null,
    selection: null,
    scene: null,
    mounted: null,
    player: null,
  };
  installGravityWellDebugApi(state);
  window.addEventListener("error", (event) => recordError(event.message || String(event.error || "error")));
  window.addEventListener("unhandledrejection", (event) => recordError(String(event.reason?.stack || event.reason || "unhandled rejection")));
  window.addEventListener("resize", () => {
    state.player?.setViewportSize(window.innerWidth, window.innerHeight);
  }, { passive: true });
  main().catch((error) => recordError(error.stack || error.message || String(error)));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing Gravity Well host");
    setStatus("loading");
    const carrierCoverageScale = defaultGravityWellCarrierCoverageScale();
    const [loaded, catalog] = await Promise.all([
      loadPolyMorphPackage("/cssgravitywell/model/"),
      loadPreparedGravityWellCatalog(),
    ]);
    const selection = selectInitialGravityWellBank(catalog);
    const loadBank = async (bankIndex, {
      lookahead = false,
      incremental = lookahead,
      complete = false,
    } = {}) => {
      const scene = await loadPreparedGravityWellBankScene(catalog, bankIndex);
      const transformBlocks = createTransformBlockLoader(scene.playback, { carrierCoverageScale });
      await transformBlocks.prime(0, { lookahead, incremental, complete });
      const { changeSchedule } = transformBlocks.bankData();
      return Object.freeze({ scene, playback: scene.playback, transformBlocks, changeSchedule });
    };
    const initialBank = await loadBank(selection.bankIndex, {
      lookahead: true,
      incremental: false,
      complete: true,
    });
    const scene = initialBank.scene;
    if (loaded.model.identity.id !== "gravitywell" ||
        loaded.model.render.leaves.length !== scene.metrics.preparedLeafCount) {
      throw new Error("Gravity Well model and prepared scene do not bind");
    }
    const mounted = mountPolyMorphModel(host, loaded.model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 824.2432258363864,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
        distance: -824.2432258363864,
      }),
    });
    cleanPreparedDom(mounted);
    const player = await createGravityWellPreparedPlayer({
      mounted,
      bank: initialBank,
      bankCount: catalog.bankCount,
      initialBankIndex: selection.bankIndex,
      loadBank,
      cycleBanks: new URLSearchParams(location.search).get("cycle") !== "0",
      onBankChange(_bankIndex, nextScene) {
        state.scene = nextScene;
      },
      onError(error) {
        recordError(error instanceof Error ? error.stack || error.message : String(error));
      },
    });
    removeEmptyWrapperStyles(mounted);
    state.catalog = catalog;
    state.selection = selection;
    state.scene = scene;
    state.mounted = mounted;
    state.player = player;
    state.ready = true;
    setStatus("ready");
    requestAnimationFrame(() => player.resume());
  }

  function recordError(message) {
    state.errors.push(message);
    setStatus("error");
    if (document.querySelector(".cssgravitywell-error-message")) return;
    const output = document.createElement("p");
    output.className = "cssgravitywell-error-message";
    output.setAttribute("role", "alert");
    output.textContent = message;
    host.append(output);
  }
}

function setStatus(kind) {
  document.body.classList.remove("loading", "ready", "error");
  document.body.classList.add(kind);
}

function cleanPreparedDom(mounted) {
  if (!isIdentityMatrix(mounted.model.render.modelMatrix) ||
      mounted.model.render.shapes.some((shape) => !isIdentityMatrix(shape.matrix))) {
    throw new Error("Gravity Well clean DOM requires identity model and shape roots");
  }
  for (const { plan } of mounted.leafHandles.values()) {
    if (plan.strategy !== "solid-quad" || plan.width !== 1 || plan.height !== 1) {
      throw new Error("Gravity Well clean DOM requires prepared 1px solid quads");
    }
  }
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.cameraElement.removeAttribute("style");
  mounted.sceneElement.className = "polycss-scene";
  mounted.sceneElement.removeAttribute("style");
  mounted.modelElement.removeAttribute("class");
  mounted.modelElement.removeAttribute("data-poly-morph-model");
  mounted.modelElement.removeAttribute("style");
  for (const element of mounted.shapeElements.values()) {
    element.className = "polycss-mesh";
    element.removeAttribute("data-poly-morph-shape");
    element.removeAttribute("style");
  }
  for (const { element } of mounted.leafHandles.values()) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-leaf");
    element.removeAttribute("data-poly-morph-strategy");
    element.removeAttribute("data-poly-morph-resolved-strategy");
    element.style.removeProperty("backface-visibility");
    element.style.removeProperty("background-repeat");
    element.style.removeProperty("height");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
    element.style.removeProperty("width");
  }
}

function isIdentityMatrix(matrix) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return Array.isArray(matrix) && matrix.length === identity.length &&
    matrix.every((value, index) => value === identity[index]);
}

function removeEmptyWrapperStyles(mounted) {
  for (const element of [
    mounted.cameraElement,
    mounted.sceneElement,
    mounted.modelElement,
    ...mounted.shapeElements.values(),
  ]) {
    if (element.getAttribute("style") === "") element.removeAttribute("style");
  }
}
