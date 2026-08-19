import assert from "node:assert/strict";
import test from "node:test";
import { selectInitialCyclonePosition } from "../src/csscyclone/preparedStream.mjs";

const hash = "0".repeat(64);
const catalog = Object.freeze({
  schema: "csscyclone-prepared-stream-catalog@1",
  streamId: "desktop-stream",
  chunkCount: 24,
  chunkFrameCount: 450,
  blockCount: 216,
  blocksPerChunk: 9,
  blockFrameCount: 50,
  frameMilliseconds: 20,
  streamFrameCount: 10_800,
  streamDurationMilliseconds: 216_000,
  randomStartChunkCount: 12,
  randomStartFrameCount: 150,
  runtimeLookaheadBlockCount: 1,
  entries: Object.freeze(Array.from({ length: 216 }, (_, index) => Object.freeze({
    index,
    chunkIndex: Math.floor(index / 9),
    blockIndex: index % 9,
    startFrameIndex: index * 50,
    frameCount: 50,
    sourceContinuousFromPrevious: index > 0,
    encoding: "gzip-newline-json",
    assetUrl: `/block-${index}.bin`,
    byteLength: 1,
    sha256: hash,
    decodedByteLength: 1,
    decodedSha256: hash,
  }))),
});

test("selects a cryptographically supplied prepared stream position once", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    randomUint32Pair: () => [7, 901],
  }), {
    chunkIndex: 7,
    frameIndex: 1,
    mode: "crypto-random",
  });
});

test("does not immediately repeat the previous randomized start chunk", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    previousChunkIndex: 7,
    randomUint32Pair: () => [7, 901],
  }), {
    chunkIndex: 8,
    frameIndex: 1,
    mode: "crypto-random-no-repeat",
  });
});

test("accepts an explicit chunk and frame for deterministic browser proof", () => {
  assert.deepEqual(selectInitialCyclonePosition(catalog, {
    search: "?chunk=23&frame=449",
  }), {
    chunkIndex: 23,
    frameIndex: 449,
    mode: "explicit",
  });
});
