// SPDX-License-Identifier: HPND

const FACES_PER_BOX = 3;

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
