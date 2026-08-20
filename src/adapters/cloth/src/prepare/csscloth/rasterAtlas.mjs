import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  buildGroundPlane,
  buildClothTriangles,
  clothTriangleBasis,
  clothFogFactor,
  CSSCLOTH_FOG_COLOR,
  CSSCLOTH_FOG_LEVELS,
  CSSCLOTH_GROUND_RASTER_HEIGHT,
  CSSCLOTH_GROUND_RASTER_WIDTH,
  CSSCLOTH_LIGHT_LEVELS,
  CSSCLOTH_RASTER_LEAF_SIZE,
  CSSCLOTH_TRIANGLE_COUNT,
  shadeGroundSourceRgb,
  shadeSourceRgb,
  sourceCssViewToWorld,
} from "./sourceModel.mjs";

export const CSSCLOTH_GROUND_IMAGE_PATH = "assets/ground.webp";
export const CSSCLOTH_SHADOW_IMAGE_PATH = "assets/shadow.png";

const RASTER_PAGE_WIDTH = 3072;
const RASTER_PAGE_HEIGHT = 8192;
const CLOTH_GUTTER = 1;
const GROUND_MAX_ANISOTROPY = 16;
const GROUND_FIT_HORIZONTAL_BANDS = Object.freeze([-0.8, -0.8, 0.8, 0.8, 0.4, 0.2, 0.2, 0.4]);
const GROUND_FIT_VERTICAL_BANDS = Object.freeze([1.3, 1.5, 1.5, 1.7, 1.9, 2, 2, 2]);
const GROUND_FIT_SCALE_BANDS = Object.freeze([1.15, 1, 1, 1, 1, 1, 1.15, 1.3]);
const GROUND_FIT_PHASE_BANDS = Object.freeze([0, 0, 0, 0.05, 0.05, 0.05, 0.05, 0]);
const CSS_LOGO_TEXT_SCALE = 0.62;
const CSS_LOGO_TEXT_LEFT = 0.08;
const CSS_PURPLE = Object.freeze([0x66, 0x33, 0x99]);
const CSS_WHITE = Object.freeze([0xff, 0xff, 0xff]);

export function clothRasterPagePath(pageIndex) {
  return `assets/cloth-${pageIndex}.png`;
}

export function clothLogoRasterPagePath(pageIndex) {
  return `assets/cloth-logo-${pageIndex}.png`;
}

export function buildClothRasterLayout(rasterBoxes, lightingStates) {
  validateClothRasterInput(rasterBoxes, lightingStates);
  let slot = 0;
  const stateSlots = lightingStates.map((states) => Object.freeze(states.map(() => slot++)));
  return buildClothSlotLayout(rasterBoxes, stateSlots, slot);
}

export function buildClothDeduplicatedLightingLayout(rasterBoxes, lightingStates) {
  validateClothRasterInput(rasterBoxes, lightingStates);
  const slotByState = new Map();
  const stateSlots = lightingStates.map((states, triangleIndex) => {
    const basis = clothTriangleBasis(triangleIndex);
    const basisKey = `${basis.a},${basis.b},${basis.c}`;
    return Object.freeze(states.map((state) => {
      const key = `${basisKey}:${state.join(",")}`;
      let slot = slotByState.get(key);
      if (slot === undefined) {
        slot = slotByState.size;
        slotByState.set(key, slot);
      }
      return slot;
    }));
  });
  return buildClothSlotLayout(rasterBoxes, stateSlots, slotByState.size, { preferSquare: true });
}

function validateClothRasterInput(rasterBoxes, lightingStates) {
  if (!Array.isArray(rasterBoxes) || rasterBoxes.length !== CSSCLOTH_TRIANGLE_COUNT ||
      rasterBoxes.some((box) => !Number.isSafeInteger(box?.width) || !Number.isSafeInteger(box?.height) ||
        box.width < 1 || box.height < 1) || !Array.isArray(lightingStates) ||
      lightingStates.length !== rasterBoxes.length || lightingStates.some((states) =>
        !Array.isArray(states) || states.length === 0 || states.length > 0x10000 ||
        states.some((state) => !Array.isArray(state) || state.length !== 6 ||
          state.slice(0, 3).some((level) =>
            !Number.isSafeInteger(level) || level < 0 || level >= CSSCLOTH_LIGHT_LEVELS) ||
          state.slice(3).some((level) =>
            !Number.isSafeInteger(level) || level < 0 || level >= CSSCLOTH_FOG_LEVELS)))) {
    throw new TypeError("Cloth raster layout needs one finite box and prepared lighting bank per triangle");
  }
}

export function clothRasterSlice(triangleIndex, layout) {
  const slot = layout?.stateSlots?.[triangleIndex]?.[0];
  return clothRasterSlotSlice(slot, layout);
}

export function clothRasterSlotSlice(slot, layout) {
  const record = layout?.slots?.[slot];
  if (!record) throw new RangeError("Cloth triangle raster placement is out of range");
  const { pageIndex: _, ...slice } = record;
  return Object.freeze(slice);
}

export function groundImageSlice() {
  return Object.freeze({
    resourcePath: CSSCLOTH_GROUND_IMAGE_PATH,
    x: 0,
    y: 0,
    width: CSSCLOTH_GROUND_RASTER_WIDTH,
    height: CSSCLOTH_GROUND_RASTER_HEIGHT,
    pageWidth: CSSCLOTH_GROUND_RASTER_WIDTH,
    pageHeight: CSSCLOTH_GROUND_RASTER_HEIGHT,
  });
}

