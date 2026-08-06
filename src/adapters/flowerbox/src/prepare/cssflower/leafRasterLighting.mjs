import {
  CSSFLOWER_LIGHTING_ATLAS_WIDTH,
  CSSFLOWER_LIGHTING_GUTTER,
  CSSFLOWER_LIGHTING_PAGE_ROWS,
} from "../../cssflower/renderContract.mjs";

export const CSSFLOWER_LEAF_RASTER_GUTTER = CSSFLOWER_LIGHTING_GUTTER;
export const CSSFLOWER_LEAF_RASTER_ATLAS_WIDTH = CSSFLOWER_LIGHTING_ATLAS_WIDTH;
export const CSSFLOWER_LEAF_RASTER_PAGE_ROWS = CSSFLOWER_LIGHTING_PAGE_ROWS;
export const CSSFLOWER_LEAF_RASTER_MAX_TEXTURE_DIMENSION = 8_192;

const lightingWeightCache = new Map();

export function buildPreparedLeafRasterLayout(faces, options = {}) {
  if (!Array.isArray(faces) || faces.length < 1) {
    throw new TypeError("Prepared cssFlower leaf raster layout requires faces");
  }
  const atlasWidth = options.atlasWidth ?? CSSFLOWER_LEAF_RASTER_ATLAS_WIDTH;
  const pageRowCount = options.pageRowCount ?? CSSFLOWER_LEAF_RASTER_PAGE_ROWS;
  const gutter = options.gutter ?? CSSFLOWER_LEAF_RASTER_GUTTER;
  const maximumTextureDimension = options.maximumTextureDimension ??
    CSSFLOWER_LEAF_RASTER_MAX_TEXTURE_DIMENSION;
  if (!Number.isSafeInteger(atlasWidth) || atlasWidth < 1 || atlasWidth > maximumTextureDimension ||
      !Number.isSafeInteger(pageRowCount) || pageRowCount < 1 ||
      !Number.isSafeInteger(gutter) || gutter < 1 ||
      !Number.isSafeInteger(maximumTextureDimension) || maximumTextureDimension < 1) {
    throw new RangeError("Prepared cssFlower leaf raster layout options are invalid");
  }

  const tiles = faces.map((face, faceIndex) => {
    const sourceOrder = Number(face?.sourceOrder);
    const width = Number(face?.leafWidth);
    const height = Number(face?.leafHeight);
    if (!Number.isSafeInteger(sourceOrder) || sourceOrder !== faceIndex ||
        !Number.isSafeInteger(width) || width < 2 ||
        !Number.isSafeInteger(height) || height < 2) {
      throw new TypeError(`Prepared cssFlower leaf raster face ${faceIndex} is invalid`);
    }
    const slotWidth = width + gutter * 2;
    const slotHeight = height + gutter * 2;
    if (slotWidth > atlasWidth) {
      throw new RangeError(`Prepared cssFlower leaf raster face ${faceIndex} exceeds the atlas width`);
    }
    return { sourceOrder, width, height, slotWidth, slotHeight };
  }).sort((left, right) => (
    right.slotHeight - left.slotHeight ||
    right.slotWidth - left.slotWidth ||
    left.sourceOrder - right.sourceOrder
  ));

  const placements = new Array(faces.length);
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let shelfCount = 1;
  for (const tile of tiles) {
    if (x > 0 && x + tile.slotWidth > atlasWidth) {
      y += shelfHeight;
      x = 0;
      shelfHeight = 0;
      shelfCount += 1;
    }
    placements[tile.sourceOrder] = Object.freeze({
      sourceOrder: tile.sourceOrder,
      slotX: x,
      slotY: y,
      slotWidth: tile.slotWidth,
      slotHeight: tile.slotHeight,
      contentX: x + gutter,
      contentY: y + gutter,
      width: tile.width,
      height: tile.height,
    });
    x += tile.slotWidth;
    shelfHeight = Math.max(shelfHeight, tile.slotHeight);
  }
  const stateSliceHeight = y + shelfHeight;
  const atlasHeight = stateSliceHeight * pageRowCount;
  if (atlasHeight > maximumTextureDimension) {
    throw new RangeError(
      `Prepared cssFlower leaf raster page ${atlasWidth}x${atlasHeight} exceeds ${maximumTextureDimension}`,
    );
  }
  const occupiedPixelsPerState = placements.reduce((sum, placement) => (
    sum + placement.slotWidth * placement.slotHeight
  ), 0);
  const decodedBytesPerFullPage = atlasWidth * atlasHeight * 4;
  return Object.freeze({
    schema: "cssflower-prepared-leaf-raster-layout@1",
    packing: "height-descending-deterministic-shelves",
    sampling: "endpoint-aligned-pixel-centers",
    gutterPolicy: "one-pixel-clamped-edge-duplication",
    atlasWidth,
    atlasHeight,
    pageRowCount,
    stateSliceHeight,
    gutter,
    shelfCount,
    maximumTextureDimension,
    occupiedPixelsPerState,
    packedPixelsPerState: atlasWidth * stateSliceHeight,
    packingEfficiency: occupiedPixelsPerState / (atlasWidth * stateSliceHeight),
    decodedBytesPerFullPage,
    placements: Object.freeze(placements),
  });
}

