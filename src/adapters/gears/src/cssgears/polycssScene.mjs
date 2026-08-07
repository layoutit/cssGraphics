let mountedStyles = [];

export function mountPreparedPolycssSnapshot({
  host,
  sceneData,
  sceneBank = [sceneData],
  snapshotHtml,
  lightingAsset,
  lightingAssets = [lightingAsset],
  bankTokens = sceneBank.map(() => null),
}) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssGears snapshot is required");
  const doc = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (doc.querySelector("script, canvas, svg")) {
    throw new Error("Prepared cssGears snapshot contains a forbidden renderer/runtime element");
  }
  const styles = [...doc.querySelectorAll("style")];
  const camera = doc.querySelector(".polycss-camera");
  const scene = camera?.querySelector(".polycss-scene");
  if (styles.length === 0 || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || hasPreparedMetadata(doc)) {
    throw new Error("Prepared cssGears snapshot is missing its retained PolyCSS graph");
  }
  if (sceneBank.length !== lightingAssets.length || sceneBank.length !== bankTokens.length ||
      sceneBank.length < 1 || sceneBank.length > 24 ||
      lightingAssets.some((asset, index) =>
        asset?.sha256 !== sceneBank[index].lighting?.assetSha256 || typeof asset.url !== "string") ||
      (sceneBank.length > 1 && bankTokens.some((token) =>
        !/^[a-z]$/u.test(token) || token === "d" || token === "g"))) {
    throw new Error("Prepared cssGears lighting asset is missing or unverified");
  }
  removePreparedSnapshotStyles();
  for (const style of styles) {
    const imported = document.importNode(style, true);
    document.head.append(imported);
    mountedStyles.push(imported);
  }
  const importedCamera = document.importNode(camera, true);
  host.replaceChildren(importedCamera);
  const mountedScene = importedCamera.querySelector(".polycss-scene");
  const gearRoots = [...(mountedScene?.querySelectorAll(":scope > .g") ?? [])];
  const leaves = [...(mountedScene?.querySelectorAll(":scope > .g > b") ?? [])];
  const expectedLeafCount = sceneBank.reduce((total, scene) => total + scene.metrics.preparedLeafCount, 0);
  if (!(mountedScene instanceof HTMLElement) ||
      gearRoots.length !== sceneData.metrics.preparedGearRootCount ||
      leaves.length !== expectedLeafCount ||
      mountedScene.querySelector("b.d") || sceneData.lighting.animatedFaceCount !== 0) {
    throw new Error("Prepared cssGears retained target census drifted");
  }
  for (let index = 0; index < lightingAssets.length; index += 1) {
    const bankToken = bankTokens[index];
    const firstLeaf = bankToken
      ? mountedScene.querySelector(`:scope > .g > b.${bankToken}`)
      : leaves[0];
    if (!(firstLeaf instanceof HTMLElement) ||
        !getComputedStyle(firstLeaf).backgroundImage.includes(sceneBank[index].lighting.assetUrl)) {
      throw new Error(`Prepared cssGears lighting bank ${index} drifted`);
    }
  }
  const stableNodes = Object.freeze([mountedScene, ...gearRoots, ...leaves]);
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
    const currentScene = host.querySelector(".polycss-scene");
    const currentGears = [...host.querySelectorAll(".polycss-scene > .g")];
    const currentLeaves = [...host.querySelectorAll(".polycss-scene > .g > b")];
    if (currentScene !== stableNodes[0] ||
        currentGears.length !== gearRoots.length ||
        currentLeaves.length !== leaves.length ||
        currentGears.some((root, index) => root !== stableNodes[index + 1]) ||
        currentLeaves.some((leaf, index) => leaf !== stableNodes[1 + gearRoots.length + index])) {
      throw new Error("Prepared cssGears retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: importedCamera,
    scene: mountedScene,
    modelRoot: mountedScene,
    gearRoots: Object.freeze(gearRoots),
    leaves: Object.freeze(leaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedAssemblyRootCount: 1,
        retainedGearRootCount: gearRoots.length,
        retainedLightingGroupCount: 0,
        retainedDynamicLightingLeafCount: 0,
        preparedStaticLightingLeafCount: leaves.length,
        preparedLightingAtlasStateCount: lightingAssets.reduce(
          (total, asset, index) => total + sceneBank[index].lighting.atlasStateCount,
          0,
        ),
        retainedPolygonLeafCount: leaves.length,
        activePreparedLeafCount: sceneData.metrics.preparedLeafCount,
        retainedSceneBankCount: sceneBank.length,
        preparedLightingAtlasTextureLeafCount: leaves.length,
        preparedLightingAtlasReadyTextureLeafCount: leaves.length,
        preparedRenderBundleCount: sceneData.metrics.preparedRenderBundleCount,
        preparedMergedSourceFaceCount: sceneData.metrics.mergedSourceFaceCount,
        preparedSourceFaceCoverageExact: sceneData.metrics.sourceFaceCoverageExact,
        preparedLightingAtlasUniqueUrlCount: lightingAssets.length,
        preparedLightingAssetSha256: lightingAssets.map((asset) => asset.sha256).join(","),
        preparedLightingAssetBytes: lightingAssets.reduce((total, asset) => total + asset.byteLength, 0),
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

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}

function removePreparedSnapshotStyles() {
  for (const style of mountedStyles) style.remove();
  mountedStyles = [];
}
