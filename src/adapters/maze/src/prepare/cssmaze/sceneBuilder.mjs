import { PORT_FORMAT_ADAPTERS } from "./formatAdapters.mjs";
import { sourceProvenanceFor } from "./provenance.mjs";
import { cssmazeSlicePlan, describeFirstSlice } from "./slicePlan.mjs";

const SOURCE_UNIT_PIXELS = 50;
const CAMERA_HEIGHT = 0.5;
const CAMERA_PERSPECTIVE_PIXELS = 270;
const CAMERA_ZOOM = 240;
const PREPARED_SCENE_SCALE = CAMERA_ZOOM / SOURCE_UNIT_PIXELS;
const CAMERA_EYE_OFFSET_PIXELS = CAMERA_PERSPECTIVE_PIXELS / PREPARED_SCENE_SCALE;
const WALL_TEXTURE_URL = "/cssmaze/assets/brick1.png";
const CEILING_TEXTURE_URL = "/cssmaze/assets/brick2.png";
const FLOOR_TEXTURE_URL = "/cssmaze/assets/wood2.png";

export function buildCssmazeFirstSliceScene({ dataSource, nativeCapture, rotationScore, sceneId = "default-maze" } = {}) {
  const state = nativeCapture?.state;
  if (!state) throw new Error("cssMaze scene preparation requires a native source-state capture");
  const walls = buildWallPolygons(state.grid);
  const surfaces = buildSurfacePolygons(state.logicalColumns, state.logicalRows);
  const preparedPolygons = Object.freeze([...surfaces, ...walls]);
  const playback = buildPreparedPlayback(state.frames, state.frameDelayMicroseconds, walls);
  const wallSourceIds = walls.map((polygon) => polygon.data.sourceId);
  const mergeCandidatePairCount = countCollinearWallPairs(state.grid);

  return Object.freeze({
    schema: "cssmaze-prepared-scene@1",
    id: sceneId,
    label: `XScreenSaver Maze3D — source seed ${state.seed}`,
    mode: cssmazeSlicePlan.mode,
    artifactMode: cssmazeSlicePlan.artifactMode,
    firstSlice: describeFirstSlice(),
    source: sourceProvenanceFor(dataSource, nativeCapture),
    adapters: PORT_FORMAT_ADAPTERS,
    sourceProfile: Object.freeze({
      schema: "cssmaze-source-profile@1",
      id: `xscreensaver-maze3d-seed-${state.seed}`,
      seed: state.seed,
      logicalRows: state.logicalRows,
      logicalColumns: state.logicalColumns,
      gridRows: state.gridRows,
      gridColumns: state.gridColumns,
      grid: Object.freeze([...state.grid]),
      start: Object.freeze([...state.start]),
      finish: Object.freeze([...state.finish]),
      generation: "maze3d.c randomized Prim algorithm through headless source-state dump",
      traversal: "maze3d.c left-hand camera state machine through headless source-state dump",
      randomProvider: "platform libc random() seeded before each prepared replay",
      rotationScore,
      defaultWallTexture: "hacks/images/brick1.png",
      defaultFloorTexture: "hacks/images/wood2.png",
      defaultCeilingTexture: "hacks/images/brick2.png",
    }),
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      representation: "prepared-textured-source-quads-in-stable-retained-snapshot",
      textureBackend: "atlas",
      textureLeafSizing: "raster",
      textureImageRendering: "pixelated",
      textureProjection: "affine",
      uniformCameraScale3d: true,
      stableDom: true,
      runtimeGeometryConstruction: false,
      runtimeMazeGeneration: false,
      runtimeRouteSolving: false,
      runtimeTextureRasterization: false,
      runtimeCameraCalculation: false,
      runtimeVisibilityCalculation: false,
      runtimeLightingCalculation: false,
      runtimeDomGrowth: false,
    }),
    camera: Object.freeze({
      projection: "perspective",
      fovDegrees: 90,
      sourceViewport: Object.freeze({ width: 960, height: 540 }),
      perspective: CAMERA_PERSPECTIVE_PIXELS,
      zoom: CAMERA_ZOOM,
      preparedSceneScale: PREPARED_SCENE_SCALE,
      preparedEyeOffsetPixels: CAMERA_EYE_OFFSET_PIXELS,
      rotX: 0,
      rotY: 0,
      target: Object.freeze([0, 0, 0]),
      distance: 0,
      near: 0.05,
      far: 100,
    }),
    controls: "none",
    background: "#000000",
    textureLighting: "baked",
    textureQuality: 1,
    lighting: Object.freeze({
      ambient: Object.freeze({ color: "#ffffff", intensity: 3.25 }),
      directional: Object.freeze({ direction: Object.freeze([0, -1, 0]), color: "#ffffff", intensity: 0 }),
    }),
    playback,
    meshes: Object.freeze([
      Object.freeze({
        id: "maze-surfaces",
        kind: "xscreensaver-maze-floor-ceiling",
        sourceId: "maze3d.c:drawFloor+drawCeiling",
        stableDom: true,
        excludeFromAutoCenter: true,
        polygons: Object.freeze(surfaces),
      }),
      Object.freeze({
        id: "maze-walls",
        kind: "xscreensaver-maze-wall-bank",
        sourceId: "maze3d.c:drawWalls",
        stableDom: true,
        excludeFromAutoCenter: true,
        polygons: Object.freeze(walls),
      }),
    ]),
    metrics: Object.freeze({
      meshCount: 2,
      sourceGridCellCount: state.gridRows * state.gridColumns,
      sourceWallSegmentCount: walls.length,
      sourceFloorPolygonCount: 1,
      sourceCeilingPolygonCount: 1,
      sourcePolygonCount: walls.length + 2,
      sourceTriangleCount: 0,
      sourceQuadCount: walls.length + 2,
      preparedFloorLeafCount: 1,
      preparedCeilingLeafCount: 1,
      preparedPolygonCount: walls.length + surfaces.length,
      preparedLeafCount: walls.length + surfaces.length,
      preparedWorldRootCount: 1,
      preparedWallRootCount: 1,
      preparedSurfaceRootCount: 1,
      preparedTimelineStateCount: state.frameCount,
      preparedLeafVisibilitySetCount: playback.leafVisibilitySets.length,
      preparedLeafVisibilityDeltaRowCount: playback.leafVisibilityChangeRows.length,
      preparedLeafVisibilityDeltaOperationCount: playback.leafVisibilityChangeRows
        .reduce((sum, row) => sum + row.length, 0),
      preparedInitialLeafVisibilityOperationCount: playback.initialLeafVisibilityChanges.length,
      atlasPageCount: 1,
      textureSourceCount: 3,
      unresolvedTextureCount: 0,
      mergeCandidateSurfaceCount: walls.length,
      mergeCandidatePairCount,
      preparedMergeCount: 0,
      sourceWallCoverageCount: wallSourceIds.length,
      sourceWallCoverageExact: new Set(wallSourceIds).size === wallSourceIds.length,
      runtimePolygonConstructionCount: 0,
      runtimeMazeGenerationCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeVisibilityCalculationCount: 0,
      runtimeLeafVisibilityComparisonCount: 0,
      runtimeDomGrowth: false,
    }),
    oracle: Object.freeze({
      sourceStateDump: "exact-generation-and-camera-state-evidence",
      sourceStateSha256: nativeCapture.stateSha256,
      nativeVisualCapture: "local-source-backed-helper-available-unqualified",
      nativeVisualRenderer: "native/maze3d-oracle.c",
      visualComparison: "unqualified",
    }),
    warnings: Object.freeze([
      "The first slice excludes rats, inverters, overlay, acid modes, floating images, and user-supplied textures.",
      "The deterministic replay resets the same seed after the source finishing wall descent; XScreenSaver normally advances libc random() into a newly generated maze.",
      "The source-state dump proves the prepared generation and camera rows, not native pixel parity.",
      "The local OpenGL comparison helper shares the first-slice source algorithms and textures but is not a full pinned XScreenSaver binary oracle.",
      "The source floor and ceiling remain one retained quad each; they are never rebuilt, subdivided, or visibility-toggled at runtime.",
      "Prepared visibility rejects only wall leaves wholly behind the source near plane; Chromium clips crossing source quads in the uniform 3D camera context.",
      "The three pinned XScreenSaver texture files are distributable with the upstream copyright and permission notice recorded in debian/copyright.",
      "Wall segments retain exact source draw coverage. Coplanar merge pairs are measured but intentionally not emitted in this prototype.",
    ]),
  });
}

