import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { inspectCssgravitywellProductBank } from "../tools/productBank.mjs";
import { CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT } from "../src/cssgravitywell/renderContract.mjs";

test("generated Gravity Well product bank is exact and portable", async () => {
  const root = resolve(import.meta.dirname, "../../../../build/generated/public/cssgravitywell");
  const summary = await inspectCssgravitywellProductBank(root);
  assert.equal(summary.bankCount, 24);
  assert.equal(summary.retainedShapeRootCount, 1);
  assert.equal(summary.retainedLeafCount, 1_922);
  assert.equal(summary.colorAssetCount, 24);
  assert.equal(summary.changeAssetCount, 24);
  assert.equal(summary.visibilityAssetCount, 24);
  assert.equal(summary.visibilityEncodedBytes, 109_999);
  assert.equal(summary.transformAssetCount, 24 * CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT);
  assert.equal(summary.fileCount, 28 + summary.transformAssetCount);
  assert.ok(summary.maximumTransformBlockPreparedCssStringBytes < 4_000_000);
  assert.ok(summary.maximumResidentTransformPreparedCssStringBytes < 8_000_000);
  assert.ok(summary.preparedFrameCount > 7_000);
});
