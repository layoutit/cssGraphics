// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { CSSBLACKHOLE_GALACTIC_DOT_COLORS } from
  "../src/shared/cssblackhole/preparedColorPresentation.mjs";

const SPACE_CONTEXT_SEED = 1979;
const SPACE_CONTEXT_STAR_COUNT = 1_000;
const SPACE_CONTEXT_UNIFORM_POINT_COUNT = 600;
const SPACE_CONTEXT_BAND_POINT_COUNT = 400;
const SPACE_CONTEXT_OPACITY_PALETTE = Object.freeze([
  "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8",
]);
const SPACE_CONTEXT_OPACITY_SAMPLING_BUCKET_COUNT = 9;
const SPACE_CONTEXT_GLOBAL_OPACITY = 0.5;
const SPACE_CONTEXT_PLATES = Object.freeze([
  Object.freeze({ id: "landscape", width: 2560, height: 1440, seedOffset: 0 }),
  Object.freeze({ id: "portrait", width: 1440, height: 2560, seedOffset: 0x51f15e }),
]);

export async function prepareBlackHoleSpaceContext(outputRoot) {
  const plates = [];
  for (const specification of SPACE_CONTEXT_PLATES) {
    const points = preparePlatePoints(specification);
    const variants = [];
    for (const deviceScaleFactor of [1, 2]) {
      const suffix = deviceScaleFactor === 1 ? "" : "@2x";
      const filename = `space-context-${specification.id}${suffix}.webp`;
      const width = specification.width * deviceScaleFactor;
      const height = specification.height * deviceScaleFactor;
      const bytes = await renderPlate({
        points,
        width,
        height,
        deviceScaleFactor,
        pointSize: deviceScaleFactor === 1 ? 1 : 4,
      });
      await writeFile(resolve(outputRoot, filename), bytes);
      variants.push(Object.freeze({
        deviceScaleFactor,
        assetUrl: `/cssblackhole/${filename}`,
        width,
        height,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      }));
    }
    plates.push(Object.freeze({
      id: specification.id,
      logicalWidth: specification.width,
      logicalHeight: specification.height,
      sourceStarCount: points.length,
      variants: Object.freeze(variants),
    }));
  }

  return Object.freeze({
    schema: "cssblackhole-prepared-space-context@1",
    classification: "decorative-static-deep-space-context-not-luminet-source-state",
    mode: "prepared-resolution-aware-luminet-dot-primitive-plates",
    seed: SPACE_CONTEXT_SEED,
    sourceStarCountPerPlate: SPACE_CONTEXT_STAR_COUNT,
    palette: CSSBLACKHOLE_GALACTIC_DOT_COLORS,
    opacityPalette: SPACE_CONTEXT_OPACITY_PALETTE,
    opacityDecimalPlaces: 1,
    maximumBaseOpacity: 0.8,
    opacitySamplingBucketCount: SPACE_CONTEXT_OPACITY_SAMPLING_BUCKET_COUNT,
    globalOpacity: SPACE_CONTEXT_GLOBAL_OPACITY,
    opacityMode: "prepared-original-dot-opacity-palette-times-global-half-opacity",
    opacityComposition: "prepared-srgb-over-opaque-black-after-global-half-opacity",
    pointPrimitive: Object.freeze({
      shape: "axis-aligned-square",
      foregroundReference: ".polycss-scene > b",
      cssPixelsAt1dppx: 1,
      cssPixelsAtMinimum2dppx: 2,
      devicePixelsAt1dppx: 1,
      devicePixelsAt2dppx: 4,
      minimumLogicalChebyshevSeparationPixels: 2,
      overlappingPreparedPointCount: 0,
    }),
    distribution: Object.freeze({
      uniformPointCount: SPACE_CONTEXT_UNIFORM_POINT_COUNT,
      broadGalacticBandPointCount: SPACE_CONTEXT_BAND_POINT_COUNT,
      bandClassification: "decorative-broad-density-context",
      centerDensityMode: "uniform-sparse-no-static-center-hole",
      minimumCenterDensity: 1,
    }),
    lensing: Object.freeze({
      classification: "thin-lens-compositional-context-not-luminet-source-parity",
      einsteinRadiusLogicalPixels: 96,
      influenceRadiusLogicalPixels: 440,
      centralShadowRadiusLogicalPixels: 0,
    }),
    plates: Object.freeze(plates),
    runtimeDomNodeCount: 0,
    runtimeAnimationCount: 0,
    runtimeStyleWriteCount: 0,
    runtimeRasterizationCount: 0,
  });
}

