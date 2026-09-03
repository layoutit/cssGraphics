// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCITYFLOW_MOBILE_BREAKPOINT_WIDTH,
  CSSCITYFLOW_PREPARED_BANKS,
  selectCityflowPreparedBank,
} from "../src/csscityflow/profileSelection.mjs";

const noCapabilities = () => false;

test("selects the mobile Cityflow bank before fetch and mount", () => {
  assert.equal(CSSCITYFLOW_MOBILE_BREAKPOINT_WIDTH, 600);
  assert.equal(selectCityflowPreparedBank({
    width: 390,
    height: 844,
    mediaMatches: noCapabilities,
    userAgent: "desktop-test",
  }), "mobile");
  assert.equal(selectCityflowPreparedBank({
    width: 1280,
    height: 720,
    mediaMatches: (query) => query.includes("pointer: coarse"),
    userAgent: "desktop-test",
  }), "mobile");
  assert.equal(selectCityflowPreparedBank({
    width: 1280,
    height: 720,
    mediaMatches: noCapabilities,
    userAgent: "Mozilla/5.0 (iPhone)",
  }), "mobile");
});

test("preserves the desktop bank for desktop devices", () => {
  assert.equal(selectCityflowPreparedBank({
    width: 1280,
    height: 720,
    mediaMatches: noCapabilities,
    userAgent: "desktop-test",
  }), "desktop");
  assert.deepEqual(CSSCITYFLOW_PREPARED_BANKS, {
    desktop: { id: "desktop", modelId: "cityflow" },
    mobile: { id: "mobile", modelId: "cityflow-mobile" },
  });
});

test("rejects invalid Cityflow viewport dimensions", () => {
  assert.throws(() => selectCityflowPreparedBank({
    width: 0,
    height: 844,
    mediaMatches: noCapabilities,
  }), /viewport drifted/u);
});
