import {
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_FACE_NORMALS,
} from "./modelBuilder.mjs";
import { CSSCYCLONE_PRESENTATION } from "./sourceModel.mjs";

const PREPARED_MINIMUM_SATURATION = CSSCYCLONE_PRESENTATION.minimumSaturation;
const PREPARED_MINIMUM_VALUE = 0.75;
const PALETTE_CENTER_HUES = Object.freeze({
  blue: 2 / 3,
  yellow: 1 / 6,
  red: 0,
  magenta: 5 / 6,
  green: 1 / 3,
});
const LIGHT_DIRECTION = normalize([400, -200, 400]);
const HALF_VECTOR = normalize([
  LIGHT_DIRECTION[0],
  LIGHT_DIRECTION[1],
  LIGHT_DIRECTION[2] + 1,
]);

export function createCyclonePreparedLightingStream() {
  let particleCount = null;
  let expectedChunkCount = null;
  let chunkFrameCount = null;
  let streamId = null;
  let nextChunkIndex = 0;
  let sourceStreamFrameCount = 0;
  let frozenFaceNormals = null;
  let currentColorStateIndices = null;
  let previousColors = null;
  let colorRestartCount = 0;
  const colorStates = [];

  function add(source) {
    validateSourceChunk(source);
    if (particleCount === null) initialize(source);
    if (source.bank.streamId !== streamId ||
        source.bank.chunkIndex !== nextChunkIndex ||
        source.bank.startFrameIndex !== sourceStreamFrameCount ||
        source.bank.particleCount !== particleCount ||
        source.bank.frameCount !== chunkFrameCount ||
        source.bank.chunkCount !== expectedChunkCount) {
      throw new Error("Prepared Cyclone lighting chunks are not one continuous source stream");
    }
    let chunkColorRestartCount = 0;
    const frameParticleColorStateIndices = source.frames.map((frame, frameIndex) => Object.freeze(
      frame.particles.map((particle, particleIndex) => {
        if (particle.color !== previousColors[particleIndex]) {
          if (sourceStreamFrameCount + frameIndex > 0) {
            colorRestartCount += 1;
            chunkColorRestartCount += 1;
          }
          currentColorStateIndices[particleIndex] = colorStates.length;
          colorStates.push(Object.freeze({
            particleIndex,
            baseColor: particle.colorRgb,
          }));
          previousColors[particleIndex] = particle.color;
        }
        return currentColorStateIndices[particleIndex];
      }),
    ));
    const chunk = deepFreeze({
      schema: "csscyclone-prepared-lighting-chunk@1",
      streamId,
      chunkIndex: source.bank.chunkIndex,
      startFrameIndex: source.bank.startFrameIndex,
      frameCount: source.frames.length,
      particleCount,
      colorRestartCount: chunkColorRestartCount,
      frameParticleColorStateIndices,
    });
    sourceStreamFrameCount += source.frames.length;
    nextChunkIndex += 1;
    return chunk;
  }

  async function finalize({ allowPartial = false } = {}) {
    if (particleCount === null || frozenFaceNormals === null || colorStates.length === 0) {
      throw new Error("Prepared Cyclone lighting stream has no source chunks");
    }
    if (!allowPartial && nextChunkIndex !== expectedChunkCount) {
      throw new Error(`Prepared Cyclone lighting stream has ${nextChunkIndex}/${expectedChunkCount} chunks`);
    }
    return buildPreparedLightingColors({
      particleCount,
      chunkCount: nextChunkIndex,
      chunkFrameCount,
      streamId,
      sourceStreamFrameCount,
      frozenFaceNormals,
      colorStates,
      colorRestartCount,
    });
  }

  function initialize(source) {
    particleCount = source.bank.particleCount;
    expectedChunkCount = source.bank.chunkCount;
    chunkFrameCount = source.bank.frameCount;
    streamId = source.bank.streamId;
    currentColorStateIndices = Array(particleCount).fill(-1);
    previousColors = Array(particleCount).fill(null);
    frozenFaceNormals = source.frames[0].particles.map((particle) => {
      const normalMatrix = inverseTranspose3(particle.matrix);
      return CSSCYCLONE_FACE_NORMALS.map((normal) => transform3(normalMatrix, normal));
    });
  }

  return Object.freeze({ add, finalize });
}

