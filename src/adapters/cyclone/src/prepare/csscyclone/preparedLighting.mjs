import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  CSSCYCLONE_FACE_INDICES,
  CSSCYCLONE_FACE_TILE_VERTEX_ORDERS,
  CSSCYCLONE_PARTICLE_VERTICES,
} from "./modelBuilder.mjs";
import { CSSCYCLONE_PRESENTATION } from "./sourceModel.mjs";

const CONTENT_SIZE = 2;
const GUTTER = 1;
const SLOT_SIZE = CONTENT_SIZE + GUTTER * 2;
const UNPACKED_MAXIMUM_COLUMNS = 1_200;
const MAXIMUM_TEXTURE_DIMENSION = 8_192;
const DISPLAY_SCALE = 16;
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

export function createCyclonePreparedLightingStream({
  assetRoot = "/csscyclone/assets",
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
    if (particleCount === null || frozenVertexNormals === null || colorStates.length === 0) {
      throw new Error("Prepared Cyclone lighting stream has no source chunks");
    }
    if (!allowPartial && nextChunkIndex !== expectedChunkCount) {
      throw new Error(`Prepared Cyclone lighting stream has ${nextChunkIndex}/${expectedChunkCount} chunks`);
    }
    return buildPreparedLightingAsset({
      assetRoot,
      particleCount,
      chunkCount: nextChunkIndex,
      chunkFrameCount,
      streamId,
      sourceStreamFrameCount,
      frozenVertexNormals,
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
    frozenVertexNormals = source.frames[0].particles.map((particle) => {
      const normalMatrix = inverseTranspose3(particle.matrix);
      return CSSCYCLONE_PARTICLE_VERTICES.map((vertex) =>
        transform3(normalMatrix, normalize(vertex)));
    });
  }

  return Object.freeze({ add, finalize });
}

export async function buildCyclonePreparedLighting({ source, assetRoot }) {
  const stream = createCyclonePreparedLightingStream({ assetRoot });
  const chunk = stream.add(source);
  const prepared = await stream.finalize({ allowPartial: true });
  return Object.freeze({ ...prepared, chunk });
}

async function buildPreparedLightingAsset({
  assetRoot,
  particleCount,
  chunkCount,
  chunkFrameCount,
  streamId,
  sourceStreamFrameCount,
  frozenVertexNormals,
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
  const unpackedColumns = Math.min(UNPACKED_MAXIMUM_COLUMNS, tileCount);
  const unpackedRows = Math.ceil(tileCount / unpackedColumns);
  const unpackedWidth = unpackedColumns * SLOT_SIZE;
  const unpackedHeight = unpackedRows * SLOT_SIZE;
  const unpackedVariants = [];
  for (const paletteFamily of CSSCYCLONE_PRESENTATION.startupPaletteFamilies) {
    const hueSlots = preparedPaletteHues(paletteFamily);
    const rgba = Buffer.alloc(unpackedWidth * unpackedHeight * 4);
    for (let stateIndex = 0; stateIndex < colorStates.length; stateIndex += 1) {
      const state = colorStates[stateIndex];
      const baseColor = prepareCyclonePaletteColor(state.baseColor, paletteFamily);
      const vertexColors = frozenVertexNormals[state.particleIndex].map((normal) => shadeVertex({
        baseColor,
        normal,
      }));
      for (let faceIndex = 0; faceIndex < CSSCYCLONE_FACE_INDICES.length; faceIndex += 1) {
        const faceVertexIndices = CSSCYCLONE_FACE_INDICES[faceIndex];
        writeAffineFaceTile({
          rgba,
          width: unpackedWidth,
          columns: unpackedColumns,
          tileIndex: stateIndex * CSSCYCLONE_FACE_INDICES.length + faceIndex,
          vertexColors,
          vertexIndices: CSSCYCLONE_FACE_TILE_VERTEX_ORDERS[faceIndex]
            .map((index) => faceVertexIndices[index]),
        });
      }
    }
    unpackedVariants.push(Object.freeze({ paletteFamily, hueSlots, rgba }));
  }
  const deduplication = deduplicateExactCrossVariantTiles(
    unpackedVariants.map((variant) => variant.rgba),
    { width: unpackedWidth, columns: unpackedColumns, tileCount },
  );
  const uniqueTileCount = deduplication.uniqueSourceTileIndices.length;
  const columns = Math.ceil(Math.sqrt(uniqueTileCount));
  const rows = Math.ceil(uniqueTileCount / columns);
  const width = columns * SLOT_SIZE;
  const height = rows * SLOT_SIZE;
  if (width > MAXIMUM_TEXTURE_DIMENSION || height > MAXIMUM_TEXTURE_DIMENSION) {
    throw new Error(`Prepared Cyclone lighting atlas ${width}x${height} exceeds the image contract`);
  }
  const assets = [];
  for (const variant of unpackedVariants) {
    const rgba = packUniqueTiles(variant.rgba, {
      sourceWidth: unpackedWidth,
      sourceColumns: unpackedColumns,
      uniqueSourceTileIndices: deduplication.uniqueSourceTileIndices,
      targetWidth: width,
      targetColumns: columns,
      targetHeight: height,
    });
    const bytes = await sharp(rgba, {
      raw: { width, height, channels: 4 },
      limitInputPixels: false,
    }).webp({ lossless: true, effort: 6 }).toBuffer();
    const assetSha256 = createHash("sha256").update(bytes).digest("hex");
    assets.push(Object.freeze({
      paletteFamily: variant.paletteFamily,
      assetUrl: `${assetRoot}/lighting-${variant.paletteFamily}-${assetSha256}.webp`,
      assetSha256,
      byteLength: bytes.byteLength,
      hueSlots: variant.hueSlots,
      bytes,
    }));
  }
  const tileBackgroundPositions = Object.freeze(Array.from({ length: tileCount }, (_, tileIndex) => {
    const slotIndex = deduplication.tileSlotIndices[tileIndex];
    const contentX = slotIndex % columns * SLOT_SIZE + GUTTER;
    const contentY = Math.floor(slotIndex / columns) * SLOT_SIZE + GUTTER;
    return `${-contentX * DISPLAY_SCALE}px ${-contentY * DISPLAY_SCALE}px`;
  }));
  const contract = deepFreeze({
    schema: "csscyclone-prepared-smooth-lighting-atlas@7",
    technique: "prepared-session-three-family-lighting-variants-with-dark-color-floor-sparse-source-color-restarts-and-exact-tile-deduplication",
    source: "src/cyclone/cyclone.cpp#particle::update+initSaver",
    streamId,
    encoding: "WebP-lossless-RGBA8",
    mimeType: "image/webp",
    lossless: true,
    width,
    height,
    decodedBytes: width * height * 4,
    paletteFamilyCount: CSSCYCLONE_PRESENTATION.startupPaletteFamilies.length,
    paletteFamilies: CSSCYCLONE_PRESENTATION.startupPaletteFamilies,
    paletteHueSlotCount: CSSCYCLONE_PRESENTATION.preparedPaletteHueSlotCount,
    paletteAssignment: CSSCYCLONE_PRESENTATION.preparedPaletteAssignment,
    preparedMinimumSaturation: PREPARED_MINIMUM_SATURATION,
    preparedMinimumValue: PREPARED_MINIMUM_VALUE,
    maximumColorFamilyCount: CSSCYCLONE_PRESENTATION.maximumColorFamilyCount,
    variants: Object.freeze(assets.map(({ bytes: ignored, ...asset }) => Object.freeze(asset))),
    contentSize: CONTENT_SIZE,
    gutterPixels: GUTTER,
    slotSize: SLOT_SIZE,
    columns,
    rows,
    tileCount,
    uniqueTileCount,
    deduplicatedTileCount: tileCount - uniqueTileCount,
    tileDeduplication: "exact-cross-palette-rgba8-slot-content",
    packing: "near-square-row-major-unique-slots",
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
    displayScale: DISPLAY_SCALE,
    sampling: "two-by-two-affine-field-with-one-extrapolated-sample-gutter",
    interpolation: "browser-perspective-transformed-stream-frame-zero-smooth-vertex-color-field",
    backgroundSize: `${width * DISPLAY_SCALE}px ${height * DISPLAY_SCALE}px`,
    tileBackgroundPositions,
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
      atlasConstruction: 0,
      lightingCalculations: 0,
      colorCalculations: 0,
      rootLightingRowWritesPerSample: 0,
      maximumSparseLeafWritesPerParticleRestart: CSSCYCLONE_FACE_INDICES.length,
      topologyMutation: false,
    }),
  });
  return Object.freeze({
    contract,
    assets: Object.freeze(assets),
    metrics: Object.freeze({
      preparedLightingChunkCount: chunkCount,
      preparedLightingStreamFrameCount: sourceStreamFrameCount,
      preparedLightingColorStateCount: colorStates.length,
      preparedLightingColorRestartCount: colorRestartCount,
      preparedLightingLogicalTileCount: tileCount,
      preparedLightingUniqueTileCount: uniqueTileCount,
      preparedLightingDeduplicatedTileCount: tileCount - uniqueTileCount,
      preparedLightingPaletteVariantCount: assets.length,
      preparedLightingAtlasBytes: assets.reduce((sum, asset) => sum + asset.byteLength, 0),
      preparedLightingMaximumVariantAtlasBytes: Math.max(...assets.map((asset) => asset.byteLength)),
      preparedLightingAtlasDecodedBytes: contract.decodedBytes,
      preparedLightingLeafBindingCount: leafCount,
      runtimeLightingCalculations: 0,
      runtimeLightingAtlasConstruction: 0,
      runtimeLightingWritesPerSample: 0,
    }),
  });
}

function deduplicateExactCrossVariantTiles(variantRgba, { width, columns, tileCount }) {
  if (!Array.isArray(variantRgba) || variantRgba.length < 1) {
    throw new Error("Cyclone lighting tile deduplication requires every palette variant");
  }
  const tileByteLength = SLOT_SIZE * SLOT_SIZE * 4;
  const signatureBytes = Buffer.alloc(tileByteLength * variantRgba.length);
  const slotBySignature = new Map();
  const tileSlotIndices = new Uint32Array(tileCount);
  const uniqueSourceTileIndices = [];
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    for (let variantIndex = 0; variantIndex < variantRgba.length; variantIndex += 1) {
      copyTileToLinear(
        variantRgba[variantIndex],
        width,
        columns,
        tileIndex,
        signatureBytes,
        variantIndex * tileByteLength,
      );
    }
    const signature = signatureBytes.toString("base64");
    let slotIndex = slotBySignature.get(signature);
    if (slotIndex === undefined) {
      slotIndex = uniqueSourceTileIndices.length;
      slotBySignature.set(signature, slotIndex);
      uniqueSourceTileIndices.push(tileIndex);
    }
    tileSlotIndices[tileIndex] = slotIndex;
  }
  return Object.freeze({
    tileSlotIndices,
    uniqueSourceTileIndices: Object.freeze(uniqueSourceTileIndices),
  });
}

