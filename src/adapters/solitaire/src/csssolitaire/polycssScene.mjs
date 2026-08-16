let mountedStyle = null;

export function mountPreparedSolitaireSnapshot({ host, manifest, snapshotHtml }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssSolitaire host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssSolitaire snapshot is required");
  const snapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (snapshot.querySelector("script,canvas,svg") ||
      snapshot.querySelectorAll("style").length !== 1 || hasPreparedMetadata(snapshot)) {
    throw new Error("Prepared cssSolitaire snapshot contains a forbidden or incomplete graph");
  }
  const style = snapshot.querySelector("style");
  const camera = snapshot.querySelector(".polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const leaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  if (!(style instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || scene.childElementCount !== manifest.metrics.retainedLeafCount ||
      leaves.length !== manifest.metrics.retainedLeafCount ||
      snapshot.querySelectorAll("[style]").length !== leaves.length ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement) || leaf.localName !== "b" ||
        !hasInlineTransformOnly(leaf))) {
    throw new Error("Prepared cssSolitaire retained DOM census drifted");
  }

  mountedStyle?.remove();
  mountedStyle = document.importNode(style, true);
  document.head.append(mountedStyle);
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) ||
      mountedScene.childElementCount !== manifest.metrics.retainedLeafCount ||
      mountedLeaves.length !== manifest.metrics.retainedLeafCount ||
      mountedLeaves.some((leaf) => !hasInlineTransformOnly(leaf))) {
    throw new Error("Mounted cssSolitaire retained DOM census drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedLeaves]);

  function assertStableDomIdentity() {
    const current = [
      host.querySelector(":scope > .polycss-camera"),
      host.querySelector(":scope > .polycss-camera > .polycss-scene"),
      ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > b"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index]) ||
        mountedLeaves.some((leaf) => !hasInlineTransformOnly(leaf))) {
      throw new Error("Prepared cssSolitaire retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    leaves: Object.freeze(mountedLeaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedBoardRootCount: 0,
        retainedRenderWrapperCount: 2,
        retainedPolygonLeafCount: mountedLeaves.length,
        retainedLeafInlineStyleDeclarationCount: mountedLeaves.length,
        retainedDataAttributeCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomMutationCount: 0,
        runtimeDomMutationObserverInstalled: false,
        runtimeDomGrowth: false,
        runtimeGeometryBoundsCalculationCount: 0,
      });
    },
    destroy() {
      host.replaceChildren();
      mountedStyle?.remove();
      mountedStyle = null;
    },
  });
}

function hasInlineTransformOnly(leaf) {
  return leaf.style.length === 1 && leaf.style[0] === "transform" && leaf.style.transform.length > 0;
}

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}