export async function buildCyclonePreparedLighting({ source }) {
  const stream = createCyclonePreparedLightingStream();
  const chunk = stream.add(source);
  const prepared = await stream.finalize({ allowPartial: true });
  return Object.freeze({ ...prepared, chunk });
}

async function buildPreparedLightingColors({
  particleCount,
  chunkCount,
  chunkFrameCount,
  streamId,
  sourceStreamFrameCount,
  frozenFaceNormals,
  colorStates,
  colorRestartCount,
}) {
  const leafCount = particleCount * CSSCYCLONE_FACE_INDICES.length;
  const tileCount = colorStates.length * CSSCYCLONE_FACE_INDICES.length;
  if (CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount !== 3 ||
      CSSCYCLONE_PRESENTATION.maximumColorFamilyCount !== 3 ||
      CSSCYCLONE_PRESENTATION.startupPaletteFamilies.some((family) =>
        !Object.hasOwn(PALETTE_CENTER_HUES, family))) {
    throw new Error("Cyclone prepared three-family palette configuration drifted");
  }
  const logicalVariants = [];
  for (const paletteFamily of CSSCYCLONE_PRESENTATION.startupPaletteFamilies) {
    const hueSlots = preparedPaletteHues(paletteFamily);
    const colors = [];
    for (let stateIndex = 0; stateIndex < colorStates.length; stateIndex += 1) {
      const state = colorStates[stateIndex];
      const baseColor = prepareCyclonePaletteColor(state.baseColor, paletteFamily);
      for (let faceIndex = 0; faceIndex < CSSCYCLONE_FACE_INDICES.length; faceIndex += 1) {
        const faceColor = shadeVertex({
          baseColor,
          normal: frozenFaceNormals[state.particleIndex][faceIndex],
        });
        colors.push(rgbHex(faceColor));
      }
    }
    logicalVariants.push(Object.freeze({ paletteFamily, hueSlots, colors: Object.freeze(colors) }));
  }
  const deduplication = deduplicateExactCrossVariantColors(logicalVariants, tileCount);
  const uniqueColorCount = deduplication.uniqueSourceColorIndices.length;
  const colorSlotIndexBytes = uniqueColorCount <= 0xffff ? 2 : 4;
  const colorSlotIndicesBase64 = encodeColorSlotIndices(
    deduplication.colorSlotIndices,
    colorSlotIndexBytes,
  );
  const variants = logicalVariants.map((variant) => Object.freeze({
    paletteFamily: variant.paletteFamily,
    hueSlots: variant.hueSlots,
    colors: Object.freeze(deduplication.uniqueSourceColorIndices.map((index) =>
      variant.colors[index])),
  }));
  const contract = deepFreeze({
    schema: "csscyclone-prepared-flat-lighting-colors@9",
    technique: "prepared-flat-face-session-three-family-solid-colors-with-dark-color-floor-sparse-source-color-restarts-and-exact-cross-variant-deduplication",
    source: "src/cyclone/cyclone.cpp#particle::update+initSaver",
    streamId,
    encoding: "CSS-sRGB-hex-plus-little-endian-color-slot-indices-base64",
    lossless: true,
    paletteFamilyCount: CSSCYCLONE_PRESENTATION.startupPaletteFamilies.length,
    paletteFamilies: CSSCYCLONE_PRESENTATION.startupPaletteFamilies,
    paletteHueSlotCount: CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount,
    paletteAssignment: CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
    preparedMinimumSaturation: PREPARED_MINIMUM_SATURATION,
    preparedMinimumValue: PREPARED_MINIMUM_VALUE,
    maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
    variants: Object.freeze(variants),
    colorEntryCount: tileCount,
    uniqueColorCount,
    deduplicatedColorCount: tileCount - uniqueColorCount,
    colorDeduplication: "exact-cross-palette-css-srgb-tuples",
    colorSlotIndexEncoding: colorSlotIndexBytes === 2 ? "uint16-le-base64" : "uint32-le-base64",
    colorSlotIndexBytes,
    colorSlotIndexCount: tileCount,
    colorSlotIndicesBase64,
    leafCount,
    sourceFaceCount: leafCount,
    sourceFaceCoverageCount: leafCount,
    sourceFaceCoverageExact: true,
    sourceStreamFrameCount,
    chunkCount,
    chunkFrameCount,
    colorStateCount: colorStates.length,
    colorRestartCount,
    facesPerParticle: CSSCYCLONE_FACE_INDICES.length,
    lightingReferenceFrameIndex: 0,
    sourceColorRestartTimingExact: true,
    sourceHueTimingExact: true,
    sourceHueValuesExact: false,
    dynamicLightOrientation: false,
    sampling: "one-prepared-solid-srgb-color-per-face-state",
    interpolation: "browser-perspective-transformed-stream-frame-zero-flat-face-color",
    material: Object.freeze({
      ambientAndDiffuse: "prepared-session-three-family-palette-from-source-particle-rgb",
      specular: Object.freeze([0.7, 0.7, 0.7, 1]),
      shininess: 20,
    }),
    light: Object.freeze({
      model: "OpenGL-1.x-infinite-viewer-ambient-Lambert-Blinn-Phong",
      globalAmbient: Object.freeze([0.2, 0.2, 0.2, 1]),
      ambient: Object.freeze([0.25, 0.25, 0.25, 0]),
      diffuse: Object.freeze([1, 1, 1, 0]),
      specular: Object.freeze([1, 1, 1, 0]),
      position: Object.freeze([400, -200, 400, 0]),
      normalizeNormals: false,
    }),
    runtime: Object.freeze({
      geometryConstruction: 0,
      imageConstruction: 0,
      lightingCalculations: 0,
      colorCalculations: 0,
      rootLightingRowWritesPerSample: 0,
      maximumSparseLeafWritesPerParticleRestart: CSSCYCLONE_FACE_INDICES.length,
      topologyMutation: false,
    }),
  });
  return Object.freeze({
    contract,
    metrics: Object.freeze({
      preparedLightingChunkCount: chunkCount,
      preparedLightingStreamFrameCount: sourceStreamFrameCount,
      preparedLightingColorStateCount: colorStates.length,
      preparedLightingColorRestartCount: colorRestartCount,
      preparedLightingLogicalColorCount: tileCount,
      preparedLightingUniqueColorCount: uniqueColorCount,
      preparedLightingDeduplicatedColorCount: tileCount - uniqueColorCount,
      preparedLightingPaletteVariantCount: variants.length,
      preparedLightingColorSlotIndexBytes: tileCount * colorSlotIndexBytes,
      preparedLightingStoredColorCharacters: variants.reduce((sum, variant) =>
        sum + variant.colors.reduce((colorSum, color) => colorSum + color.length, 0), 0),
      preparedLightingLeafBindingCount: leafCount,
      runtimeLightingCalculations: 0,
      runtimeLightingImageConstruction: 0,
      runtimeLightingWritesPerSample: 0,
    }),
  });
}

