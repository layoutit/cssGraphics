import {
  CSSFLOWER_SIDE_MATERIALS,
  CSSFLOWER_SOURCE_PROFILE,
  FLOAT,
  sourceToPolyCss,
} from "./sourceProfile.mjs";

const SOURCE_CUBE_PLANES = Object.freeze([
  Object.freeze({ id: "front", base: [-0.5, -0.5, 0.5], xAxis: [1, 0, 0], yAxis: [0, 1, 0] }),
  Object.freeze({ id: "back", base: [0.5, -0.5, -0.5], xAxis: [-1, 0, 0], yAxis: [0, 1, 0] }),
  Object.freeze({ id: "top", base: [0.5, 0.5, -0.5], xAxis: [-1, 0, 0], yAxis: [0, 0, 1] }),
  Object.freeze({ id: "bottom", base: [-0.5, -0.5, -0.5], xAxis: [1, 0, 0], yAxis: [0, 0, 1] }),
  Object.freeze({ id: "right", base: [0.5, -0.5, -0.5], xAxis: [0, 1, 0], yAxis: [0, 0, 1] }),
  Object.freeze({ id: "left", base: [-0.5, 0.5, -0.5], xAxis: [0, -1, 0], yAxis: [0, 0, 1] }),
]);

export function buildCubeTopology(subdivision = CSSFLOWER_SOURCE_PROFILE.subdivision) {
  if (subdivision !== 10) throw new RangeError("The first cssFlower slice requires subdivision 10");
  const points = [];
  const triangles = [];
  const strips = [];
  const sideStride = (subdivision + 1) ** 2;

  for (let side = 0; side < SOURCE_CUBE_PLANES.length; side += 1) {
    const plane = SOURCE_CUBE_PLANES[side];
    for (let sourceX = 0; sourceX <= subdivision; sourceX += 1) {
      const x = FLOAT(FLOAT(sourceX) / FLOAT(subdivision));
      for (let sourceY = 0; sourceY <= subdivision; sourceY += 1) {
        const y = FLOAT(FLOAT(sourceY) / FLOAT(subdivision));
        const source = mapToSourcePlane(plane, x, y);
        const scaledDistance = multiplyFloat(sourceLength(source), 2);
        const radialCoefficient = divideFloat(subtractFloat(1, scaledDistance), scaledDistance);
        const pointIndex = points.length;
        points.push(Object.freeze({
          id: `side-${String(side).padStart(2, "0")}-point-${String(sourceX * (subdivision + 1) + sourceY).padStart(3, "0")}`,
          index: pointIndex,
          side,
          sideId: plane.id,
          row: sourceX,
          column: sourceY,
          source: Object.freeze(source),
          radialCoefficient,
        }));
      }
    }

    const index = (sourceX, sourceY) => side * sideStride + sourceX * (subdivision + 1) + sourceY;
    for (let strip = 0; strip < subdivision; strip += 1) {
      const stripPointIndices = [];
      for (let sourceY = 0; sourceY <= subdivision; sourceY += 1) {
        stripPointIndices.push(index(strip, sourceY), index(strip + 1, sourceY));
      }
      strips.push(Object.freeze({ side, strip, pointIndices: Object.freeze(stripPointIndices) }));
      for (let stripIndex = 2; stripIndex < stripPointIndices.length; stripIndex += 1) {
        const pointIndices = (stripIndex & 1) === 0
          ? [stripPointIndices[stripIndex - 2], stripPointIndices[stripIndex - 1], stripPointIndices[stripIndex]]
          : [stripPointIndices[stripIndex - 1], stripPointIndices[stripIndex - 2], stripPointIndices[stripIndex]];
        const stripTriangle = stripIndex - 2;
        const triangleIndex = triangles.length;
        triangles.push(Object.freeze({
          id: `side-${String(side).padStart(2, "0")}-strip-${String(strip).padStart(2, "0")}-triangle-${String(stripTriangle).padStart(2, "0")}`,
          index: triangleIndex,
          side,
          sideId: plane.id,
          strip,
          column: Math.floor(stripTriangle / 2),
          stripTriangle,
          cellTriangle: stripTriangle & 1,
          material: CSSFLOWER_SIDE_MATERIALS[side],
          pointIndices: Object.freeze(pointIndices),
        }));
      }
    }
  }

  if (points.length !== 726 || triangles.length !== 1200) {
    throw new Error(`cssFlower cube topology drifted (${points.length} points, ${triangles.length} triangles)`);
  }
  return Object.freeze({
    schema: "cssflower-cube-topology@1",
    subdivision,
    sideCount: SOURCE_CUBE_PLANES.length,
    sideLocalPointCount: points.length,
    triangleCount: triangles.length,
    topology: "six-side-local-ordered-triangle-strips",
    merge: false,
    points: Object.freeze(points),
    strips: Object.freeze(strips),
    triangles: Object.freeze(triangles),
  });
}

