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
    textureQuality: sceneData.textureQuality,
    textureLeafSizing: sceneData.textureLeafSizing,
    textureBackend: sceneData.renderer.textureBackend,
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
    title: `cssMenger — prepared XScreenSaver depth-${sceneData.sourceProfile.depth} sponge`,
  });
  const sanitized = sanitizeSnapshot(exported, sceneData);
  const html = sanitized.html;
  if ((html.match(/<b\b/gu) ?? []).length !== sceneData.metrics.preparedLeafCount ||
      /<i\b|<s\b/iu.test(html) ||
      /cssmenger-(?:model|axis)|<script\b|<canvas\b|<svg\b/iu.test(html) ||
      /\/(?:Users|home)\//u.test(html)) {
    throw new Error("Prepared cssMenger snapshot failed retained-root sanitization");
  }
  window.__cssMengerDebugSnapshot = {
    status: "ready",
    sceneUrl,
    html,
    frontFacingSchedule: sanitized.frontFacingSchedule,
    mountedLeaves,
    stats,
  };
}

function sanitizeSnapshot(html, sceneData) {
  const planeAtlas = sceneData.planeAtlas;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style");
  const camera = parsed.querySelector(".polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const model = parsed.querySelector(".cssmenger-model");
  const axes = ["x", "y", "z"].map((axis) => parsed.querySelector(`.cssmenger-axis-${axis}`));
  if (!(stylesheet instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || !(model instanceof HTMLElement) ||
      axes.some((axis) => !(axis instanceof HTMLElement))) {
    throw new Error("Exported cssMenger retained graph is incomplete");
  }
  const perspective = camera.style.perspective;
  const viewTransform = scene.style.transform;
  const modelTransform = model.style.transform;
  if (!perspective || !viewTransform || !modelTransform) {
    throw new Error("Exported cssMenger transform graph is incomplete");
  }
  camera.removeAttribute("style");
  const view = preparedViewLonghands(viewTransform);
  scene.style.transform = modelTransform;
  const fragment = parsed.createDocumentFragment();
  const flattenedLeaves = [];
  const axisLeafCounts = [];
  for (let axis = 0; axis < axes.length; axis += 1) {
    const axisRoot = axes[axis];
    const axisLeaves = [...axisRoot.querySelectorAll(":scope > b")];
    axisLeafCounts.push(axisLeaves.length);
    for (const leaf of axisLeaves) {
      const flattened = parsed.createElement("b");
      flattened.style.transform = leaf.style.transform;
      if (!flattened.style.transform) {
        throw new Error("Exported cssMenger leaf is missing prepared placement");
      }
      fragment.append(flattened);
      flattenedLeaves.push(flattened);
    }
  }
  model.remove();
  scene.append(fragment);
  const frontFacingSchedule = prepareFrontFacingSchedule({
    playback: sceneData.playback,
    perspective,
    planeAtlas,
    view,
    leaves: flattenedLeaves,
    axisLeafCounts,
  });
  stylesheet.textContent +=
    `.polycss-camera{perspective:${perspective}}` +
    `.polycss-scene{translate:${view.translate};scale:${view.scale}}`;
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
    }
  }
  for (const element of parsed.querySelectorAll("script, canvas, svg")) element.remove();
  return Object.freeze({
    html: `<!doctype html>${parsed.documentElement.outerHTML}\n`,
    frontFacingSchedule,
  });
}

function preparedViewLonghands(viewTransform) {
  const match = /^translateZ\((-?\d+(?:\.\d+)?px)\) scale\((-?\d+(?:\.\d+)?)\) rotateX\(0deg\) rotate\(0deg\) translate3d\(0px, 0px, 0px\)$/u.exec(viewTransform);
  if (!match) throw new Error(`Exported cssMenger view transform cannot use direct prepared publication: ${viewTransform}`);
  return Object.freeze({
    translate: `0px 0px ${match[1]}`,
    scale: match[2],
    translateZ: Number.parseFloat(match[1]),
    scaleNumber: Number(match[2]),
  });
}

