import { PNG } from "pngjs";
import {
  CSSPLATONIC_LIGHT_LEVELS,
  CSSPLATONIC_RASTER_LEAF_SIZE,
} from "./sourceModel.mjs";

export const CSSPLATONIC_RASTER_ATLAS_PATH = "assets/face-colors.png";

const GUTTER = 1;
const STRIDE = CSSPLATONIC_RASTER_LEAF_SIZE + GUTTER * 2;

export function platonicRasterSlice(faceColumn, faceCount) {
  return Object.freeze({
    resourcePath: CSSPLATONIC_RASTER_ATLAS_PATH,
    x: faceColumn * STRIDE + GUTTER,
    y: 0,
    width: CSSPLATONIC_RASTER_LEAF_SIZE,
    height: CSSPLATONIC_RASTER_LEAF_SIZE,
    pageWidth: faceCount * STRIDE,
    pageHeight: CSSPLATONIC_LIGHT_LEVELS * CSSPLATONIC_RASTER_LEAF_SIZE,
  });
}

export function buildPlatonicRasterAtlas(faceDefinitions) {
  const pageWidth = faceDefinitions.length * STRIDE;
  const pageHeight = CSSPLATONIC_LIGHT_LEVELS * CSSPLATONIC_RASTER_LEAF_SIZE;
  const png = new PNG({ width: pageWidth, height: pageHeight });
  for (let lightRow = 0; lightRow < CSSPLATONIC_LIGHT_LEVELS; lightRow += 1) {
    for (const face of faceDefinitions) paintFace(png, face, lightRow);
  }
  return Uint8Array.from(PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
    inputHasAlpha: true,
    filterType: 4,
    deflateLevel: 9,
    deflateStrategy: 3,
  }));
}

function paintFace(png, face, lightRow) {
  const left = face.faceColumn * STRIDE;
  const top = lightRow * CSSPLATONIC_RASTER_LEAF_SIZE;
  const color = face.lightPalette[lightRow];
  const polygon = face.vertices.map(([x, y]) => [
    (x - face.bounds.minX) / face.bounds.width,
    (y - face.bounds.minY) / face.bounds.height,
  ]);
  for (let y = 0; y < CSSPLATONIC_RASTER_LEAF_SIZE; y += 1) {
    for (let x = -GUTTER; x < CSSPLATONIC_RASTER_LEAF_SIZE + GUTTER; x += 1) {
      const sampleX = Math.max(0, Math.min(CSSPLATONIC_RASTER_LEAF_SIZE - 1, x));
      const coverage = pixelCoverage(polygon, sampleX, y);
      const offset = ((top + y) * png.width + left + x + GUTTER) * 4;
      png.data[offset] = Math.round(color[0] * 255);
      png.data[offset + 1] = Math.round(color[1] * 255);
      png.data[offset + 2] = Math.round(color[2] * 255);
      png.data[offset + 3] = Math.round(coverage * 255);
    }
  }
}

function pixelCoverage(polygon, x, y) {
  let hits = 0;
  for (const offsetY of [0.25, 0.75]) {
    for (const offsetX of [0.25, 0.75]) {
      const point = [
        (x + offsetX) / CSSPLATONIC_RASTER_LEAF_SIZE,
        (y + offsetY) / CSSPLATONIC_RASTER_LEAF_SIZE,
      ];
      if (pointInPolygon(point, polygon)) hits += 1;
    }
  }
  return hits / 4;
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [x1, y1] = polygon[current];
    const [x2, y2] = polygon[previous];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}
