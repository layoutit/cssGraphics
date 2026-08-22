import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CSSFLOCKS_STARTUP_WINDOWS,
  selectFlocksStartupWindow,
} from "../src/shared/cssflocks/startupWindows.mjs";

test("retained startup windows are exact source offsets inside declared visual bounds", () => {
  assert.deepEqual(CSSFLOCKS_STARTUP_WINDOWS.map((window) => window.id), [
    "source-005s", "source-114s", "source-129s", "source-172s",
  ]);
  for (const window of CSSFLOCKS_STARTUP_WINDOWS) {
    assert.equal(window.sourceFrameIndex, window.blockIndex * 60);
    for (const metrics of Object.values(window.profiles)) {
      assert.ok(metrics.visibleBugFraction >= 0.55);
      assert.ok(metrics.clippedBugFraction <= 0.45);
      assert.ok(metrics.nearEdgeVisibleFraction <= 0.06);
      assert.ok(metrics.occupiedCellFraction >= 0.19);
      assert.ok(metrics.horizontalSpanFraction >= 0.49);
      assert.ok(metrics.verticalSpanFraction >= 0.56);
      assert.ok(metrics.minimumVisibleLeaderSeparationPixels >= 130);
      assert.ok(metrics.projectedSizeP95Pixels <= 15);
      assert.ok(metrics.stretchMaximum <= 10.1);
      assert.ok(metrics.occupiedHueBins >= 5);
    }
  }
});

test("session selection is balanced, avoids an immediate repeat, and honors explicit reproduction", () => {
  assert.equal(selectFlocksStartupWindow({ requestedId: "source-129s" }).blockIndex, 129);
  assert.throws(() => selectFlocksStartupWindow({ requestedId: "source-missing" }), /Unknown Flocks startup window/u);
  const balanced = [0, 0.25, 0.5, 0.75].map((randomValue) =>
    selectFlocksStartupWindow({ randomValue }).id);
  assert.deepEqual(balanced, CSSFLOCKS_STARTUP_WINDOWS.map((window) => window.id));
  for (const previous of CSSFLOCKS_STARTUP_WINDOWS) {
    for (const randomValue of [0, 0.34, 0.67, 0.999999]) {
      assert.notEqual(selectFlocksStartupWindow({ previousId: previous.id, randomValue }).id, previous.id);
    }
  }
});

test("generated catalogs bind the same source-proven startup set", async () => {
  for (const profileId of ["desktop", "mobile"]) {
    const catalog = JSON.parse(await readFile(`build/generated/public/cssflocks/${profileId}/catalog.json`, "utf8"));
    assert.deepEqual(catalog.startupWindows, CSSFLOCKS_STARTUP_WINDOWS);
    assert.equal(catalog.productSelection, "source-ordered-prefix-after-full-source-simulation");
  }
});
