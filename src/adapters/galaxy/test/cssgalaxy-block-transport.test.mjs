// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSGALAXY_HIDDEN_COORDINATE,
  decodeGalaxyPreparedBlock,
  encodeGalaxyPreparedBank,
  formatGalaxyPreparedPosition,
  parseGalaxyPreparedTranslation,
  readGalaxyPreparedBankSections,
} from "../src/shared/cssgalaxy/preparedBlockTransport.mjs";

const hidden = CSSGALAXY_HIDDEN_COORDINATE;
const coordinates = Int32Array.from([
  10, 20, hidden, hidden,
  13, 23, hidden, hidden,
  15, 25, 30, 40,
  18, 28, 30, 40,
]);
const catalog = Object.freeze({
  selectedSeed: 4946,
  starCount: 2,
  galaxyCount: 3,
  bankFrameCount: 4,
  blockFrameCount: 2,
  blocksPerBank: 2,
  viewport: Object.freeze({ width: 800, height: 600 }),
});

test("round-trips exact fixed-point point coordinates in independently decodable blocks", () => {
  const decodedBytes = encodeGalaxyPreparedBank({
    seed: 4946,
    starCount: 2,
    galaxyCount: 3,
    bankIndex: 0,
    startFrameIndex: 0,
    frameCount: 4,
    blockFrameCount: 2,
    coordinates,
  });
  const descriptor = Object.freeze({
    index: 0,
    startFrameIndex: 0,
    frameCount: 4,
    decodedByteLength: decodedBytes.byteLength,
    blockCount: 2,
    visibleSampleCount: 6,
    coordinateEncoding:
      "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1",
  });
  const bank = readGalaxyPreparedBankSections(decodedBytes, descriptor, catalog);
  assert.equal(bank.visibleSampleCount, 6);
  assert.equal(bank.blocks.length, 2);
  assert.deepEqual(decodeGalaxyPreparedBlock(bank, 0, catalog).transforms, [
    "translate(1px, 2px)", "translate(-32768px, -32768px)",
    "translate(1.3px, 2.3px)", "translate(-32768px, -32768px)",
  ]);
  assert.deepEqual(decodeGalaxyPreparedBlock(bank, 1, catalog).transforms, [
    "translate(1.5px, 2.5px)", "translate(3px, 4px)",
    "translate(1.8px, 2.8px)", "translate(3px, 4px)",
  ]);
});

test("rounds prepared coordinates to the declared tenth-pixel boundary", () => {
  assert.deepEqual(parseGalaxyPreparedTranslation("17.167px 42.05px"), [172, 421]);
  assert.deepEqual(parseGalaxyPreparedTranslation("17.149px 42.049px"), [171, 420]);
  assert.deepEqual(parseGalaxyPreparedTranslation("-32768px -32768px"), [hidden, hidden]);
});

test("formats prepared CSS variable positions without transform syntax", () => {
  assert.equal(formatGalaxyPreparedPosition(hidden, hidden), "-32768px, -32768px");
  assert.equal(formatGalaxyPreparedPosition(172, 421), "17.2px, 42.1px");
});