export function shadowImageSlice() {
  return Object.freeze({
    resourcePath: CSSCLOTH_SHADOW_IMAGE_PATH,
    x: 0,
    y: 0,
    width: CSSCLOTH_RASTER_LEAF_SIZE,
    height: CSSCLOTH_RASTER_LEAF_SIZE,
    pageWidth: CSSCLOTH_RASTER_LEAF_SIZE,
    pageHeight: CSSCLOTH_RASTER_LEAF_SIZE,
  });
}

export async function buildClothRasterAssets({ logoBytes, grassBytes, rasterBoxes, lightingStates }) {
  const [cloth, groundImage] = await Promise.all([
    buildClothRasterPages({
      logoBytes,
      rasterBoxes,
      lightingStates,
      palette: {
        background: CSS_WHITE,
        foreground: CSS_WHITE,
      },
      logoScale: 0.4,
      logoEdgeContrast: 2.2,
      logoLeft: 0.08,
      logoTop: 0.78,
      separateLogo: true,
      logoColor: CSS_PURPLE,
      loveMark: true,
      heartColor: [0xc9, 0x2a, 0x4a],
      outlineWidth: 0.009,
      outlineTopWidth: 0.016,
      outlineCornerSize: 0.014,
    }),
    buildGroundImage(grassBytes),
  ]);
  const shadowImage = await encodeRgbaPng(buildShadowImage());
  return Object.freeze({
    ...cloth,
    groundImage,
    shadowImage,
  });
}

export async function buildClothRasterPages({
  logoBytes,
  rasterBoxes,
  lightingStates,
  palette,
  backingColor,
  logoScale,
  logoEdgeContrast,
  logoLeft,
  logoTop,
  separateLogo = false,
  logoColor = CSS_PURPLE,
  loveMark = false,
  heartColor = Object.freeze([0xc9, 0x2a, 0x4a]),
  outlineWidth = 0,
  outlineTopWidth = outlineWidth,
  outlineCornerSize = 0,
}) {
  if ([outlineWidth, outlineTopWidth, outlineCornerSize].some((value) =>
    !Number.isFinite(value) || value < 0 || value >= 0.5)) {
    throw new RangeError("Cloth outline sizing is out of range");
  }
  if (separateLogo) {
    const [lightingSource, logoMask] = await Promise.all([
      buildClothLogoImage(logoBytes, {
        palette,
        logoScale,
        logoEdgeContrast,
        logoLeft,
        logoTop,
      }),
      buildClothLogoImage(logoBytes, {
        palette: { background: [0, 0, 0], foreground: CSS_WHITE },
        logoScale,
        logoEdgeContrast,
        logoLeft,
        logoTop,
      }),
    ]);
    const mark = loveMark ? buildLoveCssMasks(logoMask) : { purpleMask: logoMask, heartMask: null };
    const separated = buildSeparatedClothPages(
      lightingSource,
      mark.purpleMask,
      mark.heartMask,
      logoColor,
      heartColor,
      outlineWidth,
      outlineTopWidth,
      outlineCornerSize,
      rasterBoxes,
      lightingStates,
    );
    const [clothPages, clothLogoPages] = await Promise.all([
      Promise.all(separated.pages.map(encodeOpaqueRgbPng)),
      Promise.all(separated.logoPages.map(encodeRgbaPng)),
    ]);
    return Object.freeze({
      clothPages: Object.freeze(clothPages),
      clothLogoPages: Object.freeze(clothLogoPages),
      clothLayout: separated.layout,
      clothLogoLayout: separated.logoLayout,
      clothStoredStateCount: lightingStates.reduce((sum, states) => sum + states.length, 0),
      clothUniqueStateCount: separated.layout.slots.length,
    });
  }
  const logo = await buildClothLogoImage(logoBytes, { palette, logoScale, logoEdgeContrast });
  const clothLayout = buildClothRasterLayout(rasterBoxes, lightingStates);
  const { pages: clothPages, layout: deduplicatedClothLayout } = buildDeduplicatedClothPages(
    logo,
    rasterBoxes,
    lightingStates,
  );
  const encodedClothPages = await Promise.all(clothPages.map((page) => (
    backingColor
      ? encodeRgbaPng(buildLightingOverlayPage(page, backingColor))
      : encodeOpaqueRgbPng(page)
  )));
  return Object.freeze({
    clothPages: Object.freeze(encodedClothPages),
    clothLayout: deduplicatedClothLayout,
    clothStoredStateCount: clothLayout.slots.length,
    clothUniqueStateCount: deduplicatedClothLayout.slots.length,
  });
}

