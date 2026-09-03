// SPDX-License-Identifier: HPND

const FACES_PER_BOX = 3;
const STYLESHEET_MODEL_TRANSFORM =
  "matrix3d(29.6, 6.484, 8.604, 0, -10.774, 17.814, 23.64, 0, 0, 25.157, -18.957, 0, -2.7, -2.7, -30, 1)";

export function cleanCityflowPreparedDom(mounted, expectedBoxCount) {
  const cameraElement = mounted?.cameraElement;
  const sceneElement = mounted?.sceneElement;
  const modelElement = mounted?.modelElement;
  const shapeElements = [...(mounted?.shapeElements?.values?.() ?? [])];
  if (!(cameraElement instanceof HTMLElement) || !(sceneElement instanceof HTMLElement) ||
      !(modelElement instanceof HTMLElement) || !Number.isSafeInteger(expectedBoxCount) ||
      expectedBoxCount < 1 || shapeElements.length !== expectedBoxCount ||
      cameraElement.children.length !== 1 || cameraElement.firstElementChild !== sceneElement ||
      sceneElement.children.length !== 1 || sceneElement.firstElementChild !== modelElement ||
      shapeElements.some((element) => !(element instanceof HTMLElement) ||
        element.parentElement !== modelElement || element.children.length !== FACES_PER_BOX ||
        [...element.children].some((leaf) => leaf.localName !== "b"))) {
    throw new Error("Cityflow prepared Morph graph cannot be cleaned safely");
  }

  const leafElements = shapeElements.map((element) => [...element.children]);
  const modelTransform = modelElement.style.transform;
  if (modelTransform !== STYLESHEET_MODEL_TRANSFORM) {
    throw new Error("Cityflow stylesheet-owned model transform drifted");
  }

  cameraElement.className = "polycss-camera";
  cleanCameraMetadata();
  cameraElement.style.removeProperty("perspective");
  sceneElement.className = "polycss-scene";
  sceneElement.removeAttribute("aria-hidden");
  sceneElement.style.removeProperty("transform");
  removeEmptyRootStyleAttributes();

  for (const element of shapeElements) {
    element.removeAttribute("class");
    element.removeAttribute("data-poly-morph-shape");
  }
  for (const leaves of leafElements) {
    for (const leaf of leaves) {
      leaf.removeAttribute("class");
      leaf.removeAttribute("data-poly-morph-leaf");
      leaf.removeAttribute("data-poly-morph-strategy");
      leaf.removeAttribute("data-poly-morph-resolved-strategy");
      leaf.style.removeProperty("backface-visibility");
      leaf.style.removeProperty("background-repeat");
      leaf.style.removeProperty("color");
      leaf.style.removeProperty("height");
      leaf.style.removeProperty("opacity");
      leaf.style.removeProperty("transform-origin");
      leaf.style.removeProperty("visibility");
      leaf.style.removeProperty("width");
    }
  }

  for (const element of shapeElements) sceneElement.append(element);
  if (modelElement.childElementCount !== 0) {
    throw new Error("Cityflow prepared model wrapper contains unexpected retained nodes");
  }
  modelElement.remove();

  const stableNodes = Object.freeze([
    cameraElement,
    sceneElement,
    ...shapeElements,
    ...leafElements.flat(),
  ]);
  let runtimeDomCreationCount = 0;
  let runtimeDomRemovalCount = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      runtimeDomCreationCount += record.addedNodes.length;
      runtimeDomRemovalCount += record.removedNodes.length;
    }
  });
  observer.observe(cameraElement, { childList: true, subtree: true });

  function cleanCameraMetadata() {
    cameraElement.removeAttribute("data-polycss-camera-projection");
    cameraElement.removeAttribute("data-polycss-camera-perspective");
  }

  function removeEmptyRootStyleAttributes() {
    if (cameraElement.style.length !== 0 || sceneElement.style.length !== 0) {
      throw new Error("Cityflow prepared roots contain unexpected inline presentation");
    }
    cameraElement.removeAttribute("style");
    sceneElement.removeAttribute("style");
  }

  function assertStableDomIdentity() {
    const currentNodes = [
      cameraElement,
      sceneElement,
      ...sceneElement.children,
      ...shapeElements.flatMap((element) => [...element.children]),
    ];
    if (cameraElement.children.length !== 1 || cameraElement.firstElementChild !== sceneElement ||
        sceneElement.children.length !== shapeElements.length ||
        shapeElements.some((element, index) =>
          sceneElement.children[index] !== element || element.children.length !== FACES_PER_BOX) ||
        currentNodes.length !== stableNodes.length ||
        currentNodes.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Cityflow cleaned retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    cameraElement,
    sceneElement,
    shapeElements: Object.freeze(shapeElements),
    leafElements: Object.freeze(leafElements.map((leaves) => Object.freeze(leaves))),
    modelTransform,
    finalizePreparedTarget() {
      removeEmptyRootStyleAttributes();
      return assertStableDomIdentity();
    },
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      const renderNodes = stableNodes;
      return Object.freeze({
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedModelRootCount: 0,
        retainedBoxRootCount: shapeElements.length,
        retainedFaceLeafCount: leafElements.length * FACES_PER_BOX,
        retainedDomClassAttributeCount:
          renderNodes.filter((element) => element.hasAttribute("class")).length,
        retainedDomDataAttributeCount: renderNodes.reduce((count, element) => count +
          [...element.attributes].filter(({ name }) => name.startsWith("data-")).length, 0),
        retainedDomAriaAttributeCount: renderNodes.reduce((count, element) => count +
          [...element.attributes].filter(({ name }) => name.startsWith("aria-")).length, 0),
        retainedCameraInlineStyleAttributeCount: cameraElement.hasAttribute("style") ? 1 : 0,
        retainedSceneInlineStyleAttributeCount: sceneElement.hasAttribute("style") ? 1 : 0,
        retainedSceneInlineTransformCount: sceneElement.style.transform === "" ? 0 : 1,
        retainedBackfaceInlineStyleCount: leafElements.flat().filter((leaf) =>
          leaf.style.backfaceVisibility !== "" ||
          leaf.style.webkitBackfaceVisibility !== "").length,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      observer.disconnect();
    },
  });
}
