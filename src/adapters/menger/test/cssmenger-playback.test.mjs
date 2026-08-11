import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  COLOR_PUBLICATION_INTERVAL_TICKS,
  createCssmengerPreparedPlayer,
  timelineStateIndexForTick,
} from "../src/cssmenger/preparedPlayback.mjs";
import { buildPreparedMengerPlayback } from "../src/prepare/cssmenger/sourcePlayback.mjs";

test("prepared XScreenSaver random, palette, and rotator segment is deterministic", () => {
  const playback = buildPreparedMengerPlayback();
  assert.equal(playback.seed, 26080801);
  assert.equal(playback.stateCount, 1440);
  assert.equal(playback.palette.length, 128);
  assert.equal(playback.transforms.length, 1440);
  assert.equal(playback.nativeRotationDegrees.length, 1440);
  assert.equal(playback.colorRows.length, 1440);
  assert.equal(hash(playback.palette), "84d4a563fb968f6e084dd7e7d88e40dc5953a86b0794c5b0e19283ab47d5b55f");
  assert.equal(hash(playback.transforms), "92d277579d2e3af381b8ed3e25fcd90a64e81998047ae58b027952d1e4123bc3");
  assert.equal(hash(playback.colorRows), "eca63f6fa95d349ff7963628ebad2f8bbb2924e02a0e3c22055d9b718297d224");
  assert.equal(playback.transforms[0], "rotateX(-95.527948277deg) rotateY(94.637081676deg) rotateZ(-94.183856868deg)");
  assert.deepEqual(playback.colorRows[0], [0, 42, 84]);
  assert.equal(playback.adjacentPublicationMode, "all-fields-change");
  assert.equal(playback.transformAngleMode, "prepared-nearest-equivalent-unwrapped-degrees");
  for (let stateIndex = 1; stateIndex < playback.stateCount; stateIndex += 1) {
    assert.notEqual(playback.transforms[stateIndex], playback.transforms[stateIndex - 1]);
    const previousDegrees = transformDegrees(playback.transforms[stateIndex - 1]);
    const currentDegrees = transformDegrees(playback.transforms[stateIndex]);
    assert.equal(currentDegrees.every((value, axis) => Math.abs(value - previousDegrees[axis]) < 180), true);
    const nativeDegrees = playback.nativeRotationDegrees[stateIndex];
    const sourceTransformDegrees = [-nativeDegrees[0], nativeDegrees[1], -nativeDegrees[2]];
    assert.equal(currentDegrees.every((value, axis) => equivalentAngleDelta(value, sourceTransformDegrees[axis]) < 1e-7), true);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.notEqual(playback.colorRows[stateIndex][axis], playback.colorRows[stateIndex - 1][axis]);
    }
  }
  assert.equal(playback.runtimeInterpolation, false);
  assert.equal(playback.runtimeColorGeneration, false);
  assert.equal(playback.runtimeRotationCalculation, false);
});

function transformDegrees(transform) {
  return [...transform.matchAll(/rotate[XYZ]\((-?[0-9.]+)deg\)/gu)].map((match) => Number(match[1]));
}

function equivalentAngleDelta(left, right) {
  return Math.abs(((left - right + 180) % 360 + 360) % 360 - 180);
}

