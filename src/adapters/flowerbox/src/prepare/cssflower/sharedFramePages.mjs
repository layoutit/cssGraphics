import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { buildPreparedFullRotationCycle } from "./bloomCycle.mjs";
import {
  buildCssflowerPreparedInverseRootTransforms,
  prepareCssflowerProjectedFrame,
} from "./projectedPixels.mjs";

export const CSSFLOWER_SHARED_FRAME_PAGE_FRAME_COUNT = 4;
export const CSSFLOWER_SHARED_LAYOUT_COMPONENT_COUNT = 6;
export const CSSFLOWER_SHARED_LAYOUT_BYTES_PER_LEAF =
  CSSFLOWER_SHARED_LAYOUT_COMPONENT_COUNT * Int16Array.BYTES_PER_ELEMENT;
export const CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT = 64;

const STAGE_PIXELS = 720;
const HALF_STAGE_PIXELS = STAGE_PIXELS / 2;
const cycle = buildPreparedFullRotationCycle();

export function buildCssflowerSharedFramePagePlan({
  frameCount = CSSFLOWER_SHARED_FRAME_PAGE_FRAME_COUNT,
} = {}) {
  if (frameCount !== CSSFLOWER_SHARED_FRAME_PAGE_FRAME_COUNT) {
    throw new RangeError(`Prepared shared-frame page span must be ${CSSFLOWER_SHARED_FRAME_PAGE_FRAME_COUNT}`);
  }
  const pages = [];
  for (let startStateIndex = 0; startStateIndex < cycle.stateCount; startStateIndex += frameCount) {
    const usedFrameCount = Math.min(frameCount, cycle.stateCount - startStateIndex);
    pages.push(Object.freeze({
      index: pages.length,
      startStateIndex,
      usedFrameCount,
      ticks: Object.freeze(Array.from({ length: usedFrameCount }, (_, offset) => startStateIndex + offset)),
    }));
  }
  return Object.freeze({
    schema: "cssflower-prepared-shared-frame-page-plan@1",
    layout: "source-order-retained-leaf-windows-over-screen-aligned-prepared-frame-pages",
    stateCount: cycle.stateCount,
    cycleStartState: cycle.cycleStartState,
    cycleLength: cycle.cycleLength,
    retainedLeafCount: 1_200,
    frameCount,
    pageCount: pages.length,
    pages: Object.freeze(pages),
    inverseRootTransforms: buildCssflowerPreparedInverseRootTransforms(),
    authority: Object.freeze({
      precedent: "cssgraphics-mario-prepared-space-time-texels-with-raster-leaf-sizing",
      input: "independently-prepared-cssflower-source-state",
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
      runtimeGeometryConstruction: false,
      runtimeNormalCalculation: false,
      runtimeLightingCalculation: false,
      runtimeDomGrowth: false,
    }),
  });
}

export function prepareCssflowerSharedFramePage(page) {
  if (!validPageRequest(page)) throw new TypeError("Prepared shared-frame page request is invalid");
  const frames = page.ticks.map((tick) => prepareCssflowerProjectedFrame(tick));
  const slots = unionLeafSlots(frames);
  const crop = unionPageCrop(slots);
  const atlasImage = new PNG({
    width: crop.width * frames.length,
    height: crop.height,
    colorType: 6,
  });
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    copyOpaqueFrameCrop(frames[frameIndex].frameImage, atlasImage, crop, frameIndex);
  }
  const atlasBytes = PNG.sync.write(atlasImage, { colorType: 2, inputColorType: 6 });
  const layoutBytes = encodeCssflowerSharedLeafLayout(slots, crop);
  return Object.freeze({
    schema: "cssflower-prepared-shared-frame-window-page@1",
    index: page.index,
    startStateIndex: page.startStateIndex,
    usedFrameCount: page.usedFrameCount,
    retainedLeafCount: 1_200,
    activeUnionLeafCount: slots.filter((slot) => slot.pixelCount > 0).length,
    atlas: Object.freeze({
      encoding: "png-rgb8-lossless-pre-transport",
      width: atlasImage.width,
      height: atlasImage.height,
      frameWidth: crop.width,
      frameHeight: crop.height,
      cropLeft: crop.left,
      cropTop: crop.top,
      byteLength: atlasBytes.length,
      decodedBytes: atlasImage.width * atlasImage.height * 4,
      sha256: sha256(atlasBytes),
      frameBackgroundXs: Object.freeze(Array.from(
        { length: page.usedFrameCount },
        (_, frameIndex) => frameIndex === 0 ? 0 : -frameIndex * crop.width,
      )),
      bytes: atlasBytes,
    }),
    layout: Object.freeze({
      schema: "cssflower-prepared-shared-frame-leaf-layout@1",
      encoding: "int16-little-endian-source-order-width-height-dx-dy-frame-background-x-frame-background-y",
      componentCount: CSSFLOWER_SHARED_LAYOUT_COMPONENT_COUNT,
      bytesPerLeaf: CSSFLOWER_SHARED_LAYOUT_BYTES_PER_LEAF,
      leafCount: 1_200,
      byteLength: layoutBytes.length,
      sha256: sha256(layoutBytes),
      bytes: layoutBytes,
    }),
    packets: Object.freeze(frames.map((frame, frameIndex) => Object.freeze({
      tick: frame.tick,
      sf: frame.state.sf,
      rootTransform: frame.rootTransform,
      frameIndex,
      visibleLeafCount: frame.topology.visibleLeafCount,
    }))),
    authority: Object.freeze({
      ...frames[0].authority,
      precedent: "cssgraphics-mario-prepared-space-time-texels-with-raster-leaf-sizing",
      runtimeNormalCalculation: false,
      runtimeLightingCalculation: false,
      runtimeDomGrowth: false,
    }),
  });
}

