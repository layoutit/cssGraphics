// SPDX-License-Identifier: GPL-2.0-or-later
import {
  createPolyPerspectiveCamera,
  formatMatrix3dValues,
  injectPolyBaseStyles,
} from "@layoutit/polycss";
import { mountPolyMorphModel } from "@layoutit/polycss-morph";

export function prepareCycloneDom(host, loaded) {
  const doc = host.ownerDocument;
  const model = loaded.model;
  let mounted;
  let modelTransform;

  if (supportsPreparedTriangles(doc, model)) {
    injectPolyBaseStyles(doc);
    ({ mounted, modelTransform } = mountPreparedTriangles(doc, model));
  } else {
    const stagingHost = doc.createElement("div");
    mounted = mountPolyMorphModel(stagingHost, model, {
      resources: loaded.resources,
      camera: createPolyPerspectiveCamera({
        perspective: 800,
        target: [0, 0, 0],
        rotX: 0,
        rotY: 0,
        zoom: 50,
      }),
    });
    modelTransform = cleanPreparedDom(mounted);
  }

  return {
    mounted,
    modelTransform,
    attach() {
      host.append(mounted.cameraElement);
    },
  };
}

function supportsPreparedTriangles(doc, model) {
  const css = doc.defaultView?.CSS ?? globalThis.CSS;
  return !!css?.supports?.("corner-top-left-shape", "bevel") &&
    !!css.supports("corner-top-right-shape", "bevel") &&
    model.render.leaves.every((leaf) => leaf.strategy === "solid-triangle");
}

function mountPreparedTriangles(doc, model) {
  const cameraElement = doc.createElement("div");
  cameraElement.className = "polycss-camera";
  const sceneElement = doc.createElement("div");
  sceneElement.className = "polycss-scene";
  cameraElement.append(sceneElement);

  sceneElement.style.transform = matrixText(model.render.modelMatrix);
  const modelTransform = sceneElement.style.transform;
  sceneElement.style.removeProperty("transform");

  const shapeElements = new Map();
  for (const shape of model.render.shapes) {
    const element = doc.createElement("div");
    sceneElement.append(element);
    shapeElements.set(shape.id, element);
  }

  const leafHandles = new Map();
  for (const leaf of model.render.leaves) {
    const element = doc.createElement("u");
    element.style.transform = matrixText(leaf.matrix);
    shapeElements.get(leaf.shapeId).append(element);
    leafHandles.set(leaf.id, { id: leaf.id, plan: leaf, element });
  }

  let destroyed = false;
  const mounted = {
    model,
    cameraElement,
    sceneElement,
    shapeElements,
    leafHandles,
    get destroyed() { return destroyed; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cameraElement.remove();
      shapeElements.clear();
      leafHandles.clear();
    },
  };
  return { mounted, modelTransform };
}

function matrixText(matrix) {
  return `matrix3d(${formatMatrix3dValues(matrix)})`;
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
    element.style.removeProperty("color");
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform-origin");
    element.style.removeProperty("visibility");
  }
  if (mounted.modelElement.parentElement !== mounted.sceneElement ||
      [...mounted.shapeElements.values()].some((element) =>
        element.parentElement !== mounted.modelElement)) {
    throw new Error("Cyclone prepared model wrapper binding drifted");
  }
  const modelTransform = mounted.modelElement.style.transform;
  for (const element of mounted.shapeElements.values()) mounted.sceneElement.append(element);
  if (mounted.modelElement.childElementCount !== 0) {
    throw new Error("Cyclone prepared model wrapper contains unexpected retained nodes");
  }
  mounted.modelElement.remove();
  return modelTransform;
}
