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
      backgroundPosition: "",
      setProperty(name, value) { this[name] = value; },
    };
  }
}

globalThis.HTMLElement = FakeHTMLElement;
test.after(() => {
  if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
  else globalThis.HTMLElement = originalHTMLElement;
});

function fixture() {
  let now = 0;
  let nextRequestId = 0;
  const frames = new Map();
  const delays = new Map();
  const shapeElements = Array.from({ length: 2 }, () => new FakeHTMLElement());
  const leafElements = Array.from({ length: 2 }, () => new FakeHTMLElement());
  const playback = {
    schema: "csscyclone-prepared-dom-playback@3",
    modelId: "cyclone",
    streamId: "stream",
    streamBlockIndex: 0,
    chunkIndex: 0,
    blockIndex: 0,
    chunkCount: 1,
    blockCount: 1,
    blocksPerChunk: 1,
    startFrameIndex: 0,
    frameCount: 4,
    particleCount: 2,
    leafCount: 2,
    frameMilliseconds: 20,
    durationMilliseconds: 80,
    transforms: ["a", "b", "c", "d", "e", "f", "g", "h"],
    mounted: { shapeTransformIndices: [0, 1] },
    frames: [
      [0, 0, 1, 1],
      [0, 2, 1, 3],
      [0, 4, 1, 5],
      [0, 6, 1, 7],
    ],
  };
  const lighting = {
    schema: "csscyclone-prepared-smooth-lighting-atlas@7",
    streamId: "stream",
    chunkCount: 1,
    chunkFrameCount: 4,
    leafCount: 2,
    facesPerParticle: 1,
    colorStateCount: 1,
    colorRestartCount: 0,
    tileCount: 1,
    uniqueTileCount: 1,
    deduplicatedTileCount: 0,
    tileDeduplication: "exact-cross-palette-rgba8-slot-content",
    packing: "near-square-row-major-unique-slots",
    tileBackgroundPositions: ["0 0"],
    paletteHueSlotCount: 3,
    maximumColorFamilyCount: 3,
    variants: [{ paletteFamily: "blue", assetSha256: "hash" }],
    runtime: { lightingCalculations: 0, atlasConstruction: 0 },
  };
  const block = {
    schema: "csscyclone-prepared-stream-block@1",
    streamId: "stream",
    streamBlockIndex: 0,
    chunkIndex: 0,
    blockIndex: 0,
    startFrameIndex: 0,
    frameCount: 4,
    playback,
    lighting: {
      schema: "csscyclone-prepared-lighting-block@1",
      streamId: "stream",
      streamBlockIndex: 0,
      chunkIndex: 0,
      blockIndex: 0,
      startFrameIndex: 0,
      frameCount: 4,
      particleCount: 2,
      frameParticleColorStateIndices: [[0, 0], [0, 0], [0, 0], [0, 0]],
    },
  };
  const catalog = {
    schema: "csscyclone-prepared-stream-catalog@1",
    streamId: "stream",
    chunkCount: 1,
    chunkFrameCount: 4,
    blockCount: 1,
    entries: [{}],
    blocksPerChunk: 1,
    blockFrameCount: 4,
    runtimeLookaheadBlockCount: 1,
    streamFrameCount: 4,
    streamDurationMilliseconds: 80,
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
  const player = createCyclonePreparedPlayer({
    mounted,
    modelTransform: "matrix3d(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1)",
    catalog,
    initialBlock: block,
    initialFrameIndex: 0,
    lighting,
    lightingAsset: {
      url: "atlas.png",
      byteLength: 1,
      sha256: "hash",
      paletteFamily: "blue",
      hueSlots: [0.5, 2 / 3, 5 / 6],
      destroy: identity,
    },
    loadBlock: async () => block,
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
  };
}

test("hands each prepared publication from its deadline timer to requestAnimationFrame", async () => {
  const state = fixture();
  state.player.resume();
  assert.equal(state.delays.size, 1);
  assert.equal(state.frames.size, 0);
  assert.equal(state.fireDelay(), 16);
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

test("collapses missed prepared frames once at the next paint-aligned callback", async () => {
  const state = fixture();
  state.player.resume();
  state.fireDelay();
  state.setNow(61);
  await state.fireFrame();
  assert.deepEqual(state.shapeElements.map((element) => element.style.transform), ["g", "h"]);
  const stats = state.player.stats();
  assert.equal(stats.frameIndex, 3);
  assert.equal(stats.collapsedFrameCount, 2);
  assert.equal(stats.applyCount, 2);
  assert.equal(stats.shapeTransformWrites, 4);
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
