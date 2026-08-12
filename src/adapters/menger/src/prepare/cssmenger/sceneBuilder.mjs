import { PORT_FORMAT_ADAPTERS } from "./formatAdapters.mjs";
import { buildMengerPreparedGeometry } from "./mengerGeometry.mjs";
import { buildPreparedMengerPlaneAtlas } from "./preparedPlaneAtlas.mjs";
import { sourceProvenanceFor } from "./provenance.mjs";
import { cssmengerSlicePlan, describeFirstSlice } from "./slicePlan.mjs";
import { buildPreparedMengerPlayback } from "./sourcePlayback.mjs";

const SCENE_DEPTHS = Object.freeze({
  "depth-2": 2,
  "depth-3": 3,
});
const VIEWPORT = Object.freeze({ width: 960, height: 600 });
const SOURCE_FOV_DEGREES = 30;
const SOURCE_EYE_Z = 30;
const POLYCSS_SOURCE_UNIT_PIXELS = 70;

export async function buildCssmengerFirstSliceScene({ dataSource, sceneId = "depth-3" } = {}) {
  const depth = SCENE_DEPTHS[sceneId];
  if (!depth) throw new RangeError(`Unknown prepared cssMenger scene ${sceneId}`);
  if (!dataSource?.sourceCommit) throw new Error("cssMenger scene preparation requires verified source identity");
  const playback = buildPreparedMengerPlayback();
  const initialColorRow = playback.colorRows[playback.initial.stateIndex];
  const axisColors = initialColorRow.map((index) => playback.palette[index].material);
  const geometry = buildMengerPreparedGeometry({ depth, axisColors });
  const planeAtlas = buildPreparedMengerPlaneAtlas({
    geometry,
    palette: playback.palette.map((entry) => entry.material),
  });
  const perspective = VIEWPORT.height / 2 / Math.tan(SOURCE_FOV_DEGREES * Math.PI / 360);
  return Object.freeze({
    schema: "cssmenger-prepared-scene@1",
    id: sceneId,
    label: `XScreenSaver Menger — deterministic depth ${depth}`,
    mode: cssmengerSlicePlan.mode,
    artifactMode: cssmengerSlicePlan.artifactMode,
    firstSlice: describeFirstSlice(),
    source: sourceProvenanceFor(dataSource),
    adapters: PORT_FORMAT_ADAPTERS,
    sourceProfile: Object.freeze({
      schema: "cssmenger-source-profile@1",
      seed: playback.seed,
      depth,
      cellsPerAxis: geometry.cellsPerAxis,
      sourceBounds: Object.freeze([-1.5, 1.5]),
      sourceScale: 2.2,
      faceTraversal: "menger.c x/y/z display-list order; x-major, y-middle, z-minor recursion",
      faceMaskOptimization: "exact menger_recurs_1 visible-face mask rules",
      randomProvider: "utils/yarandom.c 55-word additive generator",
      paletteProvider: "utils/colors.c make_smooth_colormap plus utils/hsv.c",
      motionProvider: "hacks/glx/rotator.c spin with wander disabled for the first slice",
      preparedLoopClosure:
        "native rotator prefix followed by a prepare-time C2 cyclic closure; no browser interpolation or rotation calculation",
    }),
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      representation: "prepared-alpha-atlas-coplanar-plane-bundles-in-retained-snapshot",
      textureBackend: "atlas",
      textureLeafSizing: "raster",
      stableDom: true,
      merge: "one-prepared-alpha-atlas-quad-per-directional-plane",
      preparedPlaneGridSnap: "exact-source-cell-boundary-matrix3d",
      transformPresentation: "compositor-css-keyframes-through-prepared-30ms-states-on-existing-scene-node",
      backfacePolicy: "prepared-closed-opaque-surface-cull",
      runtimeGeometryConstruction: false,
      runtimeRecursion: false,
      runtimeMerge: false,
      runtimeColorGeneration: false,
      runtimeRotationCalculation: false,
      runtimeCameraCalculation: false,
      runtimeDomGrowth: false,
      alternateRenderer: false,
    }),
    camera: Object.freeze({
      projection: "perspective",
      fovDegrees: SOURCE_FOV_DEGREES,
      sourceViewport: VIEWPORT,
      perspective,
      zoom: POLYCSS_SOURCE_UNIT_PIXELS,
      rotX: 0,
      rotY: 0,
      target: Object.freeze([0, 0, 0]),
      distance: POLYCSS_SOURCE_UNIT_PIXELS * SOURCE_EYE_Z - perspective,
    }),
    controls: "none",
    background: "#000000",
    textureLighting: "baked",
    textureQuality: 1,
    textureLeafSizing: "raster",
    lighting: Object.freeze({
      ambient: Object.freeze({ color: "#ffffff", intensity: 1 }),
      directional: Object.freeze({ direction: Object.freeze([0, -1, 0]), color: "#ffffff", intensity: 0 }),
    }),
    playback,
    planeAtlas,
    meshes: geometry.meshes,
    metrics: Object.freeze({
      meshCount: geometry.meshes.length,
      sourceDepth: depth,
      sourceCellCount: 20 ** depth,
      ...geometry.metrics,
      preparedPlaneTexturePatternCount: planeAtlas.patternCount,
      preparedPlaneAtlasWidth: planeAtlas.width,
      preparedPlaneAtlasHeight: planeAtlas.height,
      preparedPlaneAtlasDecodedBytes: planeAtlas.decodedBytes,
      preparedRenderWrapperCount: 2,
      preparedModelRootCount: 0,
      preparedLightingRootCount: 0,
      preparedAxisRootCount: 0,
      preparedTimelineStateCount: playback.stateCount,
      preparedPaletteColorCount: playback.palette.length,
      preparedColorRowCount: playback.colorRows.length,
      preparedBackfaceCulling: true,
      atlasPageCount: 1,
      unresolvedTextureCount: 0,
      runtimePolygonConstructionCount: 0,
      runtimeRecursionCount: 0,
      runtimeMergeCount: 0,
      runtimeColorGenerationCount: 0,
      runtimeRotationCalculationCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeDomGrowth: false,
    }),
    oracle: Object.freeze({
      sourceIdentity: "exact-pinned-commit-and-primary-source-hash",
      sourceSemanticAdapter: "exact-recursion-random-palette-rotator-port-with-contract-tests",
      nativeStateCapture: "qualified-local-exact-common-prefix-0-45",
      nativeVisualCapture: "qualified-local-bit-exact-aa-common-prefix-0-45",
      browserVisualCapture: "qualified-local-bit-exact-aa-common-prefix-0-45",
      visualComparison: "exact-first-common-prefix-diverged",
    }),
    warnings: Object.freeze([
      `This prepared product scene fixes source depth at ${depth}; the XScreenSaver depth-change sequence remains outside this slice.`,
      "The prepared source rotator prefix closes through a prepare-time C2 forward cycle without an endpoint reversal or final-to-first transform jump.",
      "Wander and interactive trackball input are disabled in this first slice.",
      "Axis material colors follow the prepared XScreenSaver palette rows; fixed-function two-light moving highlights are not yet a native visual-parity claim.",
      "Coplanar bundles preserve an exact one-to-one census of all source faces before merging.",
      "The exact-first native/browser pixel oracle diverges because the native moving fixed-function lighting is not yet prepared; native visual parity remains unqualified.",
    ]),
  });
}