export async function buildClothLogoImage(bytes, {
  palette,
  logoScale = CSS_LOGO_TEXT_SCALE,
  logoEdgeContrast = 1,
  logoLeft = CSS_LOGO_TEXT_LEFT,
  logoTop,
} = {}) {
  if (!Number.isFinite(logoScale) || logoScale <= 0 || logoScale > 1 ||
      !Number.isFinite(logoEdgeContrast) || logoEdgeContrast < 1 ||
      !Number.isFinite(logoLeft) || logoLeft < 0 || logoLeft >= 1 ||
      (logoTop !== undefined && (!Number.isFinite(logoTop) || logoTop < 0 || logoTop >= 1))) {
    throw new RangeError("Cloth logo sizing needs a finite scale and edge contrast");
  }
  const source = await decodeRgb(bytes, { background: "#663399" });
  const bounds = findLightForegroundBounds(source);
  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  const width = Math.round(sourceWidth * logoScale);
  const height = Math.round(sourceHeight * logoScale);
  const left = Math.round(source.width * logoLeft);
  const top = logoTop === undefined
    ? Math.round((bounds.top + bounds.bottom + 1 - height) / 2)
    : Math.round(source.height * logoTop);
  if (left + width > source.width || top + height > source.height) {
    throw new RangeError("Cloth logo does not fit inside the source surface");
  }
  const patch = await resizeRgbRegion(source, bounds, width, height);
  const background = palette?.background ?? CSS_PURPLE;
  const foreground = palette?.foreground ?? CSS_WHITE;
  assertRgb(background, "Cloth background");
  assertRgb(foreground, "Cloth foreground");
  const data = Buffer.allocUnsafe(source.width * source.height * 3);
  for (let offset = 0; offset < data.length; offset += 3) {
    data[offset] = background[0];
    data[offset + 1] = background[1];
    data[offset + 2] = background[2];
  }
  const paintedPatch = palette
    ? recolorLogoPatch(patch, background, foreground, logoEdgeContrast)
    : patch;
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * width * 3;
    const targetStart = ((top + y) * source.width + left) * 3;
    paintedPatch.data.copy(data, targetStart, sourceStart, sourceStart + width * 3);
  }
  return Object.freeze({ data, width: source.width, height: source.height });
}

function recolorLogoPatch(patch, background, foreground, edgeContrast) {
  const data = Buffer.allocUnsafe(patch.data.length);
  for (let offset = 0; offset < data.length; offset += 3) {
    const coverage = Math.max(0, Math.min(1,
      (logoCoverage(patch.data, offset) - 0.5) * edgeContrast + 0.5,
    ));
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = Math.round(
        background[channel] + (foreground[channel] - background[channel]) * coverage,
      );
    }
  }
  return Object.freeze({ data, width: patch.width, height: patch.height });
}

function logoCoverage(data, offset) {
  const coverage = [0, 1, 2].reduce((sum, channel) => (
    sum + (data[offset + channel] - CSS_PURPLE[channel]) /
      (CSS_WHITE[channel] - CSS_PURPLE[channel])
  ), 0) / 3;
  return Math.max(0, Math.min(1, coverage));
}

function assertRgb(value, label) {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some((channel) => !Number.isSafeInteger(channel) || channel < 0 || channel > 255)) {
    throw new TypeError(`${label} needs three byte channels`);
  }
}

function buildLoveCssMasks(cssMask) {
  const purpleMask = {
    data: Buffer.from(cssMask.data),
    width: cssMask.width,
    height: cssMask.height,
  };
  const heartMask = {
    data: Buffer.alloc(cssMask.data.length),
    width: cssMask.width,
    height: cssMask.height,
  };
  fillMaskRect(purpleMask, 0.08, 0.6, 0.145, 0.625);
  fillMaskRect(purpleMask, 0.1, 0.6, 0.125, 0.75);
  fillMaskRect(purpleMask, 0.08, 0.725, 0.145, 0.75);
  paintHeartMask(heartMask, 0.255, 0.675, 0.13, 0.14);
  return Object.freeze({
    purpleMask: Object.freeze(purpleMask),
    heartMask: Object.freeze(heartMask),
  });
}

function fillMaskRect(image, left, top, right, bottom) {
  const x0 = Math.round(image.width * left);
  const y0 = Math.round(image.height * top);
  const x1 = Math.round(image.width * right);
  const y1 = Math.round(image.height * bottom);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) writeMaskPixel(image, x, y, 1);
  }
}

function paintHeartMask(image, centerX, centerY, width, height, flipVertical = false) {
  const samples = 4;
  const left = Math.floor(image.width * (centerX - width / 2));
  const right = Math.ceil(image.width * (centerX + width / 2));
  const top = Math.floor(image.height * (centerY - height / 2));
  const bottom = Math.ceil(image.height * (centerY + height / 2));
  const topV = centerY - height / 2;
  const lobeY = topV + height * 0.28;
  const lobeOffset = width * 0.22;
  const lobeRadius = width * 0.28;
  const triangleTop = topV + height * 0.27;
  const triangleBottom = centerY + height / 2;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      let coverage = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const u = (x + (sampleX + 0.5) / samples) / image.width;
          const v = (y + (sampleY + 0.5) / samples) / image.height;
          const shapeV = flipVertical ? centerY * 2 - v : v;
          const leftLobe = Math.hypot(u - (centerX - lobeOffset), shapeV - lobeY) <= lobeRadius;
          const rightLobe = Math.hypot(u - (centerX + lobeOffset), shapeV - lobeY) <= lobeRadius;
          const triangleProgress = (shapeV - triangleTop) / (triangleBottom - triangleTop);
          const triangle = triangleProgress >= 0 && triangleProgress <= 1 &&
            Math.abs(u - centerX) <= width * 0.47 * (1 - triangleProgress);
          if (leftLobe || rightLobe || triangle) coverage += 1;
        }
      }
      writeMaskPixel(image, x, y, coverage / samples ** 2);
    }
  }
}

function writeMaskPixel(image, x, y, coverage) {
  const value = Math.round(coverage * 255);
  const offset = (y * image.width + x) * 3;
  image.data[offset] = value;
  image.data[offset + 1] = value;
  image.data[offset + 2] = value;
}

function findLightForegroundBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 3;
      if (image.data[offset] < 240 || image.data[offset + 1] < 240 || image.data[offset + 2] < 240) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("CSS logo source has no light foreground");
  return Object.freeze({ left, top, right, bottom });
}

