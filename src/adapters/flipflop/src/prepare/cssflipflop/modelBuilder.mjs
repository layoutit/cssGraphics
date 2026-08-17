import {
  buildFlipFlopPresentationFrames,
  buildFlipFlopSourceFrames,
  buildFlipFlopTileGeometry,
  flipFlopFaceLightProfile,
  CSSFLIPFLOP_PIXELS_PER_SOURCE_UNIT,
  CSSFLIPFLOP_RASTER_LEAF_SIZE,
  CSSFLIPFLOP_SOURCE_FRAME_COUNT,
  CSSFLIPFLOP_TILE_FACE_COUNT,
  flipFlopColorRows,
  resolveFlipFlopBank,
} from "./sourceModel.mjs";
import { flipFlopRasterSlice } from "./rasterAtlas.mjs";

const CSSFLIPFLOP_RASTER_JOINT_OVERLAP = 0.0025;

export function buildFlipFlopPreparedModel({ bankId = "desktop" } = {}) {
  const bank = resolveFlipFlopBank(bankId);
  const source = buildFlipFlopSourceFrames({ bankId });
  const presentation = buildFlipFlopPresentationFrames(source);
  const faces = buildFlipFlopTileGeometry();
  const colors = flipFlopColorRows();
  const firstFrame = presentation.frames[0];
  const vertices = [];
  const normals = [];
  const polygons = [];
  const leaves = [];
  const shapes = [];

  for (const tile of firstFrame.tiles) {
    const tileToken = String(tile.index).padStart(2, "0");
    const shapeId = `tile-${tileToken}`;
    shapes.push(Object.freeze({ id: shapeId, matrix: tile.matrix }));
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const face = faces[faceIndex];
      const polygonId = `tile-${tileToken}-${face.id}`;
      const vertexOffset = vertices.length;
      vertices.push(...face.vertices);
      const normalIndex = normals.length;
      normals.push(polygonNormal(face.vertices));
      polygons.push(Object.freeze({
        id: polygonId,
        vertexIndices: Object.freeze([0, 1, 2, 3].map((index) => vertexOffset + index)),
        normalIndices: Object.freeze([normalIndex, normalIndex, normalIndex, normalIndex]),
      }));
      leaves.push(Object.freeze({
        id: `leaf-${polygonId}`,
        polygonId,
        shapeId,
        materialId: `material-${colors[tile.colorIndex].id}`,
        strategy: "atlas-slice",
        width: CSSFLIPFLOP_RASTER_LEAF_SIZE,
        height: CSSFLIPFLOP_RASTER_LEAF_SIZE,
        matrix: rasterLeafMatrix(face.matrix, face.width, face.height),
        atlas: flipFlopRasterSlice(tile.colorIndex),
        fallback: null,
      }));
    }
  }

  const playbackFrames = buildPlaybackFrames(presentation, faces);
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({ id: bank.modelId, name: bank.name, revision: "1.0.0" }),
    profile: "prepared-playback",
    capabilities: Object.freeze(["prepared-playback", "retained-render", "sparse-updates"]),
    budgets: Object.freeze({
      maxVertices: vertices.length,
      maxPolygons: polygons.length,
      maxLeaves: leaves.length,
      maxFrames: playbackFrames.length,
      maxJoints: 0,
      maxResources: 2,
      maxBytes: 32 * 1024 * 1024,
    }),
    topology: Object.freeze({
      vertices: Object.freeze(vertices),
      normals: Object.freeze(normals),
      polygons: Object.freeze(polygons),
    }),
    materials: Object.freeze(colors.map((color) =>
      Object.freeze({ id: `material-${color.id}`, color: color.rgba }))),
    render: Object.freeze({
      modelMatrix: firstFrame.boardMatrix,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }),
    deformation: Object.freeze({ kind: "none" }),
    controls: Object.freeze([]),
    springs: Object.freeze([]),
    animations: Object.freeze([]),
    playback: Object.freeze({
      durationMs: presentation.durationMilliseconds,
      loop: true,
      frames: playbackFrames,
    }),
    provenance: Object.freeze({
      generator: "cssflipflop-preparer",
      generatorVersion: "1.0.0",
      sources: Object.freeze([Object.freeze({
        id: "xscreensaver-flipflop",
        kind: "open-data",
        uri: `https://github.com/Zygo/xscreensaver/blob/${bank.commit}/${bank.primaryPath}`,
        sha256: bank.primarySha256,
        license: "XScreenSaver flipflop.c permissive notice",
      })]),
    }),
  });

  return deepFreeze({
    model,
    source,
    presentation,
    metrics: Object.freeze({
      bankId: bank.id,
      modelId: bank.modelId,
      boardWidth: bank.boardWidth,
      boardDepth: bank.boardDepth,
      cameraDistancePixels: bank.boardAverageSize * CSSFLIPFLOP_PIXELS_PER_SOURCE_UNIT,
      tileCount: bank.tileCount,
      emptyCellCount: bank.emptyCellCount,
      shapeRootCount: shapes.length,
      polygonLeafCount: leaves.length,
      rasterLeafSize: CSSFLIPFLOP_RASTER_LEAF_SIZE,
      sourceFrameCount: CSSFLIPFLOP_SOURCE_FRAME_COUNT,
      presentationFrameCount: playbackFrames.length,
      durationMilliseconds: presentation.durationMilliseconds,
      maximumShapeWritesPerFrame: Math.max(...playbackFrames.map((frame) => frame.shapes.length)),
      averageShapeWritesPerFrame: playbackFrames.reduce((sum, frame) => sum + frame.shapes.length, 0) /
        playbackFrames.length,
      maximumAtlasRowWritesPerFrame: Math.max(...playbackFrames.map((frame) => frame.leaves.length)),
      averageAtlasRowWritesPerFrame: playbackFrames.reduce((sum, frame) => sum + frame.leaves.length, 0) /
        playbackFrames.length,
      runtimeGeometryConstructionCount: 0,
      runtimeDomGrowth: false,
    }),
  });
}