test("steady playback publishes one prepared sparse-lighting address set per source tick", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  let modelTransformWrites = 0;
  let lightingAddressWrites = 0;
  class FakeHTMLElement {
    constructor() {
      let transform = "";
      let backgroundPosition = "";
      this.style = {
        setProperty: (name, value) => {
          this.style[name] = value;
        },
        getPropertyValue: () => { throw new Error("runtime DOM style read"); },
      };
      Object.defineProperties(this.style, {
        transform: {
          get: () => transform,
          set: (value) => { transform = value; modelTransformWrites += 1; },
        },
        backgroundPosition: {
          get: () => backgroundPosition,
          set: (value) => { backgroundPosition = value; lightingAddressWrites += 1; },
        },
      });
    }
  }
  globalThis.HTMLElement = FakeHTMLElement;
  try {
    const sourcePlayback = buildPreparedMengerPlayback({ stateCount: 5 });
    const playback = {
      ...sourcePlayback,
      frontFacingSchedule: {
        schema: "cssmenger-prepared-front-facing-leaf-schedule@1",
        encoding: "state-axis-offsets-plus-global-leaf-indices",
        stateCount: sourcePlayback.stateCount,
        axisCount: 3,
        offsets: Array.from({ length: sourcePlayback.stateCount * 3 + 1 }, (_, index) => index * 14),
        leafIndices: Array.from({ length: sourcePlayback.stateCount }, () =>
          Array.from({ length: 3 }, (_, axis) =>
            Array.from({ length: 14 }, (_, index) => axis * 28 + index))).flat(2),
        minimumSelectedLeafCountPerState: 42,
        maximumSelectedLeafCountPerState: 42,
        averageSelectedLeafCountPerState: 42,
        frontFaceDilationTicks: 1,
      },
    };
    const publicationRoot = new FakeHTMLElement();
    const planeAtlas = fakeSparseAtlas(playback.frontFacingSchedule);
    const leaves = Array.from({ length: 84 }, () => new FakeHTMLElement());
    const player = createCssmengerPreparedPlayer({
      playback,
      planeAtlas,
      publicationRoot,
      leaves,
      requestFrame: () => 1,
      cancelFrame: () => {},
      requestDelay: () => 1,
      cancelDelay: () => {},
    });

    const defaultStats = player.stats();
    assert.equal(defaultStats.preparedColorPublicationIntervalTicks, COLOR_PUBLICATION_INTERVAL_TICKS);
    assert.equal(defaultStats.preparedColorPublicationDelayMilliseconds, 60);
    assert.equal(defaultStats.preparedLightingAddressPublicationIntervalTicks, 1);
    assert.equal(defaultStats.preparedLightingAddressPublicationDelayMilliseconds, 30);
    assert.equal(defaultStats.preparedLoopPresentationMode,
      "prepared-adjacent-state-ping-pong-no-reset");
    assert.equal(defaultStats.preparedFlatSceneLeafLightingSeparation, true);
    assert.equal(defaultStats.preparedFrontFacingAxisSelectionsPerScheduledTick, 3);
    assert.equal(modelTransformWrites, 1);
    assert.equal(lightingAddressWrites, 42);
    player.step();
    assert.equal(modelTransformWrites, 2);
    assert.equal(lightingAddressWrites, 84);
    player.step();
    assert.equal(modelTransformWrites, 3);
    assert.equal(lightingAddressWrites, 126);
    player.step();
    assert.equal(modelTransformWrites, 4);
    const afterAdvance = player.stats();
    assert.equal(lightingAddressWrites, 168);
    assert.equal(leaves[0].style.backgroundPosition, "0px -243px");
    assert.equal(leaves[28].style.backgroundPosition, "0px -270px");
    assert.equal(leaves[56].style.backgroundPosition, "0px -297px");
    assert.equal(afterAdvance.runtimeHotPathDomStyleReadCount, 0);
    assert.equal(afterAdvance.runtimeLightingCalculationCount, 0);
    assert.equal(afterAdvance.preparedLightingAtlasAssetCount, 1);
    assert.equal(afterAdvance.preparedLightingAtlasSlotCount, 210);

    player.setTick(2);
    assert.equal(modelTransformWrites, 5);
    assert.equal(lightingAddressWrites, 210);
    assert.equal(leaves[0].style.backgroundPosition, "0px -162px");
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});