function deduplicateExactCrossVariantColors(variants, colorEntryCount) {
  if (!Array.isArray(variants) || variants.length < 1 ||
      variants.some((variant) => variant.colors.length !== colorEntryCount)) {
    throw new Error("Cyclone lighting color deduplication requires every palette variant");
  }
  const slotBySignature = new Map();
  const colorSlotIndices = new Uint32Array(colorEntryCount);
  const uniqueSourceColorIndices = [];
  for (let colorIndex = 0; colorIndex < colorEntryCount; colorIndex += 1) {
    const signature = variants.map((variant) => variant.colors[colorIndex]).join("");
    let slotIndex = slotBySignature.get(signature);
    if (slotIndex === undefined) {
      slotIndex = uniqueSourceColorIndices.length;
      slotBySignature.set(signature, slotIndex);
      uniqueSourceColorIndices.push(colorIndex);
    }
    colorSlotIndices[colorIndex] = slotIndex;
  }
  return Object.freeze({
    colorSlotIndices,
    uniqueSourceColorIndices: Object.freeze(uniqueSourceColorIndices),
  });
}

function encodeColorSlotIndices(indices, bytesPerIndex) {
  const bytes = Buffer.alloc(indices.length * bytesPerIndex);
  for (let index = 0; index < indices.length; index += 1) {
    if (bytesPerIndex === 2) bytes.writeUInt16LE(indices[index], index * bytesPerIndex);
    else bytes.writeUInt32LE(indices[index], index * bytesPerIndex);
  }
  return bytes.toString("base64");
}

