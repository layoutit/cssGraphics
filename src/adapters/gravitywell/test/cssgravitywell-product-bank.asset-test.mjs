import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { inspectCssgravitywellProductBank } from "../tools/productBank.mjs";

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
  assert.equal(summary.transformAssetCount, 72);
  assert.equal(summary.fileCount, 100);
  assert.ok(summary.preparedFrameCount > 7_000);
});
