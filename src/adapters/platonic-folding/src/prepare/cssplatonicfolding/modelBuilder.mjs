import { formatMatrix3dValues } from "@layoutit/polycss";
import {
  CSSPLATONIC_LIGHT_LEVELS,
  CSSPLATONIC_RASTER_LEAF_SIZE,
  buildPlatonicSourceSequence,
} from "./sourceModel.mjs";
import { platonicRasterSlice } from "./rasterAtlas.mjs";

export const CSSPLATONIC_MODEL_ID = "platonic-folding";

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function buildPlatonicPreparedModel() {
  const source = buildPlatonicSourceSequence({ bankId: "desktop" });
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
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({
      id: CSSPLATONIC_MODEL_ID,
      name: source.bank.name,
      revision: "1.1.0",
    }),
    profile: "static-prepared",
    capabilities: Object.freeze(["retained-render"]),
    budgets: Object.freeze({
      maxVertices: vertices.length,
      maxPolygons: polygons.length,
      maxLeaves: leaves.length,
      maxFrames: 0,
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
      modelMatrix: IDENTITY,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }),
    deformation: Object.freeze({ kind: "none" }),
    controls: Object.freeze([]),
    springs: Object.freeze([]),
    animations: Object.freeze([]),
    playback: null,
    provenance: Object.freeze({
      generator: "cssplatonicfolding-preparer",
      generatorVersion: "1.1.0",
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
      sourceSolidCount: 5,
      sourceFaceCount: source.faceDefinitions.length,
      retainedShapeRootCount: shapes.length,
      retainedPolygonLeafCount: leaves.length,
      maximumVisibleLeaves: 20,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
    }),
  });
}

export function buildPlatonicPreparedPlayback({ bankId = "desktop" } = {}) {
  const source = buildPlatonicSourceSequence({ bankId });
  const firstFrame = source.frames[0];
  const transforms = [];
  const transformIndices = new Map();
  const internTransform = (matrix) => {
    const transform = `matrix3d(${formatMatrix3dValues(matrix)})`;
    const existing = transformIndices.get(transform);
    if (existing !== undefined) return existing;
    const index = transforms.length;
    transforms.push(transform);
    transformIndices.set(transform, index);
    return index;
  };
  const mountedModelTransformIndex = internTransform(IDENTITY);
  const mountedShapeTransformIndices = source.faceDefinitions.map((face) =>
    internTransform(face.solidId === firstFrame.solidId
      ? firstFrame.faces[face.faceIndex].matrix
      : IDENTITY));
  const shapeTransformIndices = [...mountedShapeTransformIndices];
  const atlasRows = new Array(source.faceDefinitions.length).fill(0);
  const visibility = new Array(source.faceDefinitions.length).fill(1);
  let modelTransformIndex = mountedModelTransformIndex;

  const buildRow = (frame) => {
    const shapeOperations = [];
    const atlasOperations = [];
    const hideLeaves = [];
    const showLeaves = [];
    for (let index = 0; index < source.faceDefinitions.length; index += 1) {
      const face = source.faceDefinitions[index];
      if (face.solidId !== frame.solidId && visibility[index] === 1) {
        hideLeaves.push(index);
        visibility[index] = 0;
      }
    }
    const nextModelTransformIndex = internTransform(frame.modelMatrix);
    const publishedModelTransformIndex = nextModelTransformIndex === modelTransformIndex
      ? -1
      : nextModelTransformIndex;
    modelTransformIndex = nextModelTransformIndex;
    for (let index = 0; index < source.faceDefinitions.length; index += 1) {
      const face = source.faceDefinitions[index];
      if (face.solidId !== frame.solidId) continue;
      const sample = frame.faces[face.faceIndex];
      const nextShapeTransformIndex = internTransform(sample.matrix);
      if (shapeTransformIndices[index] !== nextShapeTransformIndex) {
        shapeOperations.push(index, nextShapeTransformIndex);
        shapeTransformIndices[index] = nextShapeTransformIndex;
      }
      if (atlasRows[index] !== sample.lightRow) {
        atlasOperations.push(index, sample.lightRow);
        atlasRows[index] = sample.lightRow;
      }
      if (visibility[index] === 0) {
        showLeaves.push(index);
        visibility[index] = 1;
      }
    }
    return freezeRow([
      publishedModelTransformIndex,
      shapeOperations,
      atlasOperations,
      hideLeaves,
      showLeaves,
    ]);
  };

  const frames = source.frames.map(buildRow);
  const wrap = buildRow(firstFrame);
  const imagePositionYs = Object.freeze(Array.from(
    { length: CSSPLATONIC_LIGHT_LEVELS },
    (_, row) => `${-row * CSSPLATONIC_RASTER_LEAF_SIZE}px`,
  ));
  const metrics = operationMetrics(frames, wrap);
  const playback = deepFreeze({
    schema: "cssplatonicfolding-prepared-dom-playback@1",
    bankId,
    modelId: CSSPLATONIC_MODEL_ID,
    frameMilliseconds: source.bank.delayMicroseconds / 1_000,
    durationMilliseconds: source.durationMilliseconds,
    frameCount: frames.length,
    shapeCount: source.faceDefinitions.length,
    leafCount: source.faceDefinitions.length,
    transforms: Object.freeze(transforms),
    imagePositionYs,
    mounted: Object.freeze({
      modelTransformIndex: mountedModelTransformIndex,
      shapeTransformIndices: Object.freeze(mountedShapeTransformIndices),
      atlasRows: Object.freeze(new Array(source.faceDefinitions.length).fill(0)),
      visibility: Object.freeze(new Array(source.faceDefinitions.length).fill(1)),
    }),
    frames: Object.freeze(frames),
    wrap,
  });
  return deepFreeze({ source, playback, metrics });
}

function operationMetrics(frames, wrap) {
  const rows = [...frames, wrap];
  return Object.freeze({
    preparedFrameCount: frames.length,
    modelTransformSelections: rows.reduce((sum, row) => sum + Number(row[0] >= 0), 0),
    shapeTransformSelections: rows.reduce((sum, row) => sum + row[1].length / 2, 0),
    atlasRowSelections: rows.reduce((sum, row) => sum + row[2].length / 2, 0),
    visibilitySelections: rows.reduce((sum, row) => sum + row[3].length + row[4].length, 0),
    loopHiddenShapeTransformSelections: wrap[1].filter((_, index) => index % 2 === 0)
      .filter((leafIndex) => !wrap[4].includes(leafIndex)).length,
    loopHiddenAtlasRowSelections: wrap[2].filter((_, index) => index % 2 === 0)
      .filter((leafIndex) => !wrap[4].includes(leafIndex)).length,
  });
}

function freezeRow(row) {
  return Object.freeze([
    row[0],
    Object.freeze(row[1]),
    Object.freeze(row[2]),
    Object.freeze(row[3]),
    Object.freeze(row[4]),
  ]);
}

function faceLeafMatrix(face) {
  return Object.freeze([
    face.bounds.width / CSSPLATONIC_RASTER_LEAF_SIZE, 0, 0, 0,
    0, face.bounds.height / CSSPLATONIC_RASTER_LEAF_SIZE, 0, 0,
    0, 0, 1, 0,
    face.bounds.minX, face.bounds.minY, face.vertices[0][2], 1,
  ].map((value) => Number(value.toFixed(10))));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
