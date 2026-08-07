import { createHash } from "node:crypto";
import { sourceProvenanceFor } from "./provenance.mjs";
import { cssflowerSlicePlan } from "./slicePlan.mjs";
import { CSSFLOWER_CAMERA, CSSFLOWER_SIDE_MATERIALS, CSSFLOWER_SOURCE_PROFILE } from "./sourceProfile.mjs";
import { buildCssflowerPreparedRoundedOcclusionSchedule } from "./projectedPixels.mjs";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_FRONT_FACE_DILATION_TICKS,
  CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING,
  CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA,
  CSSFLOWER_LIGHTING_ATLAS_ENCODING,
  CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE,
  CSSFLOWER_LIGHTING_ATLAS_QUALITY,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_SEAM_BLEED,
  CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
  CSSFLOWER_VISIBILITY_POLICY,
} from "../../cssflower/renderContract.mjs";

export async function buildCssflowerFirstSliceScene({
  compiled,
  dataSource,
  preparedAssets,
  sceneId = "default-cube",
} = {}) {
  if (sceneId !== "default-cube") {
    throw new RangeError(`Unknown prepared cssFlower scene ${sceneId}`);
  }
  if (compiled?.topology?.triangleCount !== 1_200 ||
      preparedAssets?.transforms?.triangleCount !== compiled.topology.triangleCount ||
      preparedAssets.transforms.geometryStateCount !== compiled.cycle.geometryStateCount ||
      preparedAssets?.lighting?.pageCount !== compiled.lighting.pageCount) {
    throw new Error("Complete source-bound PolyCSS Morph preparation is required");
  }
  const playbackStates = preparePlaybackAssetSchedule(compiled.cycle);
  const frontFacingSchedule = prepareFrontFacingTransformSchedule(
    buildCssflowerPreparedRoundedOcclusionSchedule({
      adjacency: CSSFLOWER_VISIBILITY_POLICY.adjacency,
      adjacencyRings: CSSFLOWER_VISIBILITY_POLICY.adjacencyRings,
      minimumOwnedPixels: CSSFLOWER_VISIBILITY_POLICY.minimumOwnedPixels,
      sampleGrid: CSSFLOWER_VISIBILITY_POLICY.sampleGrid,
      temporalDilationTicks: CSSFLOWER_VISIBILITY_POLICY.temporalDilationTicks,
    }),
    compiled.topology.triangleCount,
  );
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
      representation: "stable-source-triangle-leaves-with-prepared-owned-pixel-occlusion-matrix3d-blocks-and-exact-sparse-leaf-lighting-addresses",
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
    lighting: publicLightingContract(compiled.lighting, preparedAssets.lighting),
    playback: Object.freeze({
      schema: "cssflower-prepared-playback@1",
      target: "createPolyMorphPreparedDomTarget",
      scope: "rounded-product-cycle-spike-phase-omitted",
      sourceTicksPerSecond: CSSFLOWER_SOURCE_PROFILE.presentationTicksPerSecond,
      transformAsset: preparedAssets.transforms,
      frontFacingSchedule,
      stateEvidenceUrl: "/cssflower/assets/flower-box-state-evidence.json",
      cycle: Object.freeze({
        schema: compiled.cycle.schema,
        initialState: compiled.cycle.initialState,
        stateCount: compiled.cycle.stateCount,
        cycleStartState: compiled.cycle.cycleStartState,
        cycleLength: compiled.cycle.cycleLength,
        bloomTraceStateCount: compiled.cycle.bloomTraceStateCount,
        bloomCycleStartState: compiled.cycle.bloomCycleStartState,
        bloomCycleLength: compiled.cycle.bloomCycleLength,
        bloomPeakGeometryStateIndex: compiled.cycle.bloomPeakGeometryStateIndex,
        bloomPeakSf: compiled.cycle.bloomPeakSf,
        bloomPeakSfHex: compiled.cycle.bloomPeakSfHex,
        bloomPeakSfNominal: compiled.cycle.bloomPeakSfNominal,
        omittedSourceSfAtOrAbove: compiled.cycle.omittedSourceSfAtOrAbove,
        geometryStateCount: compiled.cycle.geometryStateCount,
        rootStateCount: compiled.cycle.rootStateCount,
        rootTransforms: compiled.cycle.rootTransforms,
        states: playbackStates,
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
      retainedSourceOracleTimelineStateCount: compiled.sourceCycle.stateCount,
      retainedSourceOracleGeometryStateCount: compiled.sourceCycle.geometryStateCount,
      retainedSourceOracleCombinedCycleLength: compiled.sourceCycle.cycleLength,
      preparedTransformBlockCount: preparedAssets.transforms.blockCount,
      preparedTransformEncodedBytes: preparedAssets.transforms.byteLength,
      preparedTransformDecodedBytes: preparedAssets.transforms.decodedByteLength,
      preparedFrontFacingDilationTicks: frontFacingSchedule.dilationTicks,
      preparedVisibilitySelectionDomain: frontFacingSchedule.selectionDomain,
      preparedVisibilityMinimumOwnedPixels: frontFacingSchedule.minimumOwnedPixels,
      preparedVisibilitySampleGrid: frontFacingSchedule.sampleGrid,
      preparedVisibilityAdjacencyRings: frontFacingSchedule.adjacencyRings,
      preparedFrontFacingSelectedCount: frontFacingSchedule.selectedFaceCount,
      preparedFrontFacingSuppressedCount: frontFacingSchedule.suppressedFaceCount,
      preparedFrontFacingMeanSelectedPerState: frontFacingSchedule.meanSelectedFacesPerState,
      preparedFrontFacingMinimumSelectedPerState: frontFacingSchedule.minimumSelectedFacesPerState,
      preparedFrontFacingMaximumSelectedPerState: frontFacingSchedule.maximumSelectedFacesPerState,
      preparedFrontFacingVisibilityChangeCount: frontFacingSchedule.visibilityChangeCount,
      preparedLightingPageCount: preparedAssets.lighting.pageCount,
      preparedLightingAssetCount: preparedAssets.lighting.assetCount,
      preparedLightingEncodedBytes: preparedAssets.lighting.contentAddressedBytes,
      preparedLightingFieldCount: compiled.cycle.stateCount * compiled.topology.triangleCount,
      preparedLightingAddressUpdateCount: compiled.lighting.addressSchedule.updateCount,
      preparedLightingMeanAddressUpdatesPerState: compiled.lighting.addressSchedule.meanUpdatesPerState,
      preparedLightingP95AddressUpdatesPerState: compiled.lighting.addressSchedule.p95UpdatesPerState,
      preparedLightingMaximumAddressUpdatesPerState: compiled.lighting.addressSchedule.maximumUpdatesPerState,
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
        ? "rounded-product-common-prefix-only-full-source-visual-report-retained-as-historical-evidence"
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
      "The product deliberately omits source states at sf >= 2.5 and uses a prepared 90-state rounded bloom inside one 360-state rotation. The independent 9,331-tick source/native oracle remains complete; product/native state parity is claimed only through the shared tick-0-to-45 prefix.",
      "The product uses the owner-accepted prepare-time depth16 owned-pixel visibility schedule with an eight-pixel minimum and one-tick cyclic dilation. Its sparse browser edge-coverage drift is accepted bounded product behavior, not native or prior-browser pixel parity.",
      `Prepared leaf-resolution lighting is encoded as ${CSSFLOWER_LIGHTING_ATLAS_ENCODING}; exact state and topology are retained, but decoded browser pixels are bounded-lossy and require explicit visual acceptance.`,
      "Runtime lighting selection uses an exact prepared RGB8 per-triangle change schedule. Reusing a prior atlas address is state-exact in that selection domain; the lossy AVIF grid can still produce small location-dependent raster differences when an equivalent source field is addressed from a different prepared state.",
      "PolyCSS <b> quads were evaluated for all 600 source cells across all 414 prepared states; every cell is noncoplanar in at least one state, so exact geometry equivalence fails and the 1,200 stable triangle leaves are retained.",
    ]),
  });
  return Object.freeze({ scene, compiled });
}