function buildWallPolygons(grid) {
  const polygons = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row].length; column += 1) {
      if (grid[row][column] !== "#") continue;
      if (row % 2 === 1 && column % 2 === 0) {
        const x = column / 2;
        const z0 = Math.floor(row / 2);
        polygons.push(texturedSourceQuad({
          vertices: [[x, 0, z0], [x, 0, z0 + 1], [x, 1, z0 + 1], [x, 1, z0]],
          texture: WALL_TEXTURE_URL,
          uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
          sourceId: `maze3d.c:wall:r${row}:c${column}`,
          group: "wall-x",
        }));
      } else if (row % 2 === 0 && column % 2 === 1) {
        const x0 = Math.floor(column / 2);
        const z = row / 2;
        polygons.push(texturedSourceQuad({
          vertices: [[x0, 0, z], [x0 + 1, 0, z], [x0 + 1, 1, z], [x0, 1, z]],
          texture: WALL_TEXTURE_URL,
          uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
          sourceId: `maze3d.c:wall:r${row}:c${column}`,
          group: "wall-z",
        }));
      }
    }
  }
  return polygons;
}

function buildSurfacePolygons(columns, rows) {
  return [
    texturedSourceQuad({
      vertices: [[0, 0, 0], [columns, 0, 0], [columns, 0, rows], [0, 0, rows]],
      texture: FLOOR_TEXTURE_URL,
      uvs: [[0, 0], [columns, 0], [columns, rows], [0, rows]],
      sourceId: "maze3d.c:drawFloor",
      group: "floor",
    }),
    texturedSourceQuad({
      vertices: [[0, 1, 0], [columns, 1, 0], [columns, 1, rows], [0, 1, rows]],
      texture: CEILING_TEXTURE_URL,
      uvs: [[0, 0], [columns, 0], [columns, rows], [0, rows]],
      sourceId: "maze3d.c:drawCeiling",
      group: "ceiling",
    }),
  ];
}

