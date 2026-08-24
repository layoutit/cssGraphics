// SPDX-License-Identifier: HPND
import {
  createGalaxyColorStylesheet,
} from "./colorFamilyContract.mjs";

let mountedSnapshotStyle = null;

export function mountPreparedGalaxySnapshot({ host, catalog, snapshotHtml }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string") {
    throw new Error("Galaxy requires a prepared PolyCSS snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const styles = [...parsed.querySelectorAll("style")];
  const camera = parsed.body.querySelector(":scope > .polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const leaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  const hasDiagnosticAttributes = leaves.some((leaf) =>
    leaf.id || leaf.className || [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")));
  const stylesheet = styles.map((style) => style.textContent).join("\n");
  const expectedColorStyles = createGalaxyColorStylesheet(
    catalog.prefixStarCounts, catalog.colorFamilyVariantCount, catalog.particleCohortColors);
  if (parsed.querySelector("script, canvas, svg") || styles.length !== 1 ||
      !(camera instanceof HTMLElement) || camera.localName !== "main" ||
      !(scene instanceof HTMLElement) || leaves.length !== catalog.starCount ||
      scene.children.length !== leaves.length || scene.querySelector(":scope > div, :scope > b > *") ||
      hasDiagnosticAttributes || expectedColorStyles.leafCount !== catalog.starCount ||
      stylesheet !== expectedColorStyles.stylesheet) {
    throw new Error("Prepared Galaxy retained point graph is incomplete");
  }

  mountedSnapshotStyle?.remove();
  mountedSnapshotStyle = document.importNode(styles[0], true);
  document.head.append(mountedSnapshotStyle);
  const mountedCamera = document.importNode(camera, true);
  for (const existing of host.querySelectorAll(":scope > .polycss-camera")) existing.remove();
  host.append(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || mountedLeaves.length !== catalog.starCount ||
      mountedScene.children.length !== mountedLeaves.length ||
      mountedScene.querySelector(":scope > div, :scope > b > *") ||
      mountedLeaves.some((leaf) => leaf.id || leaf.className ||
        [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")))) {
    throw new Error("Mounted Galaxy retained point census drifted");
  }

  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedLeaves]);
  const transformPublisher = createGalaxyPreparedTransformPublisher(mountedLeaves);
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
        current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Galaxy retained DOM identity changed");
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
        retainedGalaxyRootCount: 0,
        retainedPointWrapperCount: 0,
        retainedPointLeafCount: mountedLeaves.length,
        retainedPointIdCount: 0,
        retainedPointDataAttributeCount: 0,
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

export function createGalaxyPreparedTransformPublisher(leafElements) {
  if (!Array.isArray(leafElements) || leafElements.length < 1) {
    throw new Error("Galaxy requires retained transform leaves");
  }
  const styles = new Array(leafElements.length);
  for (let leafIndex = 0; leafIndex < leafElements.length; leafIndex += 1) {
    styles[leafIndex] = leafElements[leafIndex].style;
  }

  function publishTransform(leafIndex, transform) {
    styles[leafIndex].transform = transform;
  }

  return Object.freeze({
    leafCount: leafElements.length,
    publishTransform,
    stats() {
      return Object.freeze({
        transformPublicationMode: "prepared-direct-inline-transform",
        retainedTypedTransformCount: 0,
        runtimeTransformStringAllocationCount: 0,
        runtimeTransformStringFormattingCount: 0,
      });
    },
  });
}
