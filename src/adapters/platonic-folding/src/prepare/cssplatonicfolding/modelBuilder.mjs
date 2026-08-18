import {
  CSSPLATONIC_RASTER_LEAF_SIZE,
  buildPlatonicSourceSequence,
} from "./sourceModel.mjs";
import { platonicRasterSlice } from "./rasterAtlas.mjs";

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function buildPlatonicPreparedModel({ bankId = "desktop" } = {}) {
  const source = buildPlatonicSourceSequence({ bankId });
  const firstFrame = source.frames[0];
  const vertices = [];
  const normals = [Object.freeze([0, 0, 1])];
  const polygons = [];
  const shapes = [];
  const leaves = [];
  for (const face of source.faceDefinitions) {
    const vertexOffset = vertices.length;
    vertices.push(
      Object.freeze([0, 0, 0]),
      Object.freeze([1, 0, 0]),
      Object.freeze([1, 1, 0]),
      Object.freeze([0, 1, 0]),
    );
    const polygonId = `polygon-${face.id}`;
    polygons.push(Object.freeze({
      id: polygonId,
      vertexIndices: Object.freeze([0, 1, 2, 3].map((index) => vertexOffset + index)),
      normalIndices: Object.freeze([0, 0, 0, 0]),
    }));
    const initialFace = face.solidId === firstFrame.solidId
      ? firstFrame.faces[face.faceIndex]
      : null;
    shapes.push(Object.freeze({ id: face.id, matrix: initialFace?.matrix ?? IDENTITY }));
    leaves.push(Object.freeze({
      id: `leaf-${face.id}`,
      polygonId,
      shapeId: face.id,
      materialId: "platonic-face",
      strategy: "atlas-slice",
      width: CSSPLATONIC_RASTER_LEAF_SIZE,
      height: CSSPLATONIC_RASTER_LEAF_SIZE,
      matrix: faceLeafMatrix(face),
      atlas: platonicRasterSlice(face.faceColumn, source.faceDefinitions.length),
      fallback: null,
    }));
  }
  const playbackFrames = buildPlaybackFrames(source);
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({
      id: source.bank.modelId,
      name: source.bank.name,
      revision: "1.0.0",
    }),
    profile: "prepared-playback",
    capabilities: Object.freeze(["prepared-playback", "retained-render", "sparse-updates"]),
    budgets: Object.freeze({
      maxVertices: vertices.length,
      maxPolygons: polygons.length,
      maxLeaves: leaves.length,
      maxFrames: playbackFrames.length,
      maxJoints: 0,
      maxResources: 2,
      maxBytes: 64 * 1024 * 1024,
    }),
    topology: Object.freeze({
      vertices: Object.freeze(vertices),
      normals: Object.freeze(normals),
      polygons: Object.freeze(polygons),
    }),
    materials: Object.freeze([Object.freeze({
      id: "platonic-face",
      color: Object.freeze([1, 1, 1, 1]),
    })]),
    render: Object.freeze({
      modelMatrix: firstFrame.modelMatrix,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }),
    deformation: Object.freeze({ kind: "none" }),
    controls: Object.freeze([]),
    springs: Object.freeze([]),
    animations: Object.freeze([]),
    playback: Object.freeze({
      durationMs: source.durationMilliseconds,
      loop: true,
      frames: playbackFrames,
    }),
    provenance: Object.freeze({
      generator: "cssplatonicfolding-preparer",
      generatorVersion: "1.0.0",
      sources: Object.freeze([Object.freeze({
        id: "xscreensaver-platonicfolding",
        kind: "open-data",
        uri: `https://github.com/Zygo/xscreensaver/blob/${source.bank.commit}/${source.bank.primaryPath}`,
        sha256: source.bank.primarySha256,
        license: "XScreenSaver platonicfolding.c permissive notice",
      })]),
    }),
  });
  return deepFreeze({
    source,
    model,
    metrics: Object.freeze({
      bankId,
      sourceSolidCount: 5,
      sourceFaceCount: source.faceDefinitions.length,
      retainedShapeRootCount: shapes.length,
      retainedPolygonLeafCount: leaves.length,
      frameCount: playbackFrames.length,
      durationMilliseconds: source.durationMilliseconds,
      maximumVisibleLeaves: 20,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
    }),
  });
}

function buildPlaybackFrames(source) {
  let previous = null;
  return Object.freeze(source.frames.map((frame) => {
    const shapes = [];
    const leaves = [];
    for (const face of source.faceDefinitions) {
      const active = face.solidId === frame.solidId;
      const wasActive = previous?.solidId === face.solidId;
      if (active) {
        const sample = frame.faces[face.faceIndex];
        const previousSample = wasActive ? previous.faces[face.faceIndex] : null;
        if (!previousSample || !matricesEqual(sample.matrix, previousSample.matrix)) {
          shapes.push(Object.freeze({ shapeId: face.id, matrix: sample.matrix }));
        }
        if (!previousSample || sample.lightRow !== previousSample.lightRow || !wasActive) {
          leaves.push(Object.freeze({
            leafId: `leaf-${face.id}`,
            matrix: null,
            visible: wasActive ? null : true,
            opacity: null,
            atlasRow: sample.lightRow,
          }));
        }
      } else if (!previous || wasActive) {
        leaves.push(Object.freeze({
          leafId: `leaf-${face.id}`,
          matrix: null,
          visible: false,
          opacity: null,
          atlasRow: null,
        }));
      }
    }
    const prepared = Object.freeze({
      timeMs: frame.timeMs,
      modelMatrix: previous && matricesEqual(frame.modelMatrix, previous.modelMatrix)
        ? null
        : frame.modelMatrix,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    });
    previous = frame;
    return prepared;
  }));
}

function faceLeafMatrix(face) {
  return Object.freeze([
    face.bounds.width / CSSPLATONIC_RASTER_LEAF_SIZE, 0, 0, 0,
    0, face.bounds.height / CSSPLATONIC_RASTER_LEAF_SIZE, 0, 0,
    0, 0, 1, 0,
    face.bounds.minX, face.bounds.minY, face.vertices[0][2], 1,
  ].map((value) => Number(value.toFixed(10))));
}

function matricesEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
