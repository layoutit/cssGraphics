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
    const color = lighting.materialColors?.[materialIndex];
    const materialOrigin = lighting.faces?.[
      materialIndex * lighting.materialFieldStride
    ];
    if (!Number.isInteger(materialIndex) || typeof color !== "string" ||
        materialOrigin?.materialIndex !== materialIndex || materialOrigin?.side !== 0) {
      throw new Error(`Prepared fallback material is missing for pipe ${pipe}`);
    }
    if (face.getAttribute("data-csspipes-surface") === "end-cap") {
      Object.assign(face.style, {
        color: `var(--csspipes-material-color, ${color})`,
        backfaceVisibility: "visible",
        transition: "none",
      });
      face.dataset.csspipesCapColor = color;
      face.dataset.csspipesMaterialBinding = "prepared-clip";
      continue;
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
      backgroundPositionX:
        `calc(var(--csspipes-material-offset, ${materialOrigin.backgroundPositionX}) - ` +
        `${side * lighting.leafWidth}px)`,
      backgroundPositionY: "0px",
      backgroundSize: lighting.backgroundSize,
      backfaceVisibility: "visible",
      transition: "none",
    });
    face.dataset.csspipesMaterialBinding = "prepared-clip";
  }
}

function preparePlaybackLeaves(pipeRoot, pipe, bank, playback) {
  const bandSlotsPerPipe = playback.bandSlotsByPipe?.[pipe];
  const radialSegments = playback.radialSegmentsByPipe?.[pipe];
  const wallLeavesPerPipe = bandSlotsPerPipe * radialSegments;
  const expected = playback.leavesPerPipeByPipe?.[pipe];
  const leafIndexOffset = playback.pipeLeafOffsets?.[pipe];
  if (!Number.isInteger(bandSlotsPerPipe) || bandSlotsPerPipe < 1 ||
      !Number.isInteger(wallLeavesPerPipe) ||
      !Number.isInteger(radialSegments) || radialSegments < 3 ||
      expected !== wallLeavesPerPipe + 2 ||
      !Number.isInteger(leafIndexOffset) || leafIndexOffset < 0) {
    throw new Error("Prepared continuous tube cap-target census drifted");
  }
  const wallLeaves = [
    ...pipeRoot.querySelectorAll('[data-csspipes-surface="wall"]'),
  ];
  if (wallLeaves.length !== wallLeavesPerPipe) {
    throw new Error("Prepared continuous tube wall-leaf count drifted");
  }
  const capRoots = ["start", "tip"].map((cap, capIndex) => {
    const faces = [
      ...pipeRoot.querySelectorAll(`[data-csspipes-surface="end-cap"][data-csspipes-cap="${cap}"]`),
    ];
    if (faces.length !== playback.endCapLeavesPerEnd) {
      throw new Error(`Prepared continuous tube ${cap} cap census drifted`);
    }
    const capRoot = document.createElement("div");
    capRoot.dataset.csspipesCapRoot = cap;
    capRoot.dataset.csspipesPipe = String(pipe);
    capRoot.dataset.csspipesBankIndex = String(bank);
    capRoot.dataset.csspipesLeafSlot = String(wallLeavesPerPipe + capIndex);
    capRoot.dataset.csspipesTopology = "shared-ring-end-cap";
    capRoot.dataset.csspipesVisible = "false";
    rootStyle(capRoot, false);
    for (const face of faces) {
      face.dataset.csspipesVisible = "true";
      capRoot.append(face);
    }
    pipeRoot.append(capRoot);
    return capRoot;
  });
  const leaves = [...wallLeaves, ...capRoots].sort((left, right) =>
    Number(left.getAttribute("data-csspipes-leaf-slot")) -
    Number(right.getAttribute("data-csspipes-leaf-slot")));
  if (leaves.length !== expected) throw new Error("Prepared continuous tube leaf count drifted");
  for (let localIndex = 0; localIndex < leaves.length; localIndex += 1) {
    const leaf = leaves[localIndex];
    if (Number(leaf.getAttribute("data-csspipes-leaf-slot")) !== localIndex) {
      throw new Error("Prepared continuous tube leaf slots are not contiguous");
    }
    leaf.dataset.csspipesLeafIndex = String(leafIndexOffset + localIndex);
    leaf.dataset.csspipesBankIndex = String(bank);
    leaf.dataset.csspipesMorph = "prepared-continuous-tube-retraction";
    if (leaf.getAttribute("data-csspipes-surface") === "wall") {
      leaf.dataset.csspipesSeamBleed = "0";
    }
    leaf.dataset.csspipesVisible = "false";
    leaf.style.visibility = "hidden";
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
    const playbackRoot = document.createElement("div");
    playbackRoot.dataset.csspipesPlaybackRoot = "true";
    rootStyle(playbackRoot);
    playbackRoot.style.opacity = "1";
    sceneRoot.append(playbackRoot);

    for (const { bank, pipe, mesh } of handles) {
      const pipeRoot = document.createElement("div");
      pipeRoot.dataset.csspipesPipeRoot = String(pipe.pipe);
      pipeRoot.dataset.csspipesPipe = String(pipe.pipe);
      pipeRoot.dataset.csspipesBankIndex = String(bank);
      pipeRoot.dataset.csspipesShapeIndex = String(pipe.pipe);
      pipeRoot.dataset.csspipesVisible = "false";
      pipeRoot.dataset.csspipesTopology = "continuous-shared-ring-tube";
      rootStyle(pipeRoot, false);
      pipeRoot.append(mesh.element);
      applySpaceTexels(
        pipeRoot,
        sceneData.lighting,
        sceneData.playback.clips[0].materialIndicesByPipe,
      );
      preparePlaybackLeaves(pipeRoot, pipe.pipe, bank, sceneData.playback);
      playbackRoot.append(pipeRoot);
    }

    scene.applyCamera();
    await scene.whenTexturesReady();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stats = collectPolyRenderStats(host, sceneData.metrics.preparedLeafCount);
    const mountedLeaves = host.querySelectorAll("[data-csspipes-face]").length;
    const shapeTargetCount = host.querySelectorAll("[data-csspipes-shape-index]").length;
    const leafTargetCount = host.querySelectorAll("[data-csspipes-leaf-index]").length;
    const pipeRootCount = host.querySelectorAll("[data-csspipes-pipe-root]").length;
    if (mountedLeaves !== sceneData.metrics.preparedLeafCount ||
        shapeTargetCount !== sceneData.playback.totalRetainedRootCount ||
        leafTargetCount !== sceneData.playback.totalLeafTargetCount ||
        pipeRootCount !== sceneData.playback.totalRetainedRootCount) {
      throw new Error("Prepared continuous tube retained graph drifted");
    }
    const exportedHtml = await exportPolySceneSnapshot(host, {
      title: "cssPipes - prepared continuous PolyCSS tubes",
    });
    const sharedAtlasHtml = hoistPreparedSnapshotAtlas(
      exportedHtml,
      sceneData.metrics.preparedWallLeafCount,
    );
    const materialBindings = buildPreparedMaterialBindings(sceneData);
    const materialStyle =
      `<style data-csspipes-prepared-material-bindings="${materialBindings.bindingCount}">` +
      `${materialBindings.css}</style>`;
    const html = sharedAtlasHtml.replace("</head>", `${materialStyle}</head>`);
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
