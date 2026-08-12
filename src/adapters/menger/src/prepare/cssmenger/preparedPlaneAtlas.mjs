import { createHash } from "node:crypto";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import { PNG } from "pngjs";
import { preparedSourceFaceVertices } from "./mengerGeometry.mjs";

const GUTTER = 1;
const preparedBytes = new WeakMap();
export const CSS_OPACITY_NATIVE_DISPLAY_SCALE = 0.75;

const PALETTE_ROLES = Object.freeze({
  source: Object.freeze({
    stateCount: 128,
    assetPrefix: "planes",
    technique: "one-alpha-atlas-quad-per-directional-plane-with-prepared-palette-banks",
  }),
  "css-opacity-base": Object.freeze({
    stateCount: 128,
    assetPrefix: "planes-opacity-base",
    technique: "one-alpha-color-base-atlas-quad-per-directional-plane",
    rgbNormalization: "divide-by-maximum-rgb-channel",
    rgbScale: CSS_OPACITY_NATIVE_DISPLAY_SCALE,
    rgbCalibration: "native-oracle-common-prefix-display-range-scale",
  }),
});

export function buildPreparedMengerPlaneAtlas({ geometry, palette, paletteRole = "source" }) {
  const role = PALETTE_ROLES[paletteRole];
  if (!geometry?.metrics?.sourceFaceCoverageExact || !Array.isArray(geometry.bundles) ||
      !Array.isArray(geometry.sourceFaces) || !Array.isArray(geometry.meshes) ||
      !role || !Array.isArray(palette) || palette.length !== role.stateCount ||
      palette.some((material) => !Array.isArray(material) || material.length !== 4)) {
    throw new TypeError("Complete Menger plane geometry and a supported prepared palette are required");
  }
  const polygonByLeaf = new Map(geometry.meshes.flatMap((mesh) => mesh.polygons).map((polygon) => [
    Number(polygon.data["cssmenger-plane-leaf"]),
    polygon,
  ]));
  const patterns = [];
  const patternBySignature = new Map();
  const bundlePatternIndices = [];
  let preparedOpaqueTexelCount = 0;
  for (const bundle of geometry.bundles) {
    const polygon = polygonByLeaf.get(bundle.bundleIndex);
    if (!polygon) throw new Error(`Prepared Menger plane leaf ${bundle.bundleIndex} has no polygon`);
    const alpha = rasterizeBundleAlpha(bundle, polygon, geometry);
    const opaqueTexelCount = alpha.reduce((count, value) => count + (value === 255 ? 1 : 0), 0);
    if (opaqueTexelCount !== bundle.sourceFaceIndices.length) {
      throw new Error(`Prepared Menger plane leaf ${bundle.bundleIndex} alpha coverage drifted`);
    }
    preparedOpaqueTexelCount += opaqueTexelCount;
    const signature = createHash("sha256").update(alpha).digest("hex");
    let patternIndex = patternBySignature.get(signature);
    if (patternIndex === undefined) {
      patternIndex = patterns.length;
      patternBySignature.set(signature, patternIndex);
      patterns.push(Object.freeze({
        index: patternIndex,
        sha256: signature,
        width: geometry.cellsPerAxis,
        height: geometry.cellsPerAxis,
        alpha,
        opaqueTexelCount,
      }));
    }
    bundlePatternIndices[bundle.bundleIndex] = patternIndex;
  }
  if (preparedOpaqueTexelCount !== geometry.metrics.sourcePolygonCount) {
    throw new Error("Prepared Menger plane atlas lost source-face alpha coverage");
  }
  const tileWidth = geometry.cellsPerAxis;
  const tileHeight = geometry.cellsPerAxis;
  const slotWidth = tileWidth + GUTTER * 2;
  const slotHeight = tileHeight + GUTTER * 2;
  const image = new PNG({
    width: patterns.length * slotWidth,
    height: palette.length * slotHeight,
    colorType: 6,
  });
  for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
    const color = preparedPaletteColor(palette[paletteIndex], role);
    for (const pattern of patterns) {
      const contentX = pattern.index * slotWidth + GUTTER;
      const contentY = paletteIndex * slotHeight + GUTTER;
      blitPattern(image, pattern, color, contentX, contentY);
    }
  }
  const bytes = PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const patternRows = Object.freeze(patterns.map((pattern) => Object.freeze([
    pattern.index * slotWidth + GUTTER,
    GUTTER,
    tileWidth,
    tileHeight,
  ])));
  const contract = Object.freeze({
    schema: "cssmenger-prepared-coplanar-plane-atlas@1",
    technique: role.technique,
    paletteRole,
    rgbNormalization: role.rgbNormalization ?? "none",
    ...(role.rgbScale ? { rgbScale: role.rgbScale, rgbCalibration: role.rgbCalibration } : {}),
    assetUrl: `/cssmenger/assets/${role.assetPrefix}-${sha256}.png`,
    assetSha256: sha256,
    encoding: "PNG-RGBA8",
    byteLength: bytes.length,
    width: image.width,
    height: image.height,
    decodedBytes: image.width * image.height * 4,
    gutterPixels: GUTTER,
    tileWidth,
    tileHeight,
    slotWidth,
    slotHeight,
    patternCount: patterns.length,
    paletteStateCount: palette.length,
    leafCount: geometry.bundles.length,
    sourceFaceCount: geometry.metrics.sourcePolygonCount,
    sourceFaceCoverageCount: preparedOpaqueTexelCount,
    sourceFaceCoverageExact: true,
    backgroundSize: `${image.width}px ${image.height}px`,
    paletteBackgroundPositionYs: Object.freeze(palette.map((_, index) => `${-(index * slotHeight + GUTTER)}px`)),
    patternRows,
    leafPatternIndices: Object.freeze(bundlePatternIndices),
    patternSha256s: Object.freeze(patterns.map((pattern) => pattern.sha256)),
    patternOpaqueTexelCounts: Object.freeze(patterns.map((pattern) => pattern.opaqueTexelCount)),
    runtime: Object.freeze({
      geometryConstruction: 0,
      atlasConstruction: 0,
      perLeafStyleWritesPerPublishedState: "prepared-front-facing-schedule",
      rootTransformWritesPerPublishedState: 1,
      rootBackgroundPositionWritesPerPublishedState: 0,
      topologyMutation: false,
    }),
  });
  preparedBytes.set(contract, bytes);
  return contract;
}

