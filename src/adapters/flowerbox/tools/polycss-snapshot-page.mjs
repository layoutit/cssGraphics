import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_BOUNDARY_SEAM_BLEED_TEXT,
  CSSFLOWER_LIGHTING_ATLAS_HEIGHT,
  CSSFLOWER_LIGHTING_ATLAS_WIDTH,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_LIGHTING_LAYOUT,
  CSSFLOWER_LIGHTING_PAGE_COUNT,
  CSSFLOWER_LIGHTING_PAGE_ROWS,
  CSSFLOWER_LIGHTING_RASTER_MODE,
  CSSFLOWER_LIGHTING_SCHEMA,
  CSSFLOWER_SEAM_BLEED,
  CSSFLOWER_SEAM_BLEED_TEXT,
  CSSFLOWER_SEAM_BLEED_POLICY,
} from "../src/cssflower/renderContract.mjs";

const host = document.getElementById("scene");
const params = new URLSearchParams(location.search);
const sceneUrl = params.get("sceneUrl");

main().catch((error) => {
  window.__cssFlowerDebugSnapshot = {
    status: "error",
    error: error.stack || error.message || String(error),
  };
});

async function main() {
  if (!(host instanceof HTMLElement) || !sceneUrl?.startsWith("/cssflower/scenes/")) {
    throw new Error("cssFlower snapshot page requires a generated cssFlower sceneUrl");
  }
  const sceneData = await fetchJson(sceneUrl);
  validateScene(sceneData);
  const preparationLightingUrl = sceneData.lighting.grid.assetUrl;
  const [, , initialTransforms] = await Promise.all([
    fetchVerifiedBytes(preparationLightingUrl, sceneData.lighting.grid.sha256),
    loadImage(preparationLightingUrl),
    loadInitialPreparedTransforms(sceneData),
  ]);
  const { scene, mesh } = createSnapshotScene(sceneData);
  try {
    const retained = mountRetainedTargets({ scene, mesh, sceneData, initialTransforms, preparationLightingUrl });
    scene.applyCamera();
    await scene.whenTexturesReady();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const stats = collectPolyRenderStats(host, {
      polygonCount: sceneData.metrics.preparedLeafCount,
      scopeSelector: "[data-cssflower-rotation-root]",
    });
    assertSnapshotStats(stats, retained, sceneData);
    const exported = await exportPolySceneSnapshot(host);
    const preparedAtlasUrl = sceneData.lighting.grid.assetUrl;
    const html = prepareExportedSnapshot(restorePreparedLightingReference(exported, preparedAtlasUrl));
    assertExportedSnapshot(html, sceneData);
    window.__cssFlowerDebugSnapshot = {
      status: "ready",
      sceneUrl,
      sceneId: sceneData.id,
      html,
      stats,
      retainedLeafCount: retained.leaves.length,
      retainedRotationRootCount: 1,
      triangleIdCount: retained.triangleIds.size,
      seamBleed: CSSFLOWER_SEAM_BLEED,
      boundarySeamBleed: CSSFLOWER_BOUNDARY_SEAM_BLEED,
      boundaryAdjacentTriangleCount: sceneData.renderer.seamBleedBoundaryAdjacentTriangleCount,
      mergedCellCount: 0,
      lightingAtlasStateCount: sceneData.lighting.timelineRowCount,
      lightingAtlasDataUrlCount: (html.match(/data:image\/png;base64/gu) ?? []).length,
      preparedAtlasReferenceCount: (html.match(/\/cssflower\/assets\/lighting\/grid-[a-f0-9]{64}\.avif/gu) ?? []).length,
      scriptCount: (html.match(/<script\b/giu) ?? []).length,
      canvasCount: (html.match(/<canvas\b/giu) ?? []).length,
      svgCount: (html.match(/<svg\b/giu) ?? []).length,
    };
  } finally {
    scene.destroy?.();
  }
}

