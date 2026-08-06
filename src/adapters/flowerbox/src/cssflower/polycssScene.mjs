import { collectPolyRenderStats } from "@layoutit/polycss";
import { applyPreparedProjectedLeafLayout } from "./projectedPageStyles.mjs";

export function mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, projectedPages }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host.");
  const doc = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (doc.querySelector("script, canvas, svg")) {
    throw new Error("Prepared PolyCSS snapshot contains a forbidden runtime/render element.");
  }
  const styleElement = doc.querySelector("style");
  const cameraElement = doc.querySelector(".polycss-camera");
  if (!styleElement || !cameraElement) {
    throw new Error("Prepared PolyCSS snapshot is missing style or camera DOM.");
  }
  removePreparedSnapshotStyles();
  const importedStyle = document.importNode(styleElement, true);
  importedStyle.setAttribute("data-cssflower-snapshot-style", "1");
  document.head.appendChild(importedStyle);
  const importedCamera = document.importNode(cameraElement, true);
  const importedRoot = importedCamera.querySelector("[data-cssflower-rotation-root]");
  const importedScene = importedCamera.querySelector(".polycss-scene");
  const importedMesh = importedRoot?.querySelector(".polycss-mesh");
  if (!(importedRoot instanceof HTMLElement) || !(importedScene instanceof HTMLElement) ||
      !(importedMesh instanceof HTMLElement) || !projectedPages?.urlFor || !projectedPages?.layoutFor) {
    throw new Error("Prepared cssFlower projected page loader is missing.");
  }
  const importedLeaves = [...importedRoot.querySelectorAll("[data-cssflower-leaf-index]")]
    .sort((left, right) => leafIndex(left) - leafIndex(right));
  const initialProjectedPage = sceneData.playback.projectedPixels.pages[0];
  importedCamera.style.setProperty("perspective", "none", "important");
  importedScene.style.setProperty("transform", "none", "important");
  importedScene.style.setProperty("transform-style", "preserve-3d", "important");
  importedRoot.style.setProperty("--cssflower-projected-atlas", `url("${projectedPages.urlFor(0)}")`);
  importedRoot.style.setProperty("--cssflower-projected-frame-offset", "0px");
  importedMesh.style.setProperty("transform-origin", "0 0", "important");
  importedMesh.style.setProperty("transform-style", "preserve-3d", "important");
  importedMesh.style.transform = sceneData.playback.projectedPixels.inverseRootTransforms[0];
  applyPreparedProjectedLeafLayout({
    leaves: importedLeaves,
    layoutValues: projectedPages.layoutFor(0),
    atlas: initialProjectedPage.atlas,
  });
  host.replaceChildren(importedCamera);

  const camera = host.querySelector(".polycss-camera");
  const scene = host.querySelector(".polycss-scene");
  const rotationRoot = host.querySelector("[data-cssflower-rotation-root]");
  const mesh = rotationRoot?.querySelector(".polycss-mesh");
  if (!(camera instanceof HTMLElement) || !(scene instanceof HTMLElement) ||
      !(rotationRoot instanceof HTMLElement) || !(mesh instanceof HTMLElement)) {
    throw new Error("Prepared cssFlower camera, scene, or rotation root is missing.");
  }
  const leaves = [...rotationRoot.querySelectorAll("[data-cssflower-leaf-index]")]
    .sort((left, right) => leafIndex(left) - leafIndex(right));
  const triangleIds = new Set();
  if (leaves.length !== 1200 || host.querySelectorAll("[data-cssflower-rotation-root]").length !== 1) {
    throw new Error(`Prepared cssFlower retained target count drifted (${leaves.length} leaves).`);
  }
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const triangleId = leaf.getAttribute("data-cssflower-triangle");
    const seamEdgeMaskText = leaf.getAttribute("data-cssflower-seam-edge-mask");
    const seamEdgeMask = seamEdgeMaskText === null ? null : Number(seamEdgeMaskText);
    const expectedFace = sceneData.lighting?.faces?.[index];
    const expectedSeamEdgeMask = expectedFace?.seamEdgeMask;
    const seamBleed = Number(leaf.getAttribute("data-cssflower-seam-bleed"));
    const seamEdgeMaskInvalid = Number.isSafeInteger(expectedSeamEdgeMask)
      ? seamEdgeMask !== expectedSeamEdgeMask
      : seamEdgeMask !== null && (!Number.isSafeInteger(seamEdgeMask) || seamEdgeMask < 1 || seamEdgeMask > 7);
    if (leafIndex(leaf) !== index ||
        leaf.getAttribute("data-cssflower-retained-leaf") !== "true" ||
        seamBleed !== expectedFace?.seamBleed ||
        seamEdgeMaskInvalid ||
        !triangleId || triangleIds.has(triangleId)) {
      throw new Error(`Prepared cssFlower retained leaf ${index} is not source-addressable.`);
    }
    triangleIds.add(triangleId);
  }
  const stableNodes = Object.freeze([rotationRoot, ...leaves]);
  let runtimeDomCreationCount = 0;
  let runtimeDomRemovalCount = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      runtimeDomCreationCount += record.addedNodes.length;
      runtimeDomRemovalCount += record.removedNodes.length;
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  document.body.dataset.polycssArtifact = "prepared-snapshot";

  function assertStableDomIdentity() {
    const currentRoot = host.querySelector("[data-cssflower-rotation-root]");
    const currentLeaves = [...host.querySelectorAll("[data-cssflower-leaf-index]")]
      .sort((left, right) => leafIndex(left) - leafIndex(right));
    if (currentRoot !== stableNodes[0] || currentLeaves.length !== leaves.length ||
        currentLeaves.some((leaf, index) => leaf !== stableNodes[index + 1])) {
      throw new Error("Prepared cssFlower retained DOM identity changed.");
    }
    return true;
  }

  return Object.freeze({
    camera,
    scene,
    mesh,
    rotationRoot,
    leaves: Object.freeze(leaves),
    triangleIds: Object.freeze([...triangleIds]),
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      const polycss = collectPolyRenderStats(host, {
        polygonCount: sceneData.metrics.preparedLeafCount,
        scopeSelector: "[data-cssflower-rotation-root]",
      });
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedRotationRootCount: 1,
        retainedTriangleLeafCount: leaves.length,
        retainedTriangleIdCount: triangleIds.size,
        runtimeDomCreationCount,
        runtimeDomRemovalCount,
        runtimeDomMutationCount: runtimeDomCreationCount + runtimeDomRemovalCount,
        runtimeDomGrowth: false,
        polycss,
      });
    },
    destroy() {
      observer.disconnect();
      host.replaceChildren();
      removePreparedSnapshotStyles();
    },
  });
}

function leafIndex(element) {
  const value = Number(element.getAttribute("data-cssflower-leaf-index"));
  if (!Number.isInteger(value)) throw new Error("Prepared cssFlower leaf index must be an integer.");
  return value;
}

function removePreparedSnapshotStyles() {
  for (const style of document.querySelectorAll("style[data-cssflower-snapshot-style]")) style.remove();
}