async function resizeRgbRegion(source, bounds, width, height) {
  const extractedWidth = bounds.right - bounds.left + 1;
  const extractedHeight = bounds.bottom - bounds.top + 1;
  const extracted = Buffer.allocUnsafe(extractedWidth * extractedHeight * 3);
  for (let y = 0; y < extractedHeight; y += 1) {
    const sourceStart = ((bounds.top + y) * source.width + bounds.left) * 3;
    const targetStart = y * extractedWidth * 3;
    source.data.copy(extracted, targetStart, sourceStart, sourceStart + extractedWidth * 3);
  }
  const { data } = await sharp(extracted, {
    raw: { width: extractedWidth, height: extractedHeight, channels: 3 },
  }).resize(width, height, { kernel: sharp.kernel.lanczos3 }).raw().toBuffer({ resolveWithObject: true });
  return Object.freeze({ data, width, height });
}

function buildShadowImage() {
  const image = createRgba(CSSCLOTH_RASTER_LEAF_SIZE, CSSCLOTH_RASTER_LEAF_SIZE);
  const samples = 4;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let coverage = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const u = (x + (sampleX + 0.5) / samples) / image.width;
          const v = (y + (sampleY + 0.5) / samples) / image.height;
          if (u + v <= 1) coverage += 1;
        }
      }
      writePixel(image, x, y, [0, 0, 0], coverage / samples ** 2 * 0.375);
    }
  }
  return image;
}

async function buildGroundImage(bytes) {
  const source = await decodeRgb(bytes);
  const mipmaps = buildGroundMipmaps(source);
  const matrix = buildGroundPlane().matrix;
  const lighting = buildGroundLightingLookup();
  const output = Buffer.allocUnsafe(CSSCLOTH_GROUND_RASTER_WIDTH * CSSCLOTH_GROUND_RASTER_HEIGHT * 3);
  for (let y = 0; y < CSSCLOTH_GROUND_RASTER_HEIGHT; y += 1) {
    const localY = y + 0.5;
    const leftView = transformGroundPoint(matrix, 0.5, localY);
    const fog = clothFogFactor(-leftView[2]);
    if (fog === 1) {
      output.fill(Buffer.from(CSSCLOTH_FOG_COLOR), y * CSSCLOTH_GROUND_RASTER_WIDTH * 3,
        (y + 1) * CSSCLOTH_GROUND_RASTER_WIDTH * 3);
      continue;
    }
    const left = sourceCssViewToWorld(leftView);
    const right = sourceCssViewToWorld(transformGroundPoint(
      matrix,
      CSSCLOTH_GROUND_RASTER_WIDTH - 0.5,
      localY,
    ));
    const stepX = (right[0] - left[0]) / (CSSCLOTH_GROUND_RASTER_WIDTH - 1);
    const stepZ = (right[2] - left[2]) / (CSSCLOTH_GROUND_RASTER_WIDTH - 1);
    const filter = groundRasterFilterPlan(matrix, localY, source.width, source.height);
    let worldX = left[0];
    let worldZ = left[2];
    for (let x = 0; x < CSSCLOTH_GROUND_RASTER_WIDTH; x += 1) {
      sampleRepeatedRgb(
        mipmaps,
        (worldX + 10_000) / 800,
        (worldZ - 10_000) / 800,
        output,
        (y * CSSCLOTH_GROUND_RASTER_WIDTH + x) * 3,
        lighting,
        fog,
        filter,
      );
      worldX += stepX;
      worldZ += stepZ;
    }
  }
  const fitted = fitGroundRasterPhase(
    output,
    CSSCLOTH_GROUND_RASTER_WIDTH,
    CSSCLOTH_GROUND_RASTER_HEIGHT,
  );
  return sharp(fitted, {
    raw: {
      width: CSSCLOTH_GROUND_RASTER_WIDTH,
      height: CSSCLOTH_GROUND_RASTER_HEIGHT,
      channels: 3,
    },
  }).webp({ lossless: true, effort: 6 }).toBuffer();
}

export function fitGroundRasterPhase(data, width, height) {
  if (!Buffer.isBuffer(data) || !Number.isSafeInteger(width) || width < 2 ||
      !Number.isSafeInteger(height) || height < 2 || data.length !== width * height * 3) {
    throw new TypeError("Ground phase fitting needs a complete opaque RGB raster");
  }
  const output = Buffer.allocUnsafe(data.length);
  for (let y = 0; y < height; y += 1) {
    const position = y / (height - 1);
    const depth = smoothstep((position - 0.25) / 0.75);
    const horizontal = sampleGroundFitBands(GROUND_FIT_HORIZONTAL_BANDS, position) * depth;
    const vertical = sampleGroundFitBands(GROUND_FIT_VERTICAL_BANDS, position) *
      sampleGroundFitBands(GROUND_FIT_SCALE_BANDS, position) * (1 - depth * 0.35);
    const phase = sampleGroundFitBands(GROUND_FIT_PHASE_BANDS, position);
    const previousY = Math.max(0, y - 1);
    const nextY = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const previousX = Math.max(0, x - 1);
      const nextX = Math.min(width - 1, x + 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = (y * width + x) * 3 + channel;
        const value = data[offset];
        const horizontalBlur = (
          data[(y * width + previousX) * 3 + channel] + value * 2 +
          data[(y * width + nextX) * 3 + channel]
        ) / 4;
        const verticalBlur = (
          (0.25 + phase) * data[(previousY * width + x) * 3 + channel] + value * 0.5 +
          (0.25 - phase) * data[(nextY * width + x) * 3 + channel]
        );
        output[offset] = clampByte(value + horizontal * (value - horizontalBlur) +
          vertical * (verticalBlur - value));
      }
    }
  }
  return output;
}

