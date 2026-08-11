import { createHash } from "node:crypto";
import GLPK from "glpk.js";

const glpk = await GLPK();
const MAX_EXACT_DEPTH = 3;
const rectanglePartitionCache = new Map();

export const FACE = Object.freeze({ X0: 0x01, X1: 0x02, Y0: 0x04, Y1: 0x08, Z0: 0x10, Z1: 0x20 });
const DIRECTIONS = Object.freeze([
  Object.freeze({ id: "X0", bit: FACE.X0, axis: "x", axisIndex: 0, sign: -1 }),
  Object.freeze({ id: "X1", bit: FACE.X1, axis: "x", axisIndex: 0, sign: 1 }),
  Object.freeze({ id: "Y0", bit: FACE.Y0, axis: "y", axisIndex: 1, sign: -1 }),
  Object.freeze({ id: "Y1", bit: FACE.Y1, axis: "y", axisIndex: 1, sign: 1 }),
  Object.freeze({ id: "Z0", bit: FACE.Z0, axis: "z", axisIndex: 2, sign: -1 }),
  Object.freeze({ id: "Z1", bit: FACE.Z1, axis: "z", axisIndex: 2, sign: 1 }),
]);
const AXIS_MASKS = Object.freeze([FACE.X0 | FACE.X1, FACE.Y0 | FACE.Y1, FACE.Z0 | FACE.Z1]);

export function buildMengerPreparedGeometry({ depth = 3, axisColors } = {}) {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > MAX_EXACT_DEPTH) {
    throw new RangeError(`Exact Menger preparation supports integer depths from 0 to ${MAX_EXACT_DEPTH}`);
  }
  if (!Array.isArray(axisColors) || axisColors.length !== 3) throw new TypeError("Three prepared axis colors are required");
  const cellsPerAxis = 3 ** depth;
  const sourceFaces = [];
  for (let axisGroup = 0; axisGroup < AXIS_MASKS.length; axisGroup += 1) {
    recurseMenger({
      level: depth,
      bounds: [0, cellsPerAxis, 0, cellsPerAxis, 0, cellsPerAxis],
      faces: AXIS_MASKS[axisGroup],
      originalFaces: AXIS_MASKS[axisGroup],
      axisGroup,
      sourceFaces,
    });
  }
  const mergeResult = mergeCoplanarSourceFaces(sourceFaces, cellsPerAxis);
  const bundles = mergeResult.bundles;
  const meshes = [0, 1, 2].map((axisGroup) => {
    const polygons = bundles
      .filter((bundle) => bundle.axisGroup === axisGroup)
      .map((bundle) => bundleToPolygon(bundle, cellsPerAxis, axisColors[axisGroup]));
    return Object.freeze({
      id: `menger-axis-${"xyz"[axisGroup]}`,
      kind: "xscreensaver-menger-axis-face-bank",
      sourceId: `menger.c:build_sponge:list${axisGroup}`,
      axisGroup,
      stableDom: true,
      excludeFromAutoCenter: true,
      polygons: Object.freeze(polygons),
    });
  });
  const covered = bundles.flatMap((bundle) => bundle.sourceFaceIndices).sort((a, b) => a - b);
  const coverageExact = covered.length === sourceFaces.length && covered.every((value, index) => value === index);
  if (!coverageExact) throw new Error("Prepared Menger face bundles lost or duplicated source coverage");
  const sourceCoverageSha256 = createHash("sha256")
    .update(sourceFaces.map(faceIdentity).join("\n"))
    .digest("hex");
  return Object.freeze({
    depth,
    cellsPerAxis,
    sourceFaces: Object.freeze(sourceFaces),
    bundles: Object.freeze(bundles),
    meshes: Object.freeze(meshes),
    metrics: Object.freeze({
      sourcePolygonCount: sourceFaces.length,
      sourceQuadCount: sourceFaces.length,
      sourceTriangleCount: 0,
      sourceAxisFaceCounts: Object.freeze([0, 1, 2].map((axis) => sourceFaces.filter((face) => face.axisGroup === axis).length)),
      preparedLeafCount: bundles.length,
      preparedPolygonCount: bundles.length,
      preparedRenderBundleCount: bundles.length,
      mergedSourceFaceCount: sourceFaces.length - bundles.length,
      mergeReductionRatio: (sourceFaces.length - bundles.length) / sourceFaces.length,
      mergeCandidateSurfaceCount: sourceFaces.length,
      coplanarPlaneCount: mergeResult.metrics.coplanarPlaneCount,
      coplanarOccupancyPatternCount: mergeResult.metrics.coplanarOccupancyPatternCount,
      coplanarRectangleCandidateCount: mergeResult.metrics.coplanarRectangleCandidateCount,
      coplanarUniqueRectangleCandidateCount: mergeResult.metrics.coplanarUniqueRectangleCandidateCount,
      exactRectanglePartitionLeafCount: mergeResult.metrics.exactRectanglePartitionLeafCount,
      coplanarPartitionAlgorithm: "one-alpha-atlas-quad-per-directional-plane",
      coplanarPartitionOptimal: true,
      maximumBundleSourceFaceCount: Math.max(...bundles.map((bundle) => bundle.sourceFaceIndices.length)),
      sourceFaceCoverageCount: covered.length,
      sourceFaceCoverageSha256: sourceCoverageSha256,
      sourceFaceCoverageExact: coverageExact,
    }),
  });
}

