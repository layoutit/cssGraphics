import { compilePreparedCssflowerCycle } from "./compilePreparedCycle.mjs";
import { sourceProvenanceFor } from "./provenance.mjs";
import { cssflowerSlicePlan } from "./slicePlan.mjs";
import { CSSFLOWER_CAMERA, CSSFLOWER_SIDE_MATERIALS, CSSFLOWER_SOURCE_PROFILE } from "./sourceProfile.mjs";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_PROJECTED_ATLAS_ENCODING,
  CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE,
  CSSFLOWER_PROJECTED_ATLAS_QUALITY,
  CSSFLOWER_SEAM_BLEED,
} from "../../cssflower/renderContract.mjs";
import {
  generatedProjectedAtlasUrl,
  generatedSharedLayoutBlockUrl,
} from "./paths.mjs";

export async function buildCssflowerFirstSliceScene({
  dataSource,
  projectedPixels,
  readLightingPage,
  sceneId = "default-cube",
  writeLightingPage,
} = {}) {
  if (sceneId !== "default-cube") {
    throw new RangeError(`Unknown prepared cssFlower scene ${sceneId}`);
  }
  const compiled = await compilePreparedCssflowerCycle({
    nativeAuthorityStatus: dataSource?.nativeAuthorityStatus ?? "missing",
    readLightingPage,
    writeLightingPage,
  });
  if (projectedPixels?.schema !== "cssflower-prepared-shared-frame-window-pages@1" ||
      projectedPixels.stateCount !== compiled.cycle.stateCount ||
      projectedPixels.retainedLeafCount !== compiled.topology.triangleCount) {
    throw new Error("Complete source-bound projected-pixel preparation is required");
  }
  const scene = Object.freeze({
    schema: "cssflower-prepared-scene@1",
    id: "default-cube",
    label: "Microsoft Flower Box — default cube",
    mode: cssflowerSlicePlan.mode,
    artifactMode: cssflowerSlicePlan.artifactMode,
    source: sourceProvenanceFor(dataSource),
    sourceProfile: CSSFLOWER_SOURCE_PROFILE,
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      morphPackage: "@layoutit/polycss-morph",
      morphVersion: "0.2.11",
      morphTarget: "createPolyMorphPreparedDomTarget",
      representation: "stable-source-triangle-leaf-windows-over-shared-screen-aligned-prepared-frame-pages",
      textureBackend: "atlas",
      textureLeafSizing: "raster",
      stableDom: true,
      seamBleed: CSSFLOWER_SEAM_BLEED,
      boundarySeamBleed: CSSFLOWER_BOUNDARY_SEAM_BLEED,
      seamBleedPolicy: compiled.siblingSeamPlan.policy,
      seamBleedSharedEdgeCount: compiled.siblingSeamPlan.sharedEdgeCount,
      seamBleedBoundaryEdgeCount: compiled.siblingSeamPlan.boundaryEdgeCount,
      seamBleedBoundaryVertexCount: compiled.siblingSeamPlan.boundaryVertexCount,
      seamBleedBoundaryAdjacentTriangleCount: compiled.siblingSeamPlan.boundaryAdjacentTriangleCount,
      merge: false,
      quadPrimitiveAudit: compiled.quadMergeAudit,
      meshResolution: "lossless",
      runtimeGeometryConstruction: false,
      runtimeRadialProjection: false,
      runtimeNormalCalculation: false,
      runtimeLightingCalculation: false,
      runtimeDomGrowth: false,
    }),
    camera: CSSFLOWER_CAMERA,
    controls: "none",
    background: "#000000",
    textureLighting: "baked",
    textureQuality: 1,
    materials: CSSFLOWER_SIDE_MATERIALS.map(({ id, color }) => ({ id, color })),
    lighting: publicLightingContract(compiled.lighting),
    playback: Object.freeze({
      schema: "cssflower-prepared-playback@1",
      target: "createPolyMorphPreparedDomTarget",
      sourceTicksPerSecond: CSSFLOWER_SOURCE_PROFILE.presentationTicksPerSecond,
      transformAsset: Object.freeze({
        distribution: "ignored-local-preparation-evidence",
        url: null,
        sha256: compiled.transformSha256,
        encoding: "float32-little-endian-state-major-triangle-major-matrix3d",
        componentCount: 16,
        triangleCount: compiled.topology.triangleCount,
        geometryStateCount: compiled.cycle.geometryStateCount,
        byteLength: compiled.transformBytes.length,
      }),
      stateEvidenceUrl: "/cssflower/assets/flower-box-state-evidence.json",
      projectedPixels: projectedPixelContract(projectedPixels),
      cycle: Object.freeze({
        schema: compiled.cycle.schema,
        initialState: compiled.cycle.initialState,
        stateCount: compiled.cycle.stateCount,
        cycleStartState: compiled.cycle.cycleStartState,
        cycleLength: compiled.cycle.cycleLength,
        bloomTraceStateCount: compiled.cycle.bloomTraceStateCount,
        bloomCycleStartState: compiled.cycle.bloomCycleStartState,
        bloomCycleLength: compiled.cycle.bloomCycleLength,
        geometryStateCount: compiled.cycle.geometryStateCount,
        rootStateCount: compiled.cycle.rootStateCount,
        rootTransforms: compiled.cycle.rootTransforms,
        states: Object.freeze(compiled.cycle.states.map((state, stateIndex) => Object.freeze({
          ...state,
          projectedPageIndex: projectedPixels.statePageIndices[stateIndex],
          projectedFrameIndex: projectedPixels.stateFrameIndices[stateIndex],
        }))),
      }),
    }),
    meshes: Object.freeze([Object.freeze({
      id: "flower-box-default-cube",
      kind: "flower-box-cube",
      sourceId: "FLWBOX:cube:subdivision-10",
      stableDom: true,
      excludeFromAutoCenter: true,
      transform: Object.freeze({}),
      polygons: Object.freeze(compiled.initialPolygons.map((polygon, index) => Object.freeze({
        ...polygon,
        data: Object.freeze({
          ...polygon.data,
          "cssflower-seam-bleed": compiled.lighting.faces[index].seamBleed,
          "cssflower-seam-edge-mask": compiled.siblingSeamPlan.edgeMasks[index],
        }),
      }))),
    })]),
    metrics: Object.freeze({
      meshCount: 1,
      sourceSideCount: compiled.topology.sideCount,
      sourceSideLocalPointCount: compiled.topology.sideLocalPointCount,
      sourceTriangleCount: compiled.topology.triangleCount,
      preparedPolygonCount: compiled.topology.triangleCount,
      preparedLeafCount: compiled.topology.triangleCount,
      preparedRootCount: 1,
      preparedGeometryStateCount: compiled.cycle.geometryStateCount,
      preparedTimelineStateCount: compiled.cycle.stateCount,
      preparedCombinedCycleLength: compiled.cycle.cycleLength,
      preparedBloomCycleLength: compiled.cycle.bloomCycleLength,
      preparedRootStateCount: compiled.cycle.rootStateCount,
      preparedProjectedPixelPageCount: projectedPixels.pageCount,
      preparedProjectedPixelAtlasAssetCount: projectedPixels.pageCount - projectedPixels.atlasAliasCount,
      preparedProjectedPixelLayoutAssetCount: projectedPixels.layoutBlocks.length,
      preparedProjectedPixelMaximumDecodedPageBytes: projectedPixels.maximumDecodedPageBytes,
      preparedProjectedPixelMaximumAdjacentTwoPageBytes: projectedPixels.maximumAdjacentTwoPageBytes,
      preparedLightingFieldCount: compiled.cycle.stateCount * compiled.topology.triangleCount,
      preparedSeamSharedEdgeCount: compiled.siblingSeamPlan.sharedEdgeCount,
      preparedSeamSharedEdgeIncidenceCount: compiled.siblingSeamPlan.sharedEdgeIncidenceCount,
      preparedSeamBoundaryEdgeCount: compiled.siblingSeamPlan.boundaryEdgeCount,
      preparedSeamBoundaryEdgeIncidenceCount: compiled.siblingSeamPlan.boundaryEdgeIncidenceCount,
      preparedSeamBoundaryVertexCount: compiled.siblingSeamPlan.boundaryVertexCount,
      preparedSeamBoundaryAdjacentTriangleCount: compiled.siblingSeamPlan.boundaryAdjacentTriangleCount,
      mergedCellCount: 0,
      mergeCandidateCount: compiled.quadMergeAudit.sourceCellCount,
      mergeEligibleCellCount: compiled.quadMergeAudit.acrossAllStatesEligibleCellCount,
      runtimePolygonConstructionCount: 0,
      runtimeRadialProjectionCount: 0,
      runtimeNormalCalculationCount: 0,
      runtimeLightingCalculationCount: 0,
      runtimeDomGrowth: false,
    }),
    oracle: Object.freeze({
      stateEvidenceSchema: compiled.evidence.schema,
      stateEvidenceUrl: "/cssflower/assets/flower-box-state-evidence.json",
      implementationEngineIndependence: compiled.evidence.engineIndependence,
      nativeAuthorityStatus: dataSource?.nativeAuthorityStatus ?? "missing",
      nativeStateComparison: dataSource?.nativeQualification?.status === "pass"
        ? "exact-pass-9331-ticks"
        : "pending-owned-byte-identified-authority",
      visualComparison: dataSource?.nativeQualification?.status === "pass"
        ? "measured-divergence-see-ignored-local-pixelmatch-report"
        : "pending-state-correctness-and-native-authority",
    }),
    warnings: Object.freeze([
      ...(dataSource?.nativeQualification?.status === "pass" ? [
        "The independently generated topology, binary32 bloom state, rotations, positions, normals, materials, camera, and light configuration pass the retained exact 9,331-tick identity-bound native comparison.",
        "Native/browser visual parity is not claimed: calibrated pixelmatch still reports measured rasterization and lighting divergence.",
      ] : [
        "The radial coefficient formula, exact material channels, normal averaging order, and fixed-function lighting realization are independently authored candidates pending identity-bound native differential validation.",
        "Native state and visual parity are not claimed because no owned source or binary authority is present under ignored local storage.",
      ]),
      "The source update cadence is not yet authority-bound; 30 ticks per second is a deterministic browser presentation cadence, not a native timing claim.",
      "PolyCSS <b> quads were evaluated for all 600 source cells across all 414 prepared states; every cell is noncoplanar in at least one state, so exact geometry equivalence fails and the 1,200 stable triangle leaves are retained.",
    ]),
  });
  return Object.freeze({ scene, compiled });
}

