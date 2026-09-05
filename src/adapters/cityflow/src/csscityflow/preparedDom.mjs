// SPDX-License-Identifier: HPND

const FACES_PER_BOX = 3;
const STYLESHEET_MODEL_TRANSFORM =
  "matrix3d(29.6, 6.484, 8.604, 0, -10.774, 17.814, 23.64, 0, 0, 25.157, -18.957, 0, -2.7, -2.7, -30, 1)";

export function cleanCityflowMountedDom({ mounted, shapeElements }) {
  const cameraElement = mounted?.cameraElement;
  const sceneElement = mounted?.sceneElement;
  const modelElement = mounted?.modelElement;
  if (!(cameraElement instanceof HTMLElement) || !(sceneElement instanceof HTMLElement) ||
      !(modelElement instanceof HTMLElement) || !Array.isArray(shapeElements) ||
      shapeElements.length < 1 || cameraElement.firstElementChild !== sceneElement ||
      sceneElement.firstElementChild !== modelElement ||
      shapeElements.some((shape) => !(shape instanceof HTMLElement) ||
        shape.parentElement !== modelElement || shape.children.length !== FACES_PER_BOX ||
        [...shape.children].some((leaf) => leaf.localName !== "b" || leaf.children.length !== 0))) {
    throw new Error("Cityflow mounted Morph graph cannot be cleaned safely");
  }

  const modelTransform = modelElement.style.transform;
  if (modelTransform !== STYLESHEET_MODEL_TRANSFORM) {
    throw new Error("Cityflow stylesheet-owned model transform drifted");
  }
  const leafElements = shapeElements.map((shape) => [...shape.children]);

  cameraElement.className = "polycss-camera";
  sceneElement.className = "polycss-scene";
  cameraElement.removeAttribute("aria-hidden");
  sceneElement.removeAttribute("aria-hidden");
  stripDataAttributes(cameraElement);
  stripDataAttributes(sceneElement);
  cameraElement.style.removeProperty("perspective");
  sceneElement.style.removeProperty("transform");
  removeEmptyStyle(cameraElement);
  removeEmptyStyle(sceneElement);

  for (const shape of shapeElements) {
    shape.removeAttribute("class");
    stripDataAttributes(shape);
    for (const leaf of shape.children) {
      leaf.removeAttribute("class");
      stripDataAttributes(leaf);
      for (const property of [
        "backface-visibility",
        "-webkit-backface-visibility",
        "background-repeat",
        "color",
        "height",
        "opacity",
        "transform-origin",
        "visibility",
        "width",
      ]) leaf.style.removeProperty(property);
      removeEmptyStyle(leaf);
    }
  }

  for (const shape of shapeElements) sceneElement.append(shape);
  if (modelElement.childElementCount !== 0) {
    throw new Error("Cityflow model wrapper contains unexpected retained nodes");
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

  function assertStableDomIdentity() {
    const currentNodes = [
      cameraElement,
      sceneElement,
      ...sceneElement.children,
      ...shapeElements.flatMap((shape) => [...shape.children]),
    ];
    if (cameraElement.children.length !== 1 || cameraElement.firstElementChild !== sceneElement ||
        sceneElement.children.length !== shapeElements.length ||
        shapeElements.some((shape, index) =>
          sceneElement.children[index] !== shape || shape.children.length !== FACES_PER_BOX) ||
        currentNodes.length !== stableNodes.length ||
        currentNodes.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Cityflow cleaned retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    cameraElement,
    sceneElement,
    shapeElements: Object.freeze([...shapeElements]),
    leafElements: Object.freeze(leafElements.map((leaves) => Object.freeze(leaves))),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedModelRootCount: 0,
        retainedBoxRootCount: shapeElements.length,
        retainedFaceLeafCount: leafElements.length * FACES_PER_BOX,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      observer.disconnect();
    },
  });
}

export function mountCityflowPreparedSnapshot({ host, snapshotHtml, expectedBoxCount }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string" ||
      !Number.isSafeInteger(expectedBoxCount) || expectedBoxCount < 1) {
    throw new Error("Cityflow requires a prepared retained-DOM snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const camera = parsed.body.querySelector(":scope > .polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const shapeElements = [...(scene?.children ?? [])];
  if (parsed.querySelector("script,style,canvas,svg") || !(camera instanceof HTMLElement) ||
      camera.localName !== "main" || !(scene instanceof HTMLElement) ||
      camera.children.length !== 1 || camera.firstElementChild !== scene ||
      shapeElements.length !== expectedBoxCount ||
      shapeElements.some((shape) => shape.localName !== "div" ||
        shape.children.length !== FACES_PER_BOX ||
        [...shape.children].some((leaf) => leaf.localName !== "b" || leaf.children.length !== 0) ||
        hasDiagnosticAttributes(shape) || [...shape.children].some(hasDiagnosticAttributes))) {
    throw new Error("Cityflow prepared retained-DOM snapshot is incomplete");
  }

  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedShapes = [...(mountedScene?.children ?? [])];
  const leafElements = mountedShapes.map((shape) => [...shape.children]);
  if (!(mountedScene instanceof HTMLElement) || mountedCamera.children.length !== 1 ||
      mountedShapes.length !== expectedBoxCount ||
      leafElements.some((leaves) => leaves.length !== FACES_PER_BOX)) {
    throw new Error("Mounted Cityflow retained-DOM snapshot drifted");
  }

  const stableNodes = Object.freeze([
    mountedCamera,
    mountedScene,
    ...mountedShapes,
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
  observer.observe(mountedCamera, { childList: true, subtree: true });

  function assertStableDomIdentity() {
    const currentNodes = [
      host.querySelector(":scope > .polycss-camera"),
      host.querySelector(":scope > .polycss-camera > .polycss-scene"),
      ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > div"),
      ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > div > b"),
    ];
    if (currentNodes.length !== stableNodes.length ||
        currentNodes.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Cityflow prepared retained-DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    cameraElement: mountedCamera,
    sceneElement: mountedScene,
    shapeElements: Object.freeze(mountedShapes),
    leafElements: Object.freeze(leafElements.map((leaves) => Object.freeze(leaves))),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        retainedDomMode: "prepared-flat-polycss-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedModelRootCount: 0,
        retainedBoxRootCount: mountedShapes.length,
        retainedFaceLeafCount: leafElements.length * FACES_PER_BOX,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      observer.disconnect();
      mountedCamera.remove();
    },
  });
}

function hasDiagnosticAttributes(element) {
  return element.id || element.className ||
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-"));
}

function stripDataAttributes(element) {
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
  }
}

function removeEmptyStyle(element) {
  if (element.style.length === 0) element.removeAttribute("style");
}
