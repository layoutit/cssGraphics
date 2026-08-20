import {
  computeCoverageShadowSilhouette,
  computeParametricShadowSilhouette,
} from "@layoutit/polycss";

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function preparePolyMorphParametricShadow({
  id,
  frames,
  worldVertices,
  worldTriangles,
  lightDirection,
  projectPoint,
  triangleMatrix,
  atlas,
  definition = 16,
}) {
  const usesCoverage = typeof worldTriangles === "function";
  if (!/^[a-z][a-z0-9-]*$/u.test(id ?? "") || !Array.isArray(frames) || frames.length === 0 ||
      (!usesCoverage && typeof worldVertices !== "function") || typeof projectPoint !== "function" ||
      typeof triangleMatrix !== "function" || !Array.isArray(lightDirection) || lightDirection.length !== 3 ||
      !Number.isSafeInteger(definition) || definition < 3 || !atlas) {
    throw new TypeError("Complete prepared Morph shadow input is required");
  }
  const trianglesByFrame = frames.map((frame, frameIndex) => {
    if (usesCoverage) {
      const triangles = worldTriangles(frame);
      if (!Array.isArray(triangles) || triangles.some((triangle) =>
        !Array.isArray(triangle) || triangle.length !== 3)) {
        throw new TypeError("Prepared Morph coverage shadow needs complete source triangles");
      }
      const contours = computeCoverageShadowSilhouette(
        triangles,
        lightDirection,
        definition,
      ) ?? [];
      return Object.freeze(triangulateCoverageContours(contours, projectPoint, frameIndex));
    }
    const silhouette = computeParametricShadowSilhouette(
      worldVertices(frame),
      lightDirection,
      definition,
    );
    if (!silhouette || silhouette.length < 3) return Object.freeze([]);
    const outline = silhouette.map((point) => Object.freeze(projectPoint(point)));
    const center = averagePoint(outline);
    return Object.freeze(outline.map((point, index) => Object.freeze([
      center,
      point,
      outline[(index + 1) % outline.length],
    ])));
  });
  const leafCount = Math.max(...trianglesByFrame.map((triangles) => triangles.length));
  if (leafCount < 3) throw new Error("Prepared Morph shadow has no visible silhouette");
  const shadowFrames = Object.freeze(trianglesByFrame.map((triangles) => {
    return Object.freeze({
      matrices: Object.freeze(Array.from({ length: leafCount }, (_, index) => (
        index < triangles.length
          ? triangleMatrix(triangles[index])
          : IDENTITY
      ))),
      visibility: Object.freeze(Array.from(
        { length: leafCount },
        (_, index) => index < triangles.length ? 1 : 0,
      )),
    });
  }));
  const vertices = [];
  const normals = [];
  const polygons = [];
  const leaves = [];
  for (let index = 0; index < leafCount; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const polygonId = `${id}-${suffix}`;
    const vertexOffset = vertices.length;
    vertices.push(
      Object.freeze([0, 0, 0]),
      Object.freeze([atlas.width, 0, 0]),
      Object.freeze([0, atlas.height, 0]),
    );
    const normalIndex = normals.length;
    normals.push(Object.freeze([0, 0, 1]));
    polygons.push(Object.freeze({
      id: polygonId,
      vertexIndices: Object.freeze([vertexOffset, vertexOffset + 1, vertexOffset + 2]),
      normalIndices: Object.freeze([normalIndex, normalIndex, normalIndex]),
    }));
    leaves.push(Object.freeze({
      id: `leaf-${polygonId}`,
      polygonId,
      shapeId: id,
      materialId: "material-shadow",
      strategy: "atlas-slice",
      width: atlas.width,
      height: atlas.height,
      matrix: shadowFrames[0].matrices[index],
      atlas,
      fallback: null,
    }));
  }
  return deepFreeze({
    shape: { id, matrix: IDENTITY },
    material: { id: "material-shadow", color: [1, 1, 1, 1] },
    topology: { vertices, normals, polygons },
    leaves,
    frames: shadowFrames,
    leafCount,
  });
}

function triangulateCoverageContours(contours, projectPoint, frameIndex) {
  const triangles = [];
  for (const contour of contours) {
    const points = removeDuplicatePoints(contour.map((point) => Object.freeze(projectPoint(point))));
    const area = signedArea(points);
    if (points.length < 3 || area < 1) continue;
    const result = triangulateSimplePolygon(points);
    if (result.length !== points.length - 2) {
      throw new Error(`Prepared Morph coverage shadow frame ${frameIndex} could not be triangulated`);
    }
    triangles.push(...result);
  }
  return triangles.map(Object.freeze);
}

function removeDuplicatePoints(points) {
  const filtered = [];
  for (const point of points) {
    const previous = filtered.at(-1);
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-7) {
      filtered.push(point);
    }
  }
  if (filtered.length > 1 && Math.hypot(
    filtered[0][0] - filtered.at(-1)[0],
    filtered[0][1] - filtered.at(-1)[1],
  ) <= 1e-7) filtered.pop();
  return filtered;
}

function triangulateSimplePolygon(points) {
  const indices = points.map((_, index) => index);
  const triangles = [];
  while (indices.length > 3) {
    let found = false;
    for (let index = 0; index < indices.length; index += 1) {
      const previous = indices[(index - 1 + indices.length) % indices.length];
      const current = indices[index];
      const next = indices[(index + 1) % indices.length];
      if (cross2(points[previous], points[current], points[next]) <= 1e-8) continue;
      if (indices.some((candidate) => candidate !== previous && candidate !== current && candidate !== next &&
          pointInTriangle(points[candidate], points[previous], points[current], points[next]))) continue;
      triangles.push([points[previous], points[current], points[next]]);
      indices.splice(index, 1);
      found = true;
      break;
    }
    if (!found) return [];
  }
  if (indices.length === 3) triangles.push(indices.map((index) => points[index]));
  return triangles;
}

function pointInTriangle(point, a, b, c) {
  return cross2(a, b, point) >= -1e-8 &&
    cross2(b, c, point) >= -1e-8 &&
    cross2(c, a, point) >= -1e-8;
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area / 2;
}

function averagePoint(points) {
  const sum = points.reduce(
    (result, point) => [result[0] + point[0], result[1] + point[1], result[2] + point[2]],
    [0, 0, 0],
  );
  return sum.map((value) => value / points.length);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
