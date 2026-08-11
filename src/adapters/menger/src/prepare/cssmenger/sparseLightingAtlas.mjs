import { createHash } from "node:crypto";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import sharp from "sharp";
import {
  preparedSourceFaceNormal,
  preparedSourceFaceVertices,
} from "./mengerGeometry.mjs";

const GUTTER = 0;
export const DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS = 2;
export const MOBILE_LIGHTING_SAMPLE_INTERVAL_TICKS = 1_440;
const MAXIMUM_TEXTURE_DIMENSION = 16_384;
const preparedBytes = new WeakMap();

export async function buildPreparedMengerSparseLightingAtlas({
  geometry,
  playback,
  frontFacingSchedule,
  lightingSampleIntervalTicks = DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS,
  profile = "desktop",
}) {
  if (!geometry?.metrics?.sourceFaceCoverageExact || !Array.isArray(geometry.bundles) ||
      playback?.schema !== "cssmenger-prepared-playback@1" ||
      !Array.isArray(playback.nativeRotationDegrees) ||
      playback.nativeRotationDegrees.length !== playback.stateCount ||
      frontFacingSchedule?.schema !== "cssmenger-prepared-front-facing-leaf-schedule@1" ||
      frontFacingSchedule.stateCount !== playback.stateCount ||
      frontFacingSchedule.offsets?.length !== playback.stateCount * 3 + 1 ||
      frontFacingSchedule.offsets.at(-1) !== frontFacingSchedule.leafIndices?.length ||
      ![DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS, MOBILE_LIGHTING_SAMPLE_INTERVAL_TICKS]
        .includes(lightingSampleIntervalTicks) ||
      !["desktop", "mobile"].includes(profile)) {
    throw new TypeError("Complete cssMenger geometry, playback, and front-facing schedule are required");
  }
  const tileWidth = geometry.cellsPerAxis;
  const tileHeight = geometry.cellsPerAxis;
  const slotWidth = tileWidth + GUTTER * 2;
  const slotHeight = tileHeight + GUTTER * 2;
  const visibleLeafFieldCount = frontFacingSchedule.leafIndices.length;

  const polygonByLeaf = new Map(geometry.meshes.flatMap((mesh) => mesh.polygons).map((polygon) => [
    Number(polygon.data["cssmenger-plane-leaf"]),
    polygon,
  ]));
  const layouts = geometry.bundles.map((bundle) => prepareBundleLayout({
    bundle,
    polygon: polygonByLeaf.get(bundle.bundleIndex),
    geometry,
    tileWidth,
    tileHeight,
  }));
  const fields = [];
  for (let stateIndex = 0; stateIndex < playback.stateCount; stateIndex += 1) {
    for (let axis = 0; axis < frontFacingSchedule.axisCount; axis += 1) {
      const segment = stateIndex * frontFacingSchedule.axisCount + axis;
      const start = frontFacingSchedule.offsets[segment];
      const end = frontFacingSchedule.offsets[segment + 1];
      for (let cursor = start; cursor < end; cursor += 1) {
        fields.push({ cursor, leafIndex: frontFacingSchedule.leafIndices[cursor], stateIndex });
      }
    }
  }
  fields.sort((left, right) => left.leafIndex - right.leafIndex || left.stateIndex - right.stateIndex);
  const slotByScheduleCursor = new Uint16Array(visibleLeafFieldCount);
  const uniqueTiles = [];
  const slotsBySha256 = new Map();
  for (const field of fields) {
    const lightingStateIndex = field.stateIndex - field.stateIndex % lightingSampleIntervalTicks;
    const tile = Buffer.alloc(tileWidth * tileHeight * 4);
    writeLightingTile({
      rgba: tile,
      width: tileWidth,
      slotIndex: 0,
      columns: 1,
      stateIndex: lightingStateIndex,
      playback,
      layout: layouts[field.leafIndex],
      tileWidth,
      tileHeight,
      slotWidth: tileWidth,
      slotHeight: tileHeight,
    });
    const tileSha256 = createHash("sha256").update(tile).digest("hex");
    const candidates = slotsBySha256.get(tileSha256) ?? [];
    let slotIndex = candidates.find((candidate) => uniqueTiles[candidate].equals(tile));
    if (slotIndex === undefined) {
      slotIndex = uniqueTiles.length;
      uniqueTiles.push(tile);
      candidates.push(slotIndex);
      slotsBySha256.set(tileSha256, candidates);
    }
    slotByScheduleCursor[field.cursor] = slotIndex;
  }
  const slotCount = uniqueTiles.length;
  const columns = Math.min(slotCount, Math.floor(MAXIMUM_TEXTURE_DIMENSION / slotWidth));
  const rows = Math.ceil(slotCount / columns);
  const width = columns * slotWidth;
  const height = rows * slotHeight;
  if (width > MAXIMUM_TEXTURE_DIMENSION || height > MAXIMUM_TEXTURE_DIMENSION) {
    throw new Error(`Prepared cssMenger sparse lighting grid ${width}x${height} exceeds the AVIF contract`);
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let slotIndex = 0; slotIndex < uniqueTiles.length; slotIndex += 1) {
    copyTileIntoAtlas({
      rgba,
      width,
      tile: uniqueTiles[slotIndex],
      slotIndex,
      columns,
      tileWidth,
      tileHeight,
      slotWidth,
      slotHeight,
    });
  }
  const addressSchedule = prepareExactDeltaAddressSchedule({
    playback,
    frontFacingSchedule,
    slotByScheduleCursor,
    leafCount: geometry.bundles.length,
  });
  const addressStateOffsetBytes = u16leBytes(addressSchedule.offsets);
  const addressLeafIndexBytes = Buffer.from(addressSchedule.leafIndices);
  const addressSlotIndexBytes = u16leBytes(addressSchedule.slotIndices);
  const addressSha256 = createHash("sha256")
    .update(addressStateOffsetBytes)
    .update(addressLeafIndexBytes)
    .update(addressSlotIndexBytes)
    .digest("hex");
  const bytes = await sharp(rgba, {
    raw: { width, height, channels: 4 },
    limitInputPixels: false,
  }).avif({ quality: 83, effort: 6, chromaSubsampling: "4:4:4" }).toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const contract = Object.freeze({
    schema: "cssmenger-prepared-sparse-leaf-lighting-atlas@1",
    technique: `exact-deduplicated-one-source-cell-texel-per-visible-coplanar-leaf-held-${lightingSampleIntervalTicks}-source-ticks-addressed-by-front-facing-schedule-cursor`,
    profile,
    assetUrl: `/cssmenger/assets/lighting-grid${profile === "mobile" ? "-mobile" : ""}-${sha256}.avif`,
    assetSha256: sha256,
    encoding: "AVIF-lossy-q83-alpha-lossless-yuv444",
    mimeType: "image/avif",
    quality: 83,
    alphaQuality: 100,
    chromaSubsampling: "4:4:4",
    exactPreparedPixels: false,
    width,
    height,
    decodedBytes: width * height * 4,
    byteLength: bytes.length,
    tileWidth,
    tileHeight,
    slotWidth,
    slotHeight,
    columns,
    rows,
    gutterPixels: GUTTER,
    slotCount,
    addressEncoding: "base64-u16le-state-offsets-plus-u8-leaf-indices-plus-u16le-exact-deduplicated-slot-indices",
    addressScheduleSchema: "cssmenger-prepared-exact-delta-lighting-address-schedule@1",
    addressScheduleSha256: addressSha256,
    addressStateOffsetByteLength: addressStateOffsetBytes.length,
    addressStateOffsetsBase64: addressStateOffsetBytes.toString("base64"),
    addressLeafIndexByteLength: addressLeafIndexBytes.length,
    addressLeafIndicesBase64: addressLeafIndexBytes.toString("base64"),
    addressSlotIndexByteLength: addressSlotIndexBytes.length,
    addressSlotIndicesBase64: addressSlotIndexBytes.toString("base64"),
    addressUpdateCount: addressSchedule.updateCount,
    addressWriteCountPerState: Object.freeze({
      minimum: addressSchedule.minimumWriteCountPerState,
      maximum: addressSchedule.maximumWriteCountPerState,
      average: addressSchedule.averageWriteCountPerState,
      zeroWriteStateCount: addressSchedule.zeroWriteStateCount,
    }),
    redundantAddressWriteCountRemoved: visibleLeafFieldCount - addressSchedule.updateCount,
    redundantAddressWriteRatio:
      (visibleLeafFieldCount - addressSchedule.updateCount) / visibleLeafFieldCount,
    atlasFieldOrder: "first-unique-byte-exact-tile-in-leaf-index-then-source-state-index-order",
    tileDeduplication: "sha256-candidate-then-byte-for-byte-rgba-equality",
    exactUniqueTileCount: slotCount,
    exactDuplicateTileCount: visibleLeafFieldCount - slotCount,
    exactTileDeduplicationRatio: (visibleLeafFieldCount - slotCount) / visibleLeafFieldCount,
    lightingSampleIntervalTicks,
    lightingSampleDelayMilliseconds:
      playback.sourceFrameDelayMilliseconds * lightingSampleIntervalTicks,
    lightingSampleCount: Math.ceil(playback.stateCount / lightingSampleIntervalTicks),
    transformPublicationIntervalTicks: 1,
    transformPublicationDelayMilliseconds: playback.sourceFrameDelayMilliseconds,
    imageRendering: "pixelated",
    leafCount: geometry.bundles.length,
    sourceFaceCount: geometry.metrics.sourcePolygonCount,
    sourceFaceCoverageCount: geometry.metrics.sourceFaceCoverageCount,
    sourceFaceCoverageExact: true,
    sourceStateCount: playback.stateCount,
    visibleLeafFieldCount,
    fullLeafFieldCount: playback.stateCount * geometry.bundles.length,
    omittedBackFacingLeafFieldCount: playback.stateCount * geometry.bundles.length - visibleLeafFieldCount,
    runtime: Object.freeze({
      geometryConstruction: 0,
      atlasConstruction: 0,
      lightingCalculations: 0,
      colorCalculations: 0,
      addressSelection: "prepared-exact-delta-address-schedule",
      addressComparison: false,
      topologyMutation: false,
    }),
  });
  preparedBytes.set(contract, bytes);
  return contract;
}

