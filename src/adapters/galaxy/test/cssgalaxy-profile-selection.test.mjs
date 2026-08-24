// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSGALAXY_MOBILE_BREAKPOINT_WIDTH,
  selectGalaxyPreparedProfile,
} from "../src/cssgalaxy/profileSelection.mjs";

test("selects the mobile prepared bank before fetch and mount from the established device policy", () => {
  assert.equal(CSSGALAXY_MOBILE_BREAKPOINT_WIDTH, 600);
  assert.equal(selectGalaxyPreparedProfile({
    innerWidth: 599,
    userAgent: "desktop",
    mobileCapabilityMatches: false,
  }), "mobile");
  assert.equal(selectGalaxyPreparedProfile({
    innerWidth: 1280,
    userAgent: "desktop",
    mobileCapabilityMatches: true,
  }), "mobile");
  assert.equal(selectGalaxyPreparedProfile({
    innerWidth: 1280,
    userAgent: "Mozilla/5.0 (iPhone)",
    mobileCapabilityMatches: false,
  }), "mobile");
  assert.equal(selectGalaxyPreparedProfile({
    innerWidth: 600,
    userAgent: "desktop",
    mobileCapabilityMatches: false,
  }), "desktop");
});
