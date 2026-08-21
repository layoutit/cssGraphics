import assert from "node:assert/strict";
import test from "node:test";
import { createCyclonePreparedPlayer } from "../src/csscyclone/preparedPlayback.mjs";

const identity = () => undefined;
const originalHTMLElement = globalThis.HTMLElement;

class FakeHTMLElement {
  constructor() {
    this.ownerDocument = {};
    this.style = {
      transform: "",
      backgroundColor: "",
      setProperty(name, value) { this[name] = value; },
    };
  }
}

globalThis.HTMLElement = FakeHTMLElement;
test.after(() => {
  if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
  else globalThis.HTMLElement = originalHTMLElement;
});

function fixture({
  blockCount = 1,
  runtimeLookaheadBlockCount = 1,
  runtimeMaterializedLookaheadBlockCount = Math.min(2, runtimeLookaheadBlockCount),
  initialLookaheadBlockCount = 0,
  schedulerMode = "deadline-timer-raf",
} = {}) {
  let now = 0;
  let nextRequestId = 0;
  const frames = new Map();
  const delays = new Map();
  const shapeElements = Array.from({ length: 2 }, () => new FakeHTMLElement());
  const leafElements = Array.from({ length: 2 }, () => new FakeHTMLElement());
  const playback = {
    schema: "csscyclone-prepared-dom-playback@5",
    modelId: "cyclone",
    streamId: "stream",
    streamBlockIndex: 0,
    chunkIndex: 0,
    blockIndex: 0,
    chunkCount: 1,
    blockCount,
    blocksPerChunk: blockCount,
    startFrameIndex: 0,
    frameCount: 4,
    particleCount: 2,
    leafCount: 2,
    framesPerSecond: 60,
    frameMilliseconds: 1_000 / 60,
    durationMilliseconds: 4 / 60 * 1_000,
    loop: false,
    transforms: ["a", "b", "c", "d", "e", "f", "g", "h"],
  };
  const lighting = {
    schema: "csscyclone-prepared-energy-balanced-continuous-hue-vertex-lighting-colors@15",
    streamId: "stream",
    chunkCount: 1,
    chunkFrameCount: blockCount * 4,
    leafCount: 2,
    facesPerParticle: 1,
    colorStateCount: 1,
    colorRestartCount: 0,
    colorEntryCount: 1,
    uniqueColorCount: 1,
    deduplicatedColorCount: 0,
    colorDeduplication: "exact-cross-palette-css-srgb-tuples",
    colorSlotIndexCount: 1,
    paletteVariantCount: 1,
    variants: [{ paletteVariantId: "rotate-000", colors: ["#123456"] }],
    runtime: { lightingCalculations: 0, imageConstruction: 0 },
  };
  const blocks = Array.from({ length: blockCount }, (_, streamBlockIndex) => {
    const blockPlayback = {
      ...playback,
      streamBlockIndex,
      blockIndex: streamBlockIndex,
      startFrameIndex: streamBlockIndex * 4,
    };
    return {
      schema: "csscyclone-prepared-stream-block@2",
      streamId: "stream",
      streamBlockIndex,
      chunkIndex: 0,
      blockIndex: streamBlockIndex,
      startFrameIndex: streamBlockIndex * 4,
      frameCount: 4,
      playback: blockPlayback,
      lighting: {
        schema: "csscyclone-prepared-lighting-block@2",
        streamId: "stream",
        streamBlockIndex,
        chunkIndex: 0,
        blockIndex: streamBlockIndex,
        startFrameIndex: streamBlockIndex * 4,
        frameCount: 4,
        particleCount: 2,
        frameParticleColorStateIndices: new Uint16Array(8),
      },
    };
  });
  const catalog = {
    schema: "csscyclone-prepared-stream-catalog@3",
    streamId: "stream",
    chunkCount: 1,
    chunkFrameCount: blockCount * 4,
    blockCount,
    entries: Array.from({ length: blockCount }, () => ({})),
    blocksPerChunk: blockCount,
    blockFrameCount: 4,
    framesPerSecond: 60,
    frameMilliseconds: 1_000 / 60,
    runtimeLookaheadBlockCount,
    runtimeMaterializedLookaheadBlockCount,
    streamFrameCount: blockCount * 4,
    streamDurationMilliseconds: blockCount * 4 / 60 * 1_000,
  };
  const mounted = {
    model: {
      identity: { id: "cyclone" },
      render: {
        shapes: [{ id: "shape-0" }, { id: "shape-1" }],
        leaves: [{ id: "leaf-0" }, { id: "leaf-1" }],
      },
    },
    modelElement: new FakeHTMLElement(),
    cameraElement: new FakeHTMLElement(),
    sceneElement: new FakeHTMLElement(),
    shapeElements: new Map([["shape-0", shapeElements[0]], ["shape-1", shapeElements[1]]]),
    leafHandles: new Map([["leaf-0", { element: leafElements[0] }], ["leaf-1", { element: leafElements[1] }]]),
    assertStableDomIdentity: identity,
    destroy: identity,
  };
  const loadBlockCalls = [];
  const player = createCyclonePreparedPlayer({
    mounted,
    modelTransform: "matrix3d(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1)",
    catalog,
    initialBlock: blocks[0],
    initialLookaheadBlocks: blocks.slice(1, initialLookaheadBlockCount + 1),
    initialFrameIndex: 0,
    lighting,
    lightingColors: {
      paletteVariantId: "rotate-000",
      hueRotation: 0,
      colors: lighting.variants[0].colors,
      colorSlotIndices: new Uint16Array([0]),
      destroy: identity,
    },
    schedulerMode,
    loadBlock: async (streamBlockIndex) => {
      loadBlockCalls.push(streamBlockIndex);
      return blocks[streamBlockIndex];
    },
    readNow: () => now,
    requestFrame(callback) {
      const id = ++nextRequestId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    requestDelay(callback, delay) {
      const id = ++nextRequestId;
      delays.set(id, { callback, delay });
      return id;
    },
    cancelDelay: (id) => delays.delete(id),
  });
  return {
    player,
    shapeElements,
    frames,
    delays,
    loadBlockCalls,
    setNow(value) { now = value; },
    fireDelay() {
      const [id, request] = delays.entries().next().value;
      delays.delete(id);
      request.callback();
      return request.delay;
    },
    async fireFrame() {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      await callback(now);
    },
    async advanceAt(value) {
      now = value;
      if (delays.size > 0) this.fireDelay();
      await this.fireFrame();
    },
  };
}

test("hands each prepared publication from its deadline timer to requestAnimationFrame", async () => {
  const state = fixture();
  state.player.resume();
  assert.equal(state.delays.size, 1);
  assert.equal(state.frames.size, 0);
  assert.equal(state.fireDelay(), 1_000 / 60 - 8);
  assert.equal(state.frames.size, 1);
  state.setNow(20);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["c", "d"]);
  assert.equal(state.delays.size, 1);
  const stats = state.player.stats();
  assert.equal(stats.runtimeSchedulerTransport, "deadline-setTimeout-requestAnimationFrame-prepared-publication");
  assert.equal(stats.schedulerFrameCallbackCount, 1);
  assert.equal(stats.schedulerDelayCallbackCount, 1);
});