function validateScene(sceneData) {
  if (sceneData?.schema !== "cssflower-prepared-scene@1" ||
      sceneData.id !== "default-cube" ||
      sceneData.renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      sceneData.renderer?.stableDom !== true ||
      sceneData.renderer?.seamBleed !== CSSFLOWER_SEAM_BLEED ||
      sceneData.renderer?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData.renderer?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData.renderer?.seamBleedBoundaryVertexCount !== 240 ||
      sceneData.renderer?.seamBleedBoundaryAdjacentTriangleCount !== 432 ||
      sceneData.renderer?.merge !== false ||
      sceneData.metrics?.preparedLeafCount !== 1200 ||
      sceneData.metrics?.preparedRootCount !== 1 ||
      sceneData.metrics?.mergedCellCount !== 0 ||
      sceneData.meshes?.length !== 1 ||
      sceneData.meshes[0]?.polygons?.length !== 1200 ||
      sceneData.playback?.schema !== "cssflower-prepared-playback@1" ||
      sceneData.playback?.scope !== "rounded-product-cycle-positive-petals-omitted-negative-cube-lobe-retained" ||
      sceneData.playback?.cycle?.schema !== "cssflower-prepared-rounded-product-cycle@2" ||
      sceneData.playback?.cycle?.geometryStateCount !== 73 ||
      sceneData.playback?.cycle?.states?.length !== 360 ||
      sceneData.playback?.transformAsset?.triangleCount !== 1200 ||
      sceneData.playback?.transformAsset?.componentCount !== 16 ||
      sceneData.lighting?.schema !== CSSFLOWER_LIGHTING_SCHEMA ||
      sceneData.lighting?.physicalLayout !== CSSFLOWER_LIGHTING_LAYOUT ||
      sceneData.lighting?.rasterMode !== CSSFLOWER_LIGHTING_RASTER_MODE ||
      sceneData.lighting?.atlasWidth !== CSSFLOWER_LIGHTING_ATLAS_WIDTH ||
      sceneData.lighting?.atlasHeight !== CSSFLOWER_LIGHTING_ATLAS_HEIGHT ||
      sceneData.lighting?.gridColumns !== CSSFLOWER_LIGHTING_GRID_COLUMNS ||
      sceneData.lighting?.gridRows !== CSSFLOWER_LIGHTING_GRID_ROWS ||
      sceneData.lighting?.gridWidth !== CSSFLOWER_LIGHTING_GRID_WIDTH ||
      sceneData.lighting?.gridHeight !== CSSFLOWER_LIGHTING_GRID_HEIGHT ||
      sceneData.lighting?.faceCount !== 1200 ||
      sceneData.lighting?.timelineRowCount !== 360 ||
      sceneData.lighting?.pageRowCount !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData.lighting?.pageCount !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData.lighting?.pages?.length !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData.lighting?.leafSizing !== "raster" ||
      sceneData.lighting?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData.lighting?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData.lighting?.boundaryVertexCount !== 240 ||
      sceneData.lighting?.boundaryAdjacentTriangleCount !== 432 ||
      sceneData.lighting?.sharedEdgeIncidenceCount !== 3360 ||
      sceneData.lighting?.boundaryEdgeIncidenceCount !== 240 ||
      sceneData.lighting?.faces?.length !== 1200 ||
      sceneData.lighting.faces.filter((face) => face.boundaryAdjacent === true && face.seamBleed === CSSFLOWER_BOUNDARY_SEAM_BLEED).length !== 432 ||
      sceneData.lighting.faces.filter((face) => face.boundaryAdjacent === false && face.seamBleed === CSSFLOWER_SEAM_BLEED).length !== 768 ||
      sceneData.lighting?.backgroundPositionXs?.length !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData.lighting?.backgroundPositionYs?.length !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData.lighting?.runtimeLightingCalculations !== 0) {
    throw new Error("Prepared cssFlower default-cube scene contract is invalid");
  }
}

function createSnapshotScene(sceneData) {
  const camera = createSceneCamera(sceneData);
  const scene = createPolyScene(host, {
    camera,
    ambientLight: { color: "#ffffff", intensity: Math.PI },
    directionalLight: { direction: [0, -1, 1], color: "#ffffff", intensity: 0 },
    textureLighting: "baked",
    textureQuality: 1,
    textureLeafSizing: "raster",
    textureBackend: "atlas",
    textureProjection: "affine",
    seamBleed: CSSFLOWER_SEAM_BLEED,
    autoCenter: false,
  });
  const sourceMesh = sceneData.meshes[0];
  const mesh = scene.add({
    polygons: sourceMesh.polygons,
    objectUrls: [],
    warnings: [],
    dispose: () => undefined,
  }, {
    ...(sourceMesh.transform ?? {}),
    id: sourceMesh.id,
    merge: false,
    meshResolution: "lossless",
    stableDom: true,
    excludeFromAutoCenter: true,
  });
  return { scene, mesh };
}

