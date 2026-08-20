import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceSequence,
  selectFlocksProductPrefix,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  CSSFLOCKS_TRANSPORT_LIMITS,
  decodeFlocksPreparedBlock,
  decodeFlocksPreparedSourceValues,
  encodeFlocksPreparedBlock,
} from "../src/shared/cssflocks/preparedBlockTransport.mjs";

test("Flocks source-state block round-trips into prepared transforms and currentColor values", () => {
  const source = selectFlocksProductPrefix(buildFlocksSourceSequence({
    bank: Object.freeze({ ...CSSFLOCKS_SOURCE_BANK, warmupFrames: 0, frameCount: 2, blockFrameCount: 2 }),
  }), CSSFLOCKS_PRODUCT_PROFILES.mobile);
  const bytes = encodeFlocksPreparedBlock({
    frames: source.frames,
    bugCount: source.profile.bugCount,
    framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
  });
  const descriptor = Object.freeze({
    index: 0,
    startFrameIndex: 0,
    frameCount: 2,
    encoding: CSSFLOCKS_BLOCK_ENCODING,
    decodedByteLength: bytes.byteLength,
  });
  const catalog = Object.freeze({
    streamId: "mobile",
    modelId: "flocks-mobile",
    bugCount: 164,
    leafCount: 984,
    framesPerSecond: 60,
    frameMilliseconds: 1_000 / 60,
    playbackSchema: CSSFLOCKS_PLAYBACK_SCHEMA,
  });
  const block = decodeFlocksPreparedBlock(bytes, descriptor, catalog);
  assert.equal(block.playback.transforms.length, 328);
  assert.equal(block.playback.colors.length, 328);
  assert.match(block.playback.transforms[0], /^matrix3d\(/u);
  assert.match(block.playback.colors[0], /^#[0-9a-f]{6}$/u);
  assert.equal(block.preparedMatrixExpansionCount, 328);
  assert.ok(block.preparedCssStringByteLength > 0);
  assert.deepEqual(CSSFLOCKS_TRANSPORT_LIMITS.checkpoint.positionRelative, {
    storage: "int16", scale: 1 / 32, minimum: -1_024, maximum: 1_023.96875,
  });
  assert.deepEqual(CSSFLOCKS_TRANSPORT_LIMITS.delta.velocity, {
    storage: "int16", scale: 1 / 128, minimum: -256, maximum: 255.9921875,
  });
  assert.equal(decodeFlocksPreparedSourceValues(bytes, descriptor, catalog).length, 2 * 164 * 7);

  const corruptHeader = bytes.slice();
  corruptHeader[12] ^= 1;
  assert.throws(() => decodeFlocksPreparedBlock(corruptHeader, descriptor, catalog), /header drifted/u);
  const corruptCheckpoint = bytes.slice();
  corruptCheckpoint[40] ^= 1;
  assert.throws(() => decodeFlocksPreparedBlock(corruptCheckpoint, descriptor, catalog), /checksum drifted/u);
  const corruptDelta = bytes.slice();
  corruptDelta[40 + catalog.bugCount * 14] ^= 1;
  assert.throws(() => decodeFlocksPreparedBlock(corruptDelta, descriptor, catalog), /checksum drifted/u);
  assert.throws(() => decodeFlocksPreparedBlock(bytes, { ...descriptor, decodedByteLength: bytes.byteLength + 1 }, catalog), /header drifted/u);
});

test("Flocks checkpoint and predictive fields fail closed outside their explicit ranges", () => {
  const bug = (position, velocity, hue = 0.5) => ({ position, velocity, hue });
  assert.throws(() => encodeFlocksPreparedBlock({
    frames: [{ bugs: [bug([40_000, 0, 0], [0, 0, 0])] }],
    bugCount: 1,
    framesPerSecond: 60,
  }), /position origin/u);
  assert.throws(() => encodeFlocksPreparedBlock({
    frames: [
      { bugs: [bug([0, 0, 0], [0, 0, 0])] },
      { bugs: [bug([0, 0, 0], [300, 0, 0])] },
    ],
    bugCount: 1,
    framesPerSecond: 60,
  }), /velocity delta/u);
  assert.throws(() => encodeFlocksPreparedBlock({
    frames: [{ bugs: [bug([0, 0, 0], [0, 0, 0], 1.01)] }],
    bugCount: 1,
    framesPerSecond: 60,
  }), /bounded prepared Flocks/u);
});