function prepareFrontFacingSchedule({ playback, perspective, planeAtlas, view, leaves, axisLeafCounts }) {
  if (leaves.length !== planeAtlas.leafCount ||
      !Array.isArray(axisLeafCounts) || axisLeafCounts.length !== 3 ||
      axisLeafCounts.some((count) => !Number.isSafeInteger(count) || count < 1) ||
      axisLeafCounts.reduce((sum, count) => sum + count, 0) !== leaves.length ||
      playback.transforms?.length !== playback.stateCount) {
    throw new Error("Prepared cssMenger front-facing schedule inputs are incomplete");
  }
  const perspectivePixels = Number.parseFloat(perspective);
  if (!(perspectivePixels > 0) || !Number.isFinite(view.translateZ) || !(view.scaleNumber > 0)) {
    throw new Error("Prepared cssMenger projection cannot produce a front-facing schedule");
  }
  const localCorners = leaves.map((leaf) => {
    const leafMatrix = new DOMMatrix(leaf.style.transform);
    return [[0, 0], [planeAtlas.tileWidth, 0], [planeAtlas.tileWidth, planeAtlas.tileHeight], [0, planeAtlas.tileHeight]]
      .map(([x, y]) => leafMatrix.transformPoint(new DOMPoint(x, y, 0, 1)));
  });
  const visibleByState = [];
  for (let stateIndex = 0; stateIndex < playback.stateCount; stateIndex += 1) {
    const modelMatrix = new DOMMatrix(playback.transforms[stateIndex]);
    const visible = new Uint8Array(leaves.length);
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
      const projected = localCorners[leafIndex].map((corner) => {
        const point = modelMatrix.transformPoint(corner);
        const z = point.z * view.scaleNumber + view.translateZ;
        const perspectiveScale = 1 - z / perspectivePixels;
        return [point.x * view.scaleNumber / perspectiveScale, point.y * view.scaleNumber / perspectiveScale];
      });
      visible[leafIndex] = signedQuadArea(projected) > 0 ? 1 : 0;
    }
    visibleByState.push(visible);
  }
  const leafIndices = [];
  const offsets = [0];
  const selectedLeafCounts = [];
  const axisOffsets = axisLeafCounts.map((count, axis) =>
    axisLeafCounts.slice(0, axis).reduce((sum, value) => sum + value, 0));
  for (let stateIndex = 0; stateIndex < playback.stateCount; stateIndex += 1) {
    const stateStart = leafIndices.length;
    const previous = visibleByState[Math.max(0, stateIndex - 1)];
    const current = visibleByState[stateIndex];
    const next = visibleByState[Math.min(playback.stateCount - 1, stateIndex + 1)];
    for (let axis = 0; axis < 3; axis += 1) {
      const axisStart = axisOffsets[axis];
      for (let leafIndex = axisStart; leafIndex < axisStart + axisLeafCounts[axis]; leafIndex += 1) {
        if (previous[leafIndex] || current[leafIndex] || next[leafIndex]) leafIndices.push(leafIndex);
      }
      offsets.push(leafIndices.length);
    }
    selectedLeafCounts.push(leafIndices.length - stateStart);
  }
  return Object.freeze({
    schema: "cssmenger-prepared-front-facing-leaf-schedule@1",
    encoding: "state-axis-offsets-plus-global-leaf-indices",
    stateCount: playback.stateCount,
    axisCount: 3,
    offsets: Object.freeze(offsets),
    leafIndices: Object.freeze(leafIndices),
    minimumSelectedLeafCountPerState: Math.min(...selectedLeafCounts),
    maximumSelectedLeafCountPerState: Math.max(...selectedLeafCounts),
    averageSelectedLeafCountPerState: selectedLeafCounts.reduce((sum, count) => sum + count, 0) /
      selectedLeafCounts.length,
    frontFaceDilationTicks: 1,
    runtimeProjectionCalculation: false,
    runtimeNormalCalculation: false,
  });
}

function signedQuadArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    twiceArea += points[index][0] * points[next][1] - points[next][0] * points[index][1];
  }
  return twiceArea;
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