function preparePlatePoints({ width, height, seedOffset }) {
  const random = mulberry32(SPACE_CONTEXT_SEED ^ seedOffset);
  const points = [];
  const reserved = new Set();
  let attempts = 0;
  while (points.length < SPACE_CONTEXT_STAR_COUNT) {
    if (attempts > SPACE_CONTEXT_STAR_COUNT * 100) {
      throw new Error("Prepared space-context point placement exhausted");
    }
    attempts += 1;
    const inBand = points.length >= SPACE_CONTEXT_UNIFORM_POINT_COUNT;
    const sourceX = random() * width;
    const sourceY = inBand ? bandY(random, sourceX, width, height) : random() * height;
    if (sourceY < 0 || sourceY >= height) continue;
    const lensed = lensPoint(sourceX, sourceY, width, height);
    if (lensed === null) continue;
    const x = Math.round(lensed.x);
    const y = Math.round(lensed.y);
    if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1 ||
        reserved.has(`${x},${y}`)) continue;
    const color = CSSBLACKHOLE_GALACTIC_DOT_COLORS[
      Math.floor(random() * CSSBLACKHOLE_GALACTIC_DOT_COLORS.length)];
    const opacityBucket = Math.floor(
      Math.pow(random(), 1.8) * SPACE_CONTEXT_OPACITY_SAMPLING_BUCKET_COUNT);
    const opacity = SPACE_CONTEXT_OPACITY_PALETTE[
      Math.min(opacityBucket, SPACE_CONTEXT_OPACITY_PALETTE.length - 1)];
    points.push(Object.freeze({
      x,
      y,
      rgb: compositeOverBlack(color, Number(opacity) * SPACE_CONTEXT_GLOBAL_OPACITY),
    }));
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        reserved.add(`${x + offsetX},${y + offsetY}`);
      }
    }
  }
  return Object.freeze(points);
}

function bandY(random, x, width, height) {
  const normalizedX = x / width - 0.5;
  const center = height * (0.52 - normalizedX * 0.18);
  return center + gaussian(random) * height * 0.15;
}

function lensPoint(x, y, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const radius = Math.hypot(dx, dy);
  if (radius === 0) return null;
  const scale = Math.sqrt(width * height / (2560 * 1440));
  const influenceRadius = 440 * scale;
  const einsteinRadius = 96 * scale;
  if (radius >= influenceRadius) return { x, y };
  const influence = 1 - radius / influenceRadius;
  const displacement = Math.min(
    80 * scale,
    einsteinRadius * einsteinRadius / Math.max(radius, 12 * scale) * 0.35 * influence,
  );
  const imageRadius = radius + displacement;
  return {
    x: centerX + dx / radius * imageRadius,
    y: centerY + dy / radius * imageRadius,
  };
}

async function renderPlate({ points, width, height, deviceScaleFactor, pointSize }) {
  const pixels = Buffer.alloc(width * height * 3);
  for (const point of points) {
    const left = point.x * deviceScaleFactor;
    const top = point.y * deviceScaleFactor;
    for (let y = top; y < Math.min(height, top + pointSize); y += 1) {
      for (let x = left; x < Math.min(width, left + pointSize); x += 1) {
        const offset = (y * width + x) * 3;
        pixels[offset] = point.rgb[0];
        pixels[offset + 1] = point.rgb[1];
        pixels[offset + 2] = point.rgb[2];
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

function compositeOverBlack(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return Object.freeze([
    Math.round((value >> 16 & 0xff) * opacity),
    Math.round((value >> 8 & 0xff) * opacity),
    Math.round((value & 0xff) * opacity),
  ]);
}

function gaussian(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
