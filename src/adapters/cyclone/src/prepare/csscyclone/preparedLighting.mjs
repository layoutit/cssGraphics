import {
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_PARTICLE_VERTICES,
} from "./modelBuilder.mjs";
import { CSSCYCLONE_PRESENTATION } from "./sourceModel.mjs";

const PREPARED_MINIMUM_SATURATION = CSSCYCLONE_PRESENTATION.minimumSaturation;
const PREPARED_MINIMUM_VALUE = 0.75;
const PREPARED_DARK_FACE_LIGHTNESS = 0.45;
const PREPARED_MAXIMUM_DARK_FACE_SHARE = 0.2;
const PREPARED_MINIMUM_MEDIAN_LIGHTNESS = 0.6;
const PREPARED_SRGB_EXPOSURE = 1.4;
const PREPARED_THIRD_HUE_SHARE = 0.2;
const SOURCE_VERTEX_NORMALS = Object.freeze(
  CSSCYCLONE_PARTICLE_VERTICES.map((vertex) => Object.freeze(normalize(vertex))),
);
const LIGHT_DIRECTION = normalize([400, -200, 400]);
const HALF_VECTOR = normalize([
  LIGHT_DIRECTION[0],
  LIGHT_DIRECTION[1],
  LIGHT_DIRECTION[2] + 1,
]);

