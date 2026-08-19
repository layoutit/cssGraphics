import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCYCLONE_PREPARED_PROFILES,
  selectCyclonePreparedProfile,
} from "../src/csscyclone/profileSelection.mjs";

const noCapabilities = () => false;

test("selects the prepared mobile particle bank before mount", () => {
  assert.equal(selectCyclonePreparedProfile({
    width: 448,
    height: 827,
    mediaMatches: noCapabilities,
    userAgent: "desktop-test",
  }), "mobile");
  assert.equal(selectCyclonePreparedProfile({
    width: 1_280,
    height: 800,
    mediaMatches: (query) => query.includes("pointer: coarse"),
    userAgent: "desktop-test",
  }), "mobile");
  assert.equal(selectCyclonePreparedProfile({
    width: 1_280,
    height: 800,
    mediaMatches: noCapabilities,
    userAgent: "Mozilla/5.0 Android Mobile",
  }), "mobile");
});

test("preserves the prepared desktop particle bank for desktop devices", () => {
  assert.equal(selectCyclonePreparedProfile({
    width: 1_280,
    height: 800,
    mediaMatches: noCapabilities,
    userAgent: "desktop-test",
  }), "desktop");
  assert.deepEqual(CSSCYCLONE_PREPARED_PROFILES, {
    desktop: { id: "desktop", modelId: "cyclone" },
    mobile: { id: "mobile", modelId: "cyclone-mobile" },
  });
});

test("rejects invalid prepared profile viewports", () => {
  assert.throws(() => selectCyclonePreparedProfile({
    width: 0,
    height: 800,
    mediaMatches: noCapabilities,
  }), /viewport drifted/u);
});