test("CSS palette playback selects prepared rows and per-source-cell shadow addresses", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  let transformWrites = 0;
  let lightingWrites = 0;
  class FakeHTMLElement {
    constructor() {
      let transform = "";
      let backgroundPosition = "";
      this.style = {
        setProperty: (name, value) => { this.style[name] = value; },
        getPropertyValue: () => { throw new Error("runtime DOM style read"); },
      };
      Object.defineProperty(this.style, "transform", {
        get: () => transform,
        set: (value) => { transform = value; transformWrites += 1; },
      });
      Object.defineProperty(this.style, "backgroundPosition", {
        get: () => backgroundPosition,
        set: (value) => { backgroundPosition = value; lightingWrites += 1; },
      });
    }
  }
  globalThis.HTMLElement = FakeHTMLElement;
  try {
    const sourcePlayback = buildPreparedMengerPlayback({ stateCount: 5 });
    const playback = {
      ...sourcePlayback,
      frontFacingSchedule: {
        schema: "cssmenger-prepared-front-facing-leaf-schedule@1",
        encoding: "state-axis-offsets-plus-global-leaf-indices",
        stateCount: sourcePlayback.stateCount,
        axisCount: 3,
        offsets: Array.from({ length: sourcePlayback.stateCount * 3 + 1 }, (_, index) => index * 14),
        leafIndices: Array.from({ length: sourcePlayback.stateCount }, () =>
          Array.from({ length: 3 }, (_, axis) =>
            Array.from({ length: 14 }, (_, index) => axis * 28 + index))).flat(2),
        minimumSelectedLeafCountPerState: 42,
        maximumSelectedLeafCountPerState: 42,
        averageSelectedLeafCountPerState: 42,
        frontFaceDilationTicks: 1,
      },
    };
    const shadowAtlas = {
      ...fakeSparseAtlas(playback.frontFacingSchedule, { addressPublicationIntervalTicks: 2 }),
      presentation: "css-black-alpha",
      preparedAxisPaletteSourceIndices: [1, 0, 2],
      preparedPaletteColors: Array.from({ length: 128 }, (_, index) => `rgb(${index} ${index} ${index})`),
    };
    const baseAtlas = {
      schema: "cssmenger-prepared-coplanar-plane-atlas@1",
      paletteRole: "css-opacity-base",
      paletteStateCount: 128,
      leafCount: 84,
      patternCount: 1,
      patternRows: [[1, 1, 27, 27]],
      leafPatternIndices: Array(84).fill(0),
      paletteBackgroundPositionYs: Array.from({ length: 128 }, (_, index) => `${-(index * 29 + 1)}px`),
    };
    const publicationRoot = new FakeHTMLElement();
    const leaves = Array.from({ length: 84 }, () => new FakeHTMLElement());
    const player = createCssmengerPreparedPlayer({
      playback,
      planeAtlas: shadowAtlas,
      baseAtlas,
      publicationRoot,
      leaves,
      lightingPresentation: "css-opacity",
      axisLeafCounts: [28, 28, 28],
      requestFrame: () => 1,
      cancelFrame: () => {},
      requestDelay: () => 1,
      cancelDelay: () => {},
    });
    assert.equal(transformWrites, 1);
    assert.equal(lightingWrites, 84);
    assert.match(leaves[0].style.backgroundPosition, /^0px 0px, -1px -\d+px$/u);
    player.step();
    assert.equal(transformWrites, 2);
    assert.equal(lightingWrites, 84);
    player.step();
    assert.equal(transformWrites, 3);
    assert.equal(lightingWrites, 126);
    assert.match(leaves[0].style.backgroundPosition, /^0px -81px, -1px -\d+px$/u);
    const stats = player.stats();
    assert.equal(stats.preparedColorPublicationIntervalTicks, 2);
    assert.equal(stats.preparedColorPublicationDelayMilliseconds, 60);
    assert.equal(stats.preparedLightingAddressPublicationIntervalTicks, 2);
    assert.equal(stats.preparedLightingAddressPublicationDelayMilliseconds, 60);
    assert.equal(stats.preparedLightingAtlasAssetCount, 2);
    assert.equal(stats.preparedFlatSceneLeafLightingSeparation, true);
    assert.equal(stats.preparedCssOpacityWriteCountPerScheduledTick, 0);
    assert.equal(stats.preparedCssPaletteWriteCountPerScheduledTick, 21);
    assert.equal(stats.preparedLightingAddressWritesPerScheduledTick.average, 25.2);
    assert.equal(stats.runtimeLightingCalculationCount, 0);

    player.step(2);
    assert.equal(player.tick, 4);
    assert.match(leaves[0].style.backgroundPosition, /^0px -162px, -1px -\d+px$/u);
    player.step();
    assert.equal(player.tick, 3);
    assert.match(leaves[0].style.backgroundPosition, /^0px -81px, -1px -\d+px$/u);
    player.step(2);
    assert.equal(player.tick, 1);
    assert.match(leaves[0].style.backgroundPosition, /^0px 0px, -1px -\d+px$/u);
    player.step();
    assert.equal(player.tick, 0);
    player.step();
    assert.equal(player.tick, 1);
    assert.equal(player.stats().preparedLoopPresentationMode,
      "prepared-adjacent-state-ping-pong-no-reset");
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});

