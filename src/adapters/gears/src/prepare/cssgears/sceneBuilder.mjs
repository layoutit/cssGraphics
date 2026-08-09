import { PORT_FORMAT_ADAPTERS } from "./formatAdapters.mjs";
import { captureInvoluteGeometry } from "./nativeGeometry.mjs";
import { buildPreparedGearsLighting } from "./preparedLighting.mjs";
import { buildPreparedGearsRenderBundles } from "./preparedRenderBundles.mjs";
import { sourceProvenanceFor } from "./provenance.mjs";
import { cssgearsSlicePlan, describeFirstSlice } from "./slicePlan.mjs";
import {
  buildPreparedShowreel,
  buildSourceBoundSceneProfile,
  sourcePolygonToPolyCss,
} from "./sourceProfile.mjs";

export async function buildCssgearsFirstSliceScene({ dataSource, nativeCapture, sceneId = "fixed-non-planetary" } = {}) {
  if (typeof sceneId !== "string" || !/^(?:fixed-non-planetary|seed-[1-9][0-9]*)$/u.test(sceneId)) {
    throw new RangeError(`Invalid prepared cssGears scene ${sceneId}`);
  }
  const {
    sourceProfile,
    assembly,
    playback,
    camera,
  } = buildSourceBoundSceneProfile(nativeCapture);
  const capturedMeshes = [];
  let sourcePolygonCount = 0;
  let sourceTriangleCount = 0;
  let sourceQuadCount = 0;
  for (let gearIndex = 0; gearIndex < assembly.gears.length; gearIndex += 1) {
    const gear = assembly.gears[gearIndex];
    const captured = await captureInvoluteGeometry(dataSource.root, gear);
    const polygons = captured.polygons.map((polygon) => {
      if (polygon.vertices.length === 3) sourceTriangleCount += 1;
      else if (polygon.vertices.length === 4) sourceQuadCount += 1;
      else throw new Error(`Unsupported XScreenSaver polygon arity ${polygon.vertices.length}`);
      const reflected = sourcePolygonToPolyCss(polygon, assembly);
      return Object.freeze({
        vertices: reflected.vertices,
        normals: reflected.normals,
        material: Object.freeze([...polygon.color]),
      });
    });
    sourcePolygonCount += captured.sourcePolygonCount;
    capturedMeshes.push(Object.freeze({
      id: `gear-${gear.id}`,
      kind: "xscreensaver-involute-gear",
      sourceId: `gears.c:seed-${sourceProfile.seed}:gear-${gear.id}`,
      stableDom: true,
      excludeFromAutoCenter: true,
      gearIndex,
      sourceGear: publicGearRecord(gear),
      polygons: Object.freeze(polygons),
    }));
  }
  const showreel = buildPreparedShowreel(
    playback,
    assembly,
    sourceProfile,
    capturedMeshes,
  );

  if (sourceTriangleCount !== 0 || sourceQuadCount !== sourcePolygonCount) {
    throw new Error(`Prepared cssGears bank seed ${sourceProfile.seed} is outside the quad-only retained renderer contract`);
  }

  const lightingPreparation = buildPreparedGearsLighting({
    faces: capturedMeshes.flatMap((mesh) => mesh.polygons.map((polygon) => ({
      gearIndex: mesh.gearIndex,
      vertices: polygon.vertices,
      normals: polygon.normals,
      material: polygon.material,
    }))),
    assembly,
    sourceProfile,
    playback,
    showreel,
  });
  const renderPreparation = buildPreparedGearsRenderBundles({
    meshes: capturedMeshes,
    faceVertexColors: lightingPreparation.faceVertexColors,
    lighting: lightingPreparation.contract,
  });
  const meshes = renderPreparation.meshes;

  return Object.freeze({
    schema: "cssgears-prepared-scene@1",
    id: sceneId,
    label: `XScreenSaver Gears — native seed ${sourceProfile.seed}`,
    mode: cssgearsSlicePlan.mode,
    artifactMode: cssgearsSlicePlan.artifactMode,
    firstSlice: describeFirstSlice(),
    source: sourceProvenanceFor(dataSource),
    sourceProfile,
    adapters: PORT_FORMAT_ADAPTERS,
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      representation: "prepared-contiguous-coplanar-render-bundles-with-stable-rigid-gear-roots",
      stableDom: true,
      merge: "prepared-source-coverage-bundles",
      meshResolution: "lossless",
      runtimeGeometryConstruction: false,
      runtimeCameraCalculation: false,
      runtimeRatioCalculation: false,
      runtimeMeshingPhaseCalculation: false,
      runtimeLightingCalculation: false,
      runtimeLightingPublication: false,
      runtimeEdgeSelection: false,
      sourceBackfaceCulling: "GL_CULL_FACE",
      sourceFrontFace: "GL_CCW",
      preparedWinding: "flip-y-reflection-reversed-to-ccw",
      runtimeDomGrowth: false,
    }),
    camera,
    controls: "none",
    background: "#000000",
    textureLighting: "baked",
    textureQuality: 1,
    lighting: renderPreparation.lighting,
    assembly,
    playback,
    showreel,
    meshes: Object.freeze(meshes),
    metrics: Object.freeze({
      meshCount: meshes.length,
      sourceGearCount: meshes.length,
      sourcePolygonCount,
      sourceTriangleCount,
      sourceQuadCount,
      preparedPolygonCount: renderPreparation.metrics.preparedLeafCount,
      preparedLeafCount: renderPreparation.metrics.preparedLeafCount,
      preparedPolygonLeafCount: renderPreparation.metrics.preparedPolygonLeafCount,
      preparedRenderBundleCount: renderPreparation.metrics.preparedRenderBundleCount,
      mergedSourceFaceCount: renderPreparation.metrics.mergedSourceFaceCount,
      sourceFaceCoverageCount: renderPreparation.metrics.sourceFaceCoverageCount,
      sourceFaceCoverageSha256: renderPreparation.metrics.sourceFaceCoverageSha256,
      sourceFaceCoverageExact: renderPreparation.metrics.sourceFaceCoverageExact,
      preparedAssemblyRootCount: 1,
      preparedGearRootCount: meshes.length,
      preparedAssemblyTransformFoldedIntoGearRoots: true,
      preparedGearThetaSignPreserved: true,
      preparedTimelineStateCount: playback.stateCount,
      preparedShowreelStateCount: showreel.stateCount,
      preparedShowreelSpinMilliseconds: showreel.phases.spin.durationMilliseconds,
      preparedShowreelEdgeCandidateCount: showreel.edgeSelection.candidatesEvaluated,
      preparedShowreelCrossingPairCount: showreel.edgeSelection.crossingPairCount,
      preparedShowreelContinuousPathQualified: showreel.edgeSelection.continuousPathQualification,
      preparedLightingStateCount: renderPreparation.lighting.atlasStateCount,
      preparedLightingUsesPresentationSceneRotation: true,
      atlasPageCount: 1,
      unresolvedTextureCount: 0,
      mergeCandidateSurfaceCount: sourceQuadCount,
      mergeEligibleSurfaceCount: renderPreparation.metrics.mergedSourceFaceCount,
      runtimePolygonConstructionCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeRatioCalculationCount: 0,
      runtimeMeshingPhaseCalculationCount: 0,
      runtimeLightingCalculationCount: 0,
      runtimeLightingPublicationCount: 0,
      runtimeEdgeSelectionCount: 0,
      runtimeDomGrowth: false,
    }),
    oracle: Object.freeze({
      geometryCapture: "exact-source-call-census-pass",
      nativeSeed: nativeCapture.seed,
      nativeStateSha256: nativeCapture.stateSha256,
      nativeFrameSha256: nativeCapture.frameSha256,
      assemblyFormulaComparison: "exact-seeded-native-state-consumed",
      nativeFrameCapture: "headless-cgl-source-frame-captured",
      visualComparison: "unqualified",
    }),
    warnings: Object.freeze([
      "The assembly, gear parameters, source scene transform, and tick-zero angles are exact outputs of the seeded native gears.c run; product framing keeps every scene right-facing with a narrow source-derived three-quarter yaw variance while preserving source roll.",
      "Each prepared gear root publishes the positive native g->th value after the PolyCSS leaf basis conversion; negating theta here rotates asymmetric spokes and tooth phases away from the native frame.",
      "The compiled display list is a finite 720-state source segment and intentionally does not claim a closed animation cycle.",
      "Geometry polygon counts are exact outputs of the pinned involute.c call stream; native/browser visual parity is not yet claimed.",
      "Lighting is prepared once for the product scene rotation using captured native vertex normals and the source fixed-eye-space ambient, diffuse, specular, and shininess terms; runtime lighting publication is forbidden.",
      "The prepared product camera is a presentation adjustment, so the native frame remains evidence rather than a pixel-identical product-frame claim.",
      "Native moving-highlight parity is intentionally not claimed; visual qualification remains oracle-owned.",
      "The flip-Y OpenGL-to-CSS reflection reverses each prepared vertex/normal row once to preserve native GL_CCW winding for backface-visibility:hidden.",
      "Only shared-edge connected, coplanar, same-material, contiguous paint-order runs are bundled; exact source-face coverage remains prepare-gated.",
    ]),
  });
}

function publicGearRecord(gear) {
  return Object.freeze({
    id: gear.id,
    parent: gear.parent,
    angle: gear.angle,
    nteeth: gear.nteeth,
    radius: gear.radius,
    toothWidth: gear.toothW,
    toothHeight: gear.toothH,
    thickness: gear.thickness,
    innerRadius: gear.innerR,
    innerRadius2: gear.innerR2,
    nubs: gear.nubs,
    spokes: gear.spokes,
    size: gear.size,
    ratio: gear.ratio,
    initialTheta: gear.initialTheta,
    position: Object.freeze([gear.x, gear.y, gear.z]),
  });
}

export function createCssgearsSceneContract(value = {}) {
  return value;
}
