// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { createBlackHolePreparedPlayer } from
  "../src/cssblackhole/preparedPlayback.mjs";

test("Luminet publishes every nominal 60 Hz refresh despite callback jitter", () => {
  const catalog = Object.freeze({
    starCount: 4,
    frameMilliseconds: 1000 / 60,
    blockFrameCount: 4,
    blockCount: 1,
    blocksPerBank: 1,
    bankCount: 1,
    streamFrameCount: 4,
    runtimeMaterializedLookaheadBlockCount: 1,
    runtimeLookaheadBankCount: 1,
    startupMaterializedLookaheadBlockCount: 0,
    publication: Object.freeze({ snapshotOwnsInitialFrame: true }),
    snapshot: Object.freeze({ initialStreamFrame: 0 }),
    configurationLoop: Object.freeze({
      presentationSequenceFrameCount: 4,
      presentationSlotStartFrameIndices: Object.freeze([0]),
      transitionStartFrameIndices: Object.freeze([2]),
      transitionFrameCount: 2,
      configurationTransitionCount: 1,
    }),
  });
  const block = Object.freeze({
    descriptor: Object.freeze({ index: 0 }),
    frameOffsets: Uint32Array.from([0, 4, 8, 12, 16]),
    assignmentLeafIndices: Uint16Array.from(Array.from(
      { length: 16 }, (_, index) => index % 4)),
    transformChunks: Object.freeze([Object.freeze(Array.from(
      { length: 16 }, (_, index) => `translate(${index}px, ${index}px)`))]),
    transformChunkSize: 4096,
    opacityFrameOffsets: Uint32Array.from([0, 4, 8, 12, 16]),
    opacityLeafIndices: Uint16Array.from(Array.from(
      { length: 16 }, (_, index) => index % 4)),
    opacityIndices: Uint8Array.from(Array.from({ length: 16 }, (_, index) => index)),
  });
  const writes = [];
  let now = 0;
  let pendingFrame = null;
  let canceledFrameCount = 0;
  const player = createBlackHolePreparedPlayer({
    catalog,
    transformPublisher: Object.freeze({
      leafCount: 4,
      publishTransform(leafIndex, transform) { writes.push(["transform", leafIndex, transform]); },
      publishOpacity(leafIndex, opacityIndex) { writes.push(["opacity", leafIndex, opacityIndex]); },
    }),
    initialBlocks: [block],
    initialStreamFrame: 0,
    initialSnapshotPresented: true,
    loadBlock: async () => block,
    onBlockWindow() {},
    onBankWindow() {},
    readNow: () => now,
    requestFrame(callback) { pendingFrame = callback; return 1; },
    cancelFrame() { pendingFrame = null; canceledFrameCount += 1; },
  });

  assert.equal(writes.length, 0);
  assert.equal(player.stats().publishedStreamFrame, 0);
  assert.equal(player.stats().initialSnapshotReuseCount, 1);
  assert.equal(player.stats().initialSnapshotDomWriteCount, 0);

  player.resume();
  assert.equal(typeof pendingFrame, "function");
  now = 8;
  let frame = pendingFrame;
  pendingFrame = null;
  frame(now);
  assert.equal(writes.length, 0);
  assert.equal(typeof pendingFrame, "function");
  now = 21.552;
  frame = pendingFrame;
  pendingFrame = null;
  frame(now);
  assert.equal(writes.length, 0);
  assert.equal(typeof pendingFrame, "function");
  now = 38.261;
  frame = pendingFrame;
  pendingFrame = null;
  frame(now);
  assert.equal(writes.length, 8);
  assert.equal(typeof pendingFrame, "function");
  now = 54.885;
  frame = pendingFrame;
  pendingFrame = null;
  frame(now);

  const stats = player.stats();
  assert.equal(writes.length, 16);
  assert.equal(stats.appliedFrameCount, 2);
  assert.equal(stats.publishedStreamFrame, 2);
  assert.equal(stats.transformWriteCount, 8);
  assert.equal(stats.opacityWriteCount, 8);
  assert.equal(stats.schedulerFrameCallbackCount, 4);
  assert.equal(stats.schedulerCalibrationFrameCallbackCount, 2);
  assert.equal(stats.schedulerCalibrationIntervalCount, 2);
  assert.equal(stats.schedulerCalibratedDisplayFrameMilliseconds, 15.131);
  assert.equal(stats.schedulerEarlyFrameCallbackCount, 0);
  assert.equal(stats.schedulerCadenceMode, "display-refresh-at-or-below-sixty-hertz");
  assert.equal(stats.schedulerDelayRequestCount, 0);
  assert.equal(stats.schedulerDelayCallbackCount, 0);
  assert.equal(stats.schedulerNoopCallbackCount, 0);
  assert.equal(stats.schedulerLeadMilliseconds, 0);
  assert.equal(stats.runtimeSchedulerTransport,
    "wall-clock-anchored-requestAnimationFrame-prepared-publication-at-up-to-sixty-hertz");
  assert.equal(stats.sourceFrameDropCount, 0);

  now = 88.218;
  frame = pendingFrame;
  pendingFrame = null;
  frame(now);
  const thirtyHertzStats = player.stats();
  assert.equal(thirtyHertzStats.publishedStreamFrame, 0);
  assert.equal(thirtyHertzStats.appliedFrameCount, 3);
  assert.equal(thirtyHertzStats.sourceFrameDropCount, 1);
  assert.equal(thirtyHertzStats.droppedFrameCauses.schedulerDeadlineCollapse, 1);

  player.pause();
  assert.equal(canceledFrameCount, 1);
  player.destroy();
});
