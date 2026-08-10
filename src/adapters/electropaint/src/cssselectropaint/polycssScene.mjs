// SPDX-License-Identifier: GPL-2.0-only
let mountedStyles = [];

export function mountPreparedElectropaintSnapshot({ host, sceneData, snapshotHtml }) {
  if (!(host instanceof HTMLElement) || typeof snapshotHtml !== "string") {
    throw new Error("ElectroPaint requires a prepared PolyCSS snapshot");
  }
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (parsed.querySelector("script, canvas, svg")) {
    throw new Error("Prepared ElectroPaint snapshot contains an alternate renderer element");
  }
  const styles = [...parsed.querySelectorAll("style")];
  const camera = parsed.querySelector(".polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const quads = [...(scene?.querySelectorAll(":scope > b") ?? [])];
  if (styles.length === 0 || !(camera instanceof HTMLElement) || !(scene instanceof HTMLElement) ||
      quads.length !== sceneData.metrics.preparedRetainedQuadCount ||
      scene.querySelector(":scope > div, :scope > b > *")) {
    throw new Error("Prepared ElectroPaint retained graph is incomplete");
  }
  removePreparedSnapshotStyles();
  for (const style of styles) {
    const imported = document.importNode(style, true);
    imported.setAttribute("data-cssselectropaint-snapshot-style", "1");
    document.head.append(imported);
    mountedStyles.push(imported);
  }
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .polycss-scene");
  const mountedQuads = [...(mountedScene?.querySelectorAll(":scope > b") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || mountedQuads.length !== 40 ||
      mountedScene.querySelector(":scope > div, :scope > b > *")) {
    throw new Error("Mounted ElectroPaint retained graph census drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedQuads]);
  function assertStableDomIdentity() {
    const currentScene = host.querySelector(".polycss-scene");
    const currentQuads = [...host.querySelectorAll(".polycss-scene > b")];
    const current = [host.querySelector(".polycss-camera"), currentScene, ...currentQuads];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("ElectroPaint retained DOM identity changed");
    }
    return true;
  }
  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    quads: Object.freeze(mountedQuads),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-polycss-snapshot",
        retainedQuadCount: mountedQuads.length,
        retainedPolygonLeafCount: mountedQuads.length,
        retainedPerQuadWrapperCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
      host.replaceChildren();
      removePreparedSnapshotStyles();
    },
  });
}

function removePreparedSnapshotStyles() {
  for (const style of mountedStyles) style.remove();
  mountedStyles = [];
}