function mountRetainedTargets({ scene, mesh, sceneData, initialTransforms, preparationLightingUrl }) {
  const sceneRoot = host.querySelector(".polycss-scene");
  if (!(sceneRoot instanceof HTMLElement) || !(mesh?.element instanceof HTMLElement)) {
    throw new Error("PolyCSS failed to mount the cssFlower scene and mesh roots");
  }
  const root = document.createElement("div");
  root.dataset.cssflowerRotationRoot = "true";
  Object.assign(root.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    transformOrigin: "0 0 0",
    transformStyle: "preserve-3d",
    transform: sceneData.playback.cycle.rootTransforms[0],
  });
  root.style.setProperty("--cssflower-space-texels", `url("${preparationLightingUrl}")`);
  sceneRoot.append(root);
  root.append(mesh.element);

  const leaves = [...mesh.element.querySelectorAll("[data-cssflower-leaf-index]")]
    .sort((left, right) => integerAttribute(left, "data-cssflower-leaf-index") - integerAttribute(right, "data-cssflower-leaf-index"));
  if (leaves.length !== 1200) {
    throw new Error(`Prepared cssFlower retained bank drifted (${leaves.length} leaves)`);
  }
  const triangleIds = new Set();
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    if (integerAttribute(leaf, "data-cssflower-leaf-index") !== index) {
      throw new Error(`Prepared cssFlower leaf order diverged at ${index}`);
    }
    const triangleId = leaf.getAttribute("data-cssflower-triangle");
    if (!triangleId || triangleIds.has(triangleId)) {
      throw new Error(`Prepared cssFlower triangle identity diverged at ${index}`);
    }
    triangleIds.add(triangleId);
    const face = sceneData.lighting.faces[index];
    if (face?.sourceOrder !== index || face.triangleId !== triangleId ||
        !Number.isSafeInteger(face.leafWidth) || face.tileWidth !== face.leafWidth ||
        !Number.isSafeInteger(face.leafHeight) || face.tileHeight !== face.leafHeight ||
        typeof face.backgroundPositionX !== "string" || typeof face.backgroundPositionY !== "string") {
      throw new Error(`Prepared cssFlower raster face binding diverged at ${index}`);
    }
    leaf.dataset.cssflowerRetainedLeaf = "true";
    leaf.dataset.cssflowerLightingField = String(index);
    leaf.dataset.cssflowerSeamBleed = String(face.seamBleed);
    leaf.dataset.cssflowerSeamEdgeMask = String(face.seamEdgeMask);
    leaf.dataset.polycssTextureBackend = "atlas";
    leaf.dataset.polycssTextureLeafSizing = "raster";
    leaf.dataset.polycssTextureImageRendering = "auto";
    leaf.dataset.polycssTextureLighting = "baked";
    leaf.dataset.polycssTextureProjection = "affine";
    leaf.dataset.polycssTextureLeafWidth = String(face.leafWidth);
    leaf.dataset.polycssTextureLeafHeight = String(face.leafHeight);
    if (!leaf.style.transform.startsWith("matrix3d(") ||
        typeof initialTransforms[index] !== "string" ||
        !initialTransforms[index].startsWith("matrix3d(")) {
      throw new Error(`Prepared cssFlower initial leaf transform ${index} is missing`);
    }
    leaf.style.transform = initialTransforms[index];
    leaf.style.backgroundImage = "var(--cssflower-space-texels)";
    leaf.style.backgroundColor = "transparent";
    leaf.style.backgroundRepeat = "no-repeat";
    leaf.style.width = `${face.leafWidth}px`;
    leaf.style.height = `${face.leafHeight}px`;
    leaf.style.setProperty("--polycss-atlas-width", `${face.leafWidth}px`);
    leaf.style.setProperty("--polycss-atlas-height", `${face.leafHeight}px`);
    leaf.style.setProperty("--polycss-atlas-leaf-sizing", "raster");
    leaf.style.backgroundPositionX = face.backgroundPositionX;
    leaf.style.backgroundPositionY = face.backgroundPositionY;
    leaf.style.backgroundSize = face.backgroundSize;
    leaf.style.imageRendering = "auto";
  }
  return { root, leaves, triangleIds };
}

