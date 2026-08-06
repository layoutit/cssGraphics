import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  CSSPIPES_PALETTE,
  CSSPIPES_PREBAKE_CONFIG,
  CSSPIPES_PRODUCT_MATERIALS,
  CSSPIPES_PRODUCT_PALETTE,
} from "./endlessTubes.mjs";
import { CSSPIPES_GENERATED_PUBLIC_ROOT } from "./paths.mjs";

const CSSPIPES_LIGHTING_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT,
  "assets/pipe-space-texels.png",
);

const FIELD_SIZE = 8;
const LEAF_SIZE = 64;
const SHADE = Object.freeze([1.08, 0.88, 0.6, 0.42, 0.58, 0.9]);
const SPECULAR_INTENSITY = 0.18;
const OPENGL_SHININESS_SCALE = 128;

function parseHex(color) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  if (!match) throw new TypeError(`Invalid cssPipes palette color ${color}`);
  return match.slice(1).map((value) => Number.parseInt(value, 16));
}

function channel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function preparedSpecularLobe(side, x, radialSegments, shininess) {
  const facetAngle = side * Math.PI * 2 / radialSegments;
  const texelAngle = ((x + 0.5) / FIELD_SIZE - 0.5) *
    Math.PI * 2 / radialSegments;
  const halfVectorDot = Math.max(0, Math.cos(facetAngle + texelAngle));
  return SPECULAR_INTENSITY *
    halfVectorDot ** Math.max(1, shininess * OPENGL_SHININESS_SCALE);
}

function preparedDiffuseShade(side, radialSegments) {
  const position = side * SHADE.length / radialSegments;
  const left = Math.floor(position) % SHADE.length;
  const right = (left + 1) % SHADE.length;
  const blend = position - Math.floor(position);
  return SHADE[left] + (SHADE[right] - SHADE[left]) * blend;
}

export function buildPipeSpaceTexelLighting() {
  const faceCount = CSSPIPES_PALETTE.length * CSSPIPES_PREBAKE_CONFIG.radialSegments;
  const width = faceCount * FIELD_SIZE;
  const height = FIELD_SIZE;
  const png = new PNG({ width, height, colorType: 6 });
  const faces = [];
  for (let materialIndex = 0; materialIndex < CSSPIPES_PALETTE.length; materialIndex += 1) {
    const base = parseHex(CSSPIPES_PALETTE[materialIndex]);
    const material = CSSPIPES_PRODUCT_MATERIALS[materialIndex];
    const materialRadialSegments =
      CSSPIPES_PREBAKE_CONFIG.radialSegmentsBySourcePipe[materialIndex];
    for (let side = 0; side < CSSPIPES_PREBAKE_CONFIG.radialSegments; side += 1) {
      const faceIndex = materialIndex * CSSPIPES_PREBAKE_CONFIG.radialSegments + side;
      for (let y = 0; y < FIELD_SIZE; y += 1) {
        for (let x = 0; x < FIELD_SIZE; x += 1) {
          const fieldCenter = (FIELD_SIZE - 1) / 2;
          const centerHighlight = 0.92 + 0.11 *
            (1 - Math.abs(x - fieldCenter) / fieldCenter);
          const vertical = 1.03 - y * 0.075 / (FIELD_SIZE - 1);
          const brightness = preparedDiffuseShade(
            side,
            materialRadialSegments,
          ) * centerHighlight * vertical;
          const specular = preparedSpecularLobe(
            side,
            x,
            materialRadialSegments,
            material.shininess,
          );
          const offset = (y * width + faceIndex * FIELD_SIZE + x) * 4;
          for (let colorChannel = 0; colorChannel < 3; colorChannel += 1) {
            const diffuseSrgb = Math.max(0, Math.min(1,
              base[colorChannel] / 255 * brightness));
            const litLinear = srgbToLinear(diffuseSrgb) +
              material.specular[colorChannel] * specular;
            png.data[offset + colorChannel] = channel(linearToSrgb(litLinear) * 255);
          }
          png.data[offset + 3] = 255;
        }
      }
      faces.push(Object.freeze({
        materialIndex,
        symbol: material.symbol,
        side,
        radialSegments: materialRadialSegments,
        faceIndex,
        backgroundPositionX: `${-faceIndex * LEAF_SIZE}px`,
      }));
    }
  }
  const bytes = PNG.sync.write(png, { colorType: 6, inputColorType: 6 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const contract = Object.freeze({
    schema: "csspipes-prepared-space-texel-lighting@1",
    techniqueReference: "cssGraphics Mario fixed-page prepared space-texel surface",
    assetUrl: "/csspipes/assets/pipe-space-texels.png",
    assetSha256: sha256,
    encoding: "PNG-RGBA8",
    fieldWidth: FIELD_SIZE,
    fieldHeight: FIELD_SIZE,
    atlasWidth: width,
    atlasHeight: height,
    leafWidth: LEAF_SIZE,
    leafHeight: LEAF_SIZE,
    backgroundSize: `${width * (LEAF_SIZE / FIELD_SIZE)}px ${LEAF_SIZE}px`,
    palette: CSSPIPES_PRODUCT_PALETTE,
    materialColors: CSSPIPES_PALETTE,
    materialFieldStride: CSSPIPES_PREBAKE_CONFIG.radialSegments,
    materialCssStride: CSSPIPES_PREBAKE_CONFIG.radialSegments * LEAF_SIZE,
    specular: Object.freeze({
      schema: "csspipes-prepared-specular-space-texel@1",
      model: "prepared-blinn-phong-half-vector",
      materialTerms: "fixed-product-material-specular-rgb-and-shininess",
      sourceColorSpace: "linear-light",
      intensity: SPECULAR_INTENSITY,
      shininessScale: OPENGL_SHININESS_SCALE,
      halfVectorFacet: 0,
      runtimeDynamic: false,
    }),
    faces: Object.freeze(faces),
    runtime: Object.freeze({
      lightingCalculations: 0,
      backgroundImageWrites: 0,
      sequentialBackgroundPositionWrites: 0,
      materialRandomSelections: 0,
      perLeafMaterialWrites: 0,
      topologyMutation: false,
    }),
  });
  return Object.freeze({ contract, bytes });
}

export async function writePipeSpaceTexelLighting(
  prepared = buildPipeSpaceTexelLighting(),
) {
  await mkdir(dirname(CSSPIPES_LIGHTING_PATH), { recursive: true });
  const temporary = `${CSSPIPES_LIGHTING_PATH}.tmp`;
  await writeFile(temporary, prepared.bytes);
  await rename(temporary, CSSPIPES_LIGHTING_PATH);
  return Object.freeze({
    outputPath: CSSPIPES_LIGHTING_PATH,
    bytes: prepared.bytes.length,
    contract: prepared.contract,
  });
}