function recurseMenger({ level, bounds, faces, originalFaces, axisGroup, sourceFaces }) {
  if (level === 0) {
    emitCubeFaces(bounds, faces, axisGroup, sourceFaces);
    return;
  }
  const [x0, x1, y0, y1, z0, z1] = bounds;
  const xi = (x1 - x0) / 3;
  const yi = (y1 - y0) / 3;
  const zi = (z1 - z0) / 3;
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let z = 0; z < 3; z += 1) {
        if (!((x !== 1 && y !== 1) || (y !== 1 && z !== 1) || (x !== 1 && z !== 1))) continue;
        let next = faces;
        if (x === 1 || (x === 2 && y !== 1 && z !== 1)) next &= ~FACE.X0;
        if (x === 1 || (x === 0 && y !== 1 && z !== 1)) next &= ~FACE.X1;
        if ((originalFaces & FACE.X0) && x === 2 && (y === 1 || z === 1)) next |= FACE.X0;
        if ((originalFaces & FACE.X1) && x === 0 && (y === 1 || z === 1)) next |= FACE.X1;
        if (y === 1 || (y === 2 && x !== 1 && z !== 1)) next &= ~FACE.Y0;
        if (y === 1 || (y === 0 && x !== 1 && z !== 1)) next &= ~FACE.Y1;
        if ((originalFaces & FACE.Y0) && y === 2 && (x === 1 || z === 1)) next |= FACE.Y0;
        if ((originalFaces & FACE.Y1) && y === 0 && (x === 1 || z === 1)) next |= FACE.Y1;
        if (z === 1 || (z === 2 && x !== 1 && y !== 1)) next &= ~FACE.Z0;
        if (z === 1 || (z === 0 && x !== 1 && y !== 1)) next &= ~FACE.Z1;
        if ((originalFaces & FACE.Z0) && z === 2 && (x === 1 || y === 1)) next |= FACE.Z0;
        if ((originalFaces & FACE.Z1) && z === 0 && (x === 1 || y === 1)) next |= FACE.Z1;
        recurseMenger({
          level: level - 1,
          bounds: [
            x0 + x * xi, x0 + (x + 1) * xi,
            y0 + y * yi, y0 + (y + 1) * yi,
            z0 + z * zi, z0 + (z + 1) * zi,
          ],
          faces: next,
          originalFaces,
          axisGroup,
          sourceFaces,
        });
      }
    }
  }
}

function emitCubeFaces(bounds, faces, axisGroup, sourceFaces) {
  for (const direction of DIRECTIONS) {
    if (!(faces & direction.bit)) continue;
    const cell = faceCell(bounds, direction);
    sourceFaces.push(Object.freeze({
      sourceIndex: sourceFaces.length,
      axisGroup,
      direction: direction.id,
      plane: cell.plane,
      u: cell.u,
      v: cell.v,
    }));
  }
}

function faceCell([x0, x1, y0, y1, z0, z1], direction) {
  if (direction.axis === "x") return { plane: direction.sign < 0 ? x0 : x1, u: y0, v: z0 };
  if (direction.axis === "y") return { plane: direction.sign < 0 ? y0 : y1, u: x0, v: z0 };
  return { plane: direction.sign < 0 ? z0 : z1, u: x0, v: y0 };
}

