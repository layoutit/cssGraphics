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
  const html = await exportPolySceneSnapshot(host, {
    title: "cssMaze — prepared XScreenSaver Maze3D source slice",
  });
  if (!html.includes("cssmaze-world") || !html.includes("cssmaze-walls") ||
      !html.includes("cssmaze-surfaces") || /<script\b|<canvas\b|<svg\b/iu.test(html) ||
      /\/(?:Users|home)\//u.test(html)) {
    throw new Error("Prepared cssMaze snapshot failed retained-root sanitization");
  }
  window.__cssMazeSnapshot = {
    status: "ready",
    sceneUrl,
    html: `${html.trimEnd()}\n`,
    mountedLeaves,
    stats,
  };
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
