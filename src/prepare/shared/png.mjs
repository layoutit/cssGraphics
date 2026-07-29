import { constants as zlibConstants, deflateSync } from "node:zlib";

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function encodePaethScanlines(pixels, width, height, channels) {
  const rowBytes = width * channels;
  const scanlines = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * rowBytes;
    const targetOffset = y * (rowBytes + 1);
    scanlines[targetOffset] = 4;
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= channels ? pixels[sourceOffset + index - channels] : 0;
      const above = y > 0 ? pixels[sourceOffset - rowBytes + index] : 0;
      const upperLeft = y > 0 && index >= channels
        ? pixels[sourceOffset - rowBytes + index - channels]
        : 0;
      scanlines[targetOffset + index + 1] = (
        pixels[sourceOffset + index] - paethPredictor(left, above, upperLeft)
      ) & 0xff;
    }
  }
  return scanlines;
}

/** Deterministic prepare-time RGBA8 PNG encoding; never imported by the product. */
export function encodePngRgba8(pixels, width, height) {
  positiveInteger(width, "PNG width");
  positiveInteger(height, "PNG height");
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error("PNG encoder requires an exact RGBA8 pixel buffer.");
  }
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (width * 4 + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = deflateSync(scanlines, { level: 9, strategy: zlibConstants.Z_FIXED });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND"),
  ]);
}

/** Deterministic prepare-time RGBA8 PNG encoding for large baked atlases. */
export function encodePngRgba8Paeth(pixels, width, height) {
  positiveInteger(width, "PNG width");
  positiveInteger(height, "PNG height");
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error("PNG encoder requires an exact RGBA8 pixel buffer.");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = deflateSync(encodePaethScanlines(pixels, width, height, 4), { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND"),
  ]);
}