function mergeCoplanarSourceFaces(sourceFaces, cellsPerAxis) {
  const groups = new Map();
  for (const face of sourceFaces) {
    const key = `${face.axisGroup}:${face.direction}:${face.plane}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(face);
  }
  const bundles = [];
  const occupancyPatterns = new Map();
  let coplanarRectangleCandidateCount = 0;
  let exactRectanglePartitionLeafCount = 0;
  for (const faces of groups.values()) {
    const faceByCell = new Map(faces.map((face) => [`${face.u},${face.v}`, face]));
    const occupancySignature = [...faceByCell.keys()].sort(compareCellKeys).join(";");
    const partition = minimumRectanglePartition(faceByCell, cellsPerAxis, occupancySignature);
    occupancyPatterns.set(occupancySignature, partition.candidateCount);
    coplanarRectangleCandidateCount += partition.candidateCount;
    exactRectanglePartitionLeafCount += partition.rectangles.length;
    const first = faces[0];
    bundles.push(Object.freeze({
      bundleIndex: bundles.length,
      axisGroup: first.axisGroup,
      direction: first.direction,
      plane: first.plane,
      u0: 0,
      u1: cellsPerAxis,
      v0: 0,
      v1: cellsPerAxis,
      occupancySignature,
      sourceFaceIndices: Object.freeze(faces.map((face) => face.sourceIndex)),
    }));
  }
  return Object.freeze({
    bundles: Object.freeze(bundles),
    metrics: Object.freeze({
      coplanarPlaneCount: groups.size,
      coplanarOccupancyPatternCount: occupancyPatterns.size,
      coplanarRectangleCandidateCount,
      coplanarUniqueRectangleCandidateCount: [...occupancyPatterns.values()].reduce((sum, count) => sum + count, 0),
      exactRectanglePartitionLeafCount,
    }),
  });
}

function minimumRectanglePartition(faceByCell, cellsPerAxis, occupancySignature) {
  const cached = rectanglePartitionCache.get(occupancySignature);
  if (cached) return cached;
  const rectangles = enumerateSolidRectangles(faceByCell, cellsPerAxis);
  const candidateVariables = rectangles.map((rectangle, index) => ({
    name: `r${index}`,
    coef: 1,
    rectangle,
  }));
  const cellConstraints = new Map([...faceByCell.keys()].map((key) => [key, []]));
  for (const candidate of candidateVariables) {
    const rectangle = candidate.rectangle;
    for (let v = rectangle.v0; v < rectangle.v1; v += 1) {
      for (let u = rectangle.u0; u < rectangle.u1; u += 1) {
        cellConstraints.get(`${u},${v}`).push({ name: candidate.name, coef: 1 });
      }
    }
  }
  const result = glpk.solve({
    name: "cssmenger-coplanar-partition",
    objective: {
      direction: glpk.GLP_MIN,
      name: "retained-leaf-count",
      vars: candidateVariables.map(({ name, coef }) => ({ name, coef })),
    },
    subjectTo: [...cellConstraints.values()].map((vars, index) => ({
      name: `source-face-${index}`,
      vars,
      bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 },
    })),
    binaries: candidateVariables.map(({ name }) => name),
  }, {
    msglev: glpk.GLP_MSG_OFF,
    mipgap: 0,
    presol: true,
  });
  if (result.result.status !== glpk.GLP_OPT) {
    throw new Error(`Exact coplanar partition failed with GLPK status ${result.result.status}`);
  }
  const selected = candidateVariables
    .filter(({ name }) => result.result.vars[name] > 0.5)
    .map(({ rectangle }) => rectangle)
    .sort(compareRectangles);
  if (selected.length !== result.result.z) {
    throw new Error("Exact coplanar partition objective disagrees with its selected rectangle count");
  }
  const partition = Object.freeze({
    candidateCount: rectangles.length,
    rectangles: Object.freeze(selected.map((rectangle) => Object.freeze(rectangle))),
  });
  rectanglePartitionCache.set(occupancySignature, partition);
  return partition;
}

function enumerateSolidRectangles(faceByCell, cellsPerAxis) {
  const rectangles = [];
  for (let v0 = 0; v0 < cellsPerAxis; v0 += 1) {
    for (let u0 = 0; u0 < cellsPerAxis; u0 += 1) {
      if (!faceByCell.has(`${u0},${v0}`)) continue;
      let maximumU1 = cellsPerAxis;
      for (let v1 = v0; v1 < cellsPerAxis; v1 += 1) {
        if (!faceByCell.has(`${u0},${v1}`)) break;
        let solidU1 = u0;
        while (solidU1 < maximumU1 && faceByCell.has(`${solidU1},${v1}`)) solidU1 += 1;
        maximumU1 = solidU1;
        for (let u1 = u0 + 1; u1 <= maximumU1; u1 += 1) {
          rectangles.push({ u0, u1, v0, v1: v1 + 1 });
        }
      }
    }
  }
  return rectangles;
}

function compareCellKeys(left, right) {
  const [leftU, leftV] = left.split(",").map(Number);
  const [rightU, rightV] = right.split(",").map(Number);
  return leftV - rightV || leftU - rightU;
}

function compareRectangles(left, right) {
  return left.v0 - right.v0 || left.u0 - right.u0 || left.v1 - right.v1 || left.u1 - right.u1;
}

function bundleToPolygon(bundle, cellsPerAxis, material) {
  const vertices = preparedRectangleVertices(bundle, cellsPerAxis);
  const direction = DIRECTIONS.find((entry) => entry.id === bundle.direction);
  const sourceNormal = [0, 0, 0];
  sourceNormal[direction.axisIndex] = direction.sign;
  const normal = [sourceNormal[0], -sourceNormal[1], sourceNormal[2]];
  return Object.freeze({
    vertices: Object.freeze(vertices.map((vertex) => Object.freeze(vertex))),
    normals: Object.freeze(vertices.map(() => Object.freeze([...normal]))),
    material: Object.freeze([...material]),
    data: Object.freeze({
      sourceId: `menger.c:face-bundle-${bundle.bundleIndex}`,
      group: `axis-${"xyz"[bundle.axisGroup]}-${bundle.direction}`,
      "cssmenger-plane-leaf": bundle.bundleIndex,
      sourceFaceIndices: bundle.sourceFaceIndices,
      sourceFaceCount: bundle.sourceFaceIndices.length,
    }),
  });
}

export function preparedSourceFaceVertices(face, cellsPerAxis) {
  return preparedRectangleVertices({
    ...face,
    u0: face.u,
    u1: face.u + 1,
    v0: face.v,
    v1: face.v + 1,
  }, cellsPerAxis);
}

export function preparedSourceFaceNormal(face) {
  const direction = DIRECTIONS.find((entry) => entry.id === face?.direction);
  if (!direction) throw new Error(`Unknown Menger face direction ${face?.direction}`);
  const normal = [0, 0, 0];
  normal[direction.axisIndex] = direction.sign;
  return Object.freeze(normal);
}

function preparedRectangleVertices(rectangle, cellsPerAxis) {
  const sourceVertices = nativeRectangleVertices(rectangle).map((vertex) =>
    vertex.map((value) => -1.5 + value * (3 / cellsPerAxis)));
  return Object.freeze([...sourceVertices].reverse().map(([x, y, z]) =>
    Object.freeze([x * 2.2, -y * 2.2, z * 2.2])));
}

function nativeRectangleVertices({ direction, plane, u0, u1, v0, v1 }) {
  switch (direction) {
    case "X0": return [[plane, u1, v0], [plane, u0, v0], [plane, u0, v1], [plane, u1, v1]];
    case "X1": return [[plane, u1, v1], [plane, u0, v1], [plane, u0, v0], [plane, u1, v0]];
    case "Y0": return [[u1, plane, v0], [u1, plane, v1], [u0, plane, v1], [u0, plane, v0]];
    case "Y1": return [[u0, plane, v0], [u0, plane, v1], [u1, plane, v1], [u1, plane, v0]];
    case "Z0": return [[u1, v1, plane], [u1, v0, plane], [u0, v0, plane], [u0, v1, plane]];
    case "Z1": return [[u0, v1, plane], [u0, v0, plane], [u1, v0, plane], [u1, v1, plane]];
    default: throw new Error(`Unknown Menger face direction ${direction}`);
  }
}

function faceIdentity(face) {
  return `${face.sourceIndex}:${face.axisGroup}:${face.direction}:${face.plane}:${face.u}:${face.v}`;
}