test("can sample the same prepared publication from a continuous animation-frame clock", async () => {
  const state = fixture({ schedulerMode: "continuous-raf" });
  state.player.resume();
  assert.equal(state.delays.size, 0);
  assert.equal(state.frames.size, 1);
  state.setNow(7);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["a", "b"]);
  assert.equal(state.frames.size, 1);
  state.setNow(8);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["c", "d"]);
  const stats = state.player.stats();
  assert.equal(stats.runtimeSchedulerTransport, "continuous-requestAnimationFrame-prepared-publication");
  assert.equal(stats.schedulerDelayRequestCount, 0);
  assert.equal(stats.schedulerFrameCallbackCount, 2);
});

test("starts from one materialized successor while filling the verified horizon", async () => {
  const state = fixture({
    blockCount: 13,
    runtimeLookaheadBlockCount: 11,
    initialLookaheadBlockCount: 1,
  });
  assert.deepEqual(state.player.stats().pendingBlockIndices, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(state.player.stats().pendingBlockReadyCount, 1);
  assert.deepEqual(state.loadBlockCalls, [2]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state.player.stats().pendingBlockReadyCount, 2);

  state.player.resume();
  await state.advanceAt(20);
  await state.advanceAt(40);
  await state.advanceAt(60);
  await state.advanceAt(80);
  await Promise.resolve();

  const stats = state.player.stats();
  assert.equal(stats.activeBlockIndex, 1);
  assert.deepEqual(stats.pendingBlockIndices, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(stats.pendingBlockReadyCount, 2);
  assert.equal(stats.runtimePreparedBlockWaitCount, 0);
  assert.deepEqual(state.loadBlockCalls, [2, 3]);
});

test("publishes one adjacent prepared frame and resets a missed deadline", async () => {
  const state = fixture();
  state.player.resume();
  state.fireDelay();
  state.setNow(57);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["c", "d"]);
  const stats = state.player.stats();
  assert.equal(stats.frameIndex, 1);
  assert.equal(stats.collapsedFrameCount, 0);
  assert.equal(stats.schedulerLateResetCount, 1);
  assert.equal(stats.applyCount, 2);
  assert.equal(stats.shapeTransformWrites, 4);
});

test("does not skip a prepared frame when only the scheduler lead crosses its deadline", async () => {
  const state = fixture();
  state.player.resume();
  state.fireDelay();
  state.setNow(26);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["c", "d"]);
  const stats = state.player.stats();
  assert.equal(stats.frameIndex, 1);
  assert.equal(stats.collapsedFrameCount, 0);
  assert.equal(stats.applyCount, 2);
});

test("pause cancels pending delay and frame requests", () => {
  const delayed = fixture();
  delayed.player.resume();
  delayed.player.pause();
  assert.equal(delayed.delays.size, 0);
  assert.equal(delayed.player.stats().schedulerDelayCancelCount, 1);

  const framed = fixture();
  framed.player.resume();
  framed.fireDelay();
  framed.player.pause();
  assert.equal(framed.frames.size, 0);
  assert.equal(framed.player.stats().schedulerFrameCancelCount, 1);
});