test("prepared playback wraps forever at the prepared sequence boundary", () => {
  const playback = buildPreparedMengerPlayback({ stateCount: 12 });
  assert.equal(playback.loop, true);
  assert.equal(timelineStateIndexForTick(0, playback), 0);
  assert.equal(timelineStateIndexForTick(8, playback), 8);
  assert.equal(timelineStateIndexForTick(11, playback), 11);
  assert.equal(timelineStateIndexForTick(12, playback), 0);
  assert.equal(timelineStateIndexForTick(999, playback), 3);
});

test("frozen mobile lighting initializes every leaf once and never publishes lighting again", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  let transformWrites = 0;
  let lightingAddressWrites = 0;
  class FakeHTMLElement {
    constructor() {
      let transform = "";
      let backgroundPosition = "";
      this.style = {};
      Object.defineProperties(this.style, {
        transform: {
          get: () => transform,
          set: (value) => { transform = value; transformWrites += 1; },
        },
        backgroundPosition: {
          get: () => backgroundPosition,
          set: (value) => { backgroundPosition = value; lightingAddressWrites += 1; },
        },
      });
    }
  }
  globalThis.HTMLElement = FakeHTMLElement;
  try {
    const sourcePlayback = buildPreparedMengerPlayback({ stateCount: 5 });
    const playback = {
      ...sourcePlayback,
      frontFacingSchedule: {
        schema: "cssmenger-prepared-front-facing-leaf-schedule@1",
        encoding: "state-axis-offsets-plus-global-leaf-indices",
        stateCount: sourcePlayback.stateCount,
        axisCount: 3,
        offsets: Array.from({ length: sourcePlayback.stateCount * 3 + 1 }, (_, index) => index * 14),
        leafIndices: Array.from({ length: sourcePlayback.stateCount }, () =>
          Array.from({ length: 3 }, (_, axis) =>
            Array.from({ length: 14 }, (_, index) => axis * 28 + index))).flat(2),
        minimumSelectedLeafCountPerState: 42,
        maximumSelectedLeafCountPerState: 42,
        averageSelectedLeafCountPerState: 42,
        frontFaceDilationTicks: 1,
      },
    };
    const leaves = Array.from({ length: 84 }, () => new FakeHTMLElement());
    const player = createCssmengerPreparedPlayer({
      playback,
      planeAtlas: fakeFrozenMobileAtlas(playback.frontFacingSchedule),
      publicationRoot: new FakeHTMLElement(),
      leaves,
      requestFrame: () => 1,
      cancelFrame: () => {},
      requestDelay: () => 1,
      cancelDelay: () => {},
    });
    const initialAddresses = leaves.map((leaf) => leaf.style.backgroundPosition);
    assert.equal(transformWrites, 1);
    assert.equal(lightingAddressWrites, 84);
    assert.equal(initialAddresses.every(Boolean), true);
    player.step(4);
    player.step();
    assert.equal(player.tick, 3);
    player.step(3);
    assert.equal(player.tick, 0);
    player.step();
    assert.equal(player.tick, 1);
    player.setTick(3);
    assert.equal(transformWrites, 11);
    assert.equal(lightingAddressWrites, 84);
    assert.deepEqual(leaves.map((leaf) => leaf.style.backgroundPosition), initialAddresses);
    assert.equal(player.stats().preparedColorPublicationMode,
      "prepared-frozen-lighting-all-leaf-initialization-only");
    assert.equal(player.stats().preparedLoopPresentationMode,
      "prepared-adjacent-state-ping-pong-no-reset");
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});

