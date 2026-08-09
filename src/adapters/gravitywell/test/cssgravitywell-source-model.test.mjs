import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildGridSegments,
  buildPreparedGravityWellBankStates,
  buildPreparedGravityWellTimeline,
  buildPreparedGravityWellStates,
  CSSGRAVITYWELL_SEEDS,
  PREPARED_MAX_BANK_FRAME_COUNT,
  PREPARED_LINE_COVERAGE,
  preparedColorRamp,
  preparedFoggedColorPalette,
  preparedGridLineQuads,
  SOURCE,
} from "../src/prepare/cssgravitywell/sourceModel.mjs";
import {
  CSSGRAVITYWELL_VIEWPORT_PROFILE_SIZES,
  encodeGravityWellViewportVisibility,
  prepareGravityWellViewportVisibility,
} from "../src/prepare/cssgravitywell/visibilitySchedule.mjs";

test("pinned Gravity Well profile prepares a stable retained topology", () => {
  const prepared = buildPreparedGravityWellStates();
  const segments = buildGridSegments(prepared.gridWidth);
  assert.equal(prepared.gridWidth, 32);
  assert.equal(prepared.gridCellCount, 31);
  assert.equal(prepared.frameCount, 240);
  assert.equal(segments.length, 1_922);
  assert.equal(new Set(segments.flat()).size, 1_023);
  assert.equal(SOURCE.delayMicroseconds, 30_000);
  assert.equal(SOURCE.count, 15);
  assert.equal(SOURCE.resolution, 1);
  assert.equal(SOURCE.gridSize, 16 / 7);
});

test("24 deterministic seed banks share an exact prepared flat boundary", () => {
  assert.equal(CSSGRAVITYWELL_SEEDS.length, 24);
  assert.equal(new Set(CSSGRAVITYWELL_SEEDS).size, 24);
  for (const seed of CSSGRAVITYWELL_SEEDS) {
    const bankStates = buildPreparedGravityWellBankStates({ seed });
    const timeline = buildPreparedGravityWellTimeline(bankStates);
    assert.ok(timeline.frameCount > 278);
    assert.ok(timeline.frameCount <= PREPARED_MAX_BANK_FRAME_COUNT);
    assert.equal(timeline.sourceFrameStartIndex, 19);
    assert.equal(timeline.sourceFrameEndIndex, 258);
    assert.equal(timeline.drainFrameStartIndex, 259);
    assert.equal(timeline.allWellsCompleteFrameIndex, timeline.terminalFlatFrameIndex - 4);
    assert.equal(timeline.frames[timeline.sourceFrameStartIndex].sourceFrameIndex, 0);
    assert.equal(timeline.frames[timeline.sourceFrameEndIndex].sourceFrameIndex, 239);
    assert.equal(timeline.frames[timeline.drainFrameStartIndex].phase, "drain");
    assert.ok(timeline.frames[timeline.allWellsCompleteFrameIndex].depths.every((depth) => depth === 0));
    assert.equal(bankStates.allWellsComplete, true);
    assert.ok(bankStates.drainFrameCount <= 61);
    assert.ok(timeline.frames[0].depths.every((depth) => depth === 0));
    assert.deepEqual(timeline.frames[0].depths, timeline.frames.at(-1).depths);
  }
});

test("source preparation is deterministic and bound to the known state digest", () => {
  const left = buildPreparedGravityWellStates();
  const right = buildPreparedGravityWellStates();
  const projection = (prepared) => ({
    profile: prepared.sourceProfile,
    frames: prepared.frames.map((frame) => ({ depths: frame.depths, stars: frame.stars })),
  });
  assert.deepEqual(left, right);
  const digest = createHash("sha256").update(JSON.stringify(projection(left))).digest("hex");
  assert.equal(digest, "13bc685a4b3e62fdb0df5e5d8b94d89beb6ed7be3a1ea994a85fa79de442b6ff");
});

test("prepared palette is a green through red source-depth ramp", () => {
  const palette = preparedColorRamp();
  assert.equal(palette.length, 128);
  assert.equal(palette[0], "rgb(0, 255, 0)");
  assert.equal(palette.at(-1), "rgb(255, 0, 0)");
  const fogged = preparedFoggedColorPalette();
  assert.equal(fogged.length, 128 * 32);
  assert.equal(fogged[0], "rgb(0 255 0 / 0)");
  assert.equal(PREPARED_LINE_COVERAGE, 0.6);
  assert.equal(fogged[31], "rgb(0 255 0 / 0.6)");
});

test("viewport visibility is prepared as sparse conservative square profiles", () => {
  const states = buildPreparedGravityWellBankStates({ seed: CSSGRAVITYWELL_SEEDS[0] });
  const timeline = buildPreparedGravityWellTimeline(states);
  const quadsByFrame = timeline.frames.map((frame) => preparedGridLineQuads(states, frame.depths));
  const schedule = prepareGravityWellViewportVisibility(quadsByFrame);
  const encoded = encodeGravityWellViewportVisibility(schedule);
  assert.deepEqual(schedule.profiles.map((profile) => profile.size), CSSGRAVITYWELL_VIEWPORT_PROFILE_SIZES);
  assert.equal(schedule.frameCount, timeline.frameCount);
  assert.equal(schedule.leafCount, 1_922);
  assert.ok(schedule.profiles.every((profile) =>
    profile.initialVisibleIndices.length < schedule.leafCount &&
    profile.assignments.length < 400 &&
    profile.minimumVisibleCount > 500 &&
    profile.maximumVisibleCount < schedule.leafCount));
  assert.equal(String.fromCharCode(...encoded.subarray(0, 4)), "CGWV");
  assert.equal(encoded[4], 1);
  assert.equal(encoded[5], CSSGRAVITYWELL_VIEWPORT_PROFILE_SIZES.length);
});