function sampleGroundFitBands(values, position) {
  const coordinate = position * values.length - 0.5;
  const lower = Math.max(0, Math.min(values.length - 1, Math.floor(coordinate)));
  const upper = Math.max(0, Math.min(values.length - 1, lower + 1));
  const amount = smoothstep(Math.max(0, Math.min(1, coordinate - Math.floor(coordinate))));
  return values[lower] * (1 - amount) + values[upper] * amount;
}

function smoothstep(value) {
  const amount = Math.max(0, Math.min(1, value));
  return amount * amount * (3 - 2 * amount);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function groundRasterFilterPlan(matrix, localY, sourceWidth, sourceHeight) {
  const centerX = CSSCLOTH_GROUND_RASTER_WIDTH / 2;
  const adjacentY = localY < CSSCLOTH_GROUND_RASTER_HEIGHT - 0.5 ? localY + 1 : localY - 1;
  const directionY = adjacentY > localY ? 1 : -1;
  const center = groundSourcePixel(matrix, centerX, localY, sourceWidth, sourceHeight);
  const horizontal = groundSourcePixel(matrix, centerX + 1, localY, sourceWidth, sourceHeight);
  const vertical = groundSourcePixel(matrix, centerX, adjacentY, sourceWidth, sourceHeight);
  const gradientX = [horizontal[0] - center[0], horizontal[1] - center[1]];
  const gradientY = [
    (vertical[0] - center[0]) * directionY,
    (vertical[1] - center[1]) * directionY,
  ];
  const xx = gradientX[0] ** 2 + gradientY[0] ** 2;
  const xy = gradientX[0] * gradientX[1] + gradientY[0] * gradientY[1];
  const yy = gradientX[1] ** 2 + gradientY[1] ** 2;
  const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  const majorSquared = Math.max(0, (xx + yy + discriminant) / 2);
  const minorSquared = Math.max(0, (xx + yy - discriminant) / 2);
  const major = Math.sqrt(majorSquared);
  const minor = Math.sqrt(minorSquared);
  const direction = majorDirection(xx, xy, yy, majorSquared);
  const filteredMinor = Math.max(1, minor, major / GROUND_MAX_ANISOTROPY);
  return Object.freeze({
    direction: Object.freeze(direction),
    span: major,
    sampleCount: Math.max(1, Math.min(GROUND_MAX_ANISOTROPY, Math.ceil(major / filteredMinor))),
    mipLevel: Math.max(0, Math.log2(filteredMinor)),
  });
}

function groundSourcePixel(matrix, x, y, sourceWidth, sourceHeight) {
  const world = sourceCssViewToWorld(transformGroundPoint(matrix, x, y));
  return [
    (world[0] + 10_000) / 800 * sourceWidth,
    (world[2] - 10_000) / 800 * sourceHeight,
  ];
}

function majorDirection(xx, xy, yy, majorSquared) {
  if (Math.abs(xy) > 1e-12) {
    const direction = [majorSquared - yy, xy];
    const length = Math.hypot(...direction);
    return direction.map((value) => value / length);
  }
  return xx >= yy ? [1, 0] : [0, 1];
}

function buildGroundMipmaps(source) {
  const mipmaps = [source];
  while (mipmaps.at(-1).width > 1 || mipmaps.at(-1).height > 1) {
    const previous = mipmaps.at(-1);
    const width = Math.max(1, previous.width >> 1);
    const height = Math.max(1, previous.height >> 1);
    const data = Buffer.allocUnsafe(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          for (let sampleY = 0; sampleY < 2; sampleY += 1) {
            for (let sampleX = 0; sampleX < 2; sampleX += 1) {
              const sourceX = Math.min(previous.width - 1, x * 2 + sampleX);
              const sourceY = Math.min(previous.height - 1, y * 2 + sampleY);
              sum += previous.data[(sourceY * previous.width + sourceX) * 3 + channel];
            }
          }
          data[(y * width + x) * 3 + channel] = Math.round(sum / 4);
        }
      }
    }
    mipmaps.push({ data, width, height });
  }
  return mipmaps;
}

function buildGroundLightingLookup() {
  return CSSCLOTH_FOG_COLOR.map((_, channel) => Uint8Array.from(
    { length: 256 },
    (_unused, value) => Math.round(shadeGroundSourceRgb([value / 255, value / 255, value / 255])[channel] * 255),
  ));
}

function transformGroundPoint(matrix, x, y) {
  const weight = matrix[3] * x + matrix[7] * y + matrix[15];
  return [
    (matrix[0] * x + matrix[4] * y + matrix[12]) / weight,
    (matrix[1] * x + matrix[5] * y + matrix[13]) / weight,
    (matrix[2] * x + matrix[6] * y + matrix[14]) / weight,
  ];
}

function sampleRepeatedRgb(mipmaps, u, v, output, offset, lighting, fog, filter) {
  const source = mipmaps[0];
  const color = [0, 0, 0];
  for (let sample = 0; sample < filter.sampleCount; sample += 1) {
    const distance = ((sample + 0.5) / filter.sampleCount - 0.5) * filter.span;
    const sourceX = u * source.width - 0.5 + filter.direction[0] * distance;
    const sourceY = v * source.height - 0.5 + filter.direction[1] * distance;
    const sampled = sampleGroundMipmap(mipmaps, sourceX, sourceY, filter.mipLevel);
    for (let channel = 0; channel < 3; channel += 1) color[channel] += sampled[channel];
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const lit = lighting[channel][Math.round(color[channel] / filter.sampleCount)];
    output[offset + channel] = Math.round(lit + (CSSCLOTH_FOG_COLOR[channel] - lit) * fog);
  }
}