function assertSnapshotStats(stats, retained, sceneData) {
  if (retained.leaves.length !== 1200 || retained.triangleIds.size !== 1200 ||
      host.querySelectorAll("[data-cssflower-rotation-root]").length !== 1 ||
      host.querySelectorAll(`[data-cssflower-seam-bleed="${CSSFLOWER_SEAM_BLEED_TEXT}"]`).length !== 768 ||
      host.querySelectorAll(`[data-cssflower-seam-bleed="${CSSFLOWER_BOUNDARY_SEAM_BLEED_TEXT}"]`).length !== 432 ||
      host.querySelectorAll('[data-polycss-texture-backend="atlas"][data-polycss-texture-leaf-sizing="raster"]').length !== 1200 ||
      host.querySelectorAll('[data-polycss-texture-image-rendering="auto"]').length !== 1200 ||
      stats.polygonCount !== sceneData.metrics.preparedLeafCount ||
      stats.mountedPolygonLeafCount !== sceneData.metrics.preparedLeafCount ||
      stats.surfaceLeafCounts.stableTriangle !== sceneData.metrics.preparedLeafCount ||
      stats.surfaceLeafCounts.quad !== 0) {
    throw new Error(`Prepared cssFlower PolyCSS leaf stats drifted: ${JSON.stringify(stats)}`);
  }
}

function assertExportedSnapshot(html, sceneData) {
  const count = (expression) => (html.match(expression) ?? []).length;
  const dataUrlCount = count(/data:image\/png;base64/gu);
  const preparedAtlasReferenceCount = count(/\/cssflower\/assets\/lighting\/grid-[a-f0-9]{64}\.avif/gu);
  if (!html.includes("polycss-scene") ||
      count(/<script\b/giu) !== 0 ||
      count(/<canvas\b/giu) !== 0 ||
      count(/<svg\b/giu) !== 0 ||
      count(/\sdata-[a-z0-9-]+=/giu) !== 0 ||
      count(/<u class="[a-zA-Z]{1,2}"><\/u>/gu) !== 1200 ||
      count(/\.polycss-mesh>u\.[a-zA-Z]{1,2} \{/gu) !== 1200 ||
      count(/--polycss-atlas-leaf-sizing: raster/gu) !== 1 ||
      count(/image-rendering: auto/gu) !== 1 ||
      !/<body><div class="polycss-camera"><div class="polycss-scene" aria-hidden="true"><div style="[^"]*"><div class="polycss-mesh"/u.test(html) ||
      dataUrlCount !== 0 ||
      preparedAtlasReferenceCount !== 1 ||
      html.length > 3_000_000 ||
      sceneData.renderer.merge !== false) {
    throw new Error(`Prepared cssFlower snapshot sanitization failed (${html.length} bytes, ${dataUrlCount} atlas data URLs, ${preparedAtlasReferenceCount} atlas references)`);
  }
}