export function preparedMengerSparseLightingAtlasBytes(contract) {
  return preparedBytes.get(contract) ?? null;
}

function prepareExactDeltaAddressSchedule({ playback, frontFacingSchedule, slotByScheduleCursor, leafCount }) {
  if (playback.initial.stateIndex !== 0 || leafCount > 255) {
    throw new Error("Prepared cssMenger delta address schedule requires state zero and u8 leaf ids");
  }
  const currentSlots = new Int32Array(leafCount).fill(-1);
  const offsets = [0];
  const leafIndices = [];
  const slotIndices = [];
  const writeCounts = [];
  for (let stateIndex = 0; stateIndex < playback.stateCount; stateIndex += 1) {
    const stateStart = leafIndices.length;
    for (let axis = 0; axis < frontFacingSchedule.axisCount; axis += 1) {
      const segment = stateIndex * frontFacingSchedule.axisCount + axis;
      const start = frontFacingSchedule.offsets[segment];
      const end = frontFacingSchedule.offsets[segment + 1];
      for (let cursor = start; cursor < end; cursor += 1) {
        const leafIndex = frontFacingSchedule.leafIndices[cursor];
        const slotIndex = slotByScheduleCursor[cursor];
        if (currentSlots[leafIndex] === slotIndex) continue;
        currentSlots[leafIndex] = slotIndex;
        leafIndices.push(leafIndex);
        slotIndices.push(slotIndex);
      }
    }
    const writeCount = leafIndices.length - stateStart;
    writeCounts.push(writeCount);
    offsets.push(leafIndices.length);
  }
  const updateCount = leafIndices.length;
  if (updateCount > 65_535 || offsets.at(-1) !== updateCount) {
    throw new Error("Prepared cssMenger delta address schedule exceeds its u16 contract");
  }
  const minimumWriteCountPerState = writeCounts.reduce((minimum, count) => Math.min(minimum, count), Infinity);
  const maximumWriteCountPerState = writeCounts.reduce((maximum, count) => Math.max(maximum, count), 0);
  return Object.freeze({
    offsets: Object.freeze(offsets),
    leafIndices: Object.freeze(leafIndices),
    slotIndices: Object.freeze(slotIndices),
    updateCount,
    minimumWriteCountPerState,
    maximumWriteCountPerState,
    averageWriteCountPerState: updateCount / playback.stateCount,
    zeroWriteStateCount: writeCounts.reduce((count, value) => count + Number(value === 0), 0),
  });
}