function sampleGroundMipmap(mipmaps, sourceX, sourceY, mipLevel) {
  const lowerLevel = Math.min(mipmaps.length - 1, Math.floor(mipLevel));
  const upperLevel = Math.min(mipmaps.length - 1, lowerLevel + 1);
  const mix = mipLevel - lowerLevel;
  const lower = sampleGroundMipmapLevel(mipmaps[lowerLevel], sourceX / 2 ** lowerLevel, sourceY / 2 ** lowerLevel);
  if (upperLevel === lowerLevel) return lower;
  const upper = sampleGroundMipmapLevel(mipmaps[upperLevel], sourceX / 2 ** upperLevel, sourceY / 2 ** upperLevel);
  return lower.map((value, channel) => value + (upper[channel] - value) * mix);
}

function sampleGroundMipmapLevel(image, sourceX, sourceY) {
  const floorX = Math.floor(sourceX);
  const floorY = Math.floor(sourceY);
  const x0 = modulo(floorX, image.width);
  const y0 = modulo(floorY, image.height);
  const x1 = (x0 + 1) % image.width;
  const y1 = (y0 + 1) % image.height;
  const tx = sourceX - floorX;
  const ty = sourceY - floorY;
  const topLeft = (y0 * image.width + x0) * 3;
  const topRight = (y0 * image.width + x1) * 3;
  const bottomLeft = (y1 * image.width + x0) * 3;
  const bottomRight = (y1 * image.width + x1) * 3;
  return [0, 1, 2].map((channel) => {
    const top = image.data[topLeft + channel] +
      (image.data[topRight + channel] - image.data[topLeft + channel]) * tx;
    const bottom = image.data[bottomLeft + channel] +
      (image.data[bottomRight + channel] - image.data[bottomLeft + channel]) * tx;
    return top + (bottom - top) * ty;
  });
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function buildDeduplicatedClothPages(logo, rasterBoxes, lightingStates) {
  const triangles = buildClothTriangles();
  const uniqueTiles = [];
  const slotByHash = new Map();
  const stateSlots = [];
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const box = rasterBoxes[triangleIndex];
    const slots = [];
    for (let row = 0; row < lightingStates[triangleIndex].length; row += 1) {
      const tile = createRgba(box.width, box.height);
      paintClothTriangle(
        tile,
        0,
        0,
        logo,
        triangles[triangleIndex].uv,
        clothTriangleBasis(triangleIndex),
        lightingStates[triangleIndex][row],
        box.width,
        box.height,
      );
      const hash = hashOpaqueRgb(tile);
      let slot = slotByHash.get(hash);
      if (slot === undefined) {
        slot = uniqueTiles.length;
        slotByHash.set(hash, slot);
        uniqueTiles.push(tile);
      }
      slots.push(slot);
    }
    stateSlots.push(Object.freeze(slots));
  }
  const layout = buildClothSlotLayout(rasterBoxes, stateSlots, uniqueTiles.length);
  const pages = layout.pages.map((page) => createRgba(page.width, page.height));
  for (let slot = 0; slot < uniqueTiles.length; slot += 1) {
    const slice = layout.slots[slot];
    const page = pages[slice.pageIndex];
    const tile = uniqueTiles[slot];
    copyTile(tile, page, slice.x, slice.y);
    copyAllGutters(page, slice.x, slice.y, tile.width, tile.height);
  }
  return Object.freeze({ pages: Object.freeze(pages), layout });
}

function buildSeparatedClothPages(
  lightingSource,
  logoMask,
  heartMask,
  logoColor,
  heartColor,
  outlineWidth,
  outlineTopWidth,
  outlineCornerSize,
  rasterBoxes,
  lightingStates,
) {
  assertRgb(logoColor, "Cloth logo");
  assertRgb(heartColor, "Cloth heart");
  if (lightingSource.data.some((channel) => channel !== 0xff)) {
    throw new Error("Separated cloth lighting source must be uniform white");
  }
  const triangles = buildClothTriangles();
  const uniqueTiles = [];
  const slotByState = new Map();
  const stateSlots = [];
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const box = rasterBoxes[triangleIndex];
    const basis = clothTriangleBasis(triangleIndex);
    const basisKey = `${basis.a},${basis.b},${basis.c}`;
    const slots = [];
    for (const state of lightingStates[triangleIndex]) {
      const key = `${basisKey}:${state.join(",")}`;
      let slot = slotByState.get(key);
      if (slot === undefined) {
        slot = uniqueTiles.length;
        slotByState.set(key, slot);
        const tile = createRgba(box.width, box.height);
        paintClothTriangle(
          tile,
          0,
          0,
          lightingSource,
          triangles[triangleIndex].uv,
          basis,
          state,
          box.width,
          box.height,
        );
        uniqueTiles.push(tile);
      }
      slots.push(slot);
    }
    stateSlots.push(Object.freeze(slots));
  }
  const layout = buildClothSlotLayout(
    rasterBoxes,
    stateSlots,
    uniqueTiles.length,
    { preferSquare: true },
  );
  const pages = layout.pages.map((page) => createRgba(page.width, page.height));
  for (let slot = 0; slot < uniqueTiles.length; slot += 1) {
    const slice = layout.slots[slot];
    copyTile(uniqueTiles[slot], pages[slice.pageIndex], slice.x, slice.y);
    copyAllGutters(pages[slice.pageIndex], slice.x, slice.y, slice.width, slice.height);
  }
  const logoStateSlots = triangles.map((_, triangleIndex) => Object.freeze([triangleIndex]));
  const logoLayout = buildClothSlotLayout(
    rasterBoxes,
    logoStateSlots,
    triangles.length,
    { preferSquare: true },
  );
  const logoPages = logoLayout.pages.map((page) => createRgba(page.width, page.height));
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const box = rasterBoxes[triangleIndex];
    const slice = logoLayout.slots[triangleIndex];
    paintClothLogoTriangle(
      logoPages[slice.pageIndex],
      slice.x,
      slice.y,
      logoMask,
      heartMask,
      logoColor,
      heartColor,
      outlineWidth,
      outlineTopWidth,
      outlineCornerSize,
      triangles[triangleIndex].uv,
      clothTriangleBasis(triangleIndex),
      box.width,
      box.height,
    );
    copyAllGutters(logoPages[slice.pageIndex], slice.x, slice.y, box.width, box.height);
  }
  return Object.freeze({
    pages: Object.freeze(pages),
    logoPages: Object.freeze(logoPages),
    layout,
    logoLayout,
  });
}

