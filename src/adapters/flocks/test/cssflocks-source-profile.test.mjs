import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceSequence,
  computeSourceBounds,
  selectFlocksProductPrefix,
} from "../src/prepare/cssflocks/sourceModel.mjs";

const tinyBank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  warmupFrames: 2,
  frameCount: 4,
  blockFrameCount: 2,
});

test("Flocks source defaults and product prefixes remain distinct", () => {
  assert.equal(CSSFLOCKS_SOURCE.leaders, 4);
  assert.equal(CSSFLOCKS_SOURCE.followers, 1_000);
  assert.equal(CSSFLOCKS_SOURCE_BANK.bugCount, 1_004);
  assert.deepEqual(CSSFLOCKS_PRODUCT_PROFILES.desktop, {
    id: "desktop", modelId: "flocks", bugCount: 324, leaderCount: 4, followerCount: 320,
  });
  assert.deepEqual(CSSFLOCKS_PRODUCT_PROFILES.mobile, {
    id: "mobile", modelId: "flocks-mobile", bugCount: 164, leaderCount: 4, followerCount: 160,
  });
});

test("Flocks source bounds reproduce reshape integer truncation", () => {
  assert.deepEqual(computeSourceBounds(16 / 9), { wide: 284, high: 160, deep: 160, aspectRatio: 16 / 9 });
  assert.deepEqual(computeSourceBounds(9 / 16), { wide: 160, high: 284, deep: 160, aspectRatio: 9 / 16 });
});

test("seeded source motion is deterministic and source-ordered", () => {
  const left = buildFlocksSourceSequence({ bank: tinyBank });
  const right = buildFlocksSourceSequence({ bank: tinyBank });
  assert.deepEqual(left, right);
  assert.equal(left.frames.length, 4);
  assert.equal(left.frames[0].bugs.length, 1_004);
  assert.deepEqual(left.frames[0].bugs.slice(0, 4).map((bug) => bug.type), ["leader", "leader", "leader", "leader"]);
  assert.ok(left.frames[0].bugs.slice(4).every((bug) => bug.type === "follower"));
  assert.notDeepEqual(left.frames[0].bugs[0].position, left.frames[3].bugs[0].position);
});

test("source snapshots clamp velocity, encode stretch, color, and finite matrices", () => {
  const source = buildFlocksSourceSequence({ bank: tinyBank });
  for (const frame of source.frames) {
    for (const bug of frame.bugs) {
      assert.equal(bug.matrix.length, 16);
      assert.ok(bug.matrix.every(Number.isFinite));
      assert.match(bug.color, /^#[0-9a-f]{6}$/u);
      assert.ok(bug.hue >= 0 && bug.hue <= 1);
      assert.ok(bug.stretch >= 1);
      const limit = bug.type === "leader" ? 8 * CSSFLOCKS_SOURCE.speed : 10 * CSSFLOCKS_SOURCE.speed;
      assert.ok(bug.velocity.every((component) => Math.abs(component) <= limit + 1e-6));
      const speed = Math.hypot(...bug.velocity);
      if (speed > 1e-5) assert.ok(Math.abs(Math.hypot(...bug.direction) - 1) < 1e-5);
    }
  }
});

test("product selection is an exact prefix of the fully simulated source", () => {
  const source = buildFlocksSourceSequence({ bank: tinyBank });
  const selected = selectFlocksProductPrefix(source, CSSFLOCKS_PRODUCT_PROFILES.mobile);
  assert.equal(selected.frames[0].bugs.length, 164);
  assert.deepEqual(selected.frames[3].bugs, source.frames[3].bugs.slice(0, 164));
  assert.equal(selected.bank.bugCount, 1_004);
  assert.equal(selected.profile.bugCount, 164);
});
