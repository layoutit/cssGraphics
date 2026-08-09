import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMengerPreparedGeometry,
  preparedSourceFaceVertices,
} from "../src/prepare/cssmenger/mengerGeometry.mjs";

const COLORS = [
  [0.7, 0.05, 0.31, 1],
  [0.75, 0.75, 0.62, 1],
  [0.53, 0.56, 0.25, 1],
];

test("depth-3 source recursion preserves exact face census and coverage", () => {
  const geometry = buildMengerPreparedGeometry({ depth: 3, axisColors: COLORS });
  assert.equal(geometry.cellsPerAxis, 27);
  assert.equal(geometry.metrics.sourcePolygonCount, 18048);
  assert.deepEqual(geometry.metrics.sourceAxisFaceCounts, [6016, 6016, 6016]);
  assert.equal(geometry.metrics.preparedLeafCount, 84);
  assert.equal(geometry.metrics.mergedSourceFaceCount, 17964);
  assert.equal(geometry.metrics.coplanarPlaneCount, 84);
  assert.equal(geometry.metrics.coplanarOccupancyPatternCount, 8);
  assert.equal(geometry.metrics.exactRectanglePartitionLeafCount, 9528);
  assert.equal(geometry.metrics.coplanarPartitionAlgorithm, "one-alpha-atlas-quad-per-directional-plane");
  assert.equal(geometry.metrics.coplanarPartitionOptimal, true);
  assert.equal(geometry.metrics.sourceFaceCoverageCount, 18048);
  assert.equal(geometry.metrics.sourceFaceCoverageExact, true);
  assert.equal(geometry.metrics.sourceFaceCoverageSha256, "5bb98301f900af4b1b15ae73ffbd7338836b67bb0bd48b26da6017b1874b60ea");
  assert.equal(geometry.meshes.length, 3);
  assert.deepEqual(geometry.meshes.map((mesh) => mesh.polygons.length), [28, 28, 28]);
  assert.equal(geometry.meshes.every((mesh) => mesh.polygons.every((polygon) => polygon.vertices.length === 4)), true);
  assert.equal(geometry.bundles.reduce((sum, bundle) => sum + bundle.sourceFaceIndices.length, 0), 18048);
});

test("source face counts match the known recursion sequence", () => {
  const expected = [6, 72, 1056, 18048];
  for (let depth = 0; depth <= 3; depth += 1) {
    const geometry = buildMengerPreparedGeometry({ depth, axisColors: COLORS });
    assert.equal(geometry.metrics.sourcePolygonCount, expected[depth]);
  }
});

test("prepared face winding matches every adapted source normal", () => {
  const expected = new Map([
    ["X0", [-1, 0, 0]],
    ["X1", [1, 0, 0]],
    ["Y0", [0, 1, 0]],
    ["Y1", [0, -1, 0]],
    ["Z0", [0, 0, -1]],
    ["Z1", [0, 0, 1]],
  ]);
  for (const [direction, normal] of expected) {
    const vertices = preparedSourceFaceVertices({
      direction,
      plane: direction.endsWith("0") ? 0 : 1,
      u: 0,
      v: 0,
    }, 1);
    const edgeA = subtract(vertices[1], vertices[0]);
    const edgeB = subtract(vertices[2], vertices[0]);
    assert.deepEqual(crossSign(edgeA, edgeB), normal, direction);
  }
});

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function crossSign(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ].map((value) => value === 0 ? 0 : Math.sign(value));
}
