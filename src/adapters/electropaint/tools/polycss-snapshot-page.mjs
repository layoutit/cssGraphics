// SPDX-License-Identifier: GPL-2.0-only
import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";

const host = document.getElementById("scene");
const sceneUrl = new URLSearchParams(location.search).get("sceneUrl");

main().catch((error) => {
  window.__cssselectropaintSnapshot = {
    status: "error",
    error: error.stack || error.message || String(error),
  };
});

async function main() {
  if (!/^\/cssselectropaint\/variants\/[a-z0-9-]+\/source-scene\.json$/u.test(sceneUrl ?? "")) {
    throw new Error("ElectroPaint snapshot page requires its generated source scene");
  }
  const response = await fetch(sceneUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${sceneUrl}: ${response.status}`);
  const sceneData = await response.json();
  if (sceneData?.schema !== "cssselectropaint-prepared-scene@2" ||
      sceneData.meshes?.length !== 40 || sceneData.playback?.schema !== "cssselectropaint-prepared-playback@4" ||
      sceneData.playback?.initial?.leafTransforms?.length !== 40 ||
      sceneData.playback?.initial?.colorIndices?.length !== 40) {
    throw new Error("Prepared ElectroPaint source scene is invalid");
  }

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
    autoCenter: false,
    strategies: { disable: ["i", "s", "u"] },
  });
  const initialTransforms = sceneData.playback.initial.leafTransforms;
  const initialColors = sceneData.playback.initial.colorIndices;
  const handles = sceneData.meshes.map((mesh, index) => {
    const handle = scene.add({ polygons: mesh.polygons, objectUrls: [], warnings: [], dispose() {} }, {
      id: mesh.id,
      merge: false,
      meshResolution: "lossless",
      stableDom: true,
      excludeFromAutoCenter: true,
    });
    handle.element.className = "polycss-mesh e";
    handle.element.style.transform = initialTransforms[index];
    const leaves = [...handle.element.querySelectorAll("b, i, s, u")];
    if (leaves.length !== 1 || leaves[0].localName !== "b") {
      throw new Error(`Prepared ElectroPaint square ${index} did not produce one retained quad`);
    }
    const color = sceneData.playback.palette[initialColors[index]];
    leaves[0].style.backgroundColor = color.fill;
    leaves[0].style.outlineColor = color.outline;
    leaves[0].style.outlineStyle = "solid";
    return handle;
  });
  const sceneRoot = host.querySelector(".polycss-scene");
  if (!(sceneRoot instanceof HTMLElement)) throw new Error("PolyCSS scene root was not mounted");
  sceneRoot.append(...handles.map((handle) => handle.element));
  scene.applyCamera();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const stats = collectPolyRenderStats(host, 40);
  if (stats.mountedPolygonLeafCount !== 40 || sceneRoot.children.length !== 40) {
    throw new Error("Prepared ElectroPaint retained graph census drifted");
  }
  const flattenedQuadBox = measureFlattenedQuadBox(handles.map((handle) =>
    handle.element.querySelector(":scope > b")));
  const exported = await exportPolySceneSnapshot(host, {
    title: "cssElectroPaint — prepared Kent motion",
  });
  const sanitized = sanitizeSnapshot(exported, sceneData.playback, flattenedQuadBox);
  const { html } = sanitized;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (parsed.querySelectorAll(".polycss-scene > b").length !== 40 ||
      parsed.querySelector(".polycss-scene > div, .polycss-mesh, script, canvas, svg") ||
      /\/(?:Users|home)\//u.test(html)) {
    throw new Error("Prepared ElectroPaint snapshot sanitization failed");
  }
  window.__cssselectropaintSnapshot = {
    status: "ready",
    html,
    stats,
    rootTransform: sanitized.rootTransform,
    flattenedQuadBox,
  };
}

function sanitizeSnapshot(html, playback, flattenedQuadBox) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style");
  const camera = parsed.querySelector(".polycss-camera");
  const scene = camera?.querySelector(":scope > .polycss-scene");
  const roots = [...(scene?.querySelectorAll(":scope > .e") ?? [])];
  const leaves = roots.map((root) => root.querySelector(":scope > b"));
  if (!(stylesheet instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || roots.length !== 40 ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement))) {
    throw new Error("Exported ElectroPaint graph is incomplete");
  }
  const perspective = camera.style.perspective;
  if (!perspective || playback.rootTransform !== "translateY(135px) rotateX(45deg)") {
    throw new Error("Exported ElectroPaint camera is incomplete");
  }
  stylesheet.textContent =
    "html,body{width:100%;height:100%;margin:0}" +
    "body{position:relative;overflow:hidden}" +
    ".polycss-camera{position:relative;display:block;width:960px;height:540px;perspective:1000px;perspective-origin:50% 75%}" +
    ".polycss-scene{position:absolute;top:50%;left:50%;width:0;height:0;transform-style:preserve-3d}" +
    ".polycss-scene>b{position:absolute;display:block;box-sizing:border-box;margin:0;padding:0;line-height:0;" +
    `left:${number(flattenedQuadBox.left)}px;top:${number(flattenedQuadBox.top)}px;` +
    `width:${number(flattenedQuadBox.width)}px;height:${number(flattenedQuadBox.height)}px;` +
    "transform-origin:0 0 0;transform-style:preserve-3d;color:transparent;backface-visibility:visible;" +
    `outline-width:calc(${number(flattenedQuadBox.outlineScale)}px * var(--cssselectropaint-inverse-presentation-scale,1));` +
    "outline-offset:0;outline-style:solid}" +
    playback.palette.map((entry, index) =>
      `.polycss-scene .${entry.className}{background-color:${entry.fill};outline-color:${entry.outline}}`).join("");
  camera.style.removeProperty("perspective");
  scene.style.removeProperty("transform");
  if (camera.getAttribute("style") === "") camera.removeAttribute("style");
  if (scene.getAttribute("style") === "") scene.removeAttribute("style");
  const fragment = parsed.createDocumentFragment();
  for (let index = 0; index < leaves.length; index += 1) {
    const transform = roots[index].style.transform;
    if (!transform) throw new Error(`Exported ElectroPaint square ${index} has no prepared motion matrix`);
    leaves[index].style.transform = transform;
    leaves[index].style.removeProperty("background-color");
    leaves[index].style.removeProperty("outline-color");
    leaves[index].style.removeProperty("outline-style");
    leaves[index].style.removeProperty("color");
    leaves[index].className = playback.palette[playback.initial.colorIndices[index]].className;
    fragment.append(leaves[index]);
  }
  scene.replaceChildren(fragment);
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
    }
  }
  for (const element of parsed.querySelectorAll("script, canvas, svg")) element.remove();
  return {
    html: `<!doctype html>${parsed.documentElement.outerHTML}\n`,
    rootTransform: playback.rootTransform,
  };
}

function measureFlattenedQuadBox(leaves) {
  if (leaves.length !== 40 || leaves.some((leaf) => !(leaf instanceof HTMLElement))) {
    throw new Error("PolyCSS ElectroPaint quad leaves are incomplete");
  }
  const boxes = leaves.map((leaf, index) => {
    const style = getComputedStyle(leaf);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    const matrix = new DOMMatrix(style.transform);
    if (!(width > 0) || !(height > 0) || !matrixIsFinite(matrix)) {
      throw new Error(`PolyCSS ElectroPaint quad ${index} has invalid prepared geometry`);
    }
    const corners = [
      new DOMPoint(0, 0, 0).matrixTransform(matrix),
      new DOMPoint(width, 0, 0).matrixTransform(matrix),
      new DOMPoint(width, height, 0).matrixTransform(matrix),
      new DOMPoint(0, height, 0).matrixTransform(matrix),
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const zs = corners.map((point) => point.z);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    if (!corners.every((point) => Math.abs(point.w - 1) < 1e-9) ||
        !zs.every((value) => Math.abs(value - zs[0]) < 1e-9) ||
        !xs.every((value) => Math.abs(value - left) < 1e-9 || Math.abs(value - right) < 1e-9) ||
        !ys.every((value) => Math.abs(value - top) < 1e-9 || Math.abs(value - bottom) < 1e-9)) {
      throw new Error(`PolyCSS ElectroPaint quad ${index} cannot be flattened without changing geometry`);
    }
    return Object.freeze({
      left,
      top,
      width: right - left,
      height: bottom - top,
      outlineScale: Math.sqrt(Math.abs(matrix.m11 * matrix.m22 - matrix.m12 * matrix.m21)),
    });
  });
  const first = boxes[0];
  if (!boxes.every((box) => Object.keys(first).every((key) => Math.abs(box[key] - first[key]) < 1e-9))) {
    throw new Error("PolyCSS ElectroPaint quad geometry is not shared");
  }
  return first;
}

function matrixIsFinite(matrix) {
  return [
    matrix.m11, matrix.m12, matrix.m13, matrix.m14,
    matrix.m21, matrix.m22, matrix.m23, matrix.m24,
    matrix.m31, matrix.m32, matrix.m33, matrix.m34,
    matrix.m41, matrix.m42, matrix.m43, matrix.m44,
  ].every(Number.isFinite);
}

function number(value) {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(9)).toString();
}