export function createCyclonePreparedLightingStream({
  enforceFinalColorProfile = true,
} = {}) {
  let particleCount = null;
  let expectedChunkCount = null;
  let chunkFrameCount = null;
  let streamId = null;
  let nextChunkIndex = 0;
  let sourceStreamFrameCount = 0;
  let frozenVertexNormals = null;
  let currentColorStateIndices = null;
  let previousColors = null;
  let colorRestartCount = 0;
  const colorStates = [];
  const colorStateOccurrenceCounts = [];

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
          colorStateOccurrenceCounts.push(0);
          previousColors[particleIndex] = particle.color;
        }
        const stateIndex = currentColorStateIndices[particleIndex];
        colorStateOccurrenceCounts[stateIndex] += 1;
        return stateIndex;
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
    if (particleCount === null || frozenVertexNormals === null || colorStates.length === 0) {
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
      frozenVertexNormals,
      colorStates,
      colorStateOccurrenceCounts,
      colorRestartCount,
      enforceFinalColorProfile: enforceFinalColorProfile && !allowPartial,
    });
  }

  function initialize(source) {
    particleCount = source.bank.particleCount;
    expectedChunkCount = source.bank.chunkCount;
    chunkFrameCount = source.bank.frameCount;
    streamId = source.bank.streamId;
    currentColorStateIndices = Array(particleCount).fill(-1);
    previousColors = Array(particleCount).fill(null);
    frozenVertexNormals = source.frames[0].particles.map((particle) => {
      const normalMatrix = inverseTranspose3(particle.matrix);
      return SOURCE_VERTEX_NORMALS.map((normal) => transform3(normalMatrix, normal));
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
  frozenVertexNormals,
  colorStates,
  colorStateOccurrenceCounts,
  colorRestartCount,
  enforceFinalColorProfile,
}) {
  const leafCount = particleCount * CSSCYCLONE_FACE_INDICES.length;
  const tileCount = colorStates.length * CSSCYCLONE_FACE_INDICES.length;
  const colorEntryWeights = colorStateOccurrenceCounts.flatMap((count) =>
    Array(CSSCYCLONE_FACE_INDICES.length).fill(count));
  const colorEntryHueIndices = colorStates.flatMap((state) =>
    Array(CSSCYCLONE_FACE_INDICES.length).fill(preparedPaletteHueIndex(state.baseColor)));
  const paletteVariants = CSSCYCLONE_PRESENTATION.preparedPaletteVariants;
  if (!Array.isArray(paletteVariants) || paletteVariants.length !== 12 ||
      new Set(paletteVariants.map(({ id }) => id)).size !== paletteVariants.length ||
      paletteVariants.some(({ id, hueRotation, preparedHues }, index) =>
        id !== `rotate-${String(index * 30).padStart(3, "0")}` ||
        hueRotation !== index / paletteVariants.length ||
        preparedHues?.length !== 3 ||
        new Set(preparedHues).size !== preparedHues.length ||
        preparedHues.some((hue) => typeof hue !== "number" || hue < 0 || hue >= 1))) {
    throw new Error("Cyclone curated prepared palette configuration drifted");
  }
  const sourceLitVariants = paletteVariants.map((paletteVariant) => {
    const colors = [];
    for (let stateIndex = 0; stateIndex < colorStates.length; stateIndex += 1) {
      const state = colorStates[stateIndex];
      const baseColor = prepareCyclonePaletteColor(state.baseColor, paletteVariant.id);
      const vertexColors = frozenVertexNormals[state.particleIndex].map((normal) => shadeVertex({
        baseColor,
        normal,
      }));
      for (let faceIndex = 0; faceIndex < CSSCYCLONE_FACE_INDICES.length; faceIndex += 1) {
        const sourceLitColor = averageVertexColors(
          vertexColors,
          CSSCYCLONE_FACE_INDICES[faceIndex],
        );
        colors.push(sourceLitColor);
      }
    }
    return Object.freeze({
      paletteVariantId: paletteVariant.id,
      hueRotation: paletteVariant.hueRotation,
      preparedHues: paletteVariant.preparedHues,
      colors: Object.freeze(colors),
    });
  });
  const exposedVariants = sourceLitVariants.map((variant) => Object.freeze({
    ...variant,
    colors: Object.freeze(variant.colors.map((color) =>
      exposeSrgb(color, PREPARED_SRGB_EXPOSURE))),
  }));
  const targetMedianLightness = Math.max(...exposedVariants.map((variant) =>
    weightedMedian(variant.colors.map(oklabLightness), colorEntryWeights)));
  const logicalVariants = exposedVariants.map((variant) => {
    const lightnessLifts = [0, 1, 2].map((hueIndex) => {
      const groupColors = variant.colors.filter((unused, index) =>
        colorEntryHueIndices[index] === hueIndex);
      if (groupColors.length === 0) return 0;
      const groupWeights = colorEntryWeights.filter((unused, index) =>
        colorEntryHueIndices[index] === hueIndex);
      return Math.max(
        0,
        targetMedianLightness - weightedMedian(groupColors.map(oklabLightness), groupWeights),
      );
    });
    const colors = variant.colors.map((color, index) => rgbHex(
      liftOklabLightness(color, lightnessLifts[colorEntryHueIndices[index]]),
    ));
    return Object.freeze({
      paletteVariantId: variant.paletteVariantId,
      hueRotation: variant.hueRotation,
      preparedHues: variant.preparedHues,
      lightnessLifts: Object.freeze(lightnessLifts),
      colors: Object.freeze(colors),
    });
  });
  const finalLitColorProfile = buildFinalLitColorProfile(
    logicalVariants,
    colorEntryWeights,
    enforceFinalColorProfile,
  );
  const deduplication = deduplicateExactCrossVariantColors(logicalVariants, tileCount);
  const uniqueColorCount = deduplication.uniqueSourceColorIndices.length;
  const colorSlotIndexBytes = uniqueColorCount <= 0xffff ? 2 : 4;
  const colorSlotIndicesBase64 = encodeColorSlotIndices(
    deduplication.colorSlotIndices,
    colorSlotIndexBytes,
  );
  const variants = logicalVariants.map((variant) => Object.freeze({
    paletteVariantId: variant.paletteVariantId,
    hueRotation: variant.hueRotation,
    preparedHues: variant.preparedHues,
    colors: Object.freeze(deduplication.uniqueSourceColorIndices.map((index) =>
      variant.colors[index])),
  }));
  const contract = deepFreeze({
    schema: "csscyclone-prepared-source-lit-three-color-vertex-lighting-colors@21",
    technique: "prepared-source-smooth-vertex-lighting-averaged-per-solid-face-with-curated-three-color-analogous-session-palettes-srgb-exposure-oklab-lightness-normalization-sparse-source-color-restarts-and-exact-cross-variant-deduplication",
    source: "src/cyclone/cyclone.cpp#particle::update+initSaver",
    streamId,
    encoding: "CSS-sRGB-hex-plus-little-endian-color-slot-indices-base64",
    lossless: true,
    paletteVariantCount: paletteVariants.length,
    paletteVariantIds: Object.freeze(paletteVariants.map(({ id }) => id)),
    paletteAssignment: CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
    preparedMinimumSaturation: PREPARED_MINIMUM_SATURATION,
    preparedMinimumValue: PREPARED_MINIMUM_VALUE,
    finalLitColorProfile,
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
    sampling: "three-source-smooth-vertex-light-samples-averaged-per-solid-face-state",
    interpolation: "browser-solid-face-average-of-stream-frame-zero-source-vertex-lighting",
    material: Object.freeze({
      ambientAndDiffuse: "prepared-session-three-color-analogous-palette",
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

export function prepareCyclonePaletteColor(baseColor, paletteVariantId) {
  const paletteVariant = CSSCYCLONE_PRESENTATION.preparedPaletteVariants.find(({ id }) =>
    id === paletteVariantId);
  if (!paletteVariant) throw new RangeError("Cyclone prepared palette variant is invalid");
  const maximum = Math.max(...baseColor);
  const minimum = Math.min(...baseColor);
  const chroma = maximum - minimum;
  const saturation = Math.max(
    PREPARED_MINIMUM_SATURATION,
    maximum > 0 ? chroma / maximum : 0,
  );
  const preparedHueIndex = preparedPaletteHueIndex(baseColor);
  return hsvToRgb(
    paletteVariant.preparedHues[preparedHueIndex],
    saturation,
    Math.max(PREPARED_MINIMUM_VALUE, maximum),
  );
}

function preparedPaletteHueIndex(baseColor) {
  const maximum = Math.max(...baseColor);
  const minimum = Math.min(...baseColor);
  const chroma = maximum - minimum;
  let hue = 0;
  if (chroma > 1e-12) {
    if (maximum === baseColor[0]) hue = ((baseColor[1] - baseColor[2]) / chroma) % 6;
    else if (maximum === baseColor[1]) hue = (baseColor[2] - baseColor[0]) / chroma + 2;
    else hue = (baseColor[0] - baseColor[1]) / chroma + 4;
    hue = (hue / 6 + 1) % 1;
  }
  const primaryShare = (1 - PREPARED_THIRD_HUE_SHARE) / 2;
  return hue < primaryShare ? 0 : hue < primaryShare * 2 ? 1 : 2;
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

function averageVertexColors(vertexColors, vertexIndices) {
  return [0, 1, 2].map((channel) => clampByte(
    vertexIndices.reduce((sum, vertexIndex) =>
      sum + vertexColors[vertexIndex][channel], 0) / vertexIndices.length,
  ));
}

function exposeSrgb(color, exposure) {
  return color.map((channel) => Math.min(255, Math.ceil(channel * exposure)));
}

function buildFinalLitColorProfile(variants, colorEntryWeights, enforce) {
  const profiles = variants.map((variant) => {
    const lightnesses = variant.colors.map((color) => oklabLightness(parseHex(color)));
    const totalWeight = colorEntryWeights.reduce((sum, weight) => sum + weight, 0);
    const darkFaceWeight = lightnesses.reduce((sum, lightness, index) =>
      sum + (lightness < PREPARED_DARK_FACE_LIGHTNESS ? colorEntryWeights[index] : 0), 0);
    return Object.freeze({
      paletteVariantId: variant.paletteVariantId,
      medianLightness: roundMetric(weightedMedian(lightnesses, colorEntryWeights)),
      darkFaceShare: roundMetric(darkFaceWeight / totalWeight),
      lightnessLifts: Object.freeze(variant.lightnessLifts.map(roundMetric)),
    });
  });
  const invalidProfiles = profiles.filter((profile) =>
    profile.medianLightness < PREPARED_MINIMUM_MEDIAN_LIGHTNESS ||
    profile.darkFaceShare > PREPARED_MAXIMUM_DARK_FACE_SHARE);
  if (enforce && invalidProfiles.length > 0) {
    throw new Error(`Prepared Cyclone final lit colors are too dark: ${JSON.stringify(invalidProfiles)}`);
  }
  return deepFreeze({
    schema: "csscyclone-prepared-final-lit-color-profile@4",
    metric: "OKLab-lightness",
    normalization: "publication-weighted-groupwise-additive-lightness-to-brightest-variant-median-with-chroma-gamut-mapping",
    darkFaceLightnessThreshold: PREPARED_DARK_FACE_LIGHTNESS,
    maximumDarkFaceShare: PREPARED_MAXIMUM_DARK_FACE_SHARE,
    minimumMedianLightness: PREPARED_MINIMUM_MEDIAN_LIGHTNESS,
    srgbExposure: PREPARED_SRGB_EXPOSURE,
    targetMedianLightness: roundMetric(Math.max(...profiles.map(({ medianLightness }) =>
      medianLightness))),
    variants: profiles,
  });
}

function liftOklabLightness(color, lightnessLift) {
  const [lightness, a, b] = oklabFromSrgb(color);
  const target = [Math.min(1, lightness + lightnessLift), a, b];
  let mapped = srgbFromOklab(target);
  if (mapped.every((channel) => channel >= 0 && channel <= 255)) {
    return mapped.map(clampByte);
  }
  let lower = 0;
  let upper = 1;
  for (let step = 0; step < 16; step += 1) {
    const scale = (lower + upper) / 2;
    const candidate = srgbFromOklab([target[0], a * scale, b * scale]);
    if (candidate.every((channel) => channel >= 0 && channel <= 255)) {
      lower = scale;
      mapped = candidate;
    } else {
      upper = scale;
    }
  }
  return mapped.map(clampByte);
}

function oklabLightness(color) {
  return oklabFromSrgb(color)[0];
}

function oklabFromSrgb(color) {
  const [red, green, blue] = color.map((channel) => linearSrgb(channel / 255));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function srgbFromOklab([lightness, a, b]) {
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.291485548 * b;
  const linearL = l ** 3;
  const linearM = m ** 3;
  const linearS = s ** 3;
  return [
    encodedSrgb(4.0767416621 * linearL - 3.3077115913 * linearM + 0.2309699292 * linearS),
    encodedSrgb(-1.2684380046 * linearL + 2.6097574011 * linearM - 0.3413193965 * linearS),
    encodedSrgb(-0.0041960863 * linearL - 0.7034186147 * linearM + 1.707614701 * linearS),
  ];
}

function linearSrgb(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function encodedSrgb(channel) {
  return 255 * (channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * channel ** (1 / 2.4) - 0.055);
}

function parseHex(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function weightedMedian(values, weights) {
  if (values.length < 1 || values.length !== weights.length ||
      weights.some((weight) => !Number.isSafeInteger(weight) || weight < 1)) {
    throw new Error("Cyclone lightness normalization requires positive publication weights");
  }
  const entries = values.map((value, index) => [value, weights[index]])
    .sort(([left], [right]) => left - right);
  const midpoint = weights.reduce((sum, weight) => sum + weight, 0) / 2;
  let cumulative = 0;
  for (const [value, weight] of entries) {
    cumulative += weight;
    if (cumulative >= midpoint) return value;
  }
  return entries.at(-1)[0];
}

function roundMetric(value) {
  return Number(value.toFixed(6));
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
