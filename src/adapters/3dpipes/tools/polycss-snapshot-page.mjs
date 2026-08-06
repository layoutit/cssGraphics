import {
  collectPolyRenderStats,
  createPolyPerspectiveCamera,
  createPolyScene,
  exportPolySceneSnapshot,
} from "@layoutit/polycss";
import { buildPreparedMaterialBindings } from
  "../src/prepare/csspipes/preparedMaterialBindings.mjs";
import { hoistPreparedSnapshotAtlas } from
  "../src/prepare/csspipes/preparedSnapshotAtlas.mjs";

const host = document.querySelector("#scene");
const sceneUrl = new URLSearchParams(location.search).get("sceneUrl");

main().catch((error) => {
  globalThis.__cssPipesSnapshot = {
    status: "error",
    error: error?.stack || error?.message || String(error),
  };
});

function rootStyle(element, visible = true) {
  Object.assign(element.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    transformOrigin: "0 0 0",
    transformStyle: "preserve-3d",
    visibility: visible ? "visible" : "hidden",
  });
}

function applySpaceTexels(element, lighting, fallbackMaterialIndices) {
  for (const face of element.querySelectorAll("[data-csspipes-face]")) {
    const pipe = Number(face.getAttribute("data-csspipes-pipe"));
    const materialIndex = fallbackMaterialIndices?.[pipe];
    const materialOrigin = lighting.faces?.[
      materialIndex * lighting.materialFieldStride
    ];
    if (!Number.isInteger(materialIndex) ||
        materialOrigin?.materialIndex !== materialIndex || materialOrigin?.side !== 0) {
      throw new Error(`Prepared fallback material is missing for pipe ${pipe}`);
    }
    const side = Number(face.getAttribute("data-csspipes-cylinder-side"));
    const field = lighting.faces[
      materialIndex * lighting.materialFieldStride + side
    ];
    if (!field || field.materialIndex !== materialIndex || field.side !== side) {
      throw new Error(
        `Prepared space-texel field is missing for material ${materialIndex} side ${side}`,
      );
    }
    Object.assign(face.style, {
      backgroundImage: `url("${lighting.assetUrl}")`,
      backgroundColor: "transparent",
      backgroundRepeat: "no-repeat",
      backgroundPositionX: field.backgroundPositionX,
      backgroundPositionY: "0px",
      backgroundSize: lighting.backgroundSize,
      backfaceVisibility: "visible",
      transition: "none",
    });
  }
}

function createPreparedScene(hostElement, camera) {
  return createPolyScene(hostElement, {
    camera,
    ambientLight: { color: "#ffffff", intensity: Math.PI },
    directionalLight: { direction: [0, -1, 1], color: "#ffffff", intensity: 0 },
    textureLighting: "baked",
    textureQuality: 1,
    textureLeafSizing: "canonical",
    textureBackend: "atlas",
    textureProjection: "affine",
    seamBleed: 0,
    autoCenter: false,
  });
}

function preparedCamera(sceneData) {
  return createPolyPerspectiveCamera({
    perspective: sceneData.camera.perspective,
    zoom: sceneData.camera.zoom,
    rotX: sceneData.camera.rotX,
    rotY: sceneData.camera.rotY,
    target: sceneData.camera.target,
    distance: sceneData.camera.distance,
  });
}

