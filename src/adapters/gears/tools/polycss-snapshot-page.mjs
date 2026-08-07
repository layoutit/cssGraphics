import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";

const host = document.getElementById("scene");
const query = new URLSearchParams(location.search);
const sceneUrl = query.get("sceneUrl");
const sourceSceneUrl = query.get("sourceSceneUrl") || sceneUrl;

main().catch((error) => {
  window.__cssGearsSnapshot = {
    status: "error",
    error: error.stack || error.message || String(error),
  };
});

async function main() {
  if (!sceneUrl?.startsWith("/cssgears/scenes/")) {
    throw new Error("cssGears snapshot page requires a generated sceneUrl");
  }
  if (sourceSceneUrl !== sceneUrl && !sourceSceneUrl?.startsWith("/@fs/")) {
    throw new Error("cssGears snapshot page rejected its private prepared scene input");
  }
  const sceneData = await fetchJson(sourceSceneUrl);
  await preloadPreparedLighting(sceneData.lighting);
  const camera = createSceneCamera(sceneData);
  const scene = createPolyScene(host, {
    camera,
    ambientLight: sceneData.lighting.ambient,
    directionalLight: sceneData.lighting.directional,
    textureLighting: "baked",
    textureQuality: 1,
    textureBackend: "atlas",
    textureProjection: "affine",
    seamBleed: 0,
    autoCenter: false,
  });
  const foldedTransforms = foldAssemblyTransforms(
    sceneData.playback.initial.assemblyTransform,
    sceneData.playback.transforms,
  );
  const foldedShowreelTransforms = sceneData.showreel.transforms.map(
    (transform) => resolvedTransformMatrix(transform).toString(),
  );
  const handles = sceneData.meshes.map((mesh) => {
    const handle = scene.add({
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
    });
    handle.element.className = "g";
    handle.element.setAttribute("data-cssgears-gear-index", String(mesh.gearIndex));
    handle.element.setAttribute("data-cssgears-gear-id", String(mesh.sourceGear.id));
    handle.element.style.transform = foldedTransforms[sceneData.playback.initial.shapeTransformIndices[mesh.gearIndex]];
    const leaves = [...handle.element.querySelectorAll("b, i, s, u")];
    if (leaves.length !== mesh.polygons.length) {
      throw new Error(`Prepared gear ${mesh.sourceGear.id} leaf census drifted`);
    }
    for (const leaf of leaves) leaf.style.backfaceVisibility = "visible";
    return handle;
  });
  const sceneRoot = host.querySelector(".polycss-scene");
  if (!(sceneRoot instanceof HTMLElement)) throw new Error("PolyCSS scene root was not mounted");
  sceneRoot.append(...handles.map((handle) => handle.element));
  applyPreparedLighting(sceneRoot, sceneData.lighting);
  scene.applyCamera();
  await scene.whenTexturesReady();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const stats = collectPolyRenderStats(host, sceneData.metrics.preparedLeafCount);
  const mountedLeaves = sceneRoot.querySelectorAll("[data-cssgears-leaf]").length;
  if (mountedLeaves !== sceneData.metrics.preparedLeafCount ||
      sceneRoot.children.length !== sceneData.metrics.preparedGearRootCount) {
    throw new Error("Prepared cssGears retained graph drifted");
  }
  const exportedHtml = await exportPolySceneSnapshot(host, {
    title: "cssGears — prepared XScreenSaver involute assembly",
  });
  const html = prepareExportedSnapshot(exportedHtml, sceneData.lighting);
  const snapshotChecks = {
    retainedRoot: html.includes('class="polycss-scene"') && html.includes('class="g"'),
    lightingBinding: html.includes("--a:") && html.includes(sceneData.lighting.assetUrl),
    dataUrl: html.includes("data:image/"),
    metadata: /\sdata-[\w-]+=/iu.test(html),
    forbiddenElement: /<script\b|<canvas\b|<svg\b/i.test(html),
    localPath: /\/(?:Users|home)\//.test(html),
  };
  if (!snapshotChecks.retainedRoot || !snapshotChecks.lightingBinding || snapshotChecks.metadata ||
      snapshotChecks.dataUrl || snapshotChecks.forbiddenElement || snapshotChecks.localPath) {
    throw new Error(`Prepared PolyCSS snapshot failed retained-root sanitization: ${JSON.stringify(snapshotChecks)}`);
  }
  window.__cssGearsSnapshot = {
    status: "ready",
    sceneUrl,
    html: `${html.trimEnd()}\n`,
    mountedLeaves,
    gearRootCount: handles.length,
    stats,
    foldedTransforms,
    foldedShowreelTransforms,
  };
}

