// SPDX-License-Identifier: HPND

const HALF_VERTICAL_FIELD_OF_VIEW_RADIANS = Math.PI / 12;

export function cityflowSourceProjection(width, height) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Cityflow projection dimensions must be positive finite numbers");
  }
  const usesWideSourceViewport = width > height * 2;
  const viewportHeight = usesWideSourceViewport ? width : height;
  return Object.freeze({
    perspective: viewportHeight / (2 * Math.tan(HALF_VERTICAL_FIELD_OF_VIEW_RADIANS)),
    viewportHeight,
    viewportTop: usesWideSourceViewport ? height - viewportHeight / 2 : 0,
    usesWideSourceViewport,
  });
}