function preparePlaybackAssetSchedule(cycle) {
  const states = cycle?.states;
  if (!Array.isArray(states) || states.length !== cycle.stateCount ||
      !Number.isSafeInteger(cycle.cycleStartState) || cycle.cycleStartState < 0 ||
      cycle.cycleStartState >= states.length) {
    throw new Error("Prepared cssFlower playback schedule is invalid");
  }
  return Object.freeze(states.map((state, timelineStateIndex) => {
    const transformBlockIndex = Math.floor(
      state.geometryStateIndex / CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
    );
    const nextTransformState = nextDistinctPreparedState(
      states,
      timelineStateIndex,
      cycle.cycleStartState,
      (candidate) => Math.floor(
        candidate.geometryStateIndex / CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
      ),
    );
    const nextLightingState = nextDistinctPreparedState(
      states,
      timelineStateIndex,
      cycle.cycleStartState,
      (candidate) => candidate.lightingPageIndex,
    );
    return Object.freeze({
      ...state,
      transformBlockIndex,
      nextTransformBlockGeometryStateIndex: nextTransformState.geometryStateIndex,
      nextLightingPageIndex: nextLightingState.lightingPageIndex,
    });
  }));
}

function prepareFrontFacingTransformSchedule(schedule, faceCount) {
  if (!Array.isArray(schedule) || schedule.length !== 360 || faceCount !== 1_200 ||
      schedule.some((indices) => !Array.isArray(indices) || indices.length < 1 ||
        indices.some((faceIndex) => !Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= faceCount) ||
        new Set(indices).size !== indices.length)) {
    throw new Error("Prepared cssFlower front-face transform schedule is invalid");
  }
  const bytesPerState = Math.ceil(faceCount / 8);
  const bytes = Buffer.alloc(schedule.length * bytesPerState);
  const selectedByState = schedule.map((indices, stateIndex) => {
    for (const faceIndex of indices) {
      bytes[stateIndex * bytesPerState + (faceIndex >> 3)] |= 1 << (faceIndex & 7);
    }
    return indices.length;
  });
  const selectedFaceCount = selectedByState.reduce((sum, count) => sum + count, 0);
  let visibilityChangeCount = 0;
  for (let stateIndex = 0; stateIndex < schedule.length; stateIndex += 1) {
    const previousStateIndex = (stateIndex + schedule.length - 1) % schedule.length;
    for (let byteIndex = 0; byteIndex < bytesPerState; byteIndex += 1) {
      visibilityChangeCount += popcount8(
        bytes[stateIndex * bytesPerState + byteIndex] ^
        bytes[previousStateIndex * bytesPerState + byteIndex],
      );
    }
  }
  const fieldCount = schedule.length * faceCount;
  return Object.freeze({
    schema: CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA,
    stateCount: schedule.length,
    faceCount,
    dilationTicks: CSSFLOWER_FRONT_FACE_DILATION_TICKS,
    selectionDomain: CSSFLOWER_VISIBILITY_POLICY.selectionDomain,
    depthComparison: CSSFLOWER_VISIBILITY_POLICY.depthComparison,
    minimumOwnedPixels: CSSFLOWER_VISIBILITY_POLICY.minimumOwnedPixels,
    sampleGrid: CSSFLOWER_VISIBILITY_POLICY.sampleGrid,
    adjacency: CSSFLOWER_VISIBILITY_POLICY.adjacency,
    adjacencyRings: CSSFLOWER_VISIBILITY_POLICY.adjacencyRings,
    dilationPolicy: CSSFLOWER_VISIBILITY_POLICY.dilationPolicy,
    encoding: CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING,
    bytesPerState,
    byteLength: bytes.length,
    selectedFaceCount,
    suppressedFaceCount: fieldCount - selectedFaceCount,
    meanSelectedFacesPerState: selectedFaceCount / schedule.length,
    minimumSelectedFacesPerState: Math.min(...selectedByState),
    maximumSelectedFacesPerState: Math.max(...selectedByState),
    initialVisibilitySelectionCount: faceCount,
    visibilityChangeCount,
    dataSha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64: bytes.toString("base64"),
    runtimeSelection: "prepared-bit-test-only-no-geometry-projection-normal-or-lighting-calculation",
  });
}