function packUniqueTiles(source, {
  sourceWidth,
  sourceColumns,
  uniqueSourceTileIndices,
  targetWidth,
  targetColumns,
  targetHeight,
}) {
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let slotIndex = 0; slotIndex < uniqueSourceTileIndices.length; slotIndex += 1) {
    copyAtlasTile({
      source,
      sourceWidth,
      sourceColumns,
      sourceTileIndex: uniqueSourceTileIndices[slotIndex],
      target,
      targetWidth,
      targetColumns,
      targetTileIndex: slotIndex,
    });
  }
  return target;
}

function copyTileToLinear(source, sourceWidth, sourceColumns, sourceTileIndex, target, targetOffset) {
  const sourceX = sourceTileIndex % sourceColumns * SLOT_SIZE;
  const sourceY = Math.floor(sourceTileIndex / sourceColumns) * SLOT_SIZE;
  const rowByteLength = SLOT_SIZE * 4;
  for (let localY = 0; localY < SLOT_SIZE; localY += 1) {
    const sourceOffset = ((sourceY + localY) * sourceWidth + sourceX) * 4;
    source.copy(
      target,
      targetOffset + localY * rowByteLength,
      sourceOffset,
      sourceOffset + rowByteLength,
    );
  }
}

function copyAtlasTile({
  source,
  sourceWidth,
  sourceColumns,
  sourceTileIndex,
  target,
  targetWidth,
  targetColumns,
  targetTileIndex,
}) {
  const sourceX = sourceTileIndex % sourceColumns * SLOT_SIZE;
  const sourceY = Math.floor(sourceTileIndex / sourceColumns) * SLOT_SIZE;
  const targetX = targetTileIndex % targetColumns * SLOT_SIZE;
  const targetY = Math.floor(targetTileIndex / targetColumns) * SLOT_SIZE;
  const rowByteLength = SLOT_SIZE * 4;
  for (let localY = 0; localY < SLOT_SIZE; localY += 1) {
    const sourceOffset = ((sourceY + localY) * sourceWidth + sourceX) * 4;
    const targetOffset = ((targetY + localY) * targetWidth + targetX) * 4;
    source.copy(target, targetOffset, sourceOffset, sourceOffset + rowByteLength);
  }
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

function writeAffineFaceTile({
  rgba,
  width,
  columns,
  tileIndex,
  vertexColors,
  vertexIndices,
}) {
  const originX = tileIndex % columns * SLOT_SIZE;
  const originY = Math.floor(tileIndex / columns) * SLOT_SIZE;
  for (let localY = -GUTTER; localY < CONTENT_SIZE + GUTTER; localY += 1) {
    const v = (localY + 0.5) / CONTENT_SIZE;
    for (let localX = -GUTTER; localX < CONTENT_SIZE + GUTTER; localX += 1) {
      const u = (localX + 0.5) / CONTENT_SIZE;
      const weights = vertexIndices.length === 3
        ? triangleWeights(u, v)
        : vertexIndices.length === 4
        ? quadWeights(u, v)
        : null;
      if (weights === null) throw new Error("Cyclone lighting face must be a triangle or quad");
      const color = [0, 1, 2].map((channel) => clampByte(weights.reduce(
        (sum, weight, index) => sum + vertexColors[vertexIndices[index]][channel] * weight,
        0,
      )));
      const x = originX + localX + GUTTER;
      const y = originY + localY + GUTTER;
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
    }
  }
}

function triangleWeights(u, v) {
  const apex = 1 - v;
  const right = u - 0.5 * apex;
  return [apex, 1 - apex - right, right];
}

function quadWeights(u, v) {
  return [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
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
