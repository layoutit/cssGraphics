import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES,
  createFlocksPreparedPlayer,
  resolveFlocksPerspective,
} from "../src/cssflocks/preparedPlayback.mjs";

const catalog = Object.freeze({
  bugCount: 2,
  blockCount: 3,
  blockFrameCount: 2,
  streamFrameCount: 6,
  terminalSeam: Object.freeze({ correspondence: Object.freeze([1, 0]) }),
});

test("prepared Flocks player writes only stable root transforms and currentColor", () => {
  const shapes = [{ style: {} }, { style: {} }];
  let stableChecks = 0;
  const player = createFlocksPreparedPlayer({
    shapeElements: shapes,
    catalog,
    initialBlock: block(0),
    initialLookaheadBlocks: [block(1), block(2)],
    loadBlock: async (index) => block(index),
    assertStableDom() { stableChecks += 1; },
    requestFrame: () => 1,
    cancelFrame: () => undefined,
    readNow: () => 0,
  });
  assert.equal(shapes[0].style.transform, "matrix3d(0-0)");
  assert.equal(shapes[1].style.color, "#000001");
  const initial = player.stats();
  assert.equal(initial.shapeTransformWrites, 2);
  assert.equal(initial.rootColorWrites, 2);
  assert.equal(initial.runtimeClassSwapCount, 0);
  player.seekFrame(1);
  const advanced = player.stats();
  assert.equal(shapes[0].style.transform, "matrix3d(0-1)");
  assert.equal(shapes[0].style.color, "#000100");
  assert.equal(advanced.shapeTransformWrites, 4);
  assert.equal(advanced.rootColorWrites, 4);
  assert.ok(stableChecks >= 2);
  player.destroy();
});

test("Flocks perspective reproduces a 50-degree vertical field of view", () => {
  assert.equal(resolveFlocksPerspective(900), 965.0281);
});

test("continuous playback retains every transform state while bounding flat-color repaint cadence", async () => {
  const frameCount = 8;
  const oneBugCatalog = Object.freeze({ ...catalog, bugCount: 1, blockCount: 1, blockFrameCount: frameCount, streamFrameCount: frameCount, terminalSeam: Object.freeze({ correspondence: Object.freeze([0]) }) });
  const oneBugBlock = Object.freeze({
    schema: "cssflocks-prepared-stream-block@1",
    index: 0,
    startFrameIndex: 0,
    playback: Object.freeze({
      bugCount: 1,
      frameCount,
      frameMilliseconds: 1_000 / 60,
      transforms: Object.freeze(Array.from({ length: frameCount }, (_, index) => `matrix3d(${index})`)),
      colors: Object.freeze(Array.from({ length: frameCount }, (_, index) => `#00000${index}`)),
    }),
  });
  const shape = { style: {} };
  let callback = null;
  let now = 0;
  const player = createFlocksPreparedPlayer({
    shapeElements: [shape],
    catalog: oneBugCatalog,
    initialBlock: oneBugBlock,
    loadBlock: async () => oneBugBlock,
    requestFrame(next) { callback = next; return 1; },
    cancelFrame: () => undefined,
    readNow: () => now,
  });
  player.resume();
  const observedTransforms = [];
  const observedColors = [];
  for (let frame = 1; frame < frameCount; frame += 1) {
    now += 17;
    const next = callback;
    callback = null;
    await next(now);
    observedTransforms.push(shape.style.transform);
    observedColors.push(shape.style.color);
  }
  assert.deepEqual(observedTransforms, Array.from({ length: frameCount - 1 }, (_, index) => `matrix3d(${index + 1})`));
  assert.deepEqual(observedColors, ["#000000", "#000000", "#000000", "#000000", "#000005", "#000005", "#000005"]);
  assert.equal(player.stats().colorPublicationIntervalFrames, CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES);
  assert.equal(player.stats().colorPublicationRateHz, 12);
  player.seekFrame(7);
  assert.equal(shape.style.color, "#000007");
  player.destroy();
});

test("flat-color repaint phases are evenly staggered by stable retained-root index", async () => {
  const bugCount = CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES;
  const frameCount = 6;
  const staggeredCatalog = Object.freeze({
    ...catalog,
    bugCount,
    blockCount: 1,
    blockFrameCount: frameCount,
    streamFrameCount: frameCount,
    terminalSeam: Object.freeze({ correspondence: Object.freeze(Array.from({ length: bugCount }, (_, index) => index)) }),
  });
  const staggeredBlock = Object.freeze({
    schema: "cssflocks-prepared-stream-block@1",
    index: 0,
    startFrameIndex: 0,
    playback: Object.freeze({
      bugCount,
      frameCount,
      frameMilliseconds: 1_000 / 60,
      transforms: Object.freeze(Array.from({ length: frameCount * bugCount }, (_, index) => `matrix3d(${index})`)),
      colors: Object.freeze(Array.from({ length: frameCount * bugCount }, (_, index) => `#${index.toString(16).padStart(6, "0")}`)),
    }),
  });
  const shapes = Array.from({ length: bugCount }, () => ({ style: {} }));
  let callback = null;
  let now = 0;
  const player = createFlocksPreparedPlayer({
    shapeElements: shapes,
    catalog: staggeredCatalog,
    initialBlock: staggeredBlock,
    loadBlock: async () => staggeredBlock,
    requestFrame(next) { callback = next; return 1; },
    cancelFrame: () => undefined,
    readNow: () => now,
  });
  player.resume();
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    const before = shapes.map((shape) => shape.style.color);
    now += 17;
    const next = callback;
    callback = null;
    await next(now);
    const changed = shapes.flatMap((shape, index) => shape.style.color === before[index] ? [] : [index]);
    assert.deepEqual(changed, [(bugCount - frameIndex % bugCount) % bugCount]);
  }
  assert.equal(player.stats().colorPublicationPhaseCount, bugCount);
  assert.equal(player.stats().colorPublicationPolicy, "source-frame-plus-retained-root-index-round-robin");
  player.destroy();
});

