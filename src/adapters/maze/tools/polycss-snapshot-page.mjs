import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";

const host = document.getElementById("scene");
const query = new URLSearchParams(location.search);
const sceneUrl = query.get("sceneUrl");

main().catch((error) => {
  window.__cssMazeSnapshot = {
    status: "error",
    error: error.stack || error.message || String(error),
  };
});

async function main() {
  if (!sceneUrl?.startsWith("/cssmaze/scenes/")) {
    throw new Error("cssMaze snapshot page requires a generated sceneUrl");
  }
  const sceneData = await fetchJson(sceneUrl);
  const camera = createPolyPerspectiveCamera({
    perspective: sceneData.camera.perspective,
    zoom: sceneData.camera.zoom,
    rotX: sceneData.camera.rotX,
    rotY: sceneData.camera.rotY,
    target: sceneData.camera.target,
    distance: sceneData.camera.distance,
  });
  const scene = createPolyScene(host, {
    camera,
    ambientLight: sceneData.lighting.ambient,
    directionalLight: sceneData.lighting.directional,
    textureLighting: sceneData.textureLighting,
    textureQuality: sceneData.textureQuality,
    textureBackend: sceneData.renderer.textureBackend,
    textureLeafSizing: sceneData.renderer.textureLeafSizing,
    textureImageRendering: sceneData.renderer.textureImageRendering,
    textureProjection: sceneData.renderer.textureProjection,
    seamBleed: 0,
    autoCenter: false,
  });
  const handles = sceneData.meshes.map((mesh) => scene.add({
    polygons: mesh.polygons,
    objectUrls: [],
    warnings: [],
    dispose() {},
  }, {
    id: mesh.id,
    merge: false,
    meshResolution: "lossless",
    stableDom: true,
    excludeFromAutoCenter: true,
  }));
  if (handles.length !== 2) throw new Error("Prepared cssMaze snapshot requires two retained mesh roots");
  const handlesById = new Map(sceneData.meshes.map((mesh, index) => [mesh.id, handles[index]]));
  const wallHandle = handlesById.get("maze-walls");
  const surfaceHandle = handlesById.get("maze-surfaces");
  if (!wallHandle || !surfaceHandle) throw new Error("Prepared cssMaze snapshot mesh ids drifted");
  wallHandle.element.classList.add("cssmaze-walls");
  surfaceHandle.element.classList.add("cssmaze-surfaces");
  wallHandle.element.style.transformOrigin = "0 0 0";
  surfaceHandle.element.style.transformOrigin = "0 0 0";

  const sceneRoot = host.querySelector(".polycss-scene");
  if (!(sceneRoot instanceof HTMLElement)) throw new Error("PolyCSS scene root was not mounted");
  const worldRoot = document.createElement("div");
  worldRoot.className = "cssmaze-world";
  worldRoot.style.position = "absolute";
  worldRoot.style.transformStyle = "preserve-3d";
  worldRoot.style.transformOrigin = "0 0 0";
  if (sceneData.playback.preparedCompositorInterpolation !== true ||
      sceneData.playback.preparedCompositorTimingFunction !== "linear" ||
      !(sceneData.playback.preparedCompositorInterpolationMilliseconds > 0)) {
    throw new Error("cssMaze prepared camera smoothing contract drifted");
  }
  worldRoot.style.transitionProperty = "transform";
  worldRoot.style.transitionDuration = `${sceneData.playback.preparedCompositorInterpolationMilliseconds}ms`;
  worldRoot.style.transitionTimingFunction = sceneData.playback.preparedCompositorTimingFunction;
  worldRoot.style.transform = sceneData.playback.cameraTransforms[
    sceneData.playback.initial.cameraTransformIndex
  ];
  wallHandle.element.style.transform = sceneData.playback.wallTransforms[
    sceneData.playback.initial.wallTransformIndex
  ];
  worldRoot.append(...sceneData.meshes.map((mesh) => handlesById.get(mesh.id).element));
  sceneRoot.append(worldRoot);

  scene.applyCamera();
  applyUniformCameraScale(sceneRoot, sceneData.camera.preparedSceneScale);
  await scene.whenTexturesReady();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const stats = collectPolyRenderStats(host, sceneData.metrics.preparedLeafCount);
  const mountedLeaves = worldRoot.querySelectorAll("b, i, s, u").length;
  if (mountedLeaves !== sceneData.metrics.preparedLeafCount) {
    throw new Error(`Prepared cssMaze leaf census drifted: ${mountedLeaves}`);
  }
  const exported = await exportPolySceneSnapshot(host, {
    title: "cssMaze — prepared XScreenSaver Maze3D source slice",
  });
  const preparedSnapshot = prepareExportedSnapshot(exported, sceneData);
  const html = preparedSnapshot.html;
  if (!html.includes("cssmaze-world") || !html.includes("cssmaze-walls") ||
      !html.includes("cssmaze-surfaces") || /<script\b|<canvas\b|<svg\b/iu.test(html) ||
      /\sdata-[a-z0-9-]+=/iu.test(html) || /\/(?:Users|home)\//u.test(html)) {
    throw new Error("Prepared cssMaze snapshot failed retained-root sanitization");
  }
  window.__cssMazeSnapshot = {
    status: "ready",
    sceneUrl,
    html: `${html.trimEnd()}\n`,
    mountedLeaves,
    retainedWallTransforms: preparedSnapshot.retainedWallTransforms,
    retainedWallBackgroundPositions: preparedSnapshot.retainedWallBackgroundPositions,
    retainedSurfaceStyles: preparedSnapshot.retainedSurfaceStyles,
    stats,
  };
}