function popcount8(value) {
  let count = 0;
  for (let bits = value & 255; bits !== 0; bits &= bits - 1) count += 1;
  return count;
}

function nextDistinctPreparedState(states, stateIndex, cycleStartState, keyFor) {
  const currentKey = keyFor(states[stateIndex]);
  let cursor = stateIndex + 1 < states.length ? stateIndex + 1 : cycleStartState;
  for (let checked = 0; checked < states.length; checked += 1) {
    const candidate = states[cursor];
    if (keyFor(candidate) !== currentKey) return candidate;
    cursor = cursor + 1 < states.length ? cursor + 1 : cycleStartState;
  }
  throw new Error(`Prepared cssFlower schedule never leaves asset key ${currentKey}`);
}

export function createCssflowerSceneContract(value = {}) {
  return value;
}

function publicLightingContract(lighting, assets) {
  if (assets?.encoding !== CSSFLOWER_LIGHTING_ATLAS_ENCODING ||
      assets.mimeType !== CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE ||
      assets.quality !== CSSFLOWER_LIGHTING_ATLAS_QUALITY ||
      assets.assetCount !== 1 ||
      assets.grid?.columns !== CSSFLOWER_LIGHTING_GRID_COLUMNS ||
      assets.grid?.rows !== CSSFLOWER_LIGHTING_GRID_ROWS ||
      assets.grid?.width !== CSSFLOWER_LIGHTING_GRID_WIDTH ||
      assets.grid?.height !== CSSFLOWER_LIGHTING_GRID_HEIGHT ||
      assets.pages?.length !== lighting.pages.length) {
    throw new Error("Prepared cssFlower public lighting asset contract is incomplete");
  }
  return Object.freeze({
    ...lighting,
    distribution: assets.distribution,
    assetUrl: assets.grid.assetUrl,
    assetSha256: assets.grid.sha256,
    grid: assets.grid,
    pages: assets.pages,
    totalEncodedBytes: assets.encodedGridBytes,
    contentAddressedBytes: assets.contentAddressedBytes,
    assetCount: assets.assetCount,
    visualEncoding: Object.freeze({
      codec: "AVIF",
      encoding: assets.encoding,
      mimeType: assets.mimeType,
      quality: assets.quality,
      chromaSubsampling: "4:4:4",
      speed: 6,
      policy: "bounded-lossy-prepared-leaf-lighting-only",
      exactGeometry: true,
      exactPreparedPixels: false,
    }),
    encoder: assets.encoder,
  });
}