function rasterLeafMatrix(matrix, width, height) {
  const xScale = (width + CSSFLIPFLOP_RASTER_JOINT_OVERLAP * 2) / width;
  const yScale = (height + CSSFLIPFLOP_RASTER_JOINT_OVERLAP * 2) / height;
  const expanded = [...matrix];
  for (let index = 0; index < 4; index += 1) {
    expanded[12 + index] -= matrix[index] * CSSFLIPFLOP_RASTER_JOINT_OVERLAP / width;
    expanded[12 + index] -= matrix[4 + index] * CSSFLIPFLOP_RASTER_JOINT_OVERLAP / height;
    expanded[index] *= xScale;
    expanded[4 + index] *= yScale;
  }
  return Object.freeze(expanded.map((value, index) =>
    index < 8 ? value / CSSFLIPFLOP_RASTER_LEAF_SIZE : value));
}

function buildPlaybackFrames(presentation, faces) {
  const frames = [];
  let previous = null;
  let previousLightLevels = null;
  for (const frame of presentation.frames) {
    const shapes = [];
    const leaves = [];
    if (previous) {
      for (let index = 0; index < frame.tiles.length; index += 1) {
        if (matricesEqual(previous.tiles[index].matrix, frame.tiles[index].matrix)) continue;
        shapes.push(Object.freeze({
          shapeId: `tile-${String(index).padStart(2, "0")}`,
          matrix: frame.tiles[index].matrix,
        }));
      }
    }
    const lightLevels = [];
    for (const tile of frame.tiles) {
      for (let faceIndex = 0; faceIndex < CSSFLIPFLOP_TILE_FACE_COUNT; faceIndex += 1) {
        const profile = flipFlopFaceLightProfile(
          frame,
          tile,
          faceIndex,
          faces[faceIndex].sourceVertexIndices,
        );
        lightLevels.push(profile);
        if (previousLightLevels?.[lightLevels.length - 1] === profile) continue;
        leaves.push(Object.freeze({
          leafId: `leaf-tile-${String(tile.index).padStart(2, "0")}-${faces[faceIndex].id}`,
          matrix: null,
          visible: null,
          opacity: null,
          atlasRow: profile,
        }));
      }
    }
    frames.push(Object.freeze({
      timeMs: frame.frameIndex * presentation.frameMilliseconds,
      modelMatrix: previous && matricesEqual(previous.boardMatrix, frame.boardMatrix)
        ? null
        : frame.boardMatrix,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }));
    previous = frame;
    previousLightLevels = lightLevels;
  }
  return Object.freeze(frames);
}

function matricesEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function polygonNormal(vertices) {
  const ab = vertices[1].map((value, index) => value - vertices[0][index]);
  const ac = vertices[2].map((value, index) => value - vertices[0][index]);
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal);
  if (length === 0) throw new Error("Flip Flop prepared face is degenerate");
  return Object.freeze(normal.map((value) => value / length));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function expectedFlipFlopLeafCount(bankId = "desktop") {
  return resolveFlipFlopBank(bankId).tileCount * CSSFLIPFLOP_TILE_FACE_COUNT;
}
