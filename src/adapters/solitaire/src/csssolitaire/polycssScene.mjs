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
  let presentationScale = 1;
  let presentationScaleWrites = 0;

  function updatePresentation() {
    const width = host.clientWidth || manifest.renderer.landscapePresentationBase[0];
    const height = host.clientHeight || manifest.renderer.landscapePresentationBase[1];
    presentationScale = height >= width
      ? Math.min(
        width / manifest.renderer.portraitPresentationBase[0],
        height / manifest.renderer.portraitPresentationBase[1],
      )
      : manifest.renderer.landscapePresentationBaseScale * Math.min(
        width / manifest.renderer.landscapePresentationBase[0],
        height / manifest.renderer.landscapePresentationBase[1],
      );
    const serialized = String(Number(presentationScale.toFixed(8)));
    if (host.style.getPropertyValue("--csssolitaire-presentation-scale") !== serialized) {
      host.style.setProperty("--csssolitaire-presentation-scale", serialized);
      presentationScaleWrites += 1;
    }
  }
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updatePresentation) : null;
  resizeObserver?.observe(host);
  globalThis.addEventListener?.("resize", updatePresentation);
  updatePresentation();

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
        runtimeFitCalculationPurpose: "single-root-presentation-scale-only",
        runtimePresentationScale: presentationScale,
        runtimePresentationScaleWrites: presentationScaleWrites,
        runtimeGeometryBoundsCalculationCount: 0,
      });
    },
    destroy() {
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", updatePresentation);
      host.replaceChildren();
      host.style.removeProperty("--csssolitaire-presentation-scale");
      mountedStyle?.remove();
      mountedStyle = null;
    },
  });
}

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}
