let mountedStyles = [];

export function mountPreparedPolycssSnapshot({
  host,
  sceneData,
  snapshotHtml,
  planeAtlas,
  planeAtlasProfile,
  renderAtlases,
  renderAtlasAssets,
  lightingPresentation,
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
      snapshotLeaves.length !== sceneData.metrics.preparedLeafCount ||
      scene.children.length !== snapshotLeaves.length || scene.querySelector(":scope > i, :scope > s, :scope > div")) {
    throw new Error("Prepared cssMenger snapshot is missing its retained PolyCSS graph");
  }
  if (!Array.isArray(renderAtlases) || !Array.isArray(renderAtlasAssets) ||
      renderAtlases.length !== renderAtlasAssets.length || renderAtlases.length < 1 ||
      renderAtlases.some((atlas, index) => renderAtlasAssets[index]?.sha256 !== atlas?.assetSha256 ||
        renderAtlasAssets[index].url !== atlas.assetUrl ||
        renderAtlasAssets[index].cssImageBinding !== "prepared-direct-stylesheet-url") ||
      !["atlas", "css-opacity"].includes(lightingPresentation) ||
      !["desktop", "mobile"].includes(planeAtlasProfile) || planeAtlas?.profile !== planeAtlasProfile ||
      (lightingPresentation === "atlas" &&
        (renderAtlases.length !== 1 || renderAtlases[0] !== planeAtlas) ||
      lightingPresentation === "css-opacity" &&
        (renderAtlases.length !== 2 || renderAtlases[0]?.paletteRole !== "css-opacity-base" ||
          renderAtlases[1]?.presentation !== "css-black-alpha"))) {
    throw new Error("Prepared cssMenger plane atlas asset is missing or unverified");
  }
  const preparedCssText = styles.map((style) => style.textContent).join("\n");
  for (const atlas of renderAtlases) {
    if (!preparedCssText.includes(atlas.assetUrl)) {
      throw new Error(`Prepared cssMenger plane atlas URL is missing from its stylesheet (${atlas.assetUrl})`);
    }
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
      mountedScene.children.length !== leaves.length || mountedScene.querySelector(":scope > i, :scope > s, :scope > div")) {
    throw new Error("Prepared cssMenger retained target census drifted");
  }
  mountedScene.classList.toggle("cssmenger-mobile-atlas",
    lightingPresentation === "atlas" && planeAtlasProfile === "mobile");
  mountedScene.classList.toggle("cssmenger-css-opacity", lightingPresentation === "css-opacity");
  for (const existing of host.querySelectorAll(":scope > .polycss-camera")) existing.remove();
  host.append(mountedCamera);
  const computedLeaf = getComputedStyle(leaves[0]);
  if ((lightingPresentation === "atlas" &&
        !computedLeaf.backgroundImage.includes(renderAtlasAssets[0].url)) ||
      (lightingPresentation === "css-opacity" &&
        (!computedLeaf.backgroundImage.includes(renderAtlasAssets[0].url) ||
          !computedLeaf.backgroundImage.includes(renderAtlasAssets[1].url) ||
          computedLeaf.maskImage !== "none"))) {
    throw new Error("Prepared cssMenger plane atlas binding drifted");
  }
  const rotationAnimations = mountedScene.getAnimations()
    .filter((animation) => animation.animationName === "cssmenger-prepared-rotation");
  if (rotationAnimations.length !== 1) {
    throw new Error("Prepared cssMenger compositor rotation animation is missing");
  }
  const rotationAnimation = rotationAnimations[0];
  rotationAnimation.pause();
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...leaves]);
  const axisLeafCounts = sceneData.meshDescriptors?.map((mesh) => mesh.polygonCount);
  if (!Array.isArray(axisLeafCounts) || axisLeafCounts.length !== 3 ||
      axisLeafCounts.some((count) => !Number.isSafeInteger(count) || count < 1) ||
      axisLeafCounts.reduce((sum, count) => sum + count, 0) !== leaves.length) {
    throw new Error("Prepared cssMenger axis leaf census drifted");
  }
  let axisLeafOffset = 0;
  const axisLeaves = Object.freeze(axisLeafCounts.map((count) => {
    const selected = Object.freeze(leaves.slice(axisLeafOffset, axisLeafOffset + count));
    axisLeafOffset += count;
    return selected;
  }));
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
    rotationAnimation,
    axisLeaves,
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
        retainedRotationRootCount: 0,
        retainedLightingRootCount: 0,
        retainedAxisRootCount: 0,
        retainedPolygonLeafCount: leaves.length,
        preparedPlaneAtlasTextureLeafCount: leaves.length,
        preparedPlaneAtlasUniqueUrlCount: renderAtlases.length,
        preparedPlaneAtlasProfile: planeAtlasProfile,
        preparedLightingPresentation: lightingPresentation,
        preparedCompositorRotationAnimationCount: 1,
        preparedPlaneAtlasDecodedBytes:
          renderAtlases.reduce((sum, atlas) => sum + atlas.decodedBytes, 0),
        preparedPlaneAtlasAssetBytes:
          renderAtlasAssets.reduce((sum, asset) => sum + asset.byteLength, 0),
        preparedPlaneAtlasAssetSha256: renderAtlasAssets.map((asset) => asset.sha256).join(","),
        preparedPlaneAtlasCssImageBinding: renderAtlasAssets.every((asset) =>
          asset.cssImageBinding === "prepared-direct-stylesheet-url")
          ? "prepared-direct-stylesheet-url"
          : "invalid",
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      observer.disconnect();
      rotationAnimation.cancel();
      mountedCamera.remove();
      removePreparedSnapshotStyles();
    },
  });
}

function removePreparedSnapshotStyles() {
  for (const style of mountedStyles) style.remove();
  mountedStyles = [];
}
