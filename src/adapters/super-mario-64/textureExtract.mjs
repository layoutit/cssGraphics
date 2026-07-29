function assertReadRange(bytes, offset, size, label) {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length) {
    throw new Error(`${label} range ${offset}+${size} exceeds ${bytes.length} bytes.`);
  }
}

/** Bounded prepare-time MIO0 decoder used by title backdrop and glyph extraction. */
export function decodeMio0(source, baseOffset = 0) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  assertReadRange(bytes, baseOffset, 16, "MIO0 header");
  if (bytes.subarray(baseOffset, baseOffset + 4).toString("ascii") !== "MIO0") {
    throw new Error(`MIO0 header is missing at ROM offset ${baseOffset}.`);
  }
  const decodedSize = bytes.readUInt32BE(baseOffset + 4);
  const compressedOffset = bytes.readUInt32BE(baseOffset + 8);
  const literalOffset = bytes.readUInt32BE(baseOffset + 12);
  if (decodedSize === 0 || decodedSize > 16 * 1024 * 1024) throw new Error(`MIO0 decoded size is invalid: ${decodedSize}.`);
  if (compressedOffset < 16 || literalOffset < 16) throw new Error("MIO0 stream offsets overlap the header.");

  const output = Buffer.alloc(decodedSize);
  let outputIndex = 0;
  let controlBit = 0;
  let compressedIndex = baseOffset + compressedOffset;
  let literalIndex = baseOffset + literalOffset;
  while (outputIndex < decodedSize) {
    const controlIndex = baseOffset + 16 + Math.floor(controlBit / 8);
    assertReadRange(bytes, controlIndex, 1, "MIO0 control");
    const literal = (bytes[controlIndex] & (0x80 >> (controlBit % 8))) !== 0;
    controlBit += 1;
    if (literal) {
      assertReadRange(bytes, literalIndex, 1, "MIO0 literal");
      output[outputIndex] = bytes[literalIndex];
      literalIndex += 1;
      outputIndex += 1;
      continue;
    }
    assertReadRange(bytes, compressedIndex, 2, "MIO0 back-reference");
    const first = bytes[compressedIndex];
    const second = bytes[compressedIndex + 1];
    compressedIndex += 2;
    const length = (first >>> 4) + 3;
    const distance = ((first & 0x0f) << 8) + second + 1;
    if (distance > outputIndex) throw new Error(`MIO0 back-reference distance ${distance} precedes decoded output ${outputIndex}.`);
    if (outputIndex + length > decodedSize) throw new Error("MIO0 back-reference overruns the declared decoded size.");
    for (let index = 0; index < length; index += 1) {
      output[outputIndex] = output[outputIndex - distance];
      outputIndex += 1;
    }
  }

  const controlEnd = baseOffset + 16 + Math.ceil(controlBit / 8);
  const sourceEnd = Math.max(controlEnd, compressedIndex, literalIndex);
  return Object.freeze({
    bytes: output,
    decodedSize,
    sourceRange: Object.freeze({
      offset: baseOffset,
      bytes: sourceEnd - baseOffset,
      endExclusive: sourceEnd,
    }),
    streams: Object.freeze({
      controlOffset: 16,
      controlBytes: Math.ceil(controlBit / 8),
      compressedOffset,
      compressedBytes: compressedIndex - (baseOffset + compressedOffset),
      literalOffset,
      literalBytes: literalIndex - (baseOffset + literalOffset),
    }),
  });
}