function texturedSourceQuad({ vertices, texture, uvs, sourceId, group }) {
  const order = [3, 2, 1, 0];
  return Object.freeze({
    vertices: Object.freeze(order.map((index) => Object.freeze([
      -vertices[index][1],
      vertices[index][0],
      vertices[index][2],
    ]))),
    texture,
    color: "#ffffff",
    uvs: Object.freeze(order.map((index) => Object.freeze([...uvs[index]]))),
    textureWrap: Object.freeze({ s: "repeat", t: "repeat" }),
    textureAlphaMode: "opaque",
    doubleSided: true,
    data: Object.freeze({ sourceId, group, texture }),
  });
}

function buildPreparedPlayback(frames, frameDelayMicroseconds, walls) {
  const cameraTransforms = [];
  const wallTransforms = [];
  const leafVisibilitySets = [];
  const cameraIndices = new Map();
  const wallIndices = new Map();
  const leafVisibilityIndices = new Map();
  const frameRows = [];
  const sourceStateCodes = [];
  const sourceCameraPoses = [];
  let previousSourceRotation = null;
  let preparedContinuousRotation = null;
  for (const frame of frames) {
    const [, x, z, rotation, wallHeight, sourceState] = frame;
    preparedContinuousRotation = previousSourceRotation === null
      ? rotation
      : preparedContinuousRotation + wrappedAngularDelta(rotation, previousSourceRotation);
    previousSourceRotation = rotation;
    const cameraTransform = `translateZ(${number(CAMERA_EYE_OFFSET_PIXELS)}px) rotateY(${number(preparedContinuousRotation)}deg) translate3d(${number(-x * SOURCE_UNIT_PIXELS)}px, ${number(CAMERA_HEIGHT * SOURCE_UNIT_PIXELS)}px, ${number(-z * SOURCE_UNIT_PIXELS)}px)`;
    const wallTransform = `scaleY(${number(wallHeight)})`;
    const leafVisibility = buildPreparedWallVisibility(walls, x, z, rotation);
    const cameraIndex = intern(cameraTransforms, cameraIndices, cameraTransform);
    const wallIndex = intern(wallTransforms, wallIndices, wallTransform);
    const leafVisibilityIndex = intern(leafVisibilitySets, leafVisibilityIndices, leafVisibility);
    frameRows.push(Object.freeze([cameraIndex, wallIndex, leafVisibilityIndex]));
    sourceStateCodes.push(sourceState);
    sourceCameraPoses.push(Object.freeze([x, z, rotation]));
  }
  const initialVisibility = "1".repeat(walls.length);
  const initialLeafVisibilityChanges = encodeVisibilityChanges(
    initialVisibility,
    leafVisibilitySets[frameRows[0][2]],
  );
  const leafVisibilityChangeRows = frameRows.map((row, index) => {
    const previousRow = frameRows[index === 0 ? frameRows.length - 1 : index - 1];
    return encodeVisibilityChanges(
      leafVisibilitySets[previousRow[2]],
      leafVisibilitySets[row[2]],
    );
  });
  return Object.freeze({
    schema: "cssmaze-prepared-playback@1",
    layout: "direct-camera-and-wall-transform-index-rows",
    sourceFrameDelayMilliseconds: frameDelayMicroseconds / 1000,
    sourceScheduler: "maze3d.c DEFAULTS delay",
    sourceSpeed: 1,
    stateCount: frameRows.length,
    segmentStartState: 0,
    segmentEndState: frameRows.length - 1,
    loop: true,
    closes: false,
    resetPolicy: "repeat-fixed-seed-after-finished-wall-descent",
    runtimeInterpolation: false,
    runtimeEasingCalculation: false,
    preparedCompositorInterpolation: true,
    preparedCompositorInterpolationMilliseconds: frameDelayMicroseconds / 1000,
    preparedCompositorTimingFunction: "linear",
    preparedLoopResetTransition: "instant",
    leafVisibilityPolicy: "prepared-wall-any-front-near-plane-rejection-surfaces-always-visible",
    leafVisibilityNearSourceUnits: 0.05,
    cameraTransforms: Object.freeze(cameraTransforms),
    wallTransforms: Object.freeze(wallTransforms),
    leafVisibilitySets: Object.freeze(leafVisibilitySets),
    initialLeafVisibilityChanges,
    leafVisibilityChangeRows: Object.freeze(leafVisibilityChangeRows),
    frameRows: Object.freeze(frameRows),
    sourceStateCodes: Object.freeze(sourceStateCodes),
    sourceCameraPoses: Object.freeze(sourceCameraPoses),
    initial: Object.freeze({
      stateIndex: 0,
      cameraTransformIndex: frameRows[0][0],
      wallTransformIndex: frameRows[0][1],
      leafVisibilityIndex: frameRows[0][2],
    }),
  });
}

