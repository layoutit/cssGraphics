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
  return Object.freeze([
    Math.cos(angle) * PARTICLE_RADIUS,
    Math.sin(angle) * PARTICLE_RADIUS,
    0,
  ]);
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
const CSSCYCLONE_FACE_PLANS = Object.freeze(CSSCYCLONE_FACE_INDICES.map((localIndices, faceIndex) => {
  const vertices = localIndices.map((index) => CSSCYCLONE_PARTICLE_VERTICES[index]);
  return localIndices.length === 4
    ? Object.freeze({
        matrix: quadMatrix(vertices, `particle-face-${faceIndex}`),
        tileVertexOrder: Object.freeze([0, 1, 2, 3]),
      })
    : trianglePlan(vertices, `particle-face-${faceIndex}`);
}));
export const CSSCYCLONE_FACE_TILE_VERTEX_ORDERS = Object.freeze(
  CSSCYCLONE_FACE_PLANS.map(({ tileVertexOrder }) => tileVertexOrder),
);
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
    normals.push(...CSSCYCLONE_PARTICLE_VERTICES.map((vertex) => Object.freeze(normalized(vertex))));
    const shapeId = particleId(particleIndex);
    shapes.push(Object.freeze({ id: shapeId, matrix: initial.particles[particleIndex].matrix }));
    for (let faceIndex = 0; faceIndex < CSSCYCLONE_FACE_INDICES.length; faceIndex += 1) {
      const localIndices = CSSCYCLONE_FACE_INDICES[faceIndex];
      const polygonId = `${shapeId}-face-${faceIndex}`;
      polygons.push(Object.freeze({
        id: polygonId,
        vertexIndices: Object.freeze(localIndices.map((index) => vertexOffset + index)),
        normalIndices: Object.freeze(localIndices.map((index) => normalOffset + index)),
      }));
      const quad = localIndices.length === 4;
      leaves.push(Object.freeze({
        id: `leaf-${polygonId}`,
        polygonId,
        shapeId,
        materialId: "particle",
        strategy: quad ? "solid-quad" : "solid-triangle",
        width: SOLID_TRIANGLE_CANONICAL_SIZE,
        height: SOLID_TRIANGLE_CANONICAL_SIZE,
        matrix: CSSCYCLONE_FACE_PLANS[faceIndex].matrix,
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
  const transforms = source.frames.flatMap((frame) => frame.particles.map((particle) =>
    `matrix3d(${formatMatrix3dValues(particle.matrix, 6)})`));
  const playback = deepFreeze({
    schema: "csscyclone-prepared-dom-playback@5",
    bankId: source.bank.id,
    streamId: source.bank.streamId,
    chunkIndex: source.bank.chunkIndex,
    chunkCount: source.bank.chunkCount,
    startFrameIndex: source.bank.startFrameIndex,
    modelId,
    framesPerSecond: source.bank.framesPerSecond,
    frameMilliseconds: source.bank.frameMilliseconds,
    durationMilliseconds: source.durationMilliseconds,
    frameCount: source.frames.length,
    loop: false,
    particleCount: source.bank.particleCount,
    leafCount: source.bank.particleCount * CSSCYCLONE_FACE_INDICES.length,
    transforms: Object.freeze(transforms),
  });
  return deepFreeze({
    source,
    playback,
    metrics: Object.freeze({
      preparedFrameCount: source.frames.length,
      uniquePreparedTransformCount: new Set(transforms).size,
      shapeTransformSelections: transforms.length,
    }),
  });
}

function trianglePlan(vertices, id) {
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
  const { a, b, c } = plan.basis ?? {};
  if (![a, b, c].every((value) => Number.isSafeInteger(value) && value >= 0 && value < 3) ||
      new Set([a, b, c]).size !== 3) {
    throw new Error(`Cyclone triangle basis is invalid: ${id}`);
  }
  return Object.freeze({
    matrix: Object.freeze(values.map((value) => rounded(value))),
    tileVertexOrder: Object.freeze([c, a, b]),
  });
}

function quadMatrix(vertices, id) {
  if (vertices.length !== 4) throw new Error(`Cyclone quad is incomplete: ${id}`);
  const [origin, along, opposite, across] = vertices;
  const xVector = subtract(along, origin);
  const yVector = subtract(across, origin);
  const normal = normalized(cross(xVector, yVector));
  const nonPlanarity = Math.abs(dot(normal, subtract(opposite, origin)));
  if (!Number.isFinite(nonPlanarity) || nonPlanarity > 1e-8) {
    throw new Error(`Cyclone quad is not planar: ${id}`);
  }
  const size = SOLID_TRIANGLE_CANONICAL_SIZE;
  return Object.freeze([
    xVector[0] / size, xVector[1] / size, xVector[2] / size, 0,
    yVector[0] / size, yVector[1] / size, yVector[2] / size, 0,
    normal[0], normal[1], normal[2], 0,
    origin[0], origin[1], origin[2], 1,
  ].map((value) => rounded(value)));
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  if (length < 1e-12) throw new Error("Cyclone particle normal is degenerate");
  return vector.map((value) => rounded(value / length));
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
