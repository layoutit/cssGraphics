import {
  SOLID_TRIANGLE_CANONICAL_SIZE,
  computeSolidTrianglePlanFromCssPoints,
  formatMatrix3dValues,
} from "@layoutit/polycss";
import {
  CSSCYCLONE_BANK,
  CSSCYCLONE_SOURCE,
  buildCycloneSourceSequence,
} from "./sourceModel.mjs";

export const CSSCYCLONE_MODEL_IDS = Object.freeze({
  desktop: "cyclone",
  mobile: "cyclone-mobile",
});
export const CSSCYCLONE_MODEL_ID = CSSCYCLONE_MODEL_IDS.desktop;
const PARTICLE_RADIUS = CSSCYCLONE_SOURCE.particleSize / 4;
const EQUATOR = Object.freeze(Array.from({ length: 3 }, (_, index) => {
  const angle = index * Math.PI * 2 / 3;
  return Object.freeze([Math.cos(angle) * PARTICLE_RADIUS, Math.sin(angle) * PARTICLE_RADIUS, 0]);
}));
export const CSSCYCLONE_PARTICLE_VERTICES = Object.freeze([
  Object.freeze([0, 0, PARTICLE_RADIUS]),
  ...EQUATOR,
  Object.freeze([0, 0, -PARTICLE_RADIUS]),
]);
export const CSSCYCLONE_FACE_INDICES = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([0, 2, 3]),
  Object.freeze([0, 3, 1]),
  Object.freeze([4, 2, 1]),
  Object.freeze([4, 3, 2]),
  Object.freeze([4, 1, 3]),
]);

export function buildCyclonePreparedModel({
  source = buildCycloneSourceSequence(),
  modelId = CSSCYCLONE_MODEL_ID,
} = {}) {
  const vertices = [];
  const normals = [];
  const polygons = [];
  const shapes = [];
  const leaves = [];
  const initial = source.frames[0];
  for (let particleIndex = 0; particleIndex < source.bank.particleCount; particleIndex += 1) {
    const vertexOffset = vertices.length;
    const normalOffset = normals.length;
    vertices.push(...CSSCYCLONE_PARTICLE_VERTICES.map((vertex) => Object.freeze([...vertex])));
    normals.push(...CSSCYCLONE_PARTICLE_VERTICES.map((vertex) => Object.freeze(
      vertex.map((value) => rounded(value / PARTICLE_RADIUS)),
    )));
    const shapeId = particleId(particleIndex);
    shapes.push(Object.freeze({ id: shapeId, matrix: initial.particles[particleIndex].matrix }));
    for (let faceIndex = 0; faceIndex < CSSCYCLONE_FACE_INDICES.length; faceIndex += 1) {
      const localIndices = CSSCYCLONE_FACE_INDICES[faceIndex];
      const triangle = localIndices.map((index) => CSSCYCLONE_PARTICLE_VERTICES[index]);
      const polygonId = `${shapeId}-face-${faceIndex}`;
      polygons.push(Object.freeze({
        id: polygonId,
        vertexIndices: Object.freeze(localIndices.map((index) => vertexOffset + index)),
        normalIndices: Object.freeze(localIndices.map((index) => normalOffset + index)),
      }));
      leaves.push(Object.freeze({
        id: `leaf-${polygonId}`,
        polygonId,
        shapeId,
        materialId: "particle",
        strategy: "solid-triangle",
        width: SOLID_TRIANGLE_CANONICAL_SIZE,
        height: SOLID_TRIANGLE_CANONICAL_SIZE,
        matrix: triangleMatrix(triangle, polygonId),
        atlas: null,
        fallback: null,
      }));
    }
  }
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({ id: modelId, name: source.bank.name, revision: "0.1.0" }),
    profile: "static-prepared",
    capabilities: Object.freeze(["retained-render"]),
    budgets: Object.freeze({
      maxVertices: vertices.length,
      maxPolygons: polygons.length,
      maxLeaves: leaves.length,
      maxFrames: 0,
      maxJoints: 0,
      maxResources: 1,
      maxBytes: 64 * 1024 * 1024,
    }),
    topology: Object.freeze({
      vertices: Object.freeze(vertices),
      normals: Object.freeze(normals),
      polygons: Object.freeze(polygons),
    }),
    materials: Object.freeze([Object.freeze({ id: "particle", color: Object.freeze([1, 1, 1, 1]) })]),
    render: Object.freeze({
      modelMatrix: source.modelMatrix,
      shapes: Object.freeze(shapes),
      leaves: Object.freeze(leaves),
    }),
    deformation: Object.freeze({ kind: "none" }),
    controls: Object.freeze([]),
    springs: Object.freeze([]),
    animations: Object.freeze([]),
    playback: null,
    provenance: Object.freeze({
      generator: "csscyclone-preparer",
      generatorVersion: "0.1.0",
      sources: Object.freeze([Object.freeze({
        id: "really-slick-cyclone",
        kind: "open-data",
        uri: `${CSSCYCLONE_SOURCE.repository}/blob/${CSSCYCLONE_SOURCE.revision}/${CSSCYCLONE_SOURCE.path}`,
        sha256: CSSCYCLONE_SOURCE.sha256,
        license: CSSCYCLONE_SOURCE.license,
      })]),
    }),
  });
  return deepFreeze({
    source,
    model,
    metrics: Object.freeze({
      retainedParticleRootCount: shapes.length,
      retainedPolygonLeafCount: leaves.length,
      sourceParticleCount: source.bank.particleCount,
      polygonsPerParticle: CSSCYCLONE_FACE_INDICES.length,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
    }),
  });
}

