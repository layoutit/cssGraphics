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
  assert.equal(hash(playback.transforms), "934d20245221f2481a9c7d7e307eb5d0a1a18311550ef505fe3c4f8bc28c292b");
  assert.equal(hash(playback.colorRows), "eca63f6fa95d349ff7963628ebad2f8bbb2924e02a0e3c22055d9b718297d224");
  assert.equal(playback.transforms[0], "rotateX(-95.527948277deg) rotateY(94.637081676deg) rotateZ(-94.183856868deg)");
  assert.deepEqual(playback.colorRows[0], [0, 42, 84]);
  assert.equal(playback.adjacentPublicationMode, "all-fields-change");
  for (let stateIndex = 1; stateIndex < playback.stateCount; stateIndex += 1) {
    assert.notEqual(playback.transforms[stateIndex], playback.transforms[stateIndex - 1]);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.notEqual(playback.colorRows[stateIndex][axis], playback.colorRows[stateIndex - 1][axis]);
    }
  }
  assert.equal(playback.runtimeInterpolation, false);
  assert.equal(playback.runtimeColorGeneration, false);
  assert.equal(playback.runtimeRotationCalculation, false);
});

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

test("finite prepared playback clamps instead of claiming a false loop", () => {
  const playback = buildPreparedMengerPlayback({ stateCount: 12 });
  assert.equal(timelineStateIndexForTick(0, playback), 0);
  assert.equal(timelineStateIndexForTick(8, playback), 8);
  assert.equal(timelineStateIndexForTick(999, playback), 11);
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
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fakeSparseAtlas(frontFacingSchedule) {
  const sourceStateCount = frontFacingSchedule.stateCount;
  const slotCount = frontFacingSchedule.leafIndices.length;
  const stateOffsets = Array.from({ length: sourceStateCount + 1 }, (_, stateIndex) =>
    frontFacingSchedule.offsets[stateIndex * 3]);
  const stateOffsetBytes = u16leBytes(stateOffsets);
  const leafIndexBytes = Buffer.from(frontFacingSchedule.leafIndices);
  const slotIndexBytes = u16leBytes(Array.from({ length: slotCount }, (_, index) => index));
  return {
    schema: "cssmenger-prepared-sparse-leaf-lighting-atlas@1",
    leafCount: 84,
    slotCount,
    visibleLeafFieldCount: slotCount,
    sourceStateCount,
    lightingSampleIntervalTicks: 2,
    lightingSampleDelayMilliseconds: 60,
    lightingSampleCount: Math.ceil(sourceStateCount / 2),
    transformPublicationIntervalTicks: 1,
    transformPublicationDelayMilliseconds: 30,
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
    addressWriteCountPerState: {
      minimum: 42,
      maximum: 42,
      average: 42,
      zeroWriteStateCount: 0,
    },
    redundantAddressWriteCountRemoved: 0,
  };
}

function u16leBytes(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index += 1) bytes.writeUInt16LE(values[index], index * 2);
  return bytes;
}
