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
import { createGravityWellPreparedPlayer } from "./preparedPlayback.mjs";

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
      const transformBlocks = createTransformBlockLoader(scene.playback);
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
      onBankChange(bankIndex, nextScene) {
        state.scene = nextScene;
        document.body.dataset.activeBank = String(bankIndex);
        document.body.dataset.activeSeed = String(nextScene.seed);
      },
      onError(error) {
        recordError(error instanceof Error ? error.stack || error.message : String(error));
      },
    });
    state.catalog = catalog;
    state.selection = selection;
    state.scene = scene;
    state.mounted = mounted;
    state.player = player;
    state.ready = true;
    setStatus("ready");
    document.body.dataset.productView = "1";
    document.body.dataset.gameView = "polycss";
    document.body.dataset.portSlug = "cssgravitywell";
    document.body.dataset.activeBank = String(selection.bankIndex);
    document.body.dataset.activeSeed = String(scene.seed);
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
  document.body.dataset.portStatus = kind;
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.modelElement.removeAttribute("data-poly-morph-model");
  for (const element of mounted.shapeElements.values()) element.removeAttribute("data-poly-morph-shape");
  for (const { element } of mounted.leafHandles.values()) {
    element.removeAttribute("data-poly-morph-leaf");
    element.removeAttribute("data-poly-morph-strategy");
    element.removeAttribute("data-poly-morph-resolved-strategy");
  }
}
