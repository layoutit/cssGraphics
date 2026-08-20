import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { inspectCssclothProductBank } from "../tools/productBank.mjs";

test("generated Cloth product bank is exact and portable", async () => {
  const root = resolve(
    process.env.CSSCLOTH_GENERATED_PUBLIC_ROOT ?? "build/generated/public",
    "csscloth",
  );
  const summary = await inspectCssclothProductBank(root);
  assert.equal(summary.bankCount, 8);
  assert.equal(summary.bankFrameCount, 1440);
  assert.equal(summary.durationMilliseconds, 192_000);
  assert.equal(summary.retainedLeafCount, 312);
  assert.equal(summary.mobileRetainedLeafCount, 158);
  assert.equal(summary.mobileClothTriangleCount, 72);
  assert.ok(summary.playbackCompressedBytes <= 700_000);
  assert.ok(summary.mobilePlaybackCompressedBytes <= 350_000);
  assert.equal(summary.fileCount, 32);
});
