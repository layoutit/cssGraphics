// SPDX-License-Identifier: GPL-2.0-or-later
import { createPolyPerspectiveCamera } from "@layoutit/polycss";
import { mountPolyMorphModel } from "@layoutit/polycss-morph";
import { attachFlocksSceneMetadata } from "./devtoolsAttrs.mjs";

export function mountFlocksPolycssScene(host, loaded, { sceneId, profileId }) {
  const mounted = mountPolyMorphModel(host, loaded.model, {
    resources: loaded.resources,
    camera: createPolyPerspectiveCamera({ perspective: 800, target: [0, 0, 0], rotX: 0, rotY: 0, zoom: 50 }),
  });
  cleanPreparedDom(mounted);
  attachFlocksSceneMetadata(mounted.sceneElement, { sceneId, profileId });
  return mounted;
}

function cleanPreparedDom(mounted) {
  mounted.cameraElement.className = "polycss-camera";
  mounted.cameraElement.removeAttribute("data-polycss-camera-projection");
  mounted.cameraElement.removeAttribute("data-polycss-camera-perspective");
  mounted.cameraElement.style.removeProperty("perspective");
  mounted.sceneElement.className = "polycss-scene";
  mounted.sceneElement.removeAttribute("aria-hidden");
  mounted.sceneElement.style.removeProperty("transform");
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
    element.style.removeProperty("background-color");
    element.style.removeProperty("color");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
  if (mounted.modelElement.parentElement !== mounted.sceneElement ||
      [...mounted.shapeElements.values()].some((element) => element.parentElement !== mounted.modelElement)) {
    throw new Error("Flocks prepared wrapper binding drifted");
  }
  for (const element of mounted.shapeElements.values()) mounted.sceneElement.append(element);
  if (mounted.modelElement.childElementCount !== 0) {
    throw new Error("Flocks prepared model wrapper contains unexpected nodes");
  }
  mounted.modelElement.remove();
  assertFlocksDirectRoots(mounted);
}

export function assertFlocksDirectRoots(mounted) {
  if (mounted.modelElement.isConnected ||
      [...mounted.shapeElements.values()].some((element) => element.parentElement !== mounted.sceneElement) ||
      [...mounted.leafHandles.values()].some(({ element }) =>
        ![...mounted.shapeElements.values()].includes(element.parentElement))) {
    throw new Error("Flocks direct retained-root identity drifted");
  }
}
