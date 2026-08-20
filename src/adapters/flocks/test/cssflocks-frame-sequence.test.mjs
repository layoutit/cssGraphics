import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  CSSFLOCKS_FRAME_SEQUENCE_COUNT,
  CSSFLOCKS_FRAME_SEQUENCE_PLAN,
  flattenFlocksFrameSequencePlan,
} from "../tools/frameSequencePlan.mjs";

test("frame-sequence plan covers every declared continuity boundary with stable ordinals", () => {
  assert.equal(CSSFLOCKS_FRAME_SEQUENCE_COUNT, 45);
  assert.deepEqual(CSSFLOCKS_FRAME_SEQUENCE_PLAN.map((segment) => segment.id), [
    "startup",
    "ordinary-block-handoff",
    "color-wrap",
    "extreme-stretch-orientation",
    "terminal-seam",
  ]);
  const frames = flattenFlocksFrameSequencePlan();
  assert.deepEqual(frames.map((frame) => frame.ordinal), Array.from({ length: 45 }, (_, index) => index));
  assert.deepEqual(frames.filter((frame) => frame.segmentId === "ordinary-block-handoff").map((frame) => frame.streamFrameIndex),
    [6_896, 6_897, 6_898, 6_899, 6_900, 6_901, 6_902, 6_903, 6_904]);
  assert.deepEqual(frames.filter((frame) => frame.segmentId === "terminal-seam").map((frame) => frame.streamFrameIndex),
    [13_436, 13_437, 13_438, 13_439, 0, 1, 2, 3, 4]);
  const colorWrap = CSSFLOCKS_FRAME_SEQUENCE_PLAN.find((segment) => segment.id === "color-wrap");
  assert.equal((colorWrap.focusFrameIndex + colorWrap.focusRootIndex) % 5, 0);
});

test("all public Flocks visual-proof commands execute the qualified sequence rather than placeholders", async () => {
  for (const name of [
    "capture-reference-frame.mjs",
    "capture-browser-frame.mjs",
    "compare-reference-frame.mjs",
    "frameSequenceArtifacts.mjs",
    "capture-reference-frames.mjs",
    "capture-browser-frames.mjs",
    "compare-frame-sequence.mjs",
  ]) {
    const source = await readFile(resolve(import.meta.dirname, "../tools", name), "utf8");
    assert.doesNotMatch(source, /failPendingFlocksReference|pending a fixed scripted segment|process\.exitCode\s*=\s*2/u);
    assert.doesNotMatch(source, /\/Users\/|\/home\/|\.codex\/skills/u);
  }
});