function preparePlaybackLeaves(pipeRoot, pipe, playback) {
  const bandSlotsPerPipe = playback.bandSlotsByPipe?.[pipe];
  const radialSegments = playback.radialSegmentsByPipe?.[pipe];
  const wallLeavesPerPipe = bandSlotsPerPipe * radialSegments;
  const expected = playback.leavesPerPipeByPipe?.[pipe];
  const leafIndexOffset = playback.pipeLeafOffsets?.[pipe];
  if (!Number.isInteger(bandSlotsPerPipe) || bandSlotsPerPipe < 1 ||
      !Number.isInteger(wallLeavesPerPipe) ||
      !Number.isInteger(radialSegments) || radialSegments < 3 ||
      expected !== wallLeavesPerPipe ||
      !Number.isInteger(leafIndexOffset) || leafIndexOffset < 0) {
    throw new Error("Prepared continuous tube leaf census drifted");
  }
  const wallLeaves = [
    ...pipeRoot.querySelectorAll('[data-csspipes-surface="wall"]'),
  ];
  if (wallLeaves.length !== wallLeavesPerPipe) {
    throw new Error("Prepared continuous tube wall-leaf count drifted");
  }
  const leaves = wallLeaves.sort((left, right) =>
    Number(left.getAttribute("data-csspipes-leaf-slot")) -
    Number(right.getAttribute("data-csspipes-leaf-slot")));
  if (leaves.length !== expected) throw new Error("Prepared continuous tube leaf count drifted");
  for (let localIndex = 0; localIndex < leaves.length; localIndex += 1) {
    const leaf = leaves[localIndex];
    if (Number(leaf.getAttribute("data-csspipes-leaf-slot")) !== localIndex) {
      throw new Error("Prepared continuous tube leaf slots are not contiguous");
    }
    const side = Number(leaf.getAttribute("data-csspipes-cylinder-side"));
    if (!Number.isInteger(side) || side < 0 || side >= radialSegments) {
      throw new Error("Prepared continuous tube facet is invalid");
    }
    leaf.className = String.fromCharCode(97 + side);
    leaf.style.visibility = "hidden";
  }
  pipeRoot.append(...leaves);
}

