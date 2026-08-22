// SPDX-License-Identifier: GPL-2.0-or-later
const BUG_RADIUS = 2.5;
const EQUATOR = Object.freeze(Array.from({ length: 3 }, (_, index) => {
  const angle = Math.PI / 2 + index * Math.PI * 2 / 3;
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

export const CSSFLOCKS_VERTEX_NORMALS = Object.freeze(
  CSSFLOCKS_BUG_VERTICES.map((vertex) => Object.freeze(normalized(vertex))),
);

function normalized(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}