function paintClothTriangle(
  page,
  left,
  top,
  logo,
  triangleUv,
  basis,
  vertexLightLevels,
  width,
  height,
) {
  const [uv0, uv1, uv2] = triangleUv;
  const uvs = [uv0, uv1, uv2];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localX = (x + 0.5) / width;
      const localY = (y + 0.5) / height;
      const weights = [
        1 - localY,
        localY - (localX - 0.5 * (1 - localY)),
        localX - 0.5 * (1 - localY),
      ].map((value) => Math.max(0, value));
      const weightTotal = weights[0] + weights[1] + weights[2];
      for (let index = 0; index < weights.length; index += 1) weights[index] /= weightTotal;
      const sourceWeights = [0, 0, 0];
      sourceWeights[basis.c] = weights[0];
      sourceWeights[basis.a] = weights[1];
      sourceWeights[basis.b] = weights[2];
      const textureU = sourceWeights.reduce((sum, weight, index) => sum + weight * uvs[index][0], 0);
      const textureV = sourceWeights.reduce((sum, weight, index) => sum + weight * uvs[index][1], 0);
      const lightLevel = sourceWeights.reduce((sum, weight, index) =>
        sum + weight * vertexLightLevels[index], 0) / (CSSCLOTH_LIGHT_LEVELS - 1);
      const fogLevel = sourceWeights.reduce((sum, weight, index) =>
        sum + weight * vertexLightLevels[index + 3], 0) / (CSSCLOTH_FOG_LEVELS - 1);
      const lit = shadeSourceRgb(sampleRgb(logo, textureU, textureV), lightLevel);
      const color = lit.map((channel, index) => (
        channel + (CSSCLOTH_FOG_COLOR[index] / 255 - channel) * fogLevel
      ));
      writePixel(page, left + x, top + y, color, 1);
    }
  }
}

function paintClothLogoTriangle(
  page,
  left,
  top,
  logoMask,
  heartMask,
  logoColor,
  heartColor,
  outlineWidth,
  outlineTopWidth,
  outlineCornerSize,
  triangleUv,
  basis,
  width,
  height,
) {
  const uvs = triangleUv;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localX = (x + 0.5) / width;
      const localY = (y + 0.5) / height;
      const weights = [
        1 - localY,
        localY - (localX - 0.5 * (1 - localY)),
        localX - 0.5 * (1 - localY),
      ].map((value) => Math.max(0, value));
      const weightTotal = weights[0] + weights[1] + weights[2];
      for (let index = 0; index < weights.length; index += 1) weights[index] /= weightTotal;
      const sourceWeights = [0, 0, 0];
      sourceWeights[basis.c] = weights[0];
      sourceWeights[basis.a] = weights[1];
      sourceWeights[basis.b] = weights[2];
      const textureU = sourceWeights.reduce((sum, weight, index) => sum + weight * uvs[index][0], 0);
      const textureV = sourceWeights.reduce((sum, weight, index) => sum + weight * uvs[index][1], 0);
      const sideDistance = Math.min(textureU, 1 - textureU, 1 - textureV);
      const sideCoverage = Math.max(0, Math.min(1,
        (outlineWidth - sideDistance) / 0.0035 + 0.5,
      ));
      const topCoverage = Math.max(0, Math.min(1,
        (outlineTopWidth - textureV) / 0.0035 + 0.5,
      ));
      const cornerCoverage =
          (textureV <= outlineCornerSize || 1 - textureV <= outlineCornerSize) &&
          (textureU <= outlineCornerSize || 1 - textureU <= outlineCornerSize)
        ? 1
        : 0;
      const purpleCoverage = Math.max(
        sampleRgb(logoMask, textureU, textureV)[0],
        sideCoverage,
        topCoverage,
        cornerCoverage,
      );
      const heartCoverage = heartMask ? sampleRgb(heartMask, textureU, textureV)[0] : 0;
      const coverage = Math.max(purpleCoverage, heartCoverage);
      const heartMix = coverage === 0 ? 0 : heartCoverage / (purpleCoverage + heartCoverage || 1);
      const color = logoColor.map((channel, index) => (
        channel + (heartColor[index] - channel) * heartMix
      ) / 255);
      writePixel(page, left + x, top + y, color, coverage);
    }
  }
}