function prepareExportedSnapshot(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const element of parsed.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith("data-")) element.removeAttribute(name);
    }
  }
  const stylesheet = parsed.querySelector("style");
  const camera = parsed.body.firstElementChild;
  const scene = camera?.firstElementChild;
  const root = scene?.firstElementChild;
  const mesh = root?.firstElementChild;
  const leaves = mesh ? [...mesh.children] : [];
  if (!(stylesheet instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || !(root instanceof HTMLElement) ||
      !(mesh instanceof HTMLElement) || leaves.length !== 1200) {
    throw new Error("Exported cssFlower direct hierarchy is missing before stylesheet preparation");
  }
  const rules = [];
  moveStylesToRule(camera, ".polycss-camera", rules);
  moveStylesToRule(scene, ".polycss-scene", rules);
  moveStylesToRule(root, ".polycss-scene>div", rules, new Set([
    "transform",
    "--cssflower-space-texels",
  ]));
  for (const leaf of leaves) leaf.style.removeProperty("transform");
  moveSharedStylesToRule(leaves, ".polycss-mesh>u", rules, [
    "background-image",
    "background-color",
    "background-repeat",
    "background-size",
    "--polycss-atlas-leaf-sizing",
    "image-rendering",
  ]);
  rules.push(".polycss-mesh>u { border: 0; box-sizing: border-box; border-top-left-radius: 50% 100%; border-top-right-radius: 50% 100%; corner-top-left-shape: bevel; corner-top-right-shape: bevel; }");
  for (let index = 0; index < leaves.length; index += 1) {
    const className = retainedLeafClassName(index);
    leaves[index].className = className;
    moveStylesToRule(leaves[index], `.polycss-mesh>u.${className}`, rules);
  }
  stylesheet.textContent += `\n${rules.join("\n")}\n`;
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function moveSharedStylesToRule(elements, selector, rules, propertyNames) {
  const declarations = [];
  for (const name of propertyNames) {
    const value = elements[0].style.getPropertyValue(name);
    const priority = elements[0].style.getPropertyPriority(name);
    if (!value || elements.some((element) =>
      element.style.getPropertyValue(name) !== value || element.style.getPropertyPriority(name) !== priority)) {
      throw new Error(`Exported cssFlower shared leaf style ${name} drifted`);
    }
    declarations.push(`${name}: ${value}${priority ? ` !${priority}` : ""};`);
    for (const element of elements) element.style.removeProperty(name);
  }
  rules.push(`${selector} { ${declarations.join(" ")} }`);
}

function retainedLeafClassName(index) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("cssFlower leaf class index is invalid");
  let value = index;
  let className = "";
  do {
    className = alphabet[value % alphabet.length] + className;
    value = Math.floor(value / alphabet.length) - 1;
  } while (value >= 0);
  return className;
}

function moveStylesToRule(element, selector, rules, retainedProperties = new Set()) {
  const names = [...element.style].filter((name) => !retainedProperties.has(name));
  if (names.length === 0) return;
  const declarations = names.map((name) => {
    const priority = element.style.getPropertyPriority(name);
    return `${name}: ${element.style.getPropertyValue(name)}${priority ? ` !${priority}` : ""};`;
  });
  rules.push(`${selector} { ${declarations.join(" ")} }`);
  for (const name of names) element.style.removeProperty(name);
  if (element.style.length === 0) element.removeAttribute("style");
}

function restorePreparedLightingReference(html, assetUrl) {
  const matches = html.match(/data:image\/(?:avif|png);base64,[a-zA-Z0-9+/=]+/gu) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected one exported prepared-lighting data URL, found ${matches.length}`);
  }
  return html.replace(matches[0], assetUrl);
}

function integerAttribute(element, name) {
  const value = Number(element.getAttribute(name));
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}

async function fetchVerifiedBytes(url, expectedSha256) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Prepared cssFlower asset request failed for ${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actualSha256 = await sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Prepared cssFlower asset identity mismatch for ${url}: ${actualSha256}`);
  }
  return bytes;
}

async function loadInitialPreparedTransforms(sceneData) {
  const block = sceneData.playback.transformAsset?.blocks?.[0];
  if (block?.startGeometryStateIndex !== 0 || block.geometryStateCount < 1 ||
      block.triangleCount !== 1_200 || block.transformCount < 1_200) {
    throw new Error("Prepared cssFlower initial transform block is missing");
  }
  const encoded = await fetchVerifiedBytes(block.assetUrl, block.sha256);
  if (encoded.byteLength !== block.byteLength) {
    throw new Error("Prepared cssFlower initial transform block length drifted");
  }
  const stream = new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip"));
  const decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  if (decoded.byteLength !== block.decodedByteLength || await sha256(decoded) !== block.decodedSha256) {
    throw new Error("Prepared cssFlower decoded initial transform block identity drifted");
  }
  const text = new TextDecoder().decode(decoded);
  const transforms = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
  if (transforms.length !== block.transformCount ||
      transforms.slice(0, 1_200).some((transform) => !/^matrix3d\([^)]+\)$/u.test(transform))) {
    throw new Error("Prepared cssFlower initial transform rows are invalid");
  }
  return Object.freeze(transforms.slice(0, 1_200));
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
}

function createSceneCamera(sceneData) {
  const camera = sceneData.camera;
  return createPolyPerspectiveCamera({
    perspective: camera.perspective,
    zoom: camera.zoom,
    rotX: camera.rotX,
    rotY: camera.rotY,
    target: camera.target,
    distance: camera.distance,
  });
}