function prepareExportedSnapshot(html, sceneData) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style");
  const camera = parsed.querySelector(".polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const world = scene?.querySelector(":scope > .cssmaze-world");
  const surfaces = world?.querySelector(":scope > .cssmaze-surfaces");
  const walls = world?.querySelector(":scope > .cssmaze-walls");
  const surfaceLeaves = [...(surfaces?.children ?? [])];
  const wallLeaves = [...(walls?.children ?? [])];
  const leaves = [...surfaceLeaves, ...wallLeaves];
  if (!(stylesheet instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || !(world instanceof HTMLElement) ||
      !(surfaces instanceof HTMLElement) || !(walls instanceof HTMLElement) ||
      surfaceLeaves.length !== 2 || wallLeaves.length !== sceneData.metrics.sourceWallSegmentCount ||
      leaves.length !== sceneData.metrics.preparedLeafCount ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement) || leaf.localName !== "s")) {
    throw new Error("Exported cssMaze retained hierarchy is incomplete");
  }
  const retainedWallTransforms = wallLeaves.map((leaf) => leaf.style.transform);
  const retainedWallBackgroundPositions = wallLeaves.map((leaf) => leaf.style.backgroundPosition);
  const retainedSurfaceStyles = surfaceLeaves.map((leaf) => Object.freeze({
    transform: leaf.style.transform,
    backgroundPosition: leaf.style.backgroundPosition,
  }));
  if (retainedWallTransforms.some((transform) => !transform.startsWith("matrix3d(")) ||
      retainedWallBackgroundPositions.some((position) => !position) ||
      retainedSurfaceStyles.some(({ transform, backgroundPosition }) =>
        !transform.startsWith("matrix3d(") || !backgroundPosition)) {
    throw new Error("Exported cssMaze retained transition styles are incomplete");
  }

  const surfaceAtlas = uniformAttribute(surfaceLeaves, "data-polycss-snapshot-bg");
  const wallAtlas = uniformAttribute(wallLeaves, "data-polycss-snapshot-bg");
  if (!surfaceAtlas || !wallAtlas || surfaceAtlas === wallAtlas) {
    throw new Error("Exported cssMaze atlas groups are not structurally separable");
  }
  stylesheet.textContent = stylesheet.textContent
    .replaceAll(`[data-polycss-snapshot-bg="${surfaceAtlas}"]`, ".cssmaze-surfaces>s")
    .replaceAll(`[data-polycss-snapshot-bg="${wallAtlas}"]`, ".cssmaze-walls>s");
  if (stylesheet.textContent.includes("data-polycss-snapshot-bg")) {
    throw new Error("Exported cssMaze atlas selectors were not fully structuralized");
  }

  const rules = [];
  moveSharedStylesToRule(leaves, ".cssmaze-world s", rules, [
    "image-rendering",
    "background-repeat",
  ]);
  moveSharedStylesToRule(surfaceLeaves, ".cssmaze-surfaces>s", rules, [
    "width",
    "height",
    "background-size",
  ]);
  moveSharedStylesToRule(wallLeaves, ".cssmaze-walls>s", rules, [
    "width",
    "height",
    "background-size",
  ]);
  rules.push(
    ".cssmaze-world,.cssmaze-walls,.cssmaze-surfaces{position:absolute;transform-style:preserve-3d;transform-origin:0 0 0}",
    ".cssmaze-world s{-webkit-backface-visibility:visible;backface-visibility:visible}",
  );
  stylesheet.textContent += rules.join("");
  for (const element of [world, surfaces, walls]) {
    element.style.removeProperty("position");
    element.style.removeProperty("transform-style");
    element.style.removeProperty("transform-origin");
  }
  stripPreparedDomMetadata(parsed.documentElement);
  for (const element of parsed.querySelectorAll("[style]")) {
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  return Object.freeze({
    html: `<!doctype html>${parsed.documentElement.outerHTML}\n`,
    retainedWallTransforms: Object.freeze(retainedWallTransforms),
    retainedWallBackgroundPositions: Object.freeze(retainedWallBackgroundPositions),
    retainedSurfaceStyles: Object.freeze(retainedSurfaceStyles),
  });
}

function uniformAttribute(elements, name) {
  const value = elements[0]?.getAttribute(name);
  if (!value || elements.some((element) => element.getAttribute(name) !== value)) return null;
  return value;
}

function moveSharedStylesToRule(elements, selector, rules, propertyNames) {
  const declarations = [];
  for (const name of propertyNames) {
    const value = elements[0]?.style.getPropertyValue(name);
    const priority = elements[0]?.style.getPropertyPriority(name);
    if (!value || elements.some((element) =>
      element.style.getPropertyValue(name) !== value ||
      element.style.getPropertyPriority(name) !== priority)) {
      throw new Error(`Exported cssMaze shared style ${name} drifted for ${selector}`);
    }
    declarations.push(`${name}:${value}${priority ? ` !${priority}` : ""}`);
    for (const element of elements) element.style.removeProperty(name);
  }
  rules.push(`${selector}{${declarations.join(";")}}`);
}

function stripPreparedDomMetadata(root) {
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
    }
  }
}

function applyUniformCameraScale(sceneRoot, expectedScale) {
  const match = /^scale\(([^)]+)\)(.*)$/u.exec(sceneRoot.style.transform);
  const appliedScale = Number(match?.[1]);
  if (!Number.isFinite(expectedScale) || !match || Math.abs(appliedScale - expectedScale) > 0.000001) {
    throw new Error(`PolyCSS camera scale drifted: ${sceneRoot.style.transform}`);
  }
  sceneRoot.style.transform = `scale3d(${expectedScale}, ${expectedScale}, ${expectedScale})${match[2]}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}
