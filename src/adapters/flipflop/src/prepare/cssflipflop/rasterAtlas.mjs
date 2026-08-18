import { PNG } from "pngjs";
import {
  CSSFLIPFLOP_LIGHT_DIRECTIONS,
  CSSFLIPFLOP_LIGHT_LEVELS,
  CSSFLIPFLOP_LIGHT_MAGNITUDES,
  CSSFLIPFLOP_LIGHT_PROFILE_COUNT,
  CSSFLIPFLOP_RASTER_LEAF_SIZE,
  flipFlopColorRows,
} from "./sourceModel.mjs";

export const CSSFLIPFLOP_RASTER_ATLAS_PATH = "assets/tile-colors.png";

const GUTTER = 1;
const STRIDE = CSSFLIPFLOP_RASTER_LEAF_SIZE + GUTTER * 2;

export function flipFlopRasterSlice(colorIndex) {
  return Object.freeze({
    resourcePath: CSSFLIPFLOP_RASTER_ATLAS_PATH,
    x: colorIndex * STRIDE + GUTTER,
    y: 0,
    width: CSSFLIPFLOP_RASTER_LEAF_SIZE,
    height: CSSFLIPFLOP_RASTER_LEAF_SIZE,
    pageWidth: flipFlopColorRows().length * STRIDE,
    pageHeight: CSSFLIPFLOP_LIGHT_PROFILE_COUNT * CSSFLIPFLOP_RASTER_LEAF_SIZE,
  });
}

export function buildFlipFlopRasterAtlas() {
  const colors = flipFlopColorRows();
  const pageWidth = colors.length * STRIDE;
  const pageHeight = CSSFLIPFLOP_LIGHT_PROFILE_COUNT * CSSFLIPFLOP_RASTER_LEAF_SIZE;
  const png = new PNG({ width: pageWidth, height: pageHeight });
  for (let profile = 0; profile < CSSFLIPFLOP_LIGHT_PROFILE_COUNT; profile += 1) {
    const { direction, intensity, magnitude } = decodeProfile(profile);
    for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
      const color = colors[colorIndex].rgba;
      paintProfile(
        png,
        colorIndex * STRIDE,
        profile * CSSFLIPFLOP_RASTER_LEAF_SIZE,
        color,
        intensity,
        direction,
        magnitude,
      );
    }
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

function decodeProfile(profile) {
  const directionIndex = profile % CSSFLIPFLOP_LIGHT_DIRECTIONS;
  const row = Math.floor(profile / CSSFLIPFLOP_LIGHT_DIRECTIONS);
  const magnitudeIndex = row % CSSFLIPFLOP_LIGHT_MAGNITUDES.length;
  const level = Math.floor(row / CSSFLIPFLOP_LIGHT_MAGNITUDES.length);
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  return {
    direction: directions[directionIndex],
    intensity: level / (CSSFLIPFLOP_LIGHT_LEVELS - 1),
    magnitude: CSSFLIPFLOP_LIGHT_MAGNITUDES[magnitudeIndex],
  };
}

function paintProfile(png, left, top, color, center, direction, magnitude) {
  for (let y = 0; y < CSSFLIPFLOP_RASTER_LEAF_SIZE; y += 1) {
    for (let x = -GUTTER; x < CSSFLIPFLOP_RASTER_LEAF_SIZE + GUTTER; x += 1) {
      const sampleX = Math.max(0, Math.min(CSSFLIPFLOP_RASTER_LEAF_SIZE - 1, x));
      const u = (sampleX + 0.5) / CSSFLIPFLOP_RASTER_LEAF_SIZE - 0.5;
      const v = (y + 0.5) / CSSFLIPFLOP_RASTER_LEAF_SIZE - 0.5;
      const intensity = Math.max(0, Math.min(
        1,
        center + magnitude * (direction[0] * u + direction[1] * v),
      ));
      const offset = ((top + y) * png.width + left + x + GUTTER) * 4;
      png.data[offset] = Math.round(color[0] * intensity * 255);
      png.data[offset + 1] = Math.round(color[1] * intensity * 255);
      png.data[offset + 2] = Math.round(color[2] * intensity * 255);
      png.data[offset + 3] = Math.round(color[3] * 255);
    }
  }
}