function buildClothSlotLayout(rasterBoxes, stateSlots, slotCount, { preferSquare = false } = {}) {
  const width = rasterBoxes[0].width;
  const height = rasterBoxes[0].height;
  if (rasterBoxes.some((box) => box.width !== width || box.height !== height)) {
    throw new RangeError("Cloth atlas deduplication requires one raster leaf size");
  }
  const strideX = width + CLOTH_GUTTER * 2;
  const strideY = height + CLOTH_GUTTER * 2;
  const columns = preferSquare
    ? resolveNearSquareColumns(slotCount, strideX, strideY)
    : Math.min(slotCount, Math.floor(RASTER_PAGE_WIDTH / strideX));
  const pageWidth = columns * strideX;
  const pageHeight = Math.ceil(slotCount / columns) * strideY;
  if (slotCount < 1 || pageHeight > RASTER_PAGE_HEIGHT) {
    throw new RangeError("Cloth deduplicated atlas exceeds one prepared page");
  }
  const page = Object.freeze({
    index: 0,
    width: pageWidth,
    height: pageHeight,
    resourcePath: clothRasterPagePath(0),
  });
  const slots = Object.freeze(Array.from({ length: slotCount }, (_, slot) => Object.freeze({
    pageIndex: 0,
    resourcePath: page.resourcePath,
    x: (slot % columns) * strideX + CLOTH_GUTTER,
    y: Math.floor(slot / columns) * strideY + CLOTH_GUTTER,
    width,
    height,
    pageWidth,
    pageHeight,
  })));
  return Object.freeze({
    pages: Object.freeze([page]),
    slots,
    stateSlots: Object.freeze(stateSlots),
  });
}

function resolveNearSquareColumns(slotCount, strideX, strideY) {
  let best = null;
  const maxColumns = Math.min(slotCount, Math.floor(RASTER_PAGE_WIDTH / strideX));
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(slotCount / columns);
    const width = columns * strideX;
    const height = rows * strideY;
    if (height > RASTER_PAGE_HEIGHT) continue;
    const dimensionDelta = Math.abs(width - height);
    const unusedSlots = columns * rows - slotCount;
    if (!best || dimensionDelta < best.dimensionDelta ||
        (dimensionDelta === best.dimensionDelta && unusedSlots < best.unusedSlots)) {
      best = { columns, dimensionDelta, unusedSlots };
    }
  }
  if (!best) throw new RangeError("Cloth deduplicated atlas exceeds one prepared page");
  return best.columns;
}

function hashOpaqueRgb(image) {
  return createHash("sha256").update(image.data).digest("hex");
}

function buildLightingOverlayPage(page, backingColor) {
  assertRgb(backingColor, "Cloth backing");
  const output = createRgba(page.width, page.height);
  const backingLuminance = rgbLuminance(backingColor);
  for (let offset = 0; offset < page.data.length; offset += 4) {
    if (page.data[offset + 3] === 0) continue;
    const luminance = rgbLuminance(page.data.subarray(offset, offset + 3));
    const bright = luminance >= backingLuminance;
    const alpha = bright
      ? (luminance - backingLuminance) / (255 - backingLuminance)
      : (backingLuminance - luminance) / backingLuminance;
    const overlay = bright ? 255 : 0;
    output.data[offset] = overlay;
    output.data[offset + 1] = overlay;
    output.data[offset + 2] = overlay;
    output.data[offset + 3] = Math.round(alpha * 255);
  }
  return output;
}

function rgbLuminance(rgb) {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function copyTile(source, target, left, top) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((top + y) * target.width + left) * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + source.width * 4);
  }
}

function copyAllGutters(page, left, top, width, height = width) {
  for (let i = 0; i < height; i += 1) {
    copyPixel(page, left, top + i, left - 1, top + i);
    copyPixel(page, left + width - 1, top + i, left + width, top + i);
  }
  for (let i = 0; i < width; i += 1) {
    copyPixel(page, left + i, top, left + i, top - 1);
    copyPixel(page, left + i, top + height - 1, left + i, top + height);
  }
  copyPixel(page, left, top, left - 1, top - 1);
  copyPixel(page, left + width - 1, top, left + width, top - 1);
  copyPixel(page, left, top + height - 1, left - 1, top + height);
  copyPixel(page, left + width - 1, top + height - 1, left + width, top + height);
}

function copyPixel(page, sourceX, sourceY, targetX, targetY) {
  const source = (sourceY * page.width + sourceX) * 4;
  const target = (targetY * page.width + targetX) * 4;
  page.data.copy(page.data, target, source, source + 4);
}

function writePixel(page, x, y, rgb, alpha) {
  const offset = (y * page.width + x) * 4;
  page.data[offset] = Math.round(rgb[0] * 255);
  page.data[offset + 1] = Math.round(rgb[1] * 255);
  page.data[offset + 2] = Math.round(rgb[2] * 255);
  page.data[offset + 3] = Math.round(alpha * 255);
}

function sampleRgb(image, u, v) {
  const sourceX = Math.max(0, Math.min(image.width - 1, u * (image.width - 1)));
  const sourceY = Math.max(0, Math.min(image.height - 1, v * (image.height - 1)));
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = sourceX - x0;
  const ty = sourceY - y0;
  const top = mixRgb(readRgb(image, x0, y0), readRgb(image, x1, y0), tx);
  const bottom = mixRgb(readRgb(image, x0, y1), readRgb(image, x1, y1), tx);
  return mixRgb(top, bottom, ty);
}

function readRgb(image, x, y) {
  const offset = (y * image.width + x) * 3;
  return [image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255];
}

function mixRgb(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

async function decodeRgb(bytes, { background } = {}) {
  let image = sharp(bytes);
  if (background) image = image.flatten({ background });
  const { data, info } = await image.removeAlpha().toColorspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return Object.freeze({ data, width: info.width, height: info.height });
}

function createRgba(width, height) {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

function encodeRgbaPng(image) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function encodeOpaqueRgbPng(image) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}
