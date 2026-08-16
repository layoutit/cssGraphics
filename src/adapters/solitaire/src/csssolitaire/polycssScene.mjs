let mountedStyle = null;

export function mountPreparedSolitaireSnapshot({ host, manifest, snapshotHtml }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssSolitaire host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssSolitaire snapshot is required");
  const snapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (snapshot.querySelector("script,canvas,svg") || snapshot.querySelectorAll("style").length !== 1 ||
      hasPreparedMetadata(snapshot)) {
    throw new Error("Prepared cssSolitaire snapshot contains a forbidden or incomplete graph");
  }
  const style = snapshot.querySelector("style");
  const camera = snapshot.querySelector(".solitaire-prepared-camera");
  const scene = camera?.querySelector(":scope > .solitaire-prepared-scene");
  const board = scene?.querySelector(":scope > .csssolitaire-board");
  const leaves = [...(board?.querySelectorAll(":scope > s") ?? [])];
  if (!(style instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || !(board instanceof HTMLElement) ||
      leaves.length !== manifest.metrics.retainedLeafCount ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement) || leaf.localName !== "s")) {
    throw new Error("Prepared cssSolitaire retained DOM census drifted");
  }

  mountedStyle?.remove();
  mountedStyle = document.importNode(style, true);
  document.head.append(mountedStyle);
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .solitaire-prepared-scene");
  const mountedBoard = mountedScene?.querySelector(":scope > .csssolitaire-board");
  const mountedLeaves = [...(mountedBoard?.querySelectorAll(":scope > s") ?? [])];
  if (!(mountedScene instanceof HTMLElement) || !(mountedBoard instanceof HTMLElement) ||
      mountedLeaves.length !== manifest.metrics.retainedLeafCount) {
    throw new Error("Mounted cssSolitaire retained DOM census drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, mountedBoard, ...mountedLeaves]);

  function fit() {
    const portrait = host.clientHeight > host.clientWidth;
    const [sourceWidth, sourceHeight] = portrait
      ? manifest.renderer.portraitPlayfield
      : manifest.sourceProfile.playfield;
    const scale = Math.min(host.clientWidth / sourceWidth, host.clientHeight / sourceHeight);
    mountedScene.style.setProperty("--csssolitaire-fit", String(scale));
  }
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(host);
  fit();

  function assertStableDomIdentity() {
    const current = [
      host.querySelector(":scope > .solitaire-prepared-camera"),
      host.querySelector(":scope > .solitaire-prepared-camera > .solitaire-prepared-scene"),
      host.querySelector(":scope > .solitaire-prepared-camera > .solitaire-prepared-scene > .csssolitaire-board"),
      ...host.querySelectorAll(".csssolitaire-board > s"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index])) {
      throw new Error("Prepared cssSolitaire retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    board: mountedBoard,
    leaves: Object.freeze(mountedLeaves),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedBoardRootCount: 1,
        retainedPolygonLeafCount: mountedLeaves.length,
        retainedDataAttributeCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomMutationCount: 0,
        runtimeDomMutationObserverInstalled: false,
        runtimeDomGrowth: false,
        runtimeFitCalculationPurpose: "resize-only-prepared-responsive-playfield",
      });
    },
    destroy() {
      resizeObserver.disconnect();
      host.replaceChildren();
      mountedStyle?.remove();
      mountedStyle = null;
    },
  });
}

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}
