// SPDX-License-Identifier: GPL-2.0-or-later
import {
  SOLID_TRIANGLE_CANONICAL_SIZE,
  computeSolidTrianglePlanFromCssPoints,
} from "@layoutit/polycss";
import { CSSFLOCKS_SOURCE } from "./sourceModel.mjs";

const BUG_RADIUS = CSSFLOCKS_SOURCE.size * 0.5;
const EQUATOR = Object.freeze(Array.from({ length: CSSFLOCKS_SOURCE.complexity + 2 }, (_, index) => {
  const angle = Math.PI / 2 + index * Math.PI * 2 / (CSSFLOCKS_SOURCE.complexity + 2);
  return Object.freeze([Math.cos(angle) * BUG_RADIUS, Math.sin(angle) * BUG_RADIUS, 0]);
}));

export const CSSFLOCKS_BUG_VERTICES = Object.freeze([
  Object.freeze([0, 0, BUG_RADIUS]),
  ...EQUATOR,
  Object.freeze([0, 0, -BUG_RADIUS]),
]);

export const CSSFLOCKS_FACE_INDICES = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([0, 2, 3]),
  Object.freeze([0, 3, 1]),
  Object.freeze([4, 2, 1]),
  Object.freeze([4, 3, 2]),
  Object.freeze([4, 1, 3]),
]);

export const CSSFLOCKS_FACE_LIGHT_FACTORS = Object.freeze([0.78, 0.9, 1, 0.82, 0.96, 0.86]);

const FACE_PLANS = Object.freeze(CSSFLOCKS_FACE_INDICES.map((localIndices, faceIndex) =>
  trianglePlan(localIndices.map((index) => CSSFLOCKS_BUG_VERTICES[index]), `bug-face-${faceIndex}`)));

export const CSSFLOCKS_FACE_TILE_VERTEX_ORDERS = Object.freeze(
  FACE_PLANS.map(({ tileVertexOrder }) => tileVertexOrder),
);

export const CSSFLOCKS_FACE_MATRICES = Object.freeze(
  FACE_PLANS.map(({ matrix }) => matrix),
);

export function buildFlocksPreparedModel({ source, modelId = source?.profile?.modelId } = {}) {
  if (source?.schema !== "cssflocks-source-sequence@1" || !source.profile ||
      typeof modelId !== "string" || modelId.length === 0 || source.frames.length < 1 ||
      source.frames[0].bugs.length !== source.profile.bugCount) {
    throw new TypeError("A product-selected Flocks source sequence is required");
  }
  const vertices = [];
  const normals = [];
  const polygons = [];
  const shapes = [];
  const leaves = [];
  const initial = source.frames[0];
  for (let bugIndex = 0; bugIndex < source.profile.bugCount; bugIndex += 1) {
    const vertexOffset = vertices.length;
    const normalOffset = normals.length;
    vertices.push(...CSSFLOCKS_BUG_VERTICES.map((vertex) => Object.freeze([...vertex])));
    normals.push(...CSSFLOCKS_BUG_VERTICES.map((vertex) => Object.freeze(normalized(vertex))));
    const shapeId = bugId(bugIndex);
    shapes.push(Object.freeze({ id: shapeId, matrix: initial.bugs[bugIndex].matrix }));
    for (let faceIndex = 0; faceIndex < CSSFLOCKS_FACE_INDICES.length; faceIndex += 1) {
      const polygonId = `${shapeId}-face-${faceIndex}`;
      const localIndices = CSSFLOCKS_FACE_INDICES[faceIndex];
      polygons.push(Object.freeze({
        id: polygonId,
        vertexIndices: Object.freeze(localIndices.map((index) => vertexOffset + index)),
        normalIndices: Object.freeze(localIndices.map((index) => normalOffset + index)),
      }));
      leaves.push(Object.freeze({
        id: `leaf-${polygonId}`,
        polygonId,
        shapeId,
        materialId: "bug-current-color",
        strategy: "solid-triangle",
        width: SOLID_TRIANGLE_CANONICAL_SIZE,
        height: SOLID_TRIANGLE_CANONICAL_SIZE,
        matrix: FACE_PLANS[faceIndex].matrix,
        atlas: null,
        fallback: null,
      }));
    }
  }
  const model = deepFreeze({
    schema: "polycss-morph.model@1",
    identity: Object.freeze({ id: modelId, name: `Flocks ${source.profile.id}`, revision: "0.1.0" }),
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
    materials: Object.freeze([Object.freeze({
      id: "bug-current-color",
      color: Object.freeze([1, 1, 1, 1]),
    })]),
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
      generator: "cssflocks-preparer",
      generatorVersion: "0.1.0",
      sources: Object.freeze([Object.freeze({
        id: "really-slick-flocks",
        kind: "open-data",
        uri: `${CSSFLOCKS_SOURCE.repository}/blob/${CSSFLOCKS_SOURCE.revision}/${CSSFLOCKS_SOURCE.path}`,
        sha256: CSSFLOCKS_SOURCE.sha256,
        license: CSSFLOCKS_SOURCE.license,
      })]),
    }),
  });
  return deepFreeze({
    model,
    metrics: Object.freeze({
      sourceDefaultBugCount: source.bank.bugCount,
      retainedBugRootCount: shapes.length,
      retainedPolygonLeafCount: leaves.length,
      polygonsPerBug: CSSFLOCKS_FACE_INDICES.length,
      preparedVertexCount: vertices.length,
      preparedPolygonCount: polygons.length,
      sourceTriangleCount: shapes.length * CSSFLOCKS_FACE_INDICES.length,
      atlasCount: 0,
      unresolvedTextureCount: 0,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
      flatLightingFactors: CSSFLOCKS_FACE_LIGHT_FACTORS,
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
    throw new Error(`Flocks triangle is not renderable: ${id}`);
  }
  const { a, b, c } = plan.basis ?? {};
  if (![a, b, c].every((value) => Number.isSafeInteger(value) && value >= 0 && value < 3) ||
      new Set([a, b, c]).size !== 3) {
    throw new Error(`Flocks triangle basis is invalid: ${id}`);
  }
  return Object.freeze({
    matrix: Object.freeze(values.map(rounded10)),
    tileVertexOrder: Object.freeze([c, a, b]),
  });
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  if (length < 1e-12) throw new Error("Flocks bug normal is degenerate");
  return vector.map((value) => rounded10(value / length));
}

function bugId(index) {
  return `bug-${String(index).padStart(4, "0")}`;
}

function rounded10(value) {
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