function u16leBytes(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index += 1) bytes.writeUInt16LE(values[index], index * 2);
  return bytes;
}

function prepareBundleLayout({ bundle, polygon, geometry, tileWidth, tileHeight }) {
  if (!polygon) throw new Error(`Prepared cssMenger plane leaf ${bundle.bundleIndex} is missing`);
  const plan = computeTextureAtlasPlanPublic({ ...polygon, color: "#ffffff" }, bundle.bundleIndex);
  if (!plan || plan.screenPts?.length !== 8 || !(plan.canvasW > 0) || !(plan.canvasH > 0)) {
    throw new Error(`Prepared cssMenger plane leaf ${bundle.bundleIndex} has no PolyCSS basis`);
  }
  const origin = polygon.vertices[0];
  const edgeU = subtract(polygon.vertices[1], origin);
  const edgeV = subtract(polygon.vertices[3], origin);
  const edgeULengthSquared = dot(edgeU, edgeU);
  const edgeVLengthSquared = dot(edgeV, edgeV);
  const p0 = [plan.screenPts[0], plan.screenPts[1]];
  const p1 = [plan.screenPts[2], plan.screenPts[3]];
  const p3 = [plan.screenPts[6], plan.screenPts[7]];
  const faces = bundle.sourceFaceIndices.map((sourceIndex) => {
    const face = geometry.sourceFaces[sourceIndex];
    const vertices = preparedSourceFaceVertices(face, geometry.cellsPerAxis);
    const points = vertices.map((vertex) => {
      const relative = subtract(vertex, origin);
      const u = dot(relative, edgeU) / edgeULengthSquared;
      const v = dot(relative, edgeV) / edgeVLengthSquared;
      return [
        (p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v) / plan.canvasW * tileWidth,
        (p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v) / plan.canvasH * tileHeight,
      ];
    });
    const centerX = Math.max(0, Math.min(tileWidth - 1, Math.floor(points.reduce((sum, point) => sum + point[0], 0) / 4)));
    const centerY = Math.max(0, Math.min(tileHeight - 1, Math.floor(points.reduce((sum, point) => sum + point[1], 0) / 4)));
    return Object.freeze({
      sourceIndex,
      axisGroup: face.axisGroup,
      x: centerX,
      y: centerY,
      vertices: Object.freeze(vertices.map((vertex) => Object.freeze(browserPlaneToNativeSource(vertex)))),
      normal: Object.freeze(browserPlaneToNativeSource(preparedSourceFaceNormal(face))),
    });
  });
  const texelKeys = new Set(faces.map((face) => `${face.x}:${face.y}`));
  if (texelKeys.size !== faces.length) {
    throw new Error(
      `Prepared cssMenger plane leaf ${bundle.bundleIndex} maps ${faces.length} source faces to only ${texelKeys.size} texels`,
    );
  }
  return Object.freeze({ bundleIndex: bundle.bundleIndex, faces: Object.freeze(faces) });
}

