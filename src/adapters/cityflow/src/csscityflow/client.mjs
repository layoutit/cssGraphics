import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { loadPolyMorphPackage, mountPolyMorphModel } from "@layoutit/polycss-morph";
import {
  createCityflowPreparedPlayer,
  loadCityflowPreparedPlayback,
} from "./preparedPlayback.mjs";

export function mountCityflow(host) {
  const state = { ready: false, errors: [], bankId: null, mounted: null, player: null };
  globalThis.__csscityflow = state;
  main().catch((error) => fail(error));

  async function main() {
    const bankId = "desktop";
    const modelId = "cityflow";
    const [loaded, playback] = await Promise.all([
      loadPolyMorphPackage("/csscityflow/", { modelId }),
      loadCityflowPreparedPlayback(`/csscityflow/${modelId}.playback.json`),
      loadPreparedStylesheet(`/csscityflow/${modelId}.css`),
    ]);
    const perspective = innerHeight / (2 * Math.tan(Math.PI / 12));
    const mounted = mountPolyMorphModel(host, loaded.model, {
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
    const shapeElements = [];
    for (const [index, box] of loaded.model.render.shapes.entries()) {
      const element = mounted.shapeElements.get(box.id);
      if (!element) throw new Error(`Missing retained Cityflow box ${box.id}`);
      const source = readBoxState(loaded.model, index);
      element.classList.add("csscityflow-box");
      shapeElements.push(element);
      for (const [faceIndex, leaf] of [...element.children].entries()) {
        leaf.style.setProperty("--csscityflow-light", source.lightFactors[faceIndex]);
      }
    }
    const player = createCityflowPreparedPlayer({ playback, mounted, shapeElements });
    state.ready = true;
    state.bankId = bankId;
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
  return state;
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

function readBoxState(model, index) {
  const shape = model.render.shapes[index];
  const matrix = shape?.matrix;
  if (!shape || !Array.isArray(matrix) || matrix.length !== 16) {
    throw new Error("Prepared Cityflow box transform is missing");
  }
  const width = Math.hypot(matrix[0], matrix[1]);
  const cth = matrix[0] / width;
  const sth = -matrix[1] / width;
  const lightLength = Math.hypot(0, 0.25, -1);
  return Object.freeze({
    lightFactors: Object.freeze([
      0.4 + 1 / lightLength,
      0.4 + Math.max(0, cth * 0.25 / lightLength),
      0.4 + Math.max(0, -sth * 0.25 / lightLength),
    ]),
  });
}