export function buildSideSiblingSeamPlan(topology) {
  if (topology?.triangleCount !== 1200 || topology?.sideCount !== 6) {
    throw new TypeError("cssFlower sibling seams require the retained default-cube topology");
  }
  const edgeOwners = new Map();
  const edgeMasks = new Array(topology.triangleCount).fill(0);
  for (const triangle of topology.triangles) {
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const first = triangle.pointIndices[edgeIndex];
      const second = triangle.pointIndices[(edgeIndex + 1) % 3];
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const key = `${triangle.side}:${low}:${high}`;
      const record = edgeOwners.get(key) ?? { pointIndices: Object.freeze([low, high]), owners: [] };
      record.owners.push(Object.freeze({ triangleIndex: triangle.index, edgeIndex }));
      edgeOwners.set(key, record);
    }
  }

  const boundaryPointIndices = new Set();
  for (const { pointIndices, owners } of edgeOwners.values()) {
    if (owners.length !== 1) continue;
    boundaryPointIndices.add(pointIndices[0]);
    boundaryPointIndices.add(pointIndices[1]);
  }

  let sharedEdgeCount = 0;
  let boundaryEdgeCount = 0;
  for (const { owners } of edgeOwners.values()) {
    if (owners.length === 1) {
      boundaryEdgeCount += 1;
      continue;
    }
    if (owners.length !== 2) {
      throw new Error(`cssFlower side-local edge has ${owners.length} owners`);
    }
    sharedEdgeCount += 1;
    for (const owner of owners) {
      edgeMasks[owner.triangleIndex] |= 1 << owner.edgeIndex;
    }
  }
  const sharedEdgeIncidenceCount = sharedEdgeCount * 2;
  const boundaryEdgeIncidenceCount = boundaryEdgeCount;
  const boundaryAdjacentTriangles = topology.triangles.map((triangle) => (
    triangle.pointIndices.some((pointIndex) => boundaryPointIndices.has(pointIndex))
  ));
  const boundaryAdjacentTriangleCount = boundaryAdjacentTriangles.filter(Boolean).length;
  if (sharedEdgeCount !== 1680 || boundaryEdgeCount !== 240 ||
      sharedEdgeIncidenceCount !== 3360 || boundaryEdgeIncidenceCount !== 240 ||
      boundaryPointIndices.size !== 240 || boundaryAdjacentTriangleCount !== 432 ||
      edgeMasks.reduce((sum, mask) => sum + bitCount3(mask), 0) !== sharedEdgeIncidenceCount ||
      edgeMasks.some((mask) => mask < 1 || mask > 7)) {
    throw new Error("cssFlower side-local sibling seam inventory drifted");
  }
  return Object.freeze({
    schema: "cssflower-side-sibling-seam-plan@1",
    policy: "side-local-shared-edges-boundary-ring-damped",
    boundaryVertexCount: boundaryPointIndices.size,
    boundaryAdjacentTriangles: Object.freeze(boundaryAdjacentTriangles),
    boundaryAdjacentTriangleCount,
    edgeMasks: Object.freeze(edgeMasks),
    sharedEdgeCount,
    sharedEdgeIncidenceCount,
    boundaryEdgeCount,
    boundaryEdgeIncidenceCount,
  });
}

