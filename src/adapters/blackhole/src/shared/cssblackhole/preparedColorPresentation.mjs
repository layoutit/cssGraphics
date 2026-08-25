// SPDX-License-Identifier: MIT
export const CSSBLACKHOLE_GALACTIC_DOT_COLORS = Object.freeze([
  "#ffffff",
  "#f8f5ff",
  "#eee7ff",
  "#dfd1ff",
  "#c7abff",
  "#aa82ee",
]);

export const CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS = Object.freeze(
  CSSBLACKHOLE_GALACTIC_DOT_COLORS.slice(0, 4));

export const CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS = Object.freeze(
  CSSBLACKHOLE_GALACTIC_DOT_COLORS.slice(3));

export function preparedBlackHoleColorAt(leafIndex, directLeafCount) {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 ||
      !Number.isSafeInteger(directLeafCount) || directLeafCount < 0) {
    throw new RangeError("BlackHole prepared color identity is invalid");
  }
  const isDirectImage = leafIndex < directLeafCount;
  const colors = isDirectImage ?
    CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS : CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS;
  const imageLeafIndex = isDirectImage ? leafIndex : leafIndex - directLeafCount;
  return colors[imageLeafIndex % colors.length];
}
