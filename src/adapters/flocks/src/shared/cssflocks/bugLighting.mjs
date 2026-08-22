// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_BUG_VERTICES,
  CSSFLOCKS_FACE_INDICES,
  CSSFLOCKS_VERTEX_NORMALS,
} from "./bugGeometry.mjs";

const CAMERA_Z = -568;
const SOURCE_AMBIENT = 0.45;
const SOURCE_LIGHT_DIRECTION = Object.freeze(normalized([500, 500, 500]));

export function shadeFlocksPreparedHex(hex, matrix) {
  if (!/^#[0-9a-f]{6}$/u.test(hex) || !validMatrix(matrix)) {
    throw new TypeError("Complete prepared Flocks lighting inputs are required");
  }
  const sourceIntensity = sourceVisibleIntensity(matrix);
  const presentationIntensity = linearToSrgb(sourceIntensity);
  const channels = [1, 3, 5].map((offset) =>
    Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * presentationIntensity));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function resolveFlocksSourceVisibleIntensity(matrix) {
  if (!validMatrix(matrix)) {
    throw new TypeError("Complete source Flocks lighting inputs are required");
  }
  return sourceVisibleIntensity(matrix);
}

function sourceVisibleIntensity(matrix) {
  const normalMatrix = inverseTranspose3(matrix);
  const worldVertices = CSSFLOCKS_BUG_VERTICES.map((vertex) => transformPoint(matrix, vertex));
  const vertexIntensities = CSSFLOCKS_VERTEX_NORMALS.map((normal) => Math.min(
    1,
    SOURCE_AMBIENT + Math.max(0, dot(transform3(normalMatrix, normal), SOURCE_LIGHT_DIRECTION)),
  ));
  let weightedIntensity = 0;
  let totalWeight = 0;
  for (const face of CSSFLOCKS_FACE_INDICES) {
    const [a, b, c] = face.map((index) => worldVertices[index]);
    const crossProduct = cross(subtract(b, a), subtract(c, a));
    const areaWeight = Math.hypot(...crossProduct);
    if (!(areaWeight > 0)) continue;
    const center = a.map((value, axis) => (value + b[axis] + c[axis]) / 3);
    const viewDirection = normalized([
      -center[0],
      -center[1],
      CAMERA_Z - center[2],
    ]);
    const facing = dot(crossProduct, viewDirection) / areaWeight;
    if (facing <= 0) continue;
    const weight = areaWeight * facing;
    weightedIntensity += weight * face.reduce((sum, index) =>
      sum + vertexIntensities[index], 0) / face.length;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedIntensity / totalWeight : SOURCE_AMBIENT;
}

function inverseTranspose3(matrix) {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a12 * a20 - a10 * a22;
  const c02 = a10 * a21 - a11 * a20;
  const c10 = a02 * a21 - a01 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11;
  const c21 = a02 * a10 - a00 * a12;
  const c22 = a00 * a11 - a01 * a10;
  const inverseDeterminant = 1 / (a00 * c00 + a01 * c01 + a02 * c02);
  return [
    c00 * inverseDeterminant, c01 * inverseDeterminant, c02 * inverseDeterminant,
    c10 * inverseDeterminant, c11 * inverseDeterminant, c12 * inverseDeterminant,
    c20 * inverseDeterminant, c21 * inverseDeterminant, c22 * inverseDeterminant,
  ];
}

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function transform3(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function linearToSrgb(value) {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

function validMatrix(matrix) {
  return Array.isArray(matrix) && matrix.length === 16 && matrix.every(Number.isFinite);
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error("Flocks lighting vector is degenerate");
  return vector.map((value) => value / length);
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
