import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CSSFLOCKS_STARTUP_WINDOWS_BY_PROFILE,
  getFlocksStartupWindows,
  selectFlocksStartupWindow,
} from "../src/shared/cssflocks/startupWindows.mjs";

test("retained startup windows are profile-specific centered source offsets", () => {
  assert.deepEqual(getFlocksStartupWindows("desktop").map(({ id }) => id), [
    "source-057s", "source-071s", "source-085s", "source-153s",
  ]);
  assert.deepEqual(getFlocksStartupWindows("mobile").map(({ id }) => id), [
    "source-121s", "source-150s", "source-165s", "source-191s",
  ]);
  for (const [profileId, windows] of Object.entries(CSSFLOCKS_STARTUP_WINDOWS_BY_PROFILE)) {
    for (const window of windows) {
      assert.equal(window.sourceFrameIndex, window.blockIndex * 60);
      assert.equal(window.centeredWindow.durationSeconds, 8);
      assert.equal(window.centeredWindow.sampleIntervalFrames, 15);
      assert.ok(window.centeredWindow.meanVisibleBugFraction >= (profileId === "desktop" ? 0.98 : 0.42));
      assert.ok(window.centeredWindow.p10VisibleBugFraction >= (profileId === "desktop" ? 0.95 : 0.2));
      assert.ok(window.centeredWindow.p90NormalizedRadius <= (profileId === "desktop" ? 0.87 : 1.59));
    }
  }
});

test("session selection is balanced, avoids an immediate repeat, and honors explicit reproduction", () => {
  assert.equal(selectFlocksStartupWindow({ profileId: "desktop", requestedId: "source-153s" }).blockIndex, 153);
  assert.equal(selectFlocksStartupWindow({ profileId: "desktop", requestedId: "source-114s" }).blockIndex, 114);
  assert.throws(() => selectFlocksStartupWindow({ profileId: "desktop", requestedId: "source-missing" }), /Unknown Flocks startup window/u);
  const balanced = [0, 0.25, 0.5, 0.75].map((randomValue) =>
    selectFlocksStartupWindow({ profileId: "desktop", randomValue }).id);
  assert.deepEqual(balanced, getFlocksStartupWindows("desktop").map((window) => window.id));
  for (const previous of getFlocksStartupWindows("desktop")) {
    for (const randomValue of [0, 0.34, 0.67, 0.999999]) {
      assert.notEqual(selectFlocksStartupWindow({ profileId: "desktop", previousId: previous.id, randomValue }).id, previous.id);
    }
  }
});

test("generated catalogs bind the same source-proven startup set", async () => {
  for (const profileId of ["desktop", "mobile"]) {
    const catalog = JSON.parse(await readFile(`build/generated/public/cssflocks/${profileId}/catalog.json`, "utf8"));
    assert.deepEqual(catalog.startupWindows, getFlocksStartupWindows(profileId));
    assert.equal(catalog.productSelection, "source-ordered-prefix-after-full-source-simulation");
  }
});