function encodeVisibilityChanges(previous, next) {
  const operations = [];
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] === next[index]) continue;
    operations.push(next[index] === "1" ? index + 1 : -(index + 1));
  }
  return Object.freeze(operations);
}

function wrappedAngularDelta(current, previous) {
  return ((current - previous + 540) % 360) - 180;
}

function buildPreparedWallVisibility(walls, cameraX, cameraZ, rotationDegrees) {
  const radians = rotationDegrees * (Math.PI / 180);
  const forwardX = Math.sin(radians);
  const forwardZ = -Math.cos(radians);
  return walls.map((polygon) => {
    const depths = polygon.vertices.map((vertex) => {
      const sourceX = vertex[1];
      const sourceZ = vertex[2];
      return (sourceX - cameraX) * forwardX + (sourceZ - cameraZ) * forwardZ;
    });
    const visible = depths.some((depth) => depth > 0.05);
    return visible ? "1" : "0";
  }).join("");
}

function intern(values, indices, value) {
  const existing = indices.get(value);
  if (existing !== undefined) return existing;
  const index = values.length;
  values.push(value);
  indices.set(value, index);
  return index;
}

function countCollinearWallPairs(grid) {
  let count = 0;
  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row].length; column += 1) {
      if (grid[row][column] !== "#") continue;
      if (row % 2 === 1 && column % 2 === 0 && row + 2 < grid.length && grid[row + 2][column] === "#") count += 1;
      if (row % 2 === 0 && column % 2 === 1 && column + 2 < grid[row].length && grid[row][column + 2] === "#") count += 1;
    }
  }
  return count;
}

function number(value) {
  if (Object.is(value, -0) || value === 0) return "0";
  return Number(value.toFixed(6)).toString();
}