test("terminal correspondence composes retained-root source identities without DOM churn", async () => {
  const shapes = [{ style: {} }, { style: {} }];
  let queuedFrame = null;
  let now = 0;
  const player = createFlocksPreparedPlayer({
    shapeElements: shapes,
    catalog,
    initialBlock: block(0),
    initialLookaheadBlocks: [block(1), block(2)],
    loadBlock: async (index) => block(index),
    requestFrame(callback) { queuedFrame = callback; return 1; },
    cancelFrame: () => undefined,
    readNow: () => now,
  });
  player.resume();
  for (let step = 0; step < 6; step += 1) {
    now += 20;
    const callback = queuedFrame;
    queuedFrame = null;
    await callback(now);
  }
  assert.equal(player.stats().terminalWrapCount, 1);
  assert.equal(player.stats().terminalPermutationCompositionCount, 1);
  assert.equal(shapes[0].style.transform, "matrix3d(0-0b)");
  assert.equal(shapes[1].style.transform, "matrix3d(0-0)");
  player.destroy();
});

test("paused absolute seek and stepping cross the terminal seam on stable retained roots", async () => {
  const shapes = [{ style: {} }, { style: {} }];
  const identities = [...shapes];
  const player = createFlocksPreparedPlayer({
    shapeElements: shapes,
    catalog,
    initialBlock: block(0),
    initialLookaheadBlocks: [block(1), block(2)],
    loadBlock: async (index) => block(index),
  });
  await player.seekStreamFrame(4);
  assert.equal(player.stats().streamFrameIndex, 4);
  assert.equal(shapes[0].style.transform, "matrix3d(2-0)");
  await player.stepFrame();
  assert.equal(player.stats().streamFrameIndex, 5);
  await player.stepFrame();
  assert.equal(player.stats().streamFrameIndex, 0);
  assert.equal(player.stats().terminalWrapCount, 1);
  assert.equal(player.stats().terminalPermutationCompositionCount, 1);
  assert.equal(shapes[0].style.transform, "matrix3d(0-0b)");
  assert.deepEqual(shapes, identities);
  assert.equal(player.stats().debugAbsoluteSeekCount, 1);
  assert.equal(player.stats().debugStepCount, 2);
  player.destroy();
});

test("superseded prefetch rejection cannot poison a later absolute sequence seek", async () => {
  const staleOne = deferred();
  const staleTwo = deferred();
  const calls = new Map();
  const errors = [];
  const seekCatalog = Object.freeze({
    bugCount: 2,
    blockCount: 4,
    blockFrameCount: 1,
    streamFrameCount: 4,
    terminalSeam: Object.freeze({ correspondence: Object.freeze([0, 1]) }),
  });
  const blocks = Array.from({ length: 4 }, (_, index) => singleFrameBlock(index));
  const player = createFlocksPreparedPlayer({
    shapeElements: [{ style: {} }, { style: {} }],
    catalog: seekCatalog,
    initialBlock: blocks[0],
    loadBlock: async (index) => {
      const count = (calls.get(index) ?? 0) + 1;
      calls.set(index, count);
      if (index === 1 && count === 1) return staleOne.promise;
      if (index === 2 && count === 1) return staleTwo.promise;
      return blocks[index];
    },
    onError(error) { errors.push(error); },
  });
  await player.seekStreamFrame(3);
  staleOne.reject(new Error("superseded one"));
  staleTwo.reject(new Error("superseded two"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, []);
  assert.equal(player.stats().streamFrameIndex, 3);
  player.destroy();
});

function block(index) {
  return Object.freeze({
    schema: "cssflocks-prepared-stream-block@1",
    index,
    startFrameIndex: index * 2,
    playback: Object.freeze({
      bugCount: 2,
      frameCount: 2,
      frameMilliseconds: 1_000 / 60,
      transforms: Object.freeze([`matrix3d(${index}-0)`, `matrix3d(${index}-0b)`, `matrix3d(${index}-1)`, `matrix3d(${index}-1b)`]),
      colors: Object.freeze(["#000000", "#000001", "#000100", "#000101"]),
    }),
  });
}

function singleFrameBlock(index) {
  return Object.freeze({
    schema: "cssflocks-prepared-stream-block@1",
    index,
    startFrameIndex: index,
    playback: Object.freeze({
      bugCount: 2,
      frameCount: 1,
      frameMilliseconds: 1_000 / 60,
      transforms: Object.freeze([`matrix3d(${index}-0)`, `matrix3d(${index}-1)`]),
      colors: Object.freeze(["#000000", "#000001"]),
    }),
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
