let mountedStyles = [];

export function mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssMaze snapshot is required");
  const documentSnapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (documentSnapshot.querySelector("script, canvas, svg")) {
    throw new Error("Prepared cssMaze snapshot contains a forbidden renderer/runtime element");
  }
  const styles = [...documentSnapshot.querySelectorAll("style")];
  const camera = documentSnapshot.querySelector(".polycss-camera");
  const scene = camera?.querySelector(".polycss-scene");
  const world = scene?.querySelector(":scope > .cssmaze-world");
  const walls = world?.querySelector(":scope > .cssmaze-walls");
  const surfaces = world?.querySelector(":scope > .cssmaze-surfaces");
  if (styles.length === 0 || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || !(world instanceof HTMLElement) ||
      !(walls instanceof HTMLElement) || !(surfaces instanceof HTMLElement) ||
      hasPreparedMetadata(documentSnapshot)) {
    throw new Error("Prepared cssMaze snapshot is missing its retained PolyCSS graph");
  }

  removePreparedSnapshotStyles();
  for (const style of styles) {
    const imported = document.importNode(style, true);
    document.head.append(imported);
    mountedStyles.push(imported);
  }
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(".polycss-scene");
  const mountedWorld = mountedScene?.querySelector(":scope > .cssmaze-world");
  const mountedWalls = mountedWorld?.querySelector(":scope > .cssmaze-walls");
  const mountedSurfaces = mountedWorld?.querySelector(":scope > .cssmaze-surfaces");
  const leaves = [...(mountedWorld?.querySelectorAll("b, i, s, u") ?? [])];
  const wallLeaves = [...(mountedWalls?.querySelectorAll(":scope > b, :scope > i, :scope > s, :scope > u") ?? [])];
  const surfaceLeaves = [...(mountedSurfaces?.querySelectorAll(":scope > b, :scope > i, :scope > s, :scope > u") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || !(mountedWorld instanceof HTMLElement) ||
      !(mountedWalls instanceof HTMLElement) || !(mountedSurfaces instanceof HTMLElement) ||
      leaves.length !== sceneData.metrics.preparedLeafCount ||
      wallLeaves.length !== sceneData.metrics.sourceWallSegmentCount ||
      surfaceLeaves.length !== 2 || leaves.some((leaf) => leaf.localName !== "s")) {
    throw new Error("Prepared cssMaze retained target census drifted");
  }

  const stableNodes = Object.freeze([
    mountedScene,
    mountedWorld,
    mountedWalls,
    mountedSurfaces,
    ...leaves,
  ]);
  function assertStableDomIdentity() {
    const current = [
      host.querySelector(".polycss-scene"),
      host.querySelector(".cssmaze-world"),
      host.querySelector(".cssmaze-walls"),
      host.querySelector(".cssmaze-surfaces"),
      ...host.querySelectorAll(".cssmaze-world b, .cssmaze-world i, .cssmaze-world s, .cssmaze-world u"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Prepared cssMaze retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    worldRoot: mountedWorld,
    wallRoot: mountedWalls,
    surfaceRoot: mountedSurfaces,
    leaves: Object.freeze(leaves),
    wallLeaves: Object.freeze(wallLeaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedWorldRootCount: 1,
        retainedWallRootCount: 1,
        retainedSurfaceRootCount: 1,
        retainedPolygonLeafCount: leaves.length,
        retainedDataAttributeCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomMutationCount: 0,
        runtimeDomMutationObserverInstalled: false,
        runtimeDomGrowth: false,
      });
    },
    destroy() {
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
