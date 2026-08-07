import { collectPolyRenderStats } from "@layoutit/polycss";

let preparedStyle = null;

export function mountPreparedPolycssSnapshot({ host, sceneData, snapshotHtml, preparedAssets }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssFlower host.");
  const doc = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (doc.querySelector("script, canvas, svg")) {
    throw new Error("Prepared PolyCSS snapshot contains a forbidden runtime/render element.");
  }
  if ([...doc.querySelectorAll("*")].some((element) =>
    element.getAttributeNames().some((name) => name.startsWith("data-")))) {
    throw new Error("Prepared PolyCSS snapshot contains forbidden data attributes.");
  }

  const styleElement = doc.querySelector("style");
  const preparedLeafRuleCount = (styleElement?.textContent.match(/\.polycss-mesh>u\.[a-zA-Z]{1,2} \{/gu) ?? []).length;
  const cameraElement = doc.body.firstElementChild;
  const sceneElement = cameraElement?.firstElementChild;
  const rootElement = sceneElement?.firstElementChild;
  const meshElement = rootElement?.firstElementChild;
  if (!(styleElement instanceof HTMLStyleElement) || !(cameraElement instanceof HTMLElement) ||
      !cameraElement.classList.contains("polycss-camera") || !(sceneElement instanceof HTMLElement) ||
      !sceneElement.classList.contains("polycss-scene") || !(rootElement instanceof HTMLElement) ||
      !(meshElement instanceof HTMLElement) || !meshElement.classList.contains("polycss-mesh") ||
      preparedLeafRuleCount !== 1200 || !preparedAssets?.lightingPages?.urlFor) {
    throw new Error("Prepared cssFlower direct PolyCSS hierarchy is missing.");
  }

  removePreparedSnapshotStyles();
  const importedStyle = document.importNode(styleElement, true);
  document.head.appendChild(importedStyle);
  preparedStyle = importedStyle;
  const importedCamera = document.importNode(cameraElement, true);
  const importedScene = importedCamera.firstElementChild;
  const importedRoot = importedScene?.firstElementChild;
  const importedMesh = importedRoot?.firstElementChild;
  if (!(importedRoot instanceof HTMLElement) || !(importedMesh instanceof HTMLElement)) {
    throw new Error("Prepared cssFlower retained root is missing.");
  }
  importedRoot.style.setProperty(
    "--cssflower-space-texels",
    `url("${preparedAssets.lightingPages.urlFor(0)}")`,
  );
  host.replaceChildren(importedCamera);

  const camera = host.firstElementChild;
  const scene = camera?.firstElementChild;
  const rotationRoot = scene?.firstElementChild;
  const mesh = rotationRoot?.firstElementChild;
  if (!(camera instanceof HTMLElement) || !camera.classList.contains("polycss-camera") ||
      !(scene instanceof HTMLElement) || !scene.classList.contains("polycss-scene") ||
      !(rotationRoot instanceof HTMLElement) || !(mesh instanceof HTMLElement) ||
      !mesh.classList.contains("polycss-mesh")) {
    throw new Error("Prepared cssFlower camera, scene, root, or mesh is missing.");
  }

  const leaves = [...mesh.children];
  const triangleIds = sceneData.lighting.faces.map((face) => face.triangleId);
  const retainedLeafClasses = leaves.map((leaf) => leaf.className);
  if (leaves.length !== 1200 || triangleIds.length !== 1200 || new Set(triangleIds).size !== 1200 ||
      new Set(retainedLeafClasses).size !== 1200 ||
      scene.children.length !== 1 || rotationRoot.children.length !== 1) {
    throw new Error(`Prepared cssFlower retained target count drifted (${leaves.length} leaves).`);
  }
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const face = sceneData.lighting.faces[index];
    if (!(leaf instanceof HTMLElement) || leaf.tagName !== "U" ||
        !/^[a-zA-Z]{1,2}$/u.test(leaf.className) ||
        leaf.style.length !== 0 ||
        !Number.isSafeInteger(face.leafWidth) || !Number.isSafeInteger(face.leafHeight) ||
        face.sourceOrder !== index || face.triangleId !== triangleIds[index]) {
      throw new Error(`Prepared cssFlower retained leaf ${index} is not source-addressable by prepared order.`);
    }
  }

  const stableNodes = Object.freeze([camera, scene, rotationRoot, mesh, ...leaves]);
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
    const currentCamera = host.firstElementChild;
    const currentScene = currentCamera?.firstElementChild;
    const currentRoot = currentScene?.firstElementChild;
    const currentMesh = currentRoot?.firstElementChild;
    const currentLeaves = currentMesh ? [...currentMesh.children] : [];
    if (currentCamera !== stableNodes[0] || currentScene !== stableNodes[1] ||
        currentRoot !== stableNodes[2] || currentMesh !== stableNodes[3] ||
        currentLeaves.length !== leaves.length ||
        currentLeaves.some((leaf, index) => leaf !== stableNodes[index + 4])) {
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
      const polycss = collectPolyRenderStats(rotationRoot, {
        polygonCount: sceneData.metrics.preparedLeafCount,
      });
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedRotationRootCount: 1,
        retainedTriangleLeafCount: leaves.length,
        retainedTriangleIdCount: triangleIds.length,
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

function removePreparedSnapshotStyles() {
  preparedStyle?.remove();
  preparedStyle = null;
}
