import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createCssmengerPreparedPlayer, timelineStateIndexForTick } from "../src/cssmenger/preparedPlayback.mjs";
import { buildPreparedMengerPlayback } from "../src/prepare/cssmenger/sourcePlayback.mjs";

test("prepared XScreenSaver random, palette, and rotator segment is deterministic", () => {
  const playback = buildPreparedMengerPlayback();
  assert.equal(playback.seed, 26080801);
  assert.equal(playback.stateCount, 1440);
  assert.equal(playback.palette.length, 128);
  assert.equal(playback.transforms.length, 1440);
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

test("steady playback uses prepared direct writes without DOM style reads or adjacent comparisons", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  let modelTransformWrites = 0;
  let axisColorWrites = 0;
  class FakeHTMLElement {
    constructor() {
      this.style = {
        setProperty: (name, value) => {
          this.style[name] = value;
          if (name === "--m") modelTransformWrites += 1;
          else axisColorWrites += 1;
        },
        getPropertyValue: () => { throw new Error("runtime DOM style read"); },
      };
    }
  }
  globalThis.HTMLElement = FakeHTMLElement;
  try {
    const playback = buildPreparedMengerPlayback({ stateCount: 4 });
    const publicationRoot = new FakeHTMLElement();
    const planeAtlas = {
      schema: "cssmenger-prepared-coplanar-plane-atlas@1",
      paletteStateCount: 128,
      paletteBackgroundPositionYs: Array.from({ length: 128 }, (_, index) => `${-index}px`),
    };
    const player = createCssmengerPreparedPlayer({
      playback,
      planeAtlas,
      publicationRoot,
      requestFrame: () => 1,
      cancelFrame: () => {},
      requestDelay: () => 1,
      cancelDelay: () => {},
    });

    const defaultStats = player.stats();
    assert.equal(defaultStats.runtimeInstrumentationEnabled, false);
    assert.equal(defaultStats.preparedStatesApplied, null);
    assert.equal(defaultStats.runtimeHotPathDebugCounterWritesPerScheduledTick, 0);
    assert.equal(modelTransformWrites, 1);
    assert.equal(axisColorWrites, 3);
    player.step();
    const afterAdvance = player.stats();
    assert.equal(modelTransformWrites, 2);
    assert.equal(axisColorWrites, 6);
    assert.equal(afterAdvance.runtimeHotPathDomStyleReadCount, 0);
    assert.equal(afterAdvance.runtimeAdjacentPublicationComparisonCount, 0);
    assert.equal(afterAdvance.runtimeHotPathProfilingBranchCount, 0);

    player.setTick(1);
    assert.equal(modelTransformWrites, 2);
    assert.equal(axisColorWrites, 6);
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

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