export function deformCubePoints(topology, sf) {
  const positions = new Float32Array(topology.points.length * 3);
  for (const point of topology.points) {
    const scale = addFloat(multiplyFloat(point.radialCoefficient, FLOAT(sf)), 1);
    const offset = point.index * 3;
    positions[offset] = multiplyFloat(point.source[0], scale);
    positions[offset + 1] = multiplyFloat(point.source[1], scale);
    positions[offset + 2] = multiplyFloat(point.source[2], scale);
  }
  return positions;
}

export function computeSmoothPointNormals(topology, positions) {
  const sums = new Float32Array(topology.points.length * 3);
  for (const strip of topology.strips) {
    let index1 = strip.pointIndices[0];
    let index2 = strip.pointIndices[1];
    for (let stripTriangle = 0; stripTriangle < strip.pointIndices.length - 2; stripTriangle += 1) {
      const index3 = strip.pointIndices[stripTriangle + 2];
      const a = index1 * 3;
      const b = index2 * 3;
      const c = index3 * 3;
      const v1 = [
        subtractFloat(positions[c], positions[a]),
        subtractFloat(positions[c + 1], positions[a + 1]),
        subtractFloat(positions[c + 2], positions[a + 2]),
      ];
      const v2 = [
        subtractFloat(positions[b], positions[a]),
        subtractFloat(positions[b + 1], positions[a + 1]),
        subtractFloat(positions[b + 2], positions[a + 2]),
      ];
      const normal = [
        subtractFloat(multiplyFloat(v1[1], v2[2]), multiplyFloat(v2[1], v1[2])),
        subtractFloat(multiplyFloat(v1[2], v2[0]), multiplyFloat(v2[2], v1[0])),
        subtractFloat(multiplyFloat(v1[0], v2[1]), multiplyFloat(v2[0], v1[1])),
      ];
      if ((stripTriangle & 1) === 0) {
        normal[0] = FLOAT(-normal[0]);
        normal[1] = FLOAT(-normal[1]);
        normal[2] = FLOAT(-normal[2]);
      }
      for (const pointIndex of [index1, index2, index3]) {
        const offset = pointIndex * 3;
        sums[offset] = addFloat(sums[offset], normal[0]);
        sums[offset + 1] = addFloat(sums[offset + 1], normal[1]);
        sums[offset + 2] = addFloat(sums[offset + 2], normal[2]);
      }
      index1 = index2;
      index2 = index3;
    }
  }
  return sums;
}

export function trianglePolygon(topology, triangle, positions) {
  return {
    vertices: triangle.pointIndices.map((pointIndex) => {
      const offset = pointIndex * 3;
      return sourceToPolyCss([positions[offset], positions[offset + 1], positions[offset + 2]]);
    }),
    color: triangle.material.color,
    data: {
      "cssflower-triangle": triangle.id,
      "cssflower-leaf-index": triangle.index,
      "cssflower-side": triangle.side,
      "cssflower-side-id": triangle.sideId,
      "cssflower-strip": triangle.strip,
      "cssflower-strip-triangle": triangle.stripTriangle,
      "cssflower-material": triangle.material.id,
      "cssflower-seam-bleed": 0,
    },
  };
}

function mapToSourcePlane(plane, x, y) {
  return [0, 1, 2].map((component) => addFloat(
    addFloat(multiplyFloat(x, plane.xAxis[component]), multiplyFloat(y, plane.yAxis[component])),
    plane.base[component],
  ));
}

function sourceLength(value) {
  const xy = addFloat(multiplyFloat(value[0], value[0]), multiplyFloat(value[1], value[1]));
  const xyz = addFloat(xy, multiplyFloat(value[2], value[2]));
  return FLOAT(Math.sqrt(xyz));
}

function addFloat(left, right) {
  return FLOAT(FLOAT(left) + FLOAT(right));
}

function subtractFloat(left, right) {
  return FLOAT(FLOAT(left) - FLOAT(right));
}

function multiplyFloat(left, right) {
  return FLOAT(FLOAT(left) * FLOAT(right));
}

function divideFloat(left, right) {
  return FLOAT(FLOAT(left) / FLOAT(right));
}

function bitCount3(mask) {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}
