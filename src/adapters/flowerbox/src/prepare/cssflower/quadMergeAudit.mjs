import { deformCubePoints } from "./cubeTopology.mjs";

export function auditPreparedQuadMergeEligibility(topology, cycle) {
  if (topology.triangleCount % 2 !== 0) throw new Error("cssFlower triangle bank cannot be paired into source cells");
  const sourceCellCount = topology.triangleCount / 2;
  const nonCoplanarCells = new Set();
  let testedStateCellPairs = 0;
  let exactCoplanarStateCellPairs = 0;
  let exactNonCoplanarStateCellPairs = 0;
  let minimumPositivePlaneDistance = Number.POSITIVE_INFINITY;
  let maximumPlaneDistance = 0;
  let firstNonCoplanar = null;
  let worstNonCoplanar = null;

  for (const geometryState of cycle.geometryStates) {
    const positions = deformCubePoints(topology, geometryState.sf);
    for (let cellIndex = 0; cellIndex < sourceCellCount; cellIndex += 1) {
      const first = topology.triangles[cellIndex * 2];
      const second = topology.triangles[cellIndex * 2 + 1];
      if (first.side !== second.side || first.strip !== second.strip ||
          first.column !== second.column || first.material.id !== second.material.id) {
        throw new Error(`cssFlower source cell pairing drifted at ${cellIndex}`);
      }
      const pointIndices = [...new Set([...first.pointIndices, ...second.pointIndices])];
      if (pointIndices.length !== 4) throw new Error(`cssFlower source cell ${cellIndex} does not have four corners`);
      const points = pointIndices.map((pointIndex) => pointAt(positions, pointIndex));
      const ab = subtract(points[1], points[0]);
      const ac = subtract(points[2], points[0]);
      const ad = subtract(points[3], points[0]);
      const normal = cross(ab, ac);
      const signedVolume6 = dot(normal, ad);
      const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
      const planeDistance = normalLength > 0 ? Math.abs(signedVolume6) / normalLength : Number.POSITIVE_INFINITY;
      testedStateCellPairs += 1;
      if (signedVolume6 === 0) {
        exactCoplanarStateCellPairs += 1;
        continue;
      }
      exactNonCoplanarStateCellPairs += 1;
      nonCoplanarCells.add(cellIndex);
      minimumPositivePlaneDistance = Math.min(minimumPositivePlaneDistance, planeDistance);
      const coordinate = {
        geometryStateIndex: geometryState.index,
        firstTick: geometryState.firstTick,
        sf: geometryState.sf,
        sfHex: geometryState.sfHex,
        cellIndex,
        side: first.side,
        strip: first.strip,
        column: first.column,
        triangleIds: [first.id, second.id],
        pointIndices,
        signedVolume6,
        planeDistance,
      };
      if (!firstNonCoplanar) firstNonCoplanar = Object.freeze(coordinate);
      if (planeDistance > maximumPlaneDistance) {
        maximumPlaneDistance = planeDistance;
        worstNonCoplanar = Object.freeze(coordinate);
      }
    }
  }

  const acrossAllStatesEligibleCellCount = sourceCellCount - nonCoplanarCells.size;
  if (acrossAllStatesEligibleCellCount !== 0 || exactNonCoplanarStateCellPairs === 0) {
    throw new Error("cssFlower quad merge audit unexpectedly found an across-cycle eligible source cell");
  }
  return Object.freeze({
    schema: "cssflower-quad-merge-audit@1",
    primitiveConsidered: Object.freeze({ tag: "b", kind: "polycss-solid-quad" }),
    status: "rejected-noncoplanar-across-prepared-cycle",
    comparison: "exact-signed-volume-on-float32-prepared-positions",
    sourceCellCount,
    geometryStateCount: cycle.geometryStateCount,
    testedStateCellPairs,
    exactCoplanarStateCellPairs,
    exactNonCoplanarStateCellPairs,
    cellsNonCoplanarInAtLeastOneState: nonCoplanarCells.size,
    acrossAllStatesEligibleCellCount,
    minimumPositivePlaneDistance,
    maximumPlaneDistance,
    firstNonCoplanar,
    worstNonCoplanar,
    geometryEquivalence: false,
    lightingEquivalence: "not-evaluated-after-geometry-prerequisite-failed",
    decision: "retain-two-stable-triangle-leaves-per-source-cell",
  });
}

function pointAt(positions, index) {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
