import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  CSSFLOCKS_BUG_VERTICES,
  CSSFLOCKS_FACE_INDICES,
  CSSFLOCKS_FACE_LIGHT_FACTORS,
} from "../src/prepare/cssflocks/modelBuilder.mjs";
import {
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceBlocks,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { buildFlocksBugMatrix } from "../src/shared/cssflocks/bugTransform.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const oraclePath = resolve(repositoryRoot, "bench/results/cssflocks/geometry/native-geometry.json");

test("actual GLU 3-slice 2-stack feedback matches the prepared six-face topology and CCW winding", async () => {
  const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  assert.equal(oracle.triangleCount, 6);
  assert.equal(oracle.frontFace, 0x0901);
  assert.equal(oracle.cullFaceMode, 0x0405);
  assert.equal(oracle.cullEnabled, true);
  const preparedTriangles = CSSFLOCKS_FACE_INDICES.map((face) => face.map((index) => CSSFLOCKS_BUG_VERTICES[index]));
  const unmatched = [...preparedTriangles];
  for (const nativeTriangle of oracle.triangles) {
    const matchIndex = unmatched.findIndex((prepared) => cyclicTriangleDelta(nativeTriangle, prepared) < 0.001);
    assert.notEqual(matchIndex, -1, `native GLU triangle has no same-winding prepared face: ${JSON.stringify(nativeTriangle)}`);
    unmatched.splice(matchIndex, 1);
  }
  assert.equal(unmatched.length, 0);
  for (const triangle of preparedTriangles) {
    const [a, b, c] = triangle;
    const normal = cross(subtract(b, a), subtract(c, a));
    const centroid = a.map((value, index) => (value + b[index] + c[index]) / 3);
    assert.ok(dot(normal, centroid) > 0, "prepared face winding must point outward under GL_CCW");
  }
});

test("source projection and prepared transform reproduce native projected vertices", async () => {
  const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  const expectedProjection = perspectiveMatrix(50, 1280 / 720, 0.1, 2000);
  oracle.projectionMatrix.forEach((value, index) => assert.ok(Math.abs(value - expectedProjection[index]) < 0.00001));
  const sourceFirstBlock = buildFlocksSourceBlocks({ bank: CSSFLOCKS_SOURCE_BANK }).next().value;
  const bug = sourceFirstBlock.frames[0].bugs[0];
  oracle.projectedBug.position.forEach((value, index) => assert.ok(Math.abs(value - bug.position[index]) < 0.02));
  oracle.projectedBug.velocity.forEach((value, index) => assert.ok(Math.abs(value - bug.velocity[index]) < 0.002));
  const bugMatrix = buildFlocksBugMatrix(bug.position, bug.velocity).matrix;
  const camera = translationMatrix(0, 0, -568);
  const modelView = multiplyColumnMajor(camera, bugMatrix);
  const projected = CSSFLOCKS_FACE_INDICES.map((face) => face.map((index) =>
    project(CSSFLOCKS_BUG_VERTICES[index], modelView, expectedProjection, 1280, 720)));
  for (const nativeTriangle of oracle.projectedBug.triangles) {
    const best = Math.min(...projected.map((triangle) => cyclicTriangleDelta(nativeTriangle, triangle)));
    assert.ok(best <= 0.25, `projected GLU triangle drifted by ${best} pixels`);
  }
});

test("negative local Z is the source velocity axis and flat lighting is an explicit bounded deviation", async () => {
  for (const velocity of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 2, 3], [-1, -2, 4]]) {
    const transform = buildFlocksBugMatrix([0, 0, 0], velocity);
    const negativeLocalZ = [-transform.matrix[8] / transform.stretch, -transform.matrix[9] / transform.stretch, -transform.matrix[10] / transform.stretch];
    transform.direction.forEach((value, index) => assert.ok(Math.abs(value - negativeLocalZ[index]) < 0.000002));
  }
  const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
  assert.deepEqual(oracle.light, {
    ambient: [0.25, 0.25, 0.25, 0],
    diffuse: [1, 1, 1, 0],
    specular: [1, 1, 1, 0],
    position: [500, 500, 500, 0],
  });
  assert.ok(CSSFLOCKS_FACE_LIGHT_FACTORS.every((factor) => factor >= 0.75 && factor <= 1));
});

function cyclicTriangleDelta(left, right) {
  return Math.min(...[0, 1, 2].map((offset) => Math.max(...left.flatMap((vertex, vertexIndex) =>
    vertex.map((value, axis) => Math.abs(value - right[(vertexIndex + offset) % 3][axis]))))));
}

function perspectiveMatrix(fieldOfViewDegrees, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfViewDegrees * Math.PI / 360);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
}

function translationMatrix(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function multiplyColumnMajor(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) output[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
    }
  }
  return output;
}

function project(vertex, modelView, projection, width, height) {
  const eye = apply(modelView, [...vertex, 1]);
  const clip = apply(projection, eye);
  return [(clip[0] / clip[3] + 1) * width / 2, (clip[1] / clip[3] + 1) * height / 2, (clip[2] / clip[3] + 1) / 2];
}

function apply(matrix, vector) {
  return [0, 1, 2, 3].map((row) => vector.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
}

function subtract(left, right) { return left.map((value, index) => value - right[index]); }
function cross(left, right) { return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]]; }
function dot(left, right) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