export function buildCyclonePreparedPlayback({
  source = buildCycloneSourceSequence(),
  modelId = CSSCYCLONE_MODEL_ID,
} = {}) {
  const transforms = [];
  const transformIndices = new Map();
  const internTransform = (matrix) => {
    const transform = `matrix3d(${formatMatrix3dValues(matrix, 6)})`;
    const existing = transformIndices.get(transform);
    if (existing !== undefined) return existing;
    const index = transforms.length;
    transforms.push(transform);
    transformIndices.set(transform, index);
    return index;
  };
  const first = source.frames[0];
  const mountedShapeTransformIndices = first.particles.map((particle) => internTransform(particle.matrix));
  const rowForFrame = (frame) => {
    const shapeOperations = [];
    for (let index = 0; index < frame.particles.length; index += 1) {
      const particle = frame.particles[index];
      const transformIndex = internTransform(particle.matrix);
      shapeOperations.push(index, transformIndex);
    }
    return Object.freeze(shapeOperations);
  };
  const frames = source.frames.map(rowForFrame);
  const playback = deepFreeze({
    schema: "csscyclone-prepared-dom-playback@3",
    bankId: source.bank.id,
    streamId: source.bank.streamId,
    chunkIndex: source.bank.chunkIndex,
    chunkCount: source.bank.chunkCount,
    startFrameIndex: source.bank.startFrameIndex,
    modelId,
    frameMilliseconds: source.bank.frameMilliseconds,
    durationMilliseconds: source.durationMilliseconds,
    frameCount: frames.length,
    loop: false,
    particleCount: source.bank.particleCount,
    leafCount: source.bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
    transforms: Object.freeze(transforms),
    mounted: Object.freeze({
      shapeTransformIndices: Object.freeze(mountedShapeTransformIndices),
    }),
    frames: Object.freeze(frames),
  });
  return deepFreeze({
    source,
    playback,
    metrics: Object.freeze({
      preparedFrameCount: frames.length,
      uniquePreparedTransformCount: transforms.length,
      shapeTransformSelections: frames.reduce((sum, row) => sum + row.length / 2, 0),
    }),
  });
}

function triangleMatrix(vertices, id) {
  const plan = computeSolidTrianglePlanFromCssPoints(
    { vertices: vertices.map((vertex) => [...vertex]) },
    0,
    { seamBleed: 0 },
    { includeColor: false, matrixDecimals: 10, primitive: "border" },
    ...vertices.flat(),
  );
  const match = /^matrix3d\(([^)]+)\)$/u.exec(plan?.transformText ?? "");
  const values = match?.[1]?.split(",").map(Number);
  if (!values || values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Cyclone triangle is not renderable: ${id}`);
  }
  return Object.freeze(values.map((value) => rounded(value)));
}

function particleId(index) {
  return `particle-${String(index).padStart(3, "0")}`;
}

function rounded(value) {
  const result = Number(value.toFixed(10));
  return Object.is(result, -0) ? 0 : result;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export { CSSCYCLONE_BANK };
