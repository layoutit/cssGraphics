// SPDX-License-Identifier: MIT

export function mountPreparedChaosSnapshot({ host, catalog, snapshotHtml }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string") {
    throw new Error("Chaos requires a prepared PolyCSS snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const camera = parsed.body.querySelector(":scope > .polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const axes = [...(scene?.querySelectorAll(":scope > .axis") ?? [])];
  const leaves = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  if (parsed.querySelector("script, canvas, svg") || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || camera.children.length !== 1 ||
      scene.children.length !== catalog.starCount + 3 || axes.length !== 3 ||
      leaves.length !== catalog.starCount || scene.querySelector(":scope > b > *, :scope > .axis > *") ||
      axes.some((axis) => axis.tagName !== "I" || !axis.getAttribute("aria-hidden")) ||
      leaves.some((leaf) => leaf.id || leaf.className)) {
    throw new Error("Chaos prepared retained point graph is incomplete");
  }
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedAxes = [...mountedScene.querySelectorAll(":scope > .axis")];
  const mountedLeaves = [...mountedScene.querySelectorAll(":scope > b")];
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedAxes, ...mountedLeaves]);
  const styles = Object.freeze(mountedLeaves.map((leaf) => leaf.style));
  const opacities = mountedLeaves.map((leaf) => leaf.style.opacity);
  let runtimeDomMutationCount = 0;
  let transformWriteCount = 0;
  let opacityWriteCount = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      runtimeDomMutationCount += record.addedNodes.length + record.removedNodes.length;
    }
  });
  observer.observe(mountedCamera, { childList: true, subtree: true });

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    publishTransform(leafIndex, transform) {
      styles[leafIndex].transform = transform;
      transformWriteCount += 1;
    },
    publishOpacity(leafIndex, opacity) {
      if (opacities[leafIndex] === opacity) return false;
      opacities[leafIndex] = opacity;
      styles[leafIndex].opacity = opacity;
      opacityWriteCount += 1;
      return true;
    },
    assertStableDomIdentity() {
      const current = [
        host.querySelector(":scope > .polycss-camera"),
        host.querySelector(":scope > .polycss-camera > .polycss-scene"),
        ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > .axis"),
        ...host.querySelectorAll(":scope > .polycss-camera > .polycss-scene > b"),
      ];
      if (current.length !== stableNodes.length ||
          current.some((node, index) => node !== stableNodes[index])) {
        throw new Error("Chaos retained DOM identity changed");
      }
      return true;
    },
    stats() {
      return Object.freeze({
        retainedPointLeafCount: mountedLeaves.length,
        retainedAxisElementCount: mountedAxes.length,
        runtimeDomMutationCount,
        runtimeDomGrowth: runtimeDomMutationCount !== 0,
        transformWriteCount,
        opacityWriteCount,
        runtimeTransformStringFormattingCount: 0,
      });
    },
    destroy() {
      observer.disconnect();
      mountedCamera.remove();
    },
  });
}
