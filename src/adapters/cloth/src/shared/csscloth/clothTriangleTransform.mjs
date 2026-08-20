import {
  BASIS_EPS,
  computeSolidTrianglePlanFromCssPoints,
  offsetConvexPolygonPointsByEdgeAmounts,
  offsetStableTrianglePoints,
  safePlanSeamBleedAmount,
  SOLID_TRIANGLE_BLEED,
} from "@layoutit/polycss";

export const CSSCLOTH_CAMERA_POSITION = Object.freeze([1000, 50, 1500]);
const CAMERA_TARGET = Object.freeze([0, 0, 0]);
const CAMERA_UP = Object.freeze([0, 1, 0]);
export const CSSCLOTH_VIEW_BASIS = createViewBasis(
  CSSCLOTH_CAMERA_POSITION,
  CAMERA_TARGET,
  CAMERA_UP,
);
const EVEN_TRIANGLE_BASIS = Object.freeze({ a: 1, b: 2, c: 0 });
const ODD_TRIANGLE_BASIS = Object.freeze({ a: 2, b: 0, c: 1 });
const CLOTH_SEAM_BLEED = 0.3;
const CORNER_TRIANGLE_CANONICAL_SIZE = 32;
const CLOTH_RASTER_LEAF_SIZE = 28;

export function buildClothTriangleTopology(particleCount) {
  const segments = Math.sqrt(particleCount) - 1;
  if (!Number.isSafeInteger(particleCount) || particleCount < 4 ||
      !Number.isSafeInteger(segments) || segments < 1) {
    throw new RangeError("Cloth particle count must describe a square grid");
  }
  const triangles = [];
  const particleIndex = (u, v) => u + v * (segments + 1);
  for (let v = 0; v < segments; v += 1) {
    for (let u = 0; u < segments; u += 1) {
      const a = particleIndex(u, v);
      const b = particleIndex(u + 1, v);
      const c = particleIndex(u + 1, v + 1);
      const d = particleIndex(u, v + 1);
      triangles.push(Object.freeze([a, b, d]));
      triangles.push(Object.freeze([b, c, d]));
    }
  }
  return Object.freeze(triangles);
}

export function buildClothTriangleSeamEdges(topology) {
  const edgeOwners = new Map();
  for (let triangleIndex = 0; triangleIndex < topology.length; triangleIndex += 1) {
    const indices = topology[triangleIndex];
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const left = indices[edgeIndex];
      const right = indices[(edgeIndex + 1) % 3];
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const owners = edgeOwners.get(key) ?? [];
      owners.push([triangleIndex, edgeIndex]);
      edgeOwners.set(key, owners);
    }
  }
  const seamEdges = Array.from({ length: topology.length }, () => new Set());
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    for (const [triangleIndex, edgeIndex] of owners) seamEdges[triangleIndex].add(edgeIndex);
  }
  return Object.freeze(seamEdges.map((edges) => Object.freeze([...edges])));
}

export function clothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges) {
  try {
    return specializedClothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges);
  } catch (error) {
    if (!String(error?.message ?? "").includes(" is degenerate")) throw error;
    return generalClothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges);
  }
}

function specializedClothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges) {
  if (!Array.isArray(points) || points.length !== 3 ||
      points.some((point) => !Array.isArray(point) || point.length !== 3 ||
        point.some((value) => !Number.isFinite(value)))) {
    throw new TypeError("Cloth triangle needs three finite world points");
  }
  const cssPoints = points.map(sourceWorldToCssView);
  const [p0, p1, p2] = cssPoints;
  const e10x = p1[0] - p0[0];
  const e10y = p1[1] - p0[1];
  const e10z = p1[2] - p0[2];
  const e20x = p2[0] - p0[0];
  const e20y = p2[1] - p0[1];
  const e20z = p2[2] - p0[2];
  let nx = -(e10y * e20z - e10z * e20y);
  let ny = -(e10z * e20x - e10x * e20z);
  let nz = -(e10x * e20y - e10y * e20x);
  const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalLength <= BASIS_EPS) throw new Error(`Cloth triangle ${triangleIndex} is degenerate`);
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;

  const { a, b, c } = resolveClothTriangleBasis(triangleIndex);
  const av = cssPoints[a];
  const bv = cssPoints[b];
  const cv = cssPoints[c];
  const baseDx = bv[0] - av[0];
  const baseDy = bv[1] - av[1];
  const baseDz = bv[2] - av[2];
  const baseLength = Math.sqrt(baseDx * baseDx + baseDy * baseDy + baseDz * baseDz);
  if (baseLength <= BASIS_EPS) throw new Error(`Cloth triangle ${triangleIndex} is degenerate`);
  const x0 = baseDx / baseLength;
  const x1 = baseDy / baseLength;
  const x2 = baseDz / baseLength;
  const apexX = (cv[0] - av[0]) * x0 + (cv[1] - av[1]) * x1 + (cv[2] - av[2]) * x2;
  const y0 = ny * x2 - nz * x1;
  const y1 = nz * x0 - nx * x2;
  const y2 = nx * x1 - ny * x0;
  const height = normalLength / baseLength;
  if (height <= BASIS_EPS) throw new Error(`Cloth triangle ${triangleIndex} is degenerate`);

  const left = Math.max(0, Math.min(baseLength, apexX));
  const right = Math.max(0, baseLength - left);
  const screenPoints = [left, 0, 0, height, left + right, height];
  const ownedSeams = seamEdges[triangleIndex] ?? [];
  const edgePairs = [[c, a], [a, b], [b, c]];
  const edgeAmounts = edgePairs.map(([from, to], localEdgeIndex) => {
    const edgeIndex = triangleEdgeIndexForPair(from, to);
    const requested = edgeIndex !== undefined && ownedSeams.includes(edgeIndex)
      ? CLOTH_SEAM_BLEED
      : 0;
    return safePlanSeamBleedAmount(screenPoints, localEdgeIndex, requested);
  });
  const expanded = ownedSeams.length > 0
    ? offsetConvexPolygonPointsByEdgeAmounts(screenPoints, edgeAmounts)
    : offsetStableTrianglePoints(left, right, height, SOLID_TRIANGLE_BLEED);
  const apex2x = expanded[0];
  const apex2y = expanded[1];
  const baseLeft2x = expanded[2];
  const baseLeft2y = expanded[3];
  const baseRight2x = expanded[4];
  const baseRight2y = expanded[5];
  const baseY = (baseLeft2y + baseRight2y) / 2;
  const leftPx = apex2x - baseLeft2x;
  const rightPx = baseRight2x - apex2x;
  const heightPx = baseY - apex2y;
  if (leftPx <= BASIS_EPS || rightPx <= BASIS_EPS || heightPx <= BASIS_EPS) {
    throw new Error(`Cloth triangle ${triangleIndex} is degenerate`);
  }
  const baseWidthPx = leftPx + rightPx;
  const xScale = baseWidthPx / CORNER_TRIANGLE_CANONICAL_SIZE;
  const yXScale = (rightPx - leftPx) * 0.5 / CORNER_TRIANGLE_CANONICAL_SIZE;
  const yYScale = heightPx / CORNER_TRIANGLE_CANONICAL_SIZE;
  const txXOffset = apex2x - left - baseWidthPx * 0.5;
  const txYOffset = apex2y;
  const matrix = [
    x0 * xScale, x1 * xScale, x2 * xScale, 0,
    x0 * yXScale + y0 * yYScale,
    x1 * yXScale + y1 * yYScale,
    x2 * yXScale + y2 * yYScale,
    0,
    nx, ny, nz, 0,
    cv[0] + x0 * txXOffset + y0 * txYOffset,
    cv[1] + x1 * txXOffset + y1 * txYOffset,
    cv[2] + x2 * txXOffset + y2 * txYOffset,
    1,
  ].map(roundMatrix);
  const rasterScale = CORNER_TRIANGLE_CANONICAL_SIZE / CLOTH_RASTER_LEAF_SIZE;
  for (const index of [0, 1, 2, 4, 5, 6]) matrix[index] *= rasterScale;
  return matrix.map(roundMatrix);
}

function generalClothTriangleMatrixFromWorldPoints(points, triangleIndex, seamEdges) {
  const cssPoints = points.map(sourceWorldToCssView);
  const plan = computeSolidTrianglePlanFromCssPoints(
    { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
    triangleIndex,
    {
      tileSize: 1,
      layerElevation: 1,
      bleedRatio: 1,
      seamBleed: CLOTH_SEAM_BLEED,
      seamEdges: new Set(seamEdges[triangleIndex] ?? []),
    },
    {
      basis: resolveClothTriangleBasis(triangleIndex),
      matrixDecimals: 7,
      primitive: "corner-bevel",
      includeColor: false,
    },
    ...cssPoints.flat(),
  );
  if (!plan) throw new Error(`Cloth triangle ${triangleIndex} is degenerate`);
  const matrix = plan.transformText.slice(9, -1).split(",").map(Number);
  const rasterScale = CORNER_TRIANGLE_CANONICAL_SIZE / CLOTH_RASTER_LEAF_SIZE;
  for (const index of [0, 1, 2, 4, 5, 6]) matrix[index] *= rasterScale;
  return matrix.map(roundMatrix);
}

export function sourceWorldToCssView(point) {
  const relative = subtract(point, CSSCLOTH_CAMERA_POSITION);
  return [
    dot3(CSSCLOTH_VIEW_BASIS.x, relative),
    -dot3(CSSCLOTH_VIEW_BASIS.y, relative),
    dot3(CSSCLOTH_VIEW_BASIS.z, relative),
  ];
}

export function resolveClothTriangleBasis(triangleIndex) {
  if (!Number.isSafeInteger(triangleIndex) || triangleIndex < 0) {
    throw new RangeError("Cloth triangle index is out of range");
  }
  return triangleIndex % 2 === 0 ? EVEN_TRIANGLE_BASIS : ODD_TRIANGLE_BASIS;
}

function createViewBasis(position, target, up) {
  const z = normalize(subtract(position, target));
  const x = normalize(cross(up, z));
  return Object.freeze({ x: Object.freeze(x), y: Object.freeze(cross(z, x)), z: Object.freeze(z) });
}

function triangleEdgeIndexForPair(a, b) {
  if ((a + 1) % 3 === b) return a;
  if ((b + 1) % 3 === a) return b;
  return undefined;
}

function roundMatrix(value) {
  const rounded = Math.round(value * 10_000_000) / 10_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const magnitude = Math.hypot(a[0], a[1], a[2]);
  return magnitude === 0 ? [0, 0, 0] : [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
}
