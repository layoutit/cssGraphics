// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";

import { createGalaxyPreparedPlayer } from "../src/cssgalaxy/preparedPlayback.mjs";
import { formatGalaxyPreparedTransform } from
  "../src/shared/cssgalaxy/preparedBlockTransport.mjs";

test("late refreshes advance one prepared frame instead of jumping to elapsed time", async () => {
  const catalog = Object.freeze({
    starCount: 2,
    frameMilliseconds: 1000 / 60,
    streamFrameCount: 6,
    blockFrameCount: 3,
    blockCount: 2,
    blocksPerBank: 1,
    bankFrameCount: 3,
    bankCount: 2,
    runtimeLookaheadBankCount: 1,
    runtimeMaterializedLookaheadBlockCount: 1,
    startupMaterializedLookaheadBlockCount: 0,
    encounterReel: Object.freeze({
      encounterFrameCount: 3,
      encounterCount: 2,
      reformationStartFrameIndex: 2,
      reformationFrameCount: 1,
    }),
  });
  const block0 = preparedBlock(0, [
    [0, 0], [10, 10],
    [10, 10], [0, 0],
    [20, 20], [10, 10],
  ]);
  const block1 = preparedBlock(1, [
    [20, 20], [0, 0],
    [0, 0], [20, 20],
    [10, 10], [20, 20],
  ]);
  const publishedTransforms = new Array(2).fill("");
  const transformPublisher = Object.freeze({
    leafCount: 2,
    publishTransform(leafIndex, transform) {
      publishedTransforms[leafIndex] = transform;
    },
  });
  let now = 0;
  let scheduled = null;
  const player = createGalaxyPreparedPlayer({
    catalog,
    transformPublisher,
    initialBlocks: [block0],
    loadBlock: async () => block1,
    onBlockWindow() {},
    onBankWindow() {},
    readNow: () => now,
    requestFrame(callback) { scheduled = callback; return 1; },
    cancelFrame() {},
  });
  player.startLookahead();
  await Promise.resolve();
  player.resume();

  now = 50;
  scheduled(now);
  assert.equal(player.stats().publishedStreamFrame, 1);
  now = 100;
  scheduled(now);
  assert.equal(player.stats().publishedStreamFrame, 2);
  now = 150;
  scheduled(now);
  assert.equal(player.stats().publishedStreamFrame, 3);
  assert.deepEqual(publishedTransforms, [
    formatGalaxyPreparedTransform(20, 20), formatGalaxyPreparedTransform(0, 0),
  ]);
  assert.equal(player.stats().sourceFrameDropCount, 0);
  assert.deepEqual(player.stats().droppedFrameCauses, {
    schedulerDeadlineCollapse: 0,
    preparedBlockWait: 0,
    preparedBankWait: 0,
    documentHidden: 0,
  });
});

test("holds clock phase across variable 60 Hz callbacks without doubling presentation gaps", () => {
  const nearSixty = createClockFixture();
  nearSixty.player.resume();
  for (const timestamp of [15.7, 33.38, 49.1, 66.78]) {
    nearSixty.step(timestamp);
  }
  assert.equal(nearSixty.player.stats().appliedFrameCount, 5);
  assert.equal(nearSixty.player.stats().publishedStreamFrame, 4);
  assert.ok(nearSixty.player.stats().presentation.maximumMilliseconds < 17.681);

  const highRefresh = createClockFixture();
  highRefresh.player.resume();
  highRefresh.step(8.33);
  assert.equal(highRefresh.player.stats().publishedStreamFrame, 0);
  highRefresh.step(16.67);
  assert.equal(highRefresh.player.stats().publishedStreamFrame, 1);
});

function preparedBlock(index, coordinates) {
  return Object.freeze({
    descriptor: Object.freeze({ index }),
    frameOffsets: Uint32Array.from([0, 2, 4, 6]),
    assignmentLeafIndices: Uint16Array.from([0, 1, 0, 1, 0, 1]),
    transformChunks: Object.freeze([coordinates.map(([x, y]) =>
      formatGalaxyPreparedTransform(x, y))]),
    transformChunkSize: 6_000,
  });
}

function createClockFixture() {
  const catalog = Object.freeze({
    starCount: 1,
    frameMilliseconds: 1000 / 60,
    streamFrameCount: 8,
    blockFrameCount: 8,
    blockCount: 1,
    blocksPerBank: 1,
    bankFrameCount: 8,
    bankCount: 1,
    runtimeLookaheadBankCount: 1,
    runtimeMaterializedLookaheadBlockCount: 1,
    startupMaterializedLookaheadBlockCount: 0,
    encounterReel: Object.freeze({
      encounterFrameCount: 8,
      encounterCount: 1,
      reformationStartFrameIndex: 7,
      reformationFrameCount: 1,
    }),
  });
  const block = Object.freeze({
    descriptor: Object.freeze({ index: 0 }),
    frameOffsets: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    assignmentLeafIndices: Uint16Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
    transformChunks: Object.freeze([Array.from({ length: 8 }, (_, index) =>
      formatGalaxyPreparedTransform(index, index))]),
    transformChunkSize: 8,
  });
  let now = 0;
  let scheduled = null;
  const player = createGalaxyPreparedPlayer({
    catalog,
    transformPublisher: Object.freeze({ leafCount: 1, publishTransform() {} }),
    initialBlocks: [block],
    loadBlock: async () => block,
    onBlockWindow() {},
    onBankWindow() {},
    readNow: () => now,
    requestFrame(callback) { scheduled = callback; return 1; },
    cancelFrame() {},
  });
  return Object.freeze({
    player,
    step(timestamp) {
      now = timestamp;
      scheduled(timestamp);
    },
  });
}