function validateSourceChunk(source) {
  if (source?.schema !== "csscyclone-source-sequence@2" ||
      !Array.isArray(source.frames) || source.frames.length < 1 ||
      source.frames.length !== source.bank?.frameCount ||
      source.frames.some((frame) => frame.particles?.length !== source.bank?.particleCount)) {
    throw new TypeError("Complete Cyclone source chunk is required for prepared lighting");
  }
}

function preparedPaletteHues(paletteFamily) {
  const centerHue = PALETTE_CENTER_HUES[paletteFamily];
  return Object.freeze([-1, 0, 1].map((offset) => {
    const hue = centerHue + offset / 6;
    return hue < 0 ? hue + 1 : hue >= 1 ? hue - 1 : hue;
  }));
}

export function prepareCyclonePaletteColor(baseColor, paletteFamily) {
  const maximum = Math.max(...baseColor);
  const minimum = Math.min(...baseColor);
  const chroma = maximum - minimum;
  const saturation = Math.max(
    PREPARED_MINIMUM_SATURATION,
    maximum > 0 ? chroma / maximum : 0,
  );
  let hue = 0;
  if (chroma > 1e-12) {
    if (maximum === baseColor[0]) hue = ((baseColor[1] - baseColor[2]) / chroma) % 6;
    else if (maximum === baseColor[1]) hue = (baseColor[2] - baseColor[0]) / chroma + 2;
    else hue = (baseColor[0] - baseColor[1]) / chroma + 4;
    hue = (hue / 6 + 1) % 1;
  }
  const hueSlotIndex = Math.min(
    CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount - 1,
    Math.floor(hue * CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount),
  );
  return hsvToRgb(
    preparedPaletteHues(paletteFamily)[hueSlotIndex],
    saturation,
    Math.max(PREPARED_MINIMUM_VALUE, maximum),
  );
}

function hsvToRgb(hue, saturation, value) {
  const sector = hue * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const minimum = value * (1 - saturation);
  const descending = value * (1 - fraction * saturation);
  const ascending = value * (1 - (1 - fraction) * saturation);
  return [
    [value, ascending, minimum],
    [descending, value, minimum],
    [minimum, value, ascending],
    [minimum, descending, value],
    [ascending, minimum, value],
    [value, minimum, descending],
  ][index];
}

function shadeVertex({ baseColor, normal }) {
  const diffuse = Math.max(0, dot(normal, LIGHT_DIRECTION));
  const specular = diffuse > 0
    ? Math.pow(Math.max(0, dot(normal, HALF_VECTOR)), 20)
    : 0;
  return [0, 1, 2].map((channel) => clampByte(
    (baseColor[channel] * 0.2 +
      baseColor[channel] * 0.25 +
      baseColor[channel] * diffuse +
      0.7 * specular) * 255,
  ));
}

function rgbHex(color) {
  return `#${color.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function inverseTranspose3(matrix) {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a12 * a20 - a10 * a22;
  const c02 = a10 * a21 - a11 * a20;
  const c10 = a02 * a21 - a01 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11;
  const c21 = a02 * a10 - a00 * a12;
  const c22 = a00 * a11 - a01 * a10;
  const determinant = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(determinant) < 1e-12) throw new Error("Cyclone particle normal matrix is singular");
  const inverseDeterminant = 1 / determinant;
  return [
    c00 * inverseDeterminant, c01 * inverseDeterminant, c02 * inverseDeterminant,
    c10 * inverseDeterminant, c11 * inverseDeterminant, c12 * inverseDeterminant,
    c20 * inverseDeterminant, c21 * inverseDeterminant, c22 * inverseDeterminant,
  ];
}

function transform3(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error("Cyclone lighting vector has no direction");
  return vector.map((value) => value / length);
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
