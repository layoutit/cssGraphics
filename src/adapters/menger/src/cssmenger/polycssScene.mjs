let mountedStyles = [];

export function mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, planeAtlasAsset }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssMenger snapshot is required");
  const snapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (snapshot.querySelector("script, canvas, svg")) {
    throw new Error("Prepared cssMenger snapshot contains a forbidden renderer/runtime element");
  }
  const styles = [...snapshot.querySelectorAll("style")];
  const camera = snapshot.querySelector(".polycss-camera");
  const scene = camera?.querySelector(".polycss-scene");
  const model = scene?.querySelector(":scope > .cssmenger-model");
  const axisRoots = ["x", "y", "z"].map((axis) => model?.querySelector(`:scope > .cssmenger-axis-${axis}`));
  if (styles.length === 0 || !(camera instanceof HTMLElement) || !(scene instanceof HTMLElement) ||
      !(model instanceof HTMLElement) || axisRoots.some((root) => !(root instanceof HTMLElement))) {
    throw new Error("Prepared cssMenger snapshot is missing its retained PolyCSS graph");
  }
  removePreparedSnapshotStyles();
  for (const style of styles) {
    const imported = document.importNode(style, true);
    imported.setAttribute("data-cssmenger-snapshot-style", "1");
    document.head.append(imported);
    mountedStyles.push(imported);
  }
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(".polycss-scene");
  const mountedModel = mountedScene?.querySelector(":scope > .cssmenger-model");
  const mountedAxes = ["x", "y", "z"].map((axis) =>
    mountedModel?.querySelector(`:scope > .cssmenger-axis-${axis}`));
  const leaves = [...(mountedModel?.querySelectorAll("b, i, s, u") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || !(mountedModel instanceof HTMLElement) ||
      mountedAxes.some((root) => !(root instanceof HTMLElement)) ||
      leaves.length !== sceneData.metrics.preparedLeafCount) {
    throw new Error("Prepared cssMenger retained target census drifted");
  }
  if (planeAtlasAsset?.sha256 !== sceneData.planeAtlas?.assetSha256 || typeof planeAtlasAsset.url !== "string") {
    throw new Error("Prepared cssMenger plane atlas asset is missing or unverified");
  }
  mountedModel.style.setProperty("--a", `url("${planeAtlasAsset.url}")`);
  if (!getComputedStyle(leaves[0]).backgroundImage.includes(planeAtlasAsset.url)) {
    throw new Error("Prepared cssMenger plane atlas binding drifted");
  }
  const stableNodes = Object.freeze([mountedScene, mountedModel, ...mountedAxes, ...leaves]);
  let runtimeDomCreationCount = 0;
  let runtimeDomRemovalCount = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      runtimeDomCreationCount += record.addedNodes.length;
      runtimeDomRemovalCount += record.removedNodes.length;
    }
  });
  observer.observe(host, { childList: true, subtree: true });

  function assertStableDomIdentity() {
    const current = [
      host.querySelector(".polycss-scene"),
      host.querySelector(".cssmenger-model"),
      ...["x", "y", "z"].map((axis) => host.querySelector(`.cssmenger-axis-${axis}`)),
      ...host.querySelectorAll(".cssmenger-model b, .cssmenger-model i, .cssmenger-model s, .cssmenger-model u"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Prepared cssMenger retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    modelRoot: mountedModel,
    axisRoots: Object.freeze(mountedAxes),
    leaves: Object.freeze(leaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedModelRootCount: 1,
        retainedAxisRootCount: mountedAxes.length,
        retainedPolygonLeafCount: leaves.length,
        preparedPlaneAtlasTextureLeafCount: leaves.length,
        preparedPlaneAtlasUniqueUrlCount: 1,
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
      host.replaceChildren();
      removePreparedSnapshotStyles();
    },
  });
}

function removePreparedSnapshotStyles() {
  for (const style of mountedStyles) style.remove();
  mountedStyles = [];
}
