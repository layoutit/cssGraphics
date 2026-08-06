import { PNG } from "pngjs";

export const CSSFLOWER_SHARED_FRAME_PACKINGS = Object.freeze([
  "horizontal-union",
  "vertical-union",
]);

export function buildCssflowerSharedFramePackingCandidates(atlas) {
  validatePreparedHorizontalAtlas(atlas);
  const source = PNG.sync.read(atlas.bytes);
  if (source.width !== atlas.width || source.height !== atlas.height) {
    throw new Error("Prepared shared-frame PNG dimensions drifted");
  }
  const horizontal = packingDescriptor({
    packing: "horizontal-union",
    frameWidth: atlas.frameWidth,
    frameHeight: atlas.frameHeight,
    frameCount: atlas.frameBackgroundXs.length,
    bytes: Buffer.from(atlas.bytes),
  });
  if (horizontal.frameCount === 1) return Object.freeze([horizontal]);

  const verticalImage = new PNG({
    width: atlas.frameWidth,
    height: atlas.frameHeight * horizontal.frameCount,
    colorType: 6,
  });
  for (let frameIndex = 0; frameIndex < horizontal.frameCount; frameIndex += 1) {
    for (let y = 0; y < atlas.frameHeight; y += 1) {
      const sourceOffset = (y * source.width + frameIndex * atlas.frameWidth) * 4;
      const targetOffset = ((frameIndex * atlas.frameHeight + y) * verticalImage.width) * 4;
      source.data.copy(
        verticalImage.data,
        targetOffset,
        sourceOffset,
        sourceOffset + atlas.frameWidth * 4,
      );
    }
  }
  const vertical = packingDescriptor({
    packing: "vertical-union",
    frameWidth: atlas.frameWidth,
    frameHeight: atlas.frameHeight,
    frameCount: horizontal.frameCount,
    bytes: PNG.sync.write(verticalImage, { colorType: 2, inputColorType: 6 }),
  });
  return Object.freeze([horizontal, vertical]);
}

function packingDescriptor({ packing, frameWidth, frameHeight, frameCount, bytes }) {
  const horizontal = packing === "horizontal-union";
  return Object.freeze({
    packing,
    frameCount,
    width: horizontal ? frameWidth * frameCount : frameWidth,
    height: horizontal ? frameHeight : frameHeight * frameCount,
    frameWidth,
    frameHeight,
    frameBackgroundXs: Object.freeze(Array.from(
      { length: frameCount },
      (_, frameIndex) => horizontal && frameIndex > 0 ? -frameIndex * frameWidth : 0,
    )),
    frameBackgroundYs: Object.freeze(Array.from(
      { length: frameCount },
      (_, frameIndex) => !horizontal && frameIndex > 0 ? -frameIndex * frameHeight : 0,
    )),
    frameBackgroundOffsets: Object.freeze(Array.from(
      { length: frameCount },
      (_, frameIndex) => frameIndex === 0 ? 0 : horizontal ? -frameIndex * frameWidth : -frameIndex * frameHeight,
    )),
    bytes,
  });
}

function validatePreparedHorizontalAtlas(atlas) {
  if (!Buffer.isBuffer(atlas?.bytes) || atlas.bytes.length < 1 ||
      !Number.isSafeInteger(atlas.width) || atlas.width < 1 ||
      !Number.isSafeInteger(atlas.height) || atlas.height < 1 ||
      !Number.isSafeInteger(atlas.frameWidth) || atlas.frameWidth < 1 ||
      !Number.isSafeInteger(atlas.frameHeight) || atlas.frameHeight < 1 ||
      atlas.width !== atlas.frameWidth * atlas.frameBackgroundXs?.length ||
      atlas.height !== atlas.frameHeight ||
      atlas.frameBackgroundXs.some((value, frameIndex) => value !== -frameIndex * atlas.frameWidth)) {
    throw new TypeError("Complete prepared horizontal shared-frame PNG is required");
  }
}