export function writePreparedLeafRasterLightingTile({
  atlasData,
  atlasPixels,
  atlasWidth,
  rowIndex,
  faceIndex,
  layout,
  canonicalPointIndices,
  canonicalPointOffset = 0,
  vertexColors,
}) {
  if (!(atlasData instanceof Uint8Array)) {
    throw new TypeError("Prepared cssFlower leaf raster atlas data must be bytes");
  }
  const placement = layout?.placements?.[faceIndex];
  const validPointIndices = Array.isArray(canonicalPointIndices) ||
    canonicalPointIndices instanceof Uint16Array ||
    canonicalPointIndices instanceof Uint32Array;
  const validVertexColors = vertexColors instanceof Uint8Array ||
    vertexColors instanceof Uint8ClampedArray ||
    vertexColors instanceof Float32Array ||
    vertexColors instanceof Float64Array;
  const pixels = atlasPixels ?? (
    atlasData.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0
      ? new Uint32Array(
        atlasData.buffer,
        atlasData.byteOffset,
        atlasData.byteLength / Uint32Array.BYTES_PER_ELEMENT,
      )
      : null
  );
  if (!pixels || pixels.length * Uint32Array.BYTES_PER_ELEMENT !== atlasData.byteLength ||
      !placement || atlasWidth !== layout.atlasWidth ||
      !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= layout.pageRowCount ||
      !validPointIndices ||
      !Number.isSafeInteger(canonicalPointOffset) || canonicalPointOffset < 0 ||
      canonicalPointOffset + 3 > canonicalPointIndices.length ||
      !validVertexColors) {
    throw new TypeError("Prepared cssFlower leaf raster tile inputs are invalid");
  }
  const point0 = canonicalPointIndices[canonicalPointOffset];
  const point1 = canonicalPointIndices[canonicalPointOffset + 1];
  const point2 = canonicalPointIndices[canonicalPointOffset + 2];
  const originX = placement.contentX;
  const originY = rowIndex * layout.stateSliceHeight + placement.contentY;
  const weights = preparedLightingWeights(placement.width, placement.height);
  let weightOffset = 0;
  for (let y = 0; y < placement.height; y += 1) {
    let firstPixel = 0;
    let lastPixel = 0;
    for (let x = 0; x < placement.width; x += 1) {
      const apex = weights[weightOffset];
      const left = weights[weightOffset + 1];
      const right = weights[weightOffset + 2];
      weightOffset += 3;
      const red = clampByte(
        vertexColors[point0 * 3] * apex +
        vertexColors[point1 * 3] * left +
        vertexColors[point2 * 3] * right,
      );
      const green = clampByte(
        vertexColors[point0 * 3 + 1] * apex +
        vertexColors[point1 * 3 + 1] * left +
        vertexColors[point2 * 3 + 1] * right,
      );
      const blue = clampByte(
        vertexColors[point0 * 3 + 2] * apex +
        vertexColors[point1 * 3 + 2] * left +
        vertexColors[point2 * 3 + 2] * right,
      );
      const pixel = red | (green << 8) | (blue << 16) | (255 << 24);
      pixels[(originY + y) * atlasWidth + originX + x] = pixel;
      if (x === 0) firstPixel = pixel;
      if (x === placement.width - 1) lastPixel = pixel;
    }
    const rowOffset = (originY + y) * atlasWidth;
    for (let gutterX = 1; gutterX <= layout.gutter; gutterX += 1) {
      pixels[rowOffset + originX - gutterX] = firstPixel;
      pixels[rowOffset + originX + placement.width - 1 + gutterX] = lastPixel;
    }
  }
  const slotX = originX - layout.gutter;
  const slotWidth = placement.width + layout.gutter * 2;
  const firstRowOffset = originY * atlasWidth + slotX;
  const lastRowOffset = (originY + placement.height - 1) * atlasWidth + slotX;
  for (let gutterY = 1; gutterY <= layout.gutter; gutterY += 1) {
    pixels.copyWithin(
      (originY - gutterY) * atlasWidth + slotX,
      firstRowOffset,
      firstRowOffset + slotWidth,
    );
    pixels.copyWithin(
      (originY + placement.height - 1 + gutterY) * atlasWidth + slotX,
      lastRowOffset,
      lastRowOffset + slotWidth,
    );
  }
}

function preparedLightingWeights(width, height) {
  const key = `${width}x${height}`;
  const cached = lightingWeightCache.get(key);
  if (cached) return cached;
  const weights = new Float64Array(width * height * 3);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const apex = 1 - v;
      const right = u - 0.5 * apex;
      const left = 1 - apex - right;
      weights[offset] = apex;
      weights[offset + 1] = left;
      weights[offset + 2] = right;
      offset += 3;
    }
  }
  lightingWeightCache.set(key, weights);
  return weights;
}

export function leafRasterBackgroundBinding(layout, faceIndex, rowIndex) {
  const placement = layout?.placements?.[faceIndex];
  if (!placement || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= layout.pageRowCount) {
    throw new RangeError("Prepared cssFlower leaf raster background binding is invalid");
  }
  return Object.freeze({
    backgroundSize: `${layout.atlasWidth}px ${layout.atlasHeight}px`,
    backgroundPositionX: `${-placement.contentX}px`,
    backgroundPositionY: `${-(rowIndex * layout.stateSliceHeight + placement.contentY)}px`,
    temporalOffsetY: `${-rowIndex * layout.stateSliceHeight}px`,
    faceOffsetY: `${-placement.contentY}px`,
  });
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