export function createCssflowerSceneContract(value = {}) {
  return value;
}

function publicLightingContract(lighting) {
  return Object.freeze({
    ...lighting,
    distribution: "ignored-local-preparation-evidence",
    assetUrl: null,
    pages: Object.freeze(lighting.pages.map((page) => Object.freeze({
      ...page,
      assetUrl: null,
    }))),
  });
}

function projectedPixelContract(prepared) {
  return Object.freeze({
    schema: "cssflower-prepared-projected-pixel-playback@1",
    techniqueReference: "cssGraphics Mario prepared space-time texel seam extended to shared screen-aligned source-camera frame windows",
    representation: "shared-frame-windows",
    physicalLayout: prepared.layout,
    rasterMode: "source-camera-projected-pixels",
    sampling: "integer-pixel-center",
    cull: "source-default-CCW-front",
    depth: "source-depth16-less",
    interpolation: "perspective-correct-smooth-vertex-lighting",
    encoding: `${CSSFLOWER_PROJECTED_ATLAS_ENCODING} plus gzip-blocked int16 source-order leaf layouts`,
    visualEncoding: Object.freeze({
      codec: "AVIF",
      mimeType: CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE,
      quality: CSSFLOWER_PROJECTED_ATLAS_QUALITY,
      chromaSubsampling: "4:4:4",
      speed: 6,
      policy: "user-accepted-bounded-lossy-prepared-pixels",
      exactStateAndTopology: true,
      exactPreparedPixels: false,
    }),
    stateCount: prepared.stateCount,
    cycleStartState: prepared.cycleStartState,
    cycleLength: prepared.cycleLength,
    retainedLeafCount: prepared.retainedLeafCount,
    pageCount: prepared.pageCount,
    decodedResidentPageBudget: prepared.decodedResidentPageBudget,
    decodedPeakPageBudget: prepared.decodedPeakPageBudget,
    maximumDecodedPageBytes: prepared.maximumDecodedPageBytes,
    maximumAdjacentTwoPageBytes: prepared.maximumAdjacentTwoPageBytes,
    encodedAtlasBytes: prepared.encodedAtlasBytes,
    rawLayoutBytes: prepared.rawLayoutBytes,
    compressedLayoutBytes: prepared.compressedLayoutBytes,
    layoutBlockPageCount: prepared.layoutBlockPageCount,
    contentAddressedAtlasBytes: prepared.contentAddressedAtlasBytes,
    atlasAliasCount: prepared.atlasAliasCount,
    inverseRootTransforms: prepared.inverseRootTransforms,
    encoder: prepared.encoder,
    layoutBlocks: Object.freeze(prepared.layoutBlocks.map((block) => Object.freeze({
      ...block,
      assetUrl: generatedSharedLayoutBlockUrl(block.sha256),
    }))),
    pages: Object.freeze(prepared.pages.map((page) => Object.freeze({
      index: page.index,
      sourcePageIndex: page.sourcePageIndex,
      frameCount: page.frameCount,
      startStateIndex: page.startStateIndex,
      usedFrameCount: page.usedFrameCount,
      activeUnionLeafCount: page.activeUnionLeafCount,
      atlas: Object.freeze({
        ...page.atlas,
        assetUrl: generatedProjectedAtlasUrl(page.atlas.sha256),
      }),
      layout: Object.freeze({
        ...page.layout,
      }),
    }))),
    authority: prepared.authority,
    runtimeProjection: false,
    runtimeRasterization: false,
    runtimeGeometryConstruction: false,
    runtimeNormalCalculation: false,
    runtimeLightingCalculation: false,
    runtimeDomGrowth: false,
  });
}