export function encodeCssflowerSharedLeafLayout(slots, crop) {
  if (!Array.isArray(slots) || slots.length !== 1_200 ||
      slots.some((slot, index) => slot?.index !== index) ||
      !Number.isSafeInteger(crop?.left) || !Number.isSafeInteger(crop?.top)) {
    throw new TypeError("Complete prepared shared-frame leaf slots and crop are required");
  }
  const bytes = Buffer.alloc(slots.length * CSSFLOWER_SHARED_LAYOUT_BYTES_PER_LEAF);
  for (const slot of slots) {
    const values = slot.pixelCount === 0
      ? [0, 0, 0, 0, 0, 0]
      : [
          slot.width,
          slot.height,
          slot.left - HALF_STAGE_PIXELS,
          slot.top - HALF_STAGE_PIXELS,
          -(slot.left - crop.left),
          -(slot.top - crop.top),
        ];
    for (let component = 0; component < values.length; component += 1) {
      const value = values[component];
      if (!Number.isSafeInteger(value) || value < -32_768 || value > 32_767) {
        throw new RangeError(`Prepared shared-frame leaf ${slot.index} component ${component} exceeds int16`);
      }
      bytes.writeInt16LE(
        value,
        (slot.index * CSSFLOWER_SHARED_LAYOUT_COMPONENT_COUNT + component) * Int16Array.BYTES_PER_ELEMENT,
      );
    }
  }
  return bytes;
}

function unionLeafSlots(frames) {
  return Array.from({ length: 1_200 }, (_, index) => {
    const visible = frames.map((frame) => frame.leaves[index]).filter((leaf) => leaf.pixelCount > 0);
    const left = visible.length ? Math.min(...visible.map((leaf) => leaf.left)) : STAGE_PIXELS;
    const top = visible.length ? Math.min(...visible.map((leaf) => leaf.top)) : STAGE_PIXELS;
    const right = visible.length ? Math.max(...visible.map((leaf) => leaf.right)) : -1;
    const bottom = visible.length ? Math.max(...visible.map((leaf) => leaf.bottom)) : -1;
    return Object.freeze({
      index,
      pixelCount: visible.reduce((sum, leaf) => sum + leaf.pixelCount, 0),
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left + 1),
      height: Math.max(0, bottom - top + 1),
    });
  });
}

function unionPageCrop(slots) {
  const visible = slots.filter((slot) => slot.pixelCount > 0);
  if (visible.length === 0) throw new Error("Prepared shared-frame page has no visible source triangles");
  const left = Math.min(...visible.map((slot) => slot.left));
  const top = Math.min(...visible.map((slot) => slot.top));
  const right = Math.max(...visible.map((slot) => slot.right));
  const bottom = Math.max(...visible.map((slot) => slot.bottom));
  return Object.freeze({
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  });
}

function copyOpaqueFrameCrop(source, target, crop, frameIndex) {
  const targetFrameX = frameIndex * crop.width;
  for (let y = 0; y < crop.height; y += 1) {
    const sourceOffset = ((crop.top + y) * source.width + crop.left) * 4;
    const targetOffset = (y * target.width + targetFrameX) * 4;
    source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + crop.width * 4);
  }
}

function validPageRequest(page) {
  return Number.isSafeInteger(page?.index) && page.index >= 0 &&
    Number.isSafeInteger(page.startStateIndex) && page.startStateIndex >= 0 &&
    Number.isSafeInteger(page.usedFrameCount) && page.usedFrameCount >= 1 &&
    page.usedFrameCount <= CSSFLOWER_SHARED_FRAME_PAGE_FRAME_COUNT &&
    Array.isArray(page.ticks) && page.ticks.length === page.usedFrameCount &&
    page.ticks.every((tick, offset) => tick === page.startStateIndex + offset && tick < cycle.stateCount);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
