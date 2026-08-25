// SPDX-License-Identifier: MIT
import { CSSBLACKHOLE_OPACITY_PALETTE } from
  "../shared/cssblackhole/preparedBlockTransport.mjs";
import { preparedBlackHoleColorAt } from
  "../shared/cssblackhole/preparedColorPresentation.mjs";

let mountedSnapshotStyle = null;
const PREPARED_DOT_STYLESHEET = ".polycss-scene>b{color:#fff}";

export function mountPreparedBlackHoleSnapshot({ host, catalog, snapshotHtml }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string") {
    throw new Error("BlackHole requires a prepared PolyCSS snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const styles = [...parsed.querySelectorAll("style")];
  const camera = parsed.body.querySelector(":scope > .polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const leaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  const directLeafCount = catalog.pointSelection?.selectedDirectPointCount;
  const hasPreparedColors = Number.isSafeInteger(directLeafCount) && directLeafCount >= 0 &&
    leaves.every((leaf, leafIndex) =>
      leaf.getAttribute("style")?.startsWith(
        `color:${preparedBlackHoleColorAt(leafIndex, directLeafCount)};`));
  const hasPreparedInitialState = catalog.snapshot?.initialStreamFrame === 0 &&
    catalog.snapshot.preparedTransformCount === catalog.starCount &&
    catalog.snapshot.preparedOpacityCount === catalog.starCount &&
    leaves.every((leaf) => leaf.style.transform.startsWith("translate(") && leaf.style.opacity !== "");
  const hasDiagnosticAttributes = leaves.some((leaf) =>
    leaf.id || leaf.className || [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")));
  const stylesheet = styles.map((style) => style.textContent).join("\n");
  if (parsed.querySelector("script, canvas, svg") || styles.length !== 1 ||
      !(camera instanceof HTMLElement) || camera.localName !== "main" ||
      !(scene instanceof HTMLElement) || leaves.length !== catalog.starCount ||
      camera.children.length !== 1 ||
      scene.children.length !== leaves.length || scene.querySelector(":scope > div, :scope > b > *") ||
      hasDiagnosticAttributes || !hasPreparedColors || !hasPreparedInitialState ||
      stylesheet !== PREPARED_DOT_STYLESHEET ||
      !Array.isArray(catalog.preparedOpacityPalette) ||
      catalog.preparedOpacityPalette.length !== CSSBLACKHOLE_OPACITY_PALETTE.length) {
    throw new Error("Prepared BlackHole retained point graph is incomplete");
  }

  mountedSnapshotStyle?.remove();
  mountedSnapshotStyle = document.importNode(styles[0], true);
  document.head.append(mountedSnapshotStyle);
  const mountedCamera = document.importNode(camera, true);
  for (const existing of host.querySelectorAll(":scope > .polycss-camera")) existing.remove();
  host.append(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  const mountedLeafColors = Object.freeze(mountedLeaves.map((leaf) => leaf.style.color));
  if (!(mountedScene instanceof HTMLElement) ||
      mountedCamera.children.length !== 1 ||
      mountedLeaves.length !== catalog.starCount ||
      mountedScene.children.length !== mountedLeaves.length ||
      mountedScene.querySelector(":scope > div, :scope > b > *") ||
      mountedLeaves.some((leaf) => leaf.id || leaf.className ||
        [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")))) {
    throw new Error("Mounted BlackHole retained point census drifted");
  }

  const stableNodes = Object.freeze([
    mountedCamera, mountedScene, ...mountedLeaves,
  ]);
  const transformPublisher = createBlackHolePreparedTransformPublisher(
    mountedLeaves, catalog.preparedOpacityPalette);
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
    if (!mountedSnapshotStyle?.isConnected || current.length !== stableNodes.length ||
        current.some((node, index) => node !== stableNodes[index]) ||
        mountedLeaves.some((leaf, leafIndex) => leaf.style.color !== mountedLeafColors[leafIndex])) {
      throw new Error("BlackHole retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    leafElements: Object.freeze(mountedLeaves),
    transformPublisher,
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        retainedDomMode: "prepared-flat-polycss-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedConfigurationRootCount: 0,
        retainedPointWrapperCount: 0,
        retainedPointLeafCount: mountedLeaves.length,
        retainedPointIdCount: 0,
        retainedPointDataAttributeCount: 0,
        retainedPreparedColorCount: new Set(mountedLeafColors).size,
        preparedColorAssignmentMode: catalog.presentationColors.colorAssignment,
        runtimeColorWriteCount: 0,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
        ...transformPublisher.stats(),
      });
    },
    destroy() {
      observer.disconnect();
      mountedCamera.remove();
      mountedSnapshotStyle?.remove();
      mountedSnapshotStyle = null;
    },
  });
}

export function createBlackHolePreparedTransformPublisher(leafElements, preparedOpacityPalette) {
  if (!Array.isArray(leafElements) || leafElements.length < 1) {
    throw new Error("BlackHole requires retained transform leaves");
  }
  if (!Array.isArray(preparedOpacityPalette) ||
      preparedOpacityPalette.length !== CSSBLACKHOLE_OPACITY_PALETTE.length ||
      preparedOpacityPalette.some((value) => typeof value !== "string")) {
    throw new Error("BlackHole requires a prepared source opacity dictionary");
  }
  const styles = new Array(leafElements.length);
  for (let leafIndex = 0; leafIndex < leafElements.length; leafIndex += 1) {
    styles[leafIndex] = leafElements[leafIndex].style;
  }

  function publishTransform(leafIndex, transform) {
    styles[leafIndex].transform = transform;
  }

  function publishOpacity(leafIndex, opacityIndex) {
    const opacity = preparedOpacityPalette[opacityIndex];
    if (opacity === undefined) throw new RangeError("BlackHole prepared opacity index drifted");
    styles[leafIndex].opacity = opacity;
  }

  return Object.freeze({
    leafCount: leafElements.length,
    publishTransform,
    publishOpacity,
    stats() {
      return Object.freeze({
        transformPublicationMode: "prepared-direct-inline-transform",
        retainedTypedTransformCount: 0,
        runtimeTransformStringAllocationCount: 0,
        runtimeTransformStringFormattingCount: 0,
        opacityPublicationMode: "prepared-direct-inline-opacity-dictionary",
        preparedOpacityDictionaryEntryCount: preparedOpacityPalette.length,
        runtimeOpacityStringAllocationCount: 0,
        runtimeOpacityStringFormattingCount: 0,
      });
    },
  });
}
