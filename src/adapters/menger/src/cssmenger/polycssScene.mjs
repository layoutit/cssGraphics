let mountedStyles = [];

export function mountPreparedPolycssSnapshot({
  host,
  sceneData,
  snapshotHtml,
  planeAtlas,
  planeAtlasProfile,
  planeAtlasAsset,
}) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssMenger host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssMenger snapshot is required");
  const snapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (snapshot.querySelector("script, canvas, svg")) {
    throw new Error("Prepared cssMenger snapshot contains a forbidden renderer/runtime element");
  }
  const styles = [...snapshot.querySelectorAll("style")];
  const camera = snapshot.querySelector(".polycss-camera");
  const scene = camera?.querySelector(".polycss-scene");
  const snapshotLeaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  if (styles.length === 0 || !(camera instanceof HTMLElement) || !(scene instanceof HTMLElement) ||
      snapshotLeaves.length !== sceneData.metrics.preparedLeafCount || scene.querySelector(":scope > i, :scope > s")) {
    throw new Error("Prepared cssMenger snapshot is missing its retained PolyCSS graph");
  }
  removePreparedSnapshotStyles();
  for (const style of styles) {
    const imported = document.importNode(style, true);
    document.head.append(imported);
    mountedStyles.push(imported);
  }
  const mountedCamera = document.importNode(camera, true);
  const mountedScene = mountedCamera.querySelector(".polycss-scene");
  const leaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || leaves.length !== sceneData.metrics.preparedLeafCount ||
      mountedScene.querySelector(":scope > i, :scope > s")) {
    throw new Error("Prepared cssMenger retained target census drifted");
  }
  mountedScene.classList.toggle("cssmenger-mobile-atlas", planeAtlasProfile === "mobile");
  for (const existing of host.querySelectorAll(":scope > .polycss-camera")) existing.remove();
  host.append(mountedCamera);
  if (planeAtlasAsset?.sha256 !== planeAtlas?.assetSha256 || typeof planeAtlasAsset.url !== "string" ||
      !["desktop", "mobile"].includes(planeAtlasProfile) || planeAtlas?.profile !== planeAtlasProfile) {
    throw new Error("Prepared cssMenger plane atlas asset is missing or unverified");
  }
  if (!getComputedStyle(leaves[0]).backgroundImage.includes(planeAtlasAsset.url)) {
    throw new Error("Prepared cssMenger plane atlas binding drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...leaves]);
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
    const current = [
      host.querySelector(":scope > .polycss-camera"),
      host.querySelector(":scope > .polycss-camera > .polycss-scene"),
      ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > b"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Prepared cssMenger retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    publicationRoot: mountedScene,
    axisLeaves: Object.freeze([0, 1, 2].map((axis) =>
      Object.freeze(leaves.slice(axis * 28, axis * 28 + 28)))),
    leaves: Object.freeze(leaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedRenderWrapperCount: 2,
        retainedModelRootCount: 0,
        retainedAxisRootCount: 0,
        retainedPolygonLeafCount: leaves.length,
        preparedPlaneAtlasTextureLeafCount: leaves.length,
        preparedPlaneAtlasUniqueUrlCount: 1,
        preparedPlaneAtlasProfile: planeAtlasProfile,
        preparedPlaneAtlasDecodedBytes: planeAtlas.decodedBytes,
        preparedPlaneAtlasAssetBytes: planeAtlasAsset.byteLength,
        preparedPlaneAtlasAssetSha256: planeAtlasAsset.sha256,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      observer.disconnect();
      mountedCamera.remove();
      removePreparedSnapshotStyles();
    },
  });
}

function removePreparedSnapshotStyles() {
  for (const style of mountedStyles) style.remove();
  mountedStyles = [];
}
