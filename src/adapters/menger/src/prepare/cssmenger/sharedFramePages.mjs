import { createHash } from "node:crypto";
import sharp from "sharp";

export const CSSMENGER_SHARED_FRAME_PAGE_STATE_COUNT = 4;
export const CSSMENGER_SHARED_FRAME_LAYOUT_COMPONENT_COUNT = 6;

export async function prepareMengerSharedFramePage({
  index,
  startStateIndex,
  frames,
  viewport,
  leafCount,
} = {}) {
  if (!Number.isSafeInteger(index) || index < 0 ||
      !Number.isSafeInteger(startStateIndex) || startStateIndex < 0 ||
      !Array.isArray(frames) || frames.length < 1 ||
      frames.length > CSSMENGER_SHARED_FRAME_PAGE_STATE_COUNT ||
      frames.some((frame, offset) => frame?.stateIndex !== startStateIndex + offset ||
        !(frame.pngBytes instanceof Uint8Array) || frame.layouts?.length !== leafCount) ||
      !Number.isSafeInteger(viewport?.width) || !Number.isSafeInteger(viewport?.height) ||
      !Number.isSafeInteger(leafCount) || leafCount < 1) {
    throw new TypeError("Complete consecutive cssMenger shared frames are required");
  }
  const decoded = await Promise.all(frames.map(async (frame) => {
    const image = sharp(frame.pngBytes).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (info.width !== viewport.width || info.height !== viewport.height || info.channels !== 4) {
      throw new Error(`Prepared cssMenger frame ${frame.stateIndex} dimensions drifted`);
    }
    return Object.freeze({ data, info, bounds: nonTransparentBounds(data, info) });
  }));
  const crop = unionBounds(decoded.map((frame) => frame.bounds));
  const inputs = await Promise.all(frames.map(async (frame, frameIndex) => ({
    input: await sharp(frame.pngBytes).extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    }).png().toBuffer(),
    left: frameIndex * crop.width,
    top: 0,
  })));
  const bytes = await sharp({
    create: {
      width: crop.width * frames.length,
      height: crop.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(inputs).webp({ lossless: true, effort: 4 }).toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const layout = encodeUnionLeafLayout({ frames, crop, viewport, leafCount });
  const descriptor = Object.freeze({
    index,
    startStateIndex,
    usedStateCount: frames.length,
    stateCount: CSSMENGER_SHARED_FRAME_PAGE_STATE_COUNT,
    assetUrl: `/cssmenger/assets/shared-frame-${String(index).padStart(4, "0")}-${sha256}.webp`,
    assetSha256: sha256,
    byteLength: bytes.length,
    encoding: "WebP-lossless-RGBA8",
    width: crop.width * frames.length,
    height: crop.height,
    decodedBytes: crop.width * frames.length * crop.height * 4,
    frameWidth: crop.width,
    frameHeight: crop.height,
    cropLeft: crop.left,
    cropTop: crop.top,
    frameBackgroundPositionXs: Object.freeze(Array.from(
      { length: frames.length },
      (_, frameIndex) => -frameIndex * crop.width,
    )),
    layout,
  });
  return Object.freeze({ descriptor, bytes });
}

export function buildPreparedMengerSharedFrameContract({
  pages,
  sourceStateCount,
  leafCount,
  sourceFaceCount,
  sourceFaceCoverageCount,
} = {}) {
  if (!Array.isArray(pages) || pages.length < 1 ||
      pages.some((page, index) => page?.index !== index ||
        page.startStateIndex !== index * CSSMENGER_SHARED_FRAME_PAGE_STATE_COUNT ||
        page.layout?.length !== leafCount * CSSMENGER_SHARED_FRAME_LAYOUT_COMPONENT_COUNT) ||
      !Number.isSafeInteger(sourceStateCount) || sourceStateCount < 2 ||
      pages.reduce((sum, page) => sum + page.usedStateCount, 0) !== sourceStateCount ||
      !Number.isSafeInteger(leafCount) || leafCount < 1 ||
      !Number.isSafeInteger(sourceFaceCount) || sourceFaceCount < 1 ||
      sourceFaceCoverageCount !== sourceFaceCount) {
    throw new TypeError("Complete prepared cssMenger shared-frame pages are required");
  }
  const totalEncodedBytes = pages.reduce((sum, page) => sum + page.byteLength, 0);
  const maximumDecodedPageBytes = Math.max(...pages.map((page) => page.decodedBytes));
  const maximumAdjacentDecodedBytes = Math.max(...pages.map((page, index) =>
    page.decodedBytes + (pages[index + 1]?.decodedBytes ?? 0)));
  return Object.freeze({
    schema: "cssmenger-prepared-shared-screen-frame-pages@1",
    technique: "source-prepared-full-face-depth-owned-raster-shared-frame-retained-polycss-leaf",
    source: "independently prepared pinned XScreenSaver source facts",
    externalFrameIngestion: false,
    preparedSnapshotFrameIngestion: false,
    sourceProjectedFrameIngestion: true,
    nativeFrameIngestion: false,
    browserOracleFrameIngestion: false,
    encoding: "content-addressed-WebP-lossless-RGBA8",
    transparency: "independently-prepared-source-depth-owned-alpha-coverage",
    rasterMode: "polycss-raster",
    imageRendering: "auto",
    layout: "one-retained-polycss-raster-leaf-over-screen-aligned-source-projected-frame-pages",
    viewport: Object.freeze({ width: 960, height: 600 }),
    pageStateCount: CSSMENGER_SHARED_FRAME_PAGE_STATE_COUNT,
    pageCount: pages.length,
    pages: Object.freeze(pages),
    totalEncodedBytes,
    maximumDecodedPageBytes,
    maximumAdjacentDecodedBytes,
    layoutComponentCount: CSSMENGER_SHARED_FRAME_LAYOUT_COMPONENT_COUNT,
    layoutEncoding: "leaf-major-width-height-centered-x-centered-y-background-x-background-y",
    leafCount,
    sourceFaceCount,
    sourceFaceCoverageCount,
    sourceFaceCoverageExact: true,
    sourceStateCount,
    runtime: Object.freeze({
      geometryConstruction: 0,
      atlasConstruction: 0,
      lightingCalculations: 0,
      colorCalculations: 0,
      projectionCalculations: 0,
      rasterization: 0,
      decodedResidency: "current-plus-next-page",
      pageHandoff: "hold-current-until-next-verified-decoded-then-atomic-swap",
      frameSelection: "prepared-page-local-background-offset",
      perLeafStyleWritesPerPageBoundary: leafCount,
      rootBackgroundPositionWritesPerPublishedState: 2,
      topologyMutation: false,
    }),
    authority: Object.freeze({
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
    }),
  });
}

function encodeUnionLeafLayout({ frames, crop, viewport, leafCount }) {
  const values = [];
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const bounds = frames.map((frame) => frame.layouts[leafIndex]).filter(Boolean);
    if (bounds.length === 0) {
      values.push(0, 0, 0, 0, 0, 0);
      continue;
    }
    const left = Math.max(crop.left, Math.min(...bounds.map((bound) => bound.left)) - 2);
    const top = Math.max(crop.top, Math.min(...bounds.map((bound) => bound.top)) - 2);
    const right = Math.min(crop.right + 1, Math.max(...bounds.map((bound) => bound.right)) + 2);
    const bottom = Math.min(crop.bottom + 1, Math.max(...bounds.map((bound) => bound.bottom)) + 2);
    values.push(
      right - left,
      bottom - top,
      left - viewport.width / 2,
      top - viewport.height / 2,
      -(left - crop.left),
      -(top - crop.top),
    );
  }
  if (values.some((value) => !Number.isSafeInteger(value) || value < -32_768 || value > 32_767)) {
    throw new RangeError("Prepared cssMenger shared-frame layout exceeds int16");
  }
  return Object.freeze(values);
}

function nonTransparentBounds(data, info) {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Prepared cssMenger shared frame is blank");
  return Object.freeze({ left, top, right, bottom });
}

function unionBounds(bounds) {
  const left = Math.min(...bounds.map((bound) => bound.left));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const right = Math.max(...bounds.map((bound) => bound.right));
  const bottom = Math.max(...bounds.map((bound) => bound.bottom));
  return Object.freeze({ left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 });
}
