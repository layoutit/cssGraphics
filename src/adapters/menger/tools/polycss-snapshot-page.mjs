import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";

const host = document.getElementById("scene");
const sceneUrl = new URLSearchParams(location.search).get("sceneUrl");

main().catch((error) => {
  window.__cssMengerDebugSnapshot = { status: "error", error: error.stack || error.message || String(error) };
});

async function main() {
  if (!sceneUrl?.startsWith("/cssmenger/scenes/")) throw new Error("cssMenger snapshot page requires a generated sceneUrl");
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
    textureLighting: "baked",
    textureQuality: 1,
    autoCenter: false,
    strategies: { disable: ["u"] },
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
  if (handles.length !== 3) throw new Error("Prepared cssMenger snapshot requires three axis roots");
  const sceneRoot = host.querySelector(".polycss-scene");
  if (!(sceneRoot instanceof HTMLElement)) throw new Error("PolyCSS scene root was not mounted");
  const modelRoot = document.createElement("div");
  modelRoot.className = "cssmenger-model";
  modelRoot.style.position = "absolute";
  modelRoot.style.transformStyle = "preserve-3d";
  modelRoot.style.transformOrigin = "0 0 0";
  modelRoot.style.transform = sceneData.playback.transforms[sceneData.playback.initial.stateIndex];
  const initialColors = sceneData.playback.colorRows[sceneData.playback.initial.stateIndex];
  await preloadPreparedPlaneAtlas(sceneData.planeAtlas);
  modelRoot.style.setProperty("--a", `url("${sceneData.planeAtlas.assetUrl}")`);
  for (let axis = 0; axis < handles.length; axis += 1) {
    const root = handles[axis].element;
    root.className = `cssmenger-axis cssmenger-axis-${"xyz"[axis]}`;
    root.style.setProperty("--axis-atlas-y", sceneData.planeAtlas.paletteBackgroundPositionYs[initialColors[axis]]);
    root.style.transformOrigin = "0 0 0";
    modelRoot.append(root);
  }
  sceneRoot.append(modelRoot);
  applyPreparedPlaneAtlas(modelRoot, sceneData.planeAtlas);
  scene.applyCamera();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const mountedLeaves = modelRoot.querySelectorAll("b, i, s, u").length;
  if (mountedLeaves !== sceneData.metrics.preparedLeafCount) {
    throw new Error(`Prepared cssMenger leaf census drifted: ${mountedLeaves}`);
  }
  const stats = collectPolyRenderStats(host, sceneData.metrics.preparedLeafCount);
  const exported = await exportPolySceneSnapshot(host, {
    title: "cssMenger — prepared XScreenSaver depth-3 sponge",
  });
  const html = sanitizeSnapshot(exported, sceneData.planeAtlas);
  if (!html.includes("cssmenger-model") || !html.includes("cssmenger-axis-x") ||
      /<script\b|<canvas\b|<svg\b/iu.test(html) || /\/(?:Users|home)\//u.test(html)) {
    throw new Error("Prepared cssMenger snapshot failed retained-root sanitization");
  }
  window.__cssMengerDebugSnapshot = { status: "ready", sceneUrl, html, mountedLeaves, stats };
}

function sanitizeSnapshot(html, planeAtlas) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style");
  const model = parsed.querySelector(".cssmenger-model");
  const axes = ["x", "y", "z"].map((axis) => parsed.querySelector(`.cssmenger-axis-${axis}`));
  if (!(stylesheet instanceof HTMLStyleElement) || !(model instanceof HTMLElement) ||
      axes.some((axis) => !(axis instanceof HTMLElement))) {
    throw new Error("Exported cssMenger retained graph is incomplete");
  }
  stylesheet.textContent +=
    `.cssmenger-model,.cssmenger-axis{position:absolute;transform-style:preserve-3d;transform-origin:0 0 0}` +
    `.cssmenger-model{--a:url("${planeAtlas.assetUrl}")}` +
    `.cssmenger-axis>b,.cssmenger-axis>i,.cssmenger-axis>s,.cssmenger-axis>u{` +
    `width:${planeAtlas.tileWidth}px;height:${planeAtlas.tileHeight}px;color:transparent!important;` +
    `background-color:transparent!important;background-image:var(--a)!important;background-repeat:no-repeat!important;` +
    `background-position-y:var(--axis-atlas-y)!important;background-size:${planeAtlas.backgroundSize}!important;` +
    `image-rendering:pixelated;backface-visibility:hidden!important}`;
  model.style.removeProperty("--a");
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
    }
  }
  for (const element of parsed.querySelectorAll("script, canvas, svg")) element.remove();
  return `<!doctype html>${parsed.documentElement.outerHTML}\n`;
}