function stripPreparedDomMetadata(root) {
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function consolidatePreparedStyles(html) {
  const pattern = /<style>([\s\S]*?)<\/style>/gu;
  const blocks = [...html.matchAll(pattern)];
  if (blocks.length < 1) throw new Error("Prepared snapshot has no stylesheet");
  const combined = `<style>${blocks.map((match) => match[1].trim()).join("\n")}</style>`;
  let first = true;
  return html.replace(pattern, () => {
    if (!first) return "";
    first = false;
    return combined;
  });
}

function moveStaticStylesToStylesheet(root) {
  root.querySelector(".polycss-camera")?.style.removeProperty("perspective");
  for (const element of root.querySelectorAll(".polycss-scene > div")) {
    for (const property of [
      "position", "left", "top", "width", "height", "transform-origin",
      "transform-style",
    ]) element.style.removeProperty(property);
  }
  for (const leaf of root.querySelectorAll(".polycss-scene > div > b")) {
    for (const property of [
      "color", "background-color", "background-repeat", "background-position-x",
      "background-position-y", "background-size", "backface-visibility", "transition",
    ]) leaf.style.removeProperty(property);
  }
}

async function main() {
  if (!(host instanceof HTMLElement) || !sceneUrl?.startsWith("/csspipes/")) {
    throw new Error("cssPipes snapshot page requires a generated sceneUrl");
  }
  const response = await fetch(sceneUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Prepared scene request failed (${response.status})`);
  const sceneData = await response.json();
  if (sceneData.schema !== "csspipes-prebaked-scene@12" ||
      sceneData.playback?.schema !== "csspipes-prebaked-playback@13" ||
      sceneData.pipeMeshes?.length !== sceneData.playback.pipeCount) {
    throw new Error("Prepared cssPipes continuous-tube scene is invalid");
  }
  const lightingResponse = await fetch(sceneData.lighting.assetUrl, { cache: "no-store" });
  if (!lightingResponse.ok) throw new Error("Prepared cssPipes space-texel atlas is unavailable");
  const scene = createPreparedScene(host, preparedCamera(sceneData));
  try {
    const handles = Array.from(
      { length: sceneData.playback.retainedBankCount },
      (_, bank) => sceneData.pipeMeshes.map((pipe) => ({
        bank,
        pipe,
        mesh: scene.add({
          polygons: pipe.polygons.map((face) => face.polygon),
          objectUrls: [], warnings: [], dispose() {},
        }, {
          id: `${pipe.id}-bank-${bank}`,
          merge: false,
          meshResolution: "lossless",
          stableDom: true,
          excludeFromAutoCenter: true,
        }),
      })),
    ).flat();
    const sceneRoot = host.querySelector(".polycss-scene");
    if (!(sceneRoot instanceof HTMLElement)) throw new Error("PolyCSS scene root was not mounted");
    for (const { bank, pipe, mesh } of handles) {
      const pipeRoot = document.createElement("div");
      const materialIndex = sceneData.playback.clips[0].materialIndicesByPipe[pipe.pipe];
      pipeRoot.className = `m${materialIndex}`;
      rootStyle(pipeRoot, false);
      pipeRoot.append(...mesh.element.children);
      mesh.element.remove();
      applySpaceTexels(
        pipeRoot,
        sceneData.lighting,
        sceneData.playback.clips[0].materialIndicesByPipe,
      );
      preparePlaybackLeaves(pipeRoot, pipe.pipe, sceneData.playback);
      sceneRoot.append(pipeRoot);
    }

    scene.applyCamera();
    await scene.whenTexturesReady();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stats = collectPolyRenderStats(host, sceneData.metrics.preparedLeafCount);
    const mountedLeaves = sceneRoot.querySelectorAll(":scope > div > b").length;
    const shapeTargetCount = sceneRoot.children.length;
    const leafTargetCount = sceneRoot.querySelectorAll(":scope > div > b").length;
    const pipeRootCount = sceneRoot.children.length;
    if (mountedLeaves !== sceneData.metrics.preparedLeafCount ||
        shapeTargetCount !== sceneData.playback.totalRetainedRootCount ||
        leafTargetCount !== sceneData.playback.totalLeafTargetCount ||
        pipeRootCount !== sceneData.playback.totalRetainedRootCount) {
      throw new Error("Prepared continuous tube retained graph drifted");
    }
    moveStaticStylesToStylesheet(host);
    stripPreparedDomMetadata(host);
    const exportedHtml = await exportPolySceneSnapshot(host, {
      title: "cssPipes - prepared continuous PolyCSS tubes",
    });
    const sharedAtlasHtml = hoistPreparedSnapshotAtlas(
      exportedHtml,
      sceneData.metrics.preparedWallLeafCount,
      sceneData.lighting.backgroundSize,
    );
    const materialBindings = buildPreparedMaterialBindings(sceneData);
    const materialStyle =
      `<style>` +
      `.polycss-camera { perspective: ${sceneData.camera.perspective}px; ` +
      `width: ${sceneData.camera.sourceViewport.width}px; ` +
      `height: ${sceneData.camera.sourceViewport.height}px; ` +
      `transform-origin: 0 0; }` +
      `.polycss-scene > div { ` +
      `position: absolute; left: 0; top: 0; width: 0; height: 0; ` +
      `transform-origin: 0 0 0; transform-style: preserve-3d; }` +
      `${materialBindings.css}</style>`;
    const html = consolidatePreparedStyles(sharedAtlasHtml.replace(
      "</head>",
      `${materialStyle}</head>`,
    ));
    if (!html.includes("polycss-scene") || /<script\b/i.test(html)) {
      throw new Error("Prepared PolyCSS snapshot failed script/scene sanitization");
    }
    globalThis.__cssPipesSnapshot = {
      status: "ready",
      html,
      stats,
      mountedLeaves,
      slotCount: pipeRootCount,
      shapeTargetCount,
      leafTargetCount,
      pipeRootCount,
      bandSlotCount: sceneData.playback.bandSlotCount,
      materialBindingCount: materialBindings.bindingCount,
      materialUsage: materialBindings.materialUsage,
      sceneId: sceneData.id,
    };
  } finally {
    scene.destroy?.();
  }
}