test("late playback still advances one adjacent prepared state per scheduled draw", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  let requestedFrame = null;
  let requestedDelay = null;
  let modelTransformWrites = 0;
  let lightingAddressWrites = 0;
  class FakeHTMLElement {
    constructor() {
      let transform = "";
      let backgroundPosition = "";
      this.style = {
        setProperty: (name, value) => { this.style[name] = value; },
        getPropertyValue: () => { throw new Error("runtime DOM style read"); },
      };
      Object.defineProperties(this.style, {
        transform: {
          get: () => transform,
          set: (value) => { transform = value; modelTransformWrites += 1; },
        },
        backgroundPosition: {
          get: () => backgroundPosition,
          set: (value) => { backgroundPosition = value; lightingAddressWrites += 1; },
        },
      });
    }
  }
  globalThis.HTMLElement = FakeHTMLElement;
  try {
    const sourcePlayback = buildPreparedMengerPlayback({ stateCount: 12 });
    const playback = {
      ...sourcePlayback,
      frontFacingSchedule: {
        schema: "cssmenger-prepared-front-facing-leaf-schedule@1",
        encoding: "state-axis-offsets-plus-global-leaf-indices",
        stateCount: sourcePlayback.stateCount,
        axisCount: 3,
        offsets: Array.from({ length: sourcePlayback.stateCount * 3 + 1 }, (_, index) => index * 14),
        leafIndices: Array.from({ length: sourcePlayback.stateCount }, () =>
          Array.from({ length: 3 }, (_, axis) =>
            Array.from({ length: 14 }, (_, index) => axis * 28 + index))).flat(2),
        minimumSelectedLeafCountPerState: 42,
        maximumSelectedLeafCountPerState: 42,
        averageSelectedLeafCountPerState: 42,
        frontFaceDilationTicks: 1,
      },
    };
    const leaves = Array.from({ length: 84 }, () => new FakeHTMLElement());
    const player = createCssmengerPreparedPlayer({
      playback,
      planeAtlas: fakeSparseAtlas(playback.frontFacingSchedule),
      publicationRoot: new FakeHTMLElement(),
      leaves,
      readNow: () => 0,
      requestFrame: (callback) => { requestedFrame = callback; return 1; },
      cancelFrame: () => {},
      requestDelay: (callback) => { requestedDelay = callback; return 2; },
      cancelDelay: () => {},
    });
    player.resume();
    requestedDelay();
    requestedFrame(125);
    assert.equal(player.tick, 1);
    assert.equal(modelTransformWrites, 2);
    assert.equal(lightingAddressWrites, 84);
    assert.equal(leaves[0].style.backgroundPosition, "0px -81px");
    requestedDelay();
    requestedFrame(245);
    player.pause();
    assert.equal(player.tick, 2);
    assert.equal(modelTransformWrites, 3);
    assert.equal(lightingAddressWrites, 126);
    assert.equal(leaves[0].style.backgroundPosition, "0px -162px");
    assert.equal(player.stats().preparedSchedulerCatchUpMode, "one-adjacent-prepared-state-no-skip");
    player.setTick(11);
    player.resume();
    requestedDelay();
    requestedFrame(400);
    assert.equal(player.tick, 10);
    assert.equal(player.paused, false);
    player.pause();
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fakeSparseAtlas(frontFacingSchedule, { addressPublicationIntervalTicks = 1 } = {}) {
  const sourceStateCount = frontFacingSchedule.stateCount;
  const selectedLeafIndices = [];
  const stateOffsets = [0];
  const writeCounts = [];
  for (let stateIndex = 0; stateIndex < sourceStateCount; stateIndex += 1) {
    const before = selectedLeafIndices.length;
    if (stateIndex % addressPublicationIntervalTicks === 0) {
      const start = frontFacingSchedule.offsets[stateIndex * 3];
      const end = frontFacingSchedule.offsets[(stateIndex + 1) * 3];
      selectedLeafIndices.push(...frontFacingSchedule.leafIndices.slice(start, end));
    }
    writeCounts.push(selectedLeafIndices.length - before);
    stateOffsets.push(selectedLeafIndices.length);
  }
  const slotCount = selectedLeafIndices.length;
  const stateOffsetBytes = u16leBytes(stateOffsets);
  const leafIndexBytes = Buffer.from(selectedLeafIndices);
  const slotIndices = Array.from({ length: slotCount }, (_, index) => index);
  const slotIndexBytes = u16leBytes(slotIndices);
  const reverse = reverseFakeAddressSchedule({
    stateOffsets,
    leafIndices: selectedLeafIndices,
    slotIndices,
    stateCount: sourceStateCount,
    leafCount: 84,
  });
  const reverseStateOffsetBytes = u16leBytes(reverse.offsets);
  const reverseLeafIndexBytes = Buffer.from(reverse.leafIndices);
  const reverseSlotIndexBytes = u16leBytes(reverse.slotIndices);
  return {
    schema: "cssmenger-prepared-sparse-leaf-lighting-atlas@1",
    leafCount: 84,
    slotCount,
    visibleLeafFieldCount: frontFacingSchedule.leafIndices.length,
    addressedVisibleLeafFieldCount: slotCount,
    sourceStateCount,
    lightingSampleIntervalTicks: 2,
    lightingSampleDelayMilliseconds: 60,
    lightingSampleCount: Math.ceil(sourceStateCount / 2),
    transformPublicationIntervalTicks: 1,
    transformPublicationDelayMilliseconds: 30,
    addressPublicationIntervalTicks,
    addressPublicationDelayMilliseconds: 30 * addressPublicationIntervalTicks,
    columns: 14,
    slotWidth: 27,
    slotHeight: 27,
    gutterPixels: 0,
    addressScheduleSchema: "cssmenger-prepared-exact-delta-lighting-address-schedule@1",
    addressEncoding:
      "base64-u16le-state-offsets-plus-u8-leaf-indices-plus-u16le-exact-deduplicated-slot-indices",
    addressStateOffsetByteLength: stateOffsetBytes.length,
    addressStateOffsetsBase64: stateOffsetBytes.toString("base64"),
    addressLeafIndexByteLength: leafIndexBytes.length,
    addressLeafIndicesBase64: leafIndexBytes.toString("base64"),
    addressSlotIndexByteLength: slotIndexBytes.length,
    addressSlotIndicesBase64: slotIndexBytes.toString("base64"),
    addressUpdateCount: slotCount,
    reverseAddressScheduleSchema:
      "cssmenger-prepared-exact-reverse-delta-lighting-address-schedule@1",
    reverseAddressStateOffsetByteLength: reverseStateOffsetBytes.length,
    reverseAddressStateOffsetsBase64: reverseStateOffsetBytes.toString("base64"),
    reverseAddressLeafIndexByteLength: reverseLeafIndexBytes.length,
    reverseAddressLeafIndicesBase64: reverseLeafIndexBytes.toString("base64"),
    reverseAddressSlotIndexByteLength: reverseSlotIndexBytes.length,
    reverseAddressSlotIndicesBase64: reverseSlotIndexBytes.toString("base64"),
    reverseAddressUpdateCount: reverse.slotIndices.length,
    reverseAddressWriteCountPerState: reverse.writeCountPerState,
    addressWriteCountPerState: {
      minimum: Math.min(...writeCounts),
      maximum: Math.max(...writeCounts),
      average: slotCount / sourceStateCount,
      zeroWriteStateCount: writeCounts.filter((count) => count === 0).length,
    },
    redundantAddressWriteCountRemoved: 0,
  };
}

function fakeFrozenMobileAtlas(frontFacingSchedule) {
  const sourceStateCount = frontFacingSchedule.stateCount;
  const stateOffsets = [0, ...Array.from({ length: sourceStateCount }, () => 84)];
  const stateOffsetBytes = u16leBytes(stateOffsets);
  const leafIndexBytes = Buffer.from(Array.from({ length: 84 }, (_, index) => index));
  const slotIndexBytes = u16leBytes(Array.from({ length: 84 }, (_, index) => index));
  const reverseStateOffsetBytes = u16leBytes(Array.from({ length: sourceStateCount + 1 }, () => 0));
  return {
    schema: "cssmenger-prepared-sparse-leaf-lighting-atlas@1",
    leafCount: 84,
    slotCount: 84,
    visibleLeafFieldCount: frontFacingSchedule.leafIndices.length,
    addressedVisibleLeafFieldCount: frontFacingSchedule.leafIndices.length,
    sourceStateCount,
    lightingSampleIntervalTicks: 1_440,
    lightingSampleDelayMilliseconds: 43_200,
    lightingSampleCount: 1,
    transformPublicationIntervalTicks: 1,
    transformPublicationDelayMilliseconds: 30,
    addressPublicationIntervalTicks: 1,
    addressPublicationDelayMilliseconds: 30,
    columns: 84,
    slotWidth: 27,
    slotHeight: 27,
    gutterPixels: 0,
    addressScheduleSchema: "cssmenger-prepared-exact-delta-lighting-address-schedule@1",
    addressEncoding:
      "base64-u16le-state-offsets-plus-u8-leaf-indices-plus-u16le-exact-deduplicated-slot-indices",
    addressStateOffsetByteLength: stateOffsetBytes.length,
    addressStateOffsetsBase64: stateOffsetBytes.toString("base64"),
    addressLeafIndexByteLength: leafIndexBytes.length,
    addressLeafIndicesBase64: leafIndexBytes.toString("base64"),
    addressSlotIndexByteLength: slotIndexBytes.length,
    addressSlotIndicesBase64: slotIndexBytes.toString("base64"),
    addressUpdateCount: 84,
    reverseAddressScheduleSchema:
      "cssmenger-prepared-exact-reverse-delta-lighting-address-schedule@1",
    reverseAddressStateOffsetByteLength: reverseStateOffsetBytes.length,
    reverseAddressStateOffsetsBase64: reverseStateOffsetBytes.toString("base64"),
    reverseAddressLeafIndexByteLength: 0,
    reverseAddressLeafIndicesBase64: "",
    reverseAddressSlotIndexByteLength: 0,
    reverseAddressSlotIndicesBase64: "",
    reverseAddressUpdateCount: 0,
    reverseAddressWriteCountPerState: {
      minimum: 0,
      maximum: 0,
      average: 0,
      zeroWriteStateCount: sourceStateCount,
    },
    addressWriteCountPerState: {
      minimum: 0,
      maximum: 84,
      average: 84 / sourceStateCount,
      zeroWriteStateCount: sourceStateCount - 1,
    },
    redundantAddressWriteCountRemoved: frontFacingSchedule.leafIndices.length - 84,
  };
}

function reverseFakeAddressSchedule({
  stateOffsets,
  leafIndices,
  slotIndices,
  stateCount,
  leafCount,
}) {
  const slotsByState = [];
  const currentSlots = new Int32Array(leafCount).fill(-1);
  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    for (let cursor = stateOffsets[stateIndex]; cursor < stateOffsets[stateIndex + 1]; cursor += 1) {
      currentSlots[leafIndices[cursor]] = slotIndices[cursor];
    }
    slotsByState.push(Int32Array.from(currentSlots));
  }
  const offsets = [0];
  const reverseLeafIndices = [];
  const reverseSlotIndices = [];
  const writeCounts = [];
  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const before = reverseLeafIndices.length;
    if (stateIndex < stateCount - 1) {
      for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
        const target = slotsByState[stateIndex][leafIndex];
        if (target < 0 || slotsByState[stateIndex + 1][leafIndex] === target) continue;
        reverseLeafIndices.push(leafIndex);
        reverseSlotIndices.push(target);
      }
    }
    writeCounts.push(reverseLeafIndices.length - before);
    offsets.push(reverseLeafIndices.length);
  }
  return {
    offsets,
    leafIndices: reverseLeafIndices,
    slotIndices: reverseSlotIndices,
    writeCountPerState: {
      minimum: Math.min(...writeCounts),
      maximum: Math.max(...writeCounts),
      average: reverseSlotIndices.length / stateCount,
      zeroWriteStateCount: writeCounts.filter((count) => count === 0).length,
    },
  };
}

function u16leBytes(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index += 1) bytes.writeUInt16LE(values[index], index * 2);
  return bytes;
}