function writeLightingTile({
  rgba,
  width,
  slotIndex,
  columns,
  stateIndex,
  playback,
  layout,
  tileWidth,
  tileHeight,
  slotWidth,
  slotHeight,
}) {
  const slotX = (slotIndex % columns) * slotWidth;
  const slotY = Math.floor(slotIndex / columns) * slotHeight;
  const contentX = slotX + GUTTER;
  const contentY = slotY + GUTTER;
  const rotation = playback.nativeRotationDegrees[stateIndex];
  const materialIndices = playback.colorRows[stateIndex];
  const rotatedNormals = new Map();
  for (const face of layout.faces) {
    const normalKey = face.normal.join(",");
    let normal = rotatedNormals.get(normalKey);
    if (!normal) {
      normal = rotateNative(face.normal, rotation);
      rotatedNormals.set(normalKey, normal);
    }
    const sourceAxisGroup = face.axisGroup === 0 ? 1 : face.axisGroup === 1 ? 0 : 2;
    const material = playback.palette[materialIndices[sourceAxisGroup]].material;
    const colors = face.vertices.map((vertex) => shadeVertex(material, vertex, normal, rotation));
    const offset = ((contentY + face.y) * width + contentX + face.x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[offset + channel] = byte(colors.reduce((sum, color) => sum + color[channel], 0) / colors.length);
    }
    rgba[offset + 3] = 255;
  }
  if (GUTTER > 0) duplicateGutter(rgba, width, contentX, contentY, tileWidth, tileHeight);
}

