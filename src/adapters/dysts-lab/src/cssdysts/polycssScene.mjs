// SPDX-License-Identifier: MIT

export function mountPreparedChaosSnapshot({ host, catalog, snapshotHtml }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string") {
    throw new Error("Chaos requires a prepared PolyCSS snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const camera = parsed.body.querySelector(":scope > .polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const leaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  const hasDiagnosticAttributes = leaves.some((leaf) =>
    leaf.id || leaf.className ||
    [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")));
  if (parsed.querySelector("script, canvas, svg") || !(camera instanceof HTMLElement) ||
      camera.localName !== "main" || !(scene instanceof HTMLElement) ||
      camera.children.length !== 1 || scene.children.length !== catalog.starCount ||
      leaves.length !== catalog.starCount || scene.querySelector(":scope > b > *") ||
      hasDiagnosticAttributes) {
    throw new Error("Chaos prepared retained point graph is incomplete");
  }
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || mountedCamera.children.length !== 1 ||
      mountedScene.children.length !== catalog.starCount ||
      mountedLeaves.length !== catalog.starCount ||
      mountedScene.querySelector(":scope > b > *") ||
      mountedLeaves.some((leaf) => leaf.id || leaf.className ||
        [...leaf.attributes].some((attribute) => attribute.name.startsWith("data-")))) {
    throw new Error("Mounted Chaos retained point census drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedLeaves]);
  const styles = Object.freeze(mountedLeaves.map((leaf) => leaf.style));
  const colors = mountedLeaves.map((leaf) => leaf.style.color);
  let runtimeDomCreationCount = 0;
  let runtimeDomRemovalCount = 0;
  let transformWriteCount = 0;
  let colorWriteCount = 0;
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
    if (current.length !== stableNodes.length ||
        current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Chaos retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    publishTransform(leafIndex, transform) {
      styles[leafIndex].transform = transform;
      transformWriteCount += 1;
    },
    publishColor(leafIndex, color) {
      if (colors[leafIndex] === color) return false;
      colors[leafIndex] = color;
      styles[leafIndex].color = color;
      colorWriteCount += 1;
      return true;
    },
    assertStableDomIdentity,
    stats() {
      const runtimeDomMutationCount = runtimeDomCreationCount + runtimeDomRemovalCount;
      assertStableDomIdentity();
      return Object.freeze({
        retainedDomMode: "prepared-flat-polycss-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedPointWrapperCount: 0,
        retainedPointLeafCount: mountedLeaves.length,
        retainedPointIdCount: 0,
        retainedPointDataAttributeCount: 0,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount,
        runtimeDomGrowth: runtimeDomMutationCount !== 0,
        transformWriteCount,
        colorWriteCount,
        runtimeTransformStringFormattingCount: 0,
      });
    },
    destroy() {
      observer.disconnect();
      mountedCamera.remove();
    },
  });
}