function foldAssemblyTransforms(assemblyTransform, transforms) {
  const assembly = resolvedTransformMatrix(assemblyTransform);
  return transforms.map((transform) => assembly.multiply(resolvedTransformMatrix(transform)).toString());
}

function resolvedTransformMatrix(transform) {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.transformOrigin = "0 0 0";
  probe.style.transform = transform;
  document.body.append(probe);
  const matrix = new DOMMatrix(getComputedStyle(probe).transform);
  probe.remove();
  return matrix;
}

function prepareExportedSnapshot(html, lighting) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style");
  const camera = parsed.querySelector(".polycss-camera");
  const root = parsed.querySelector(".polycss-scene");
  const gearRoots = [...(root?.querySelectorAll(":scope > [data-cssgears-gear-index]") ?? [])];
  const leaves = [...parsed.querySelectorAll("[data-cssgears-leaf]")];
  if (!(stylesheet instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(root instanceof HTMLElement) || gearRoots.length !== 3 || leaves.length !== lighting.leafCount ||
      leaves.some((leaf) => leaf.localName !== "b")) {
    throw new Error("Exported cssGears lighting hierarchy is incomplete");
  }
  const perspective = camera.style.perspective;
  const sceneTransform = root.style.transform;
  if (!perspective || !sceneTransform) throw new Error("Exported cssGears camera transform is incomplete");
  stylesheet.textContent = `html,body{width:100%;height:100%;margin:0}` +
    `body{position:relative;overflow:hidden}` +
    `.polycss-camera{position:relative;display:block;width:100%;height:100%;perspective:${perspective}}` +
    `.polycss-scene,.polycss-scene *{box-sizing:border-box}` +
    `.polycss-scene{position:absolute;top:50%;left:50%;width:0;height:0;transform-style:preserve-3d;` +
    `transform:${sceneTransform};--a:url("${lighting.assetUrl}")}` +
    `.g{position:absolute;transform-style:preserve-3d}` +
    `.g b{position:absolute;display:block;transform-origin:0 0;transform-style:preserve-3d;margin:0;padding:0;` +
    `line-height:0;width:${lighting.sourceTileWidth}px;height:${lighting.sourceTileHeight}px;color:transparent;` +
    `background-color:transparent;background-image:var(--a);background-repeat:no-repeat;` +
    `background-position-y:0;background-size:${lighting.backgroundSize};` +
    `image-rendering:auto;backface-visibility:hidden}`;
  camera.style.removeProperty("perspective");
  root.style.removeProperty("transform");
  root.style.removeProperty("--a");
  for (const gearRoot of gearRoots) gearRoot.className = "g";
  const sharedProperties = [
    "color",
    "background-color",
    "background-image",
    "background-repeat",
    "background-size",
    "image-rendering",
    "backface-visibility",
  ];
  for (const leaf of leaves) {
    for (const property of sharedProperties) leaf.style.removeProperty(property);
    if (leaf.style.width === `${lighting.sourceTileWidth}px`) leaf.style.removeProperty("width");
    if (leaf.style.height === `${lighting.sourceTileHeight}px`) leaf.style.removeProperty("height");
    if (leaf.style.backgroundPositionY === "0px") leaf.style.removeProperty("background-position-y");
  }
  stripPreparedDomMetadata(parsed.documentElement);
  for (const element of parsed.querySelectorAll("[style]")) {
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  return `<!doctype html>${parsed.documentElement.outerHTML}\n`;
}

function applyPreparedLighting(sceneRoot, lighting) {
  if (lighting?.schema !== "cssgears-prepared-opengl-static-render-atlas@1" ||
      !Number.isSafeInteger(lighting.faceCount) || lighting.faceCount < 1 ||
      lighting.sourceFaceCount !== lighting.faceCount ||
      lighting.leafCount !== lighting.leafRows?.length || lighting.atlasStateCount !== 1 ||
      lighting.sourceStateCount !== 720 || lighting.canonicalSourceStateIndex !== 0 ||
      lighting.animatedFaceCount !== 0 || lighting.staticFaceCount !== lighting.faceCount ||
      lighting.animatedFaceIndices?.length !== 0 ||
      lighting.sourceTileWidth !== 2 || lighting.sourceTileHeight !== 2 ||
      lighting.sourceFaceCoverageCount !== lighting.faceCount ||
      lighting.sourceFaceCoverageExact !== true ||
      typeof lighting.assetUrl !== "string" || typeof lighting.backgroundSize !== "string") {
    throw new Error("Complete prepared cssGears lighting atlas is required");
  }
  sceneRoot.style.setProperty("--a", `url("${lighting.assetUrl}")`);
  const leaves = [...sceneRoot.querySelectorAll("[data-cssgears-leaf]")];
  if (leaves.length !== lighting.leafCount) throw new Error("Prepared cssGears lighting leaf census drifted");
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
    const leaf = leaves[leafIndex];
    const sourceLeafIndex = Number(leaf.getAttribute("data-cssgears-leaf"));
    const row = lighting.leafRows[leafIndex];
    if (sourceLeafIndex !== leafIndex || !Array.isArray(row) || row.length !== 4 ||
        row.some((value) => !Number.isSafeInteger(value) || value < 0) || row[2] < 1 || row[3] < 1) {
      throw new Error(`Prepared cssGears lighting leaf ${leafIndex} is invalid`);
    }
    const computed = getComputedStyle(leaf);
    const sourceWidth = Number.parseFloat(computed.width);
    const sourceHeight = Number.parseFloat(computed.height);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new Error(`Prepared cssGears lighting leaf ${leafIndex} has no source leaf extent`);
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
    leaf.style.backgroundPositionY = `${-row[1]}px`;
    leaf.style.backgroundSize = lighting.backgroundSize;
    leaf.style.imageRendering = "auto";
    leaf.setAttribute("data-polycss-texture-backend", "atlas");
    leaf.setAttribute("data-polycss-texture-ready", "true");
    leaf.setAttribute("data-polycss-texture-image-rendering", "auto");
    leaf.setAttribute("data-polycss-texture-leaf-sizing", "raster");
    leaf.setAttribute("data-polycss-texture-projection", "affine");
    leaf.setAttribute("data-polycss-texture-lighting", "baked");
    leaf.setAttribute("data-polycss-texture-leaf-width", String(row[2]));
    leaf.setAttribute("data-polycss-texture-leaf-height", String(row[3]));
  }
}

function stripPreparedDomMetadata(root) {
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
    }
  }
}

function resizeMatrix3d(transform, scaleX, scaleY) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) throw new Error(`Prepared cssGears leaf transform is not matrix3d: ${transform}`);
  const values = match[1].split(",").map((value) => Number(value.trim()));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Prepared cssGears leaf matrix is invalid");
  }
  for (let index = 0; index < 4; index += 1) values[index] *= scaleX;
  for (let index = 4; index < 8; index += 1) values[index] *= scaleY;
  return `matrix3d(${values.map(number).join(", ")})`;
}

async function preloadPreparedLighting(lighting) {
  if (lighting?.schema !== "cssgears-prepared-opengl-static-render-atlas@1" ||
      typeof lighting.assetUrl !== "string") {
    throw new Error("Prepared cssGears lighting contract is missing");
  }
  const image = new Image();
  image.decoding = "async";
  image.src = lighting.assetUrl;
  await image.decode();
  if (image.naturalWidth !== lighting.width || image.naturalHeight !== lighting.height) {
    throw new Error(`Prepared cssGears lighting dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`);
  }
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