function copyTileIntoAtlas({
  rgba,
  width,
  tile,
  slotIndex,
  columns,
  tileWidth,
  tileHeight,
  slotWidth,
  slotHeight,
}) {
  const contentX = (slotIndex % columns) * slotWidth + GUTTER;
  const contentY = Math.floor(slotIndex / columns) * slotHeight + GUTTER;
  const rowBytes = tileWidth * 4;
  for (let y = 0; y < tileHeight; y += 1) {
    const sourceStart = y * rowBytes;
    const targetStart = ((contentY + y) * width + contentX) * 4;
    tile.copy(rgba, targetStart, sourceStart, sourceStart + rowBytes);
  }
  if (GUTTER > 0) duplicateGutter(rgba, width, contentX, contentY, tileWidth, tileHeight);
}

function duplicateGutter(rgba, atlasWidth, contentX, contentY, width, height) {
  for (let y = 0; y < height; y += 1) {
    copyPixel(rgba, atlasWidth, contentX, contentY + y, contentX - 1, contentY + y);
    copyPixel(rgba, atlasWidth, contentX + width - 1, contentY + y, contentX + width, contentY + y);
  }
  for (let x = -1; x <= width; x += 1) {
    copyPixel(rgba, atlasWidth, contentX + Math.max(0, Math.min(width - 1, x)), contentY,
      contentX + x, contentY - 1);
    copyPixel(rgba, atlasWidth, contentX + Math.max(0, Math.min(width - 1, x)), contentY + height - 1,
      contentX + x, contentY + height);
  }
}

function copyPixel(rgba, atlasWidth, sourceX, sourceY, targetX, targetY) {
  const source = (sourceY * atlasWidth + sourceX) * 4;
  const target = (targetY * atlasWidth + targetX) * 4;
  rgba.copy(rgba, target, source, source + 4);
}

function shadeVertex(material, vertex, normal, rotation) {
  const [x, y, z] = rotateNative(vertex, rotation);
  const light0 = normalize([-1 - x * 0.1, -1 - y * 0.1, 1 - z * 0.1]);
  const light1 = normalize([1 - x * 0.1, -0.2 - y * 0.1, 0.2 - z * 0.1]);
  const factor = 0.2 + Math.max(0, dot(normal, light0)) + Math.max(0, dot(normal, light1));
  return [0, 1, 2].map((channel) => clamp01(material[channel] * factor));
}

function rotateNative([x, y, z], [xDegrees, yDegrees, zDegrees]) {
  const zAngle = zDegrees * Math.PI / 180;
  const zx = x * Math.cos(zAngle) - y * Math.sin(zAngle);
  const zy = x * Math.sin(zAngle) + y * Math.cos(zAngle);
  const yAngle = yDegrees * Math.PI / 180;
  const yx = zx * Math.cos(yAngle) + z * Math.sin(yAngle);
  const yz = -zx * Math.sin(yAngle) + z * Math.cos(yAngle);
  const xAngle = xDegrees * Math.PI / 180;
  return [
    yx,
    zy * Math.cos(xAngle) - yz * Math.sin(xAngle),
    zy * Math.sin(xAngle) + yz * Math.cos(xAngle),
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((component) => component / length);
}

function browserPlaneToNativeSource([x, y, z]) {
  return [-y, -x, z];
}

function subtract(left, right) {
  return left.map((component, axis) => component - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, component, axis) => sum + component * right[axis], 0);
}

function byte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
