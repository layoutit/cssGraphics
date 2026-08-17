let mountedStyle = null;

export function mountPreparedSolitaireSnapshot({ host, retainedLeafCount, snapshotHtml }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssSolitaire host");
  if (!Number.isSafeInteger(retainedLeafCount) || retainedLeafCount <= 4) {
    throw new Error("Prepared cssSolitaire retained leaf count is required");
  }
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
      !(scene instanceof HTMLElement) || scene.childElementCount !== retainedLeafCount ||
      leaves.length !== retainedLeafCount ||
      snapshot.querySelectorAll("[style]").length !== leaves.length ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement) || leaf.localName !== "b" ||
        !hasInlinePreparedStyle(leaf))) {
    throw new Error("Prepared cssSolitaire retained DOM census drifted");
  }

  mountedStyle?.remove();
  mountedStyle = document.importNode(style, true);
  document.head.append(mountedStyle);
  const mountedCamera = document.importNode(camera, true);
  for (const existing of host.querySelectorAll(":scope > .polycss-camera")) existing.remove();
  host.append(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) ||
      mountedScene.childElementCount !== retainedLeafCount ||
      mountedLeaves.length !== retainedLeafCount ||
      mountedLeaves.some((leaf) => !hasInlinePreparedStyle(leaf))) {
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
        mountedLeaves.some((leaf) => !hasInlinePreparedStyle(leaf))) {
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
        retainedLeafInlineStyleDeclarationCount: mountedLeaves.reduce(
          (count, leaf) => count + leaf.style.length,
          0,
        ),
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
      mountedCamera.remove();
      mountedStyle?.remove();
      mountedStyle = null;
    },
  });
}

function hasInlinePreparedStyle(leaf) {
  const properties = [...leaf.style];
  return leaf.className === "" && properties.length >= 3 && properties.length <= 4 &&
    properties.includes("transform") && properties.includes("background-position-x") &&
    properties.includes("background-position-y") &&
    properties.every((property) =>
      property === "transform" || property === "background-position-x" ||
      property === "background-position-y" || property === "visibility") &&
    leaf.style.transform.startsWith("matrix(") &&
    /^-?\d+px -?\d+px$/u.test(leaf.style.backgroundPosition) &&
    (leaf.style.visibility === "" || leaf.style.visibility === "visible");
}

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}
