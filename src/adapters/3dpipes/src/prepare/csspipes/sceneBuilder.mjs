import {
  buildPreparedPipeMeshes,
  CSSPIPES_CAMERA_CONTRACT,
  CSSPIPES_HISTORICAL_PALETTE,
  CSSPIPES_PALETTE,
  CSSPIPES_PREBAKE_CONFIG,
  CSSPIPES_PRODUCT_PALETTE,
  CSSPIPES_SOURCE_VIEWPORT,
  CSSPIPES_VIEWPORT_PROFILES,
} from "./endlessTubes.mjs";
import { buildPreparedClipLibrary } from "./preparedClips.mjs";
import { buildPipeSpaceTexelLighting } from "./preparedLighting.mjs";
import { CSSPIPES_PRODUCT } from "./slicePlan.mjs";

export async function buildCssPipesScene({
  lightingBundle = buildPipeSpaceTexelLighting(),
} = {}) {
  const playback = buildPreparedClipLibrary();
  const fallbackMaterialIndices = playback.clips[0].materialIndicesByPipe;
  const fallbackPipeColors = Object.freeze(
    fallbackMaterialIndices.map((index) => CSSPIPES_PALETTE[index]),
  );
  const pipeMeshes = buildPreparedPipeMeshes(
    playback.bandSlotsByPipe,
    fallbackPipeColors,
  );
  const lighting = Object.freeze({
    ...lightingBundle.contract,
    fallbackMaterialIndices,
    fallbackPipeColors,
    clipBindings: Object.freeze({
      schema: "csspipes-prepared-material-classes@1",
      bindingCount: lightingBundle.contract.materialColors.length * playback.radialSegments,
      runtimeRandomness: false,
      runtimePerLeafColorWrites: 0,
    }),
  });
  const preparedLeafCountPerBank = pipeMeshes.reduce(
    (total, pipe) => total + pipe.polygons.length,
    0,
  );
  const preparedLeafCount = preparedLeafCountPerBank * playback.retainedBankCount;
  if (preparedLeafCountPerBank !== playback.wallLeafTargetCount) {
    throw new Error("cssPipes retained tube leaf bank drifted from its prepared playback");
  }
  return Object.freeze({
    schema: "csspipes-prebaked-scene@11",
    id: CSSPIPES_PRODUCT.id,
    route: CSSPIPES_PRODUCT.route,
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      primitives: Object.freeze([
        "@layoutit/polycss#createPolyCylinder",
      ]),
      representation: "two-retained-banks-of-continuous-shared-ring-morphed-tube-meshes",
      morph: playback.morph,
      seamBleed: 0,
      merge: false,
      meshResolution: "lossless",
      stableDom: true,
      runtimeTopologyWork: false,
      runtimeDomGrowth: false,
    }),
    camera: Object.freeze({
      ...CSSPIPES_CAMERA_CONTRACT,
      sourceViewport: CSSPIPES_SOURCE_VIEWPORT,
      responsivePresentation: Object.freeze({
        schema: "csspipes-responsive-presentation@1",
        selection: "host-orientation-selects-prepared-seed-pool",
        profiles: CSSPIPES_VIEWPORT_PROFILES,
      }),
      ...playback.clips[0].camera.state,
    }),
    provenance: Object.freeze({
      classification: "original-generative-polycss-artwork",
      inspiration: Object.freeze(["XScreenSaver pipes.c", "Windows 3D Pipes"]),
      productAuthority: "cssPipes authored 64-clip pre-baked library",
      paletteAuthority: CSSPIPES_PRODUCT_PALETTE,
      historicalPaletteRecord: CSSPIPES_HISTORICAL_PALETTE,
      rendererAuthority: "@layoutit/polycss 0.2.11 cylinder plus @layoutit/polycss-morph 0.2.11 prepared-DOM target APIs",
      parityClaim: false,
    }),
    preBake: Object.freeze({
      ...CSSPIPES_PREBAKE_CONFIG,
      bandSlotsPerPipe: playback.bandSlotsPerPipe,
      bandSlotsByPipe: playback.bandSlotsByPipe,
      bandSlotCount: playback.bandSlotCount,
      retainedPipeRootCount: playback.retainedPipeRootCount,
      retainedRootCount: playback.retainedRootCount,
      retainedBankCount: playback.retainedBankCount,
      totalRetainedRootCount: playback.totalRetainedRootCount,
    }),
    playback,
    lighting,
    pipeMeshes,
    metrics: Object.freeze({
      clipCount: playback.clipCount,
      pipeMeshCount: pipeMeshes.length,
      pipeMeshInstanceCount: pipeMeshes.length * playback.retainedBankCount,
      bandSlotCount: playback.bandSlotCount,
      bandSlotsPerPipe: playback.bandSlotsPerPipe,
      bandSlotsByPipe: playback.bandSlotsByPipe,
      retainedPipeRootCount: playback.retainedPipeRootCount,
      retainedRootCount: playback.retainedRootCount,
      retainedBankCount: playback.retainedBankCount,
      totalRetainedRootCount: playback.totalRetainedRootCount,
      preparedLogicalSegmentCount: CSSPIPES_PREBAKE_CONFIG.logicalSegmentCount,
      preparedPolygonCount: preparedLeafCount,
      preparedLeafCount,
      preparedLeafCountPerBank,
      preparedWallLeafCount: playback.wallLeafTargetCount * playback.retainedBankCount,
      triangleEquivalentCount:
        playback.retainedBankCount * playback.wallLeafTargetCount * 2,
      preparedTransformStates: playback.metrics.preparedTransformStates,
      preparedRecordingFrames: playback.metrics.preparedRecordingFrames,
      preparedLeafTransitions: playback.metrics.preparedLeafTransitions,
      preparedRootMorphTargets: playback.totalRetainedRootCount,
      preparedLeafMorphTargets: playback.totalLeafTargetCount,
      preparedMorphTargets:
        playback.totalRetainedRootCount + playback.totalLeafTargetCount,
      preparedSnakeTailAssignments: playback.metrics.preparedSnakeTailAssignments,
      preparedSnakeTailFrames: playback.metrics.preparedSnakeTailFrames,
      preparedWeldedMeshVertices: playback.metrics.preparedWeldedMeshVertices,
      preparedWeldedMeshPolygons: playback.metrics.preparedWeldedMeshPolygons,
      preparedWeldedJoints: playback.metrics.preparedWeldedJoints,
      uniformBandSlotCount: playback.metrics.uniformBandSlotCount,
      packedBandSlotSavings: playback.metrics.packedBandSlotSavings,
      packedWallLeafSavings: playback.metrics.packedWallLeafSavings,
      totalSurfaceLeafSavings: playback.metrics.totalSurfaceLeafSavings,
      minBandsPerClip: playback.metrics.minBandsPerClip,
      maxBandsPerClip: playback.metrics.maxBandsPerClip,
      averageBandsPerClip: playback.metrics.averageBandsPerClip,
      preparedLightingFields: lighting.faces.length,
      preparedMaterialBindings: lighting.clipBindings.bindingCount,
      preparedMaterialDuplicateCount: playback.metrics.preparedMaterialDuplicateCount,
      minimumPreparedMaterialOklabDistance:
        playback.metrics.minimumPreparedMaterialOklabDistance,
      minimumPreparedScreenOccupiedCellCount:
        playback.metrics.minimumPreparedScreenOccupiedCellCount,
      runtimePolygonConstructionCount: 0,
      runtimePathGeneration: false,
      runtimeGeometrySemantics: false,
      runtimeDomGrowth: false,
    }),
    warnings: Object.freeze([
      "cssPipes is pipes.c and Windows 3D Pipes inspired artwork, not a behavioral or visual port",
      "each prepared clip builds every complete connected tube first and records its tip-to-seed retraction",
      "the optional Snake experiment replays inline prepared tail rows in one retained bank while the next prepared head grows in the other",
      "preparation groups tubes by fixed facet family, then ranks each family by band complexity into seven retained roots",
      "the browser replays those retained-leaf rows in reverse and has no straight, turn, or elbow operation",
      "every adjacent tube band shares the same prepared four-, five-, six-, or seven-vertex ring and every leaf matrix uses seamBleed 0",
      "projective tube quads explicitly zero both seamBleed and the projective guard bleed fallback",
      "the retained tubes are deliberately open-ended and contain no end-cap leaves or cap playback branches",
      "every clip uses the same fixed seven-color product palette, including authored amber, cool slate, and vivid purple, bound by source-pipe identity through static prepared CSS",
    ]),
  });
}