function applyPreparedPlaneAtlas(modelRoot, atlas) {
  if (atlas?.schema !== "cssmenger-prepared-coplanar-plane-atlas@1" ||
      atlas.leafCount !== atlas.leafPatternIndices?.length ||
      atlas.patternCount !== atlas.patternRows?.length ||
      atlas.paletteStateCount !== atlas.paletteBackgroundPositionYs?.length) {
    throw new Error("Prepared cssMenger plane atlas contract is invalid");
  }
  const leaves = [...modelRoot.querySelectorAll("[data-cssmenger-plane-leaf]")];
  if (leaves.length !== atlas.leafCount) throw new Error("Prepared cssMenger plane atlas leaf census drifted");
  for (const leaf of leaves) {
    const leafIndex = Number(leaf.getAttribute("data-cssmenger-plane-leaf"));
    const patternIndex = atlas.leafPatternIndices[leafIndex];
    const row = atlas.patternRows[patternIndex];
    if (!Number.isSafeInteger(leafIndex) || !Array.isArray(row) || row.length !== 4) {
      throw new Error(`Prepared cssMenger plane atlas leaf ${leafIndex} is invalid`);
    }
    const computed = getComputedStyle(leaf);
    const sourceWidth = Number.parseFloat(computed.width);
    const sourceHeight = Number.parseFloat(computed.height);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new Error(`Prepared cssMenger plane atlas leaf ${leafIndex} has no source extent`);
    }
    leaf.style.transform = resizeMatrix3d(
      leaf.style.transform,
      sourceWidth / row[2],
      sourceHeight / row[3],
    );
    leaf.style.width = `${row[2]}px`;
    leaf.style.height = `${row[3]}px`;
    leaf.style.color = "transparent";
    leaf.style.backgroundColor = "transparent";
    leaf.style.backgroundImage = "var(--a)";
    leaf.style.backgroundRepeat = "no-repeat";
    leaf.style.backgroundPositionX = `${-row[0]}px`;
    leaf.style.backgroundPositionY = "var(--axis-atlas-y)";
    leaf.style.backgroundSize = atlas.backgroundSize;
    leaf.style.imageRendering = "pixelated";
  }
}

async function preloadPreparedPlaneAtlas(atlas) {
  if (atlas?.schema !== "cssmenger-prepared-coplanar-plane-atlas@1" || typeof atlas.assetUrl !== "string") {
    throw new Error("Prepared cssMenger plane atlas is missing");
  }
  const image = new Image();
  image.decoding = "async";
  image.src = atlas.assetUrl;
  await image.decode();
  if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) {
    throw new Error(`Prepared cssMenger plane atlas dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`);
  }
}

function resizeMatrix3d(transform, scaleX, scaleY) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) throw new Error(`Prepared cssMenger leaf transform is not matrix3d: ${transform}`);
  const values = match[1].split(",").map((value) => Number(value.trim()));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Prepared cssMenger leaf matrix is invalid");
  }
  for (let index = 0; index < 4; index += 1) values[index] *= scaleX;
  for (let index = 4; index < 8; index += 1) values[index] *= scaleY;
  return `matrix3d(${values.map(number).join(", ")})`;
}

function number(value) {
  if (Object.is(value, -0) || value === 0) return "0";
  return Number(value.toFixed(9)).toString();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json();
}
