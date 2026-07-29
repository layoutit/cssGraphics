function assertDimensions(width, height, bytes, bytesPerTexel, label) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} has invalid dimensions ${width}x${height}.`);
  }
  const expected = width * height * bytesPerTexel;
  if (bytes.length !== expected) throw new Error(`${label} has ${bytes.length} source bytes; expected ${expected}.`);
}

function expand5(value) {
  return (value << 3) | (value >>> 2);
}

export function decodeRgba16(source, width, height) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  assertDimensions(width, height, bytes, 2, "RGBA16 texture");
  const output = Buffer.alloc(width * height * 4);
  for (let sourceIndex = 0, outputIndex = 0; sourceIndex < bytes.length; sourceIndex += 2, outputIndex += 4) {
    const texel = bytes.readUInt16BE(sourceIndex);
    output[outputIndex] = expand5((texel >>> 11) & 0x1f);
    output[outputIndex + 1] = expand5((texel >>> 6) & 0x1f);
    output[outputIndex + 2] = expand5((texel >>> 1) & 0x1f);
    output[outputIndex + 3] = (texel & 1) === 1 ? 255 : 0;
  }
  return output;
}

export function decodeIa8(source, width, height) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  assertDimensions(width, height, bytes, 1, "IA8 texture");
  const output = Buffer.alloc(width * height * 4);
  for (let sourceIndex = 0, outputIndex = 0; sourceIndex < bytes.length; sourceIndex += 1, outputIndex += 4) {
    const intensity4 = bytes[sourceIndex] >>> 4;
    const alpha4 = bytes[sourceIndex] & 0x0f;
    const intensity = (intensity4 << 4) | intensity4;
    output[outputIndex] = intensity;
    output[outputIndex + 1] = intensity;
    output[outputIndex + 2] = intensity;
    output[outputIndex + 3] = (alpha4 << 4) | alpha4;
  }
  return output;
}

export function createUvProof(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("UV proof requires positive integer dimensions.");
  }
  return Object.freeze({
    sourceRectTexels: Object.freeze({ x: 0, y: 0, width, height }),
    fullRectNormalized: Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 }),
    vertexStFractionBits: 5,
    textureScaleFractionBits: 16,
    tileOriginFractionBits: 2,
    rawVertexToTexel: Object.freeze({
      s: Object.freeze({ numerator: 1, denominator: 32 }),
      t: Object.freeze({ numerator: 1, denominator: 32 }),
    }),
    texelToNormalized: Object.freeze({
      s: Object.freeze({ numerator: 1, denominator: width }),
      t: Object.freeze({ numerator: 1, denominator: height }),
    }),
    filterBiasTexels: Object.freeze({ point: 0, bilinear: 0.5 }),
    formula: "normalized=(vertexST*textureScale/65536/32-tileOriginQuarterTexels/4+filterBiasTexels)/textureDimension",
  });
}