function preparedPaletteColor(material, role) {
  const maximumRgb = Math.max(...material.slice(0, 3));
  if (role.rgbNormalization && !(maximumRgb > 0)) {
    throw new Error("Prepared cssMenger CSS-opacity palette contains a black material");
  }
  return material.map((value, channel) => {
    const normalized = channel < 3 && role.rgbNormalization
      ? value / maximumRgb * (role.rgbScale ?? 1)
      : value;
    return Math.max(0, Math.min(255, Math.round(normalized * 255)));
  });
}

export function preparedMengerPlaneAtlasBytes(contract) {
  return preparedBytes.get(contract) ?? null;
}

function rasterizeBundleAlpha(bundle, polygon, geometry) {
  const plan = computeTextureAtlasPlanPublic({ ...polygon, color: "#ffffff" }, bundle.bundleIndex);
  if (!plan || plan.screenPts?.length !== 8 || !(plan.canvasW > 0) || !(plan.canvasH > 0)) {
    throw new Error(`Prepared Menger plane leaf ${bundle.bundleIndex} has no PolyCSS basis`);
  }
  const alpha = new Uint8Array(geometry.cellsPerAxis * geometry.cellsPerAxis);
  const bundleVertices = polygon.vertices;
  const origin = bundleVertices[0];
  const edgeU = subtract(bundleVertices[1], origin);
  const edgeV = subtract(bundleVertices[3], origin);
  const edgeULengthSquared = dot(edgeU, edgeU);
  const edgeVLengthSquared = dot(edgeV, edgeV);
  const p0 = [plan.screenPts[0], plan.screenPts[1]];
  const p1 = [plan.screenPts[2], plan.screenPts[3]];
  const p3 = [plan.screenPts[6], plan.screenPts[7]];
  const faces = bundle.sourceFaceIndices.map((sourceIndex) => geometry.sourceFaces[sourceIndex]);
  for (const face of faces) {
    const points = preparedSourceFaceVertices(face, geometry.cellsPerAxis).map((vertex) => {
      const relative = subtract(vertex, origin);
      const u = dot(relative, edgeU) / edgeULengthSquared;
      const v = dot(relative, edgeV) / edgeVLengthSquared;
      const x = p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v;
      const y = p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v;
      return [x / plan.canvasW * geometry.cellsPerAxis, y / plan.canvasH * geometry.cellsPerAxis];
    });
    fillQuad(alpha, geometry.cellsPerAxis, geometry.cellsPerAxis, points);
  }
  return alpha;
}

function fillQuad(alpha, width, height, points) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0]))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point[0]))) - 1);
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))) - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sample = [x + 0.5, y + 0.5];
      if (pointInTriangle(sample, points[0], points[1], points[2]) ||
          pointInTriangle(sample, points[0], points[2], points[3])) {
        alpha[y * width + x] = 255;
      }
    }
  }
}

function pointInTriangle(point, left, middle, right) {
  const area = edge(left, middle, right);
  if (Math.abs(area) < 1e-9) return false;
  const w0 = edge(middle, right, point) / area;
  const w1 = edge(right, left, point) / area;
  const w2 = edge(left, middle, point) / area;
  return w0 >= -1e-7 && w1 >= -1e-7 && w2 >= -1e-7;
}

function blitPattern(image, pattern, color, contentX, contentY) {
  for (let y = -GUTTER; y < pattern.height + GUTTER; y += 1) {
    for (let x = -GUTTER; x < pattern.width + GUTTER; x += 1) {
      const sourceX = Math.max(0, Math.min(pattern.width - 1, x));
      const sourceY = Math.max(0, Math.min(pattern.height - 1, y));
      const alpha = pattern.alpha[sourceY * pattern.width + sourceX];
      const offset = ((contentY + y) * image.width + contentX + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = alpha;
    }
  }
}

function edge(left, right, point) {
  return (point[0] - left[0]) * (right[1] - left[1]) - (point[1] - left[1]) * (right[0] - left[0]);
}

function subtract(left, right) {
  return left.map((component, axis) => component - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, component, axis) => sum + component * right[axis], 0);
}
