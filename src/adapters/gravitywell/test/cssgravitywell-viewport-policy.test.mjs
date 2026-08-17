import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultGravityWellCarrierCoverageScale,
  defaultViewportProfilePolicy,
  GRAVITYWELL_VIEWPORT_PROFILE_POLICY,
  selectGravityWellVisibilityProfile,
} from "../src/cssgravitywell/preparedPlayback.mjs";
import {
  CSSGRAVITYWELL_VISIBILITY_ENCODING,
  CSSGRAVITYWELL_VISIBILITY_SCHEMA,
  encodeGravityWellViewportVisibility,
} from "../src/prepare/cssgravitywell/visibilitySchedule.mjs";

const profiles = [
  { width: 430, height: 960 },
  { width: 960, height: 430 },
  { width: 640, height: 1_024 },
  { width: 1_024, height: 640 },
  { width: 1_024, height: 1_024 },
  { width: 1_536, height: 1_536 },
];
const schedule = Object.freeze({
  schema: "cssgravitywell-prepared-viewport-visibility@2",
  profiles,
});

test("desktop keeps the smallest rectangular prepared visibility profile", () => {
  assert.equal(
    selectGravityWellVisibilityProfile(
      schedule,
      390,
      844,
      GRAVITYWELL_VIEWPORT_PROFILE_POLICY.rectangular,
    ),
    profiles[0],
  );
  assert.equal(
    selectGravityWellVisibilityProfile(
      schedule,
      844,
      390,
      GRAVITYWELL_VIEWPORT_PROFILE_POLICY.rectangular,
    ),
    profiles[1],
  );
});

test("mobile uses the smallest prepared square covering both viewport axes", () => {
  for (const [width, height] of [[390, 844], [844, 390], [430, 932]]) {
    assert.equal(
      selectGravityWellVisibilityProfile(
        schedule,
        width,
        height,
        GRAVITYWELL_VIEWPORT_PROFILE_POLICY.conservativeMobile,
      ),
      profiles[4],
    );
  }
  assert.equal(
    selectGravityWellVisibilityProfile(
      schedule,
      1_025,
      768,
      GRAVITYWELL_VIEWPORT_PROFILE_POLICY.conservativeMobile,
    ),
    profiles[5],
  );
});

test("coarse primary pointers select the conservative mobile policy without URL state", () => {
  assert.equal(
    defaultViewportProfilePolicy(() => ({ matches: true })),
    GRAVITYWELL_VIEWPORT_PROFILE_POLICY.conservativeMobile,
  );
  assert.equal(
    defaultViewportProfilePolicy(() => ({ matches: false })),
    GRAVITYWELL_VIEWPORT_PROFILE_POLICY.rectangular,
  );
  assert.equal(
    defaultViewportProfilePolicy(null),
    GRAVITYWELL_VIEWPORT_PROFILE_POLICY.rectangular,
  );
});

test("fractional coarse-pointer DPR compensates 1px carrier coverage without changing desktop", () => {
  const coarse = () => ({ matches: true });
  const precise = () => ({ matches: false });
  assert.equal(defaultGravityWellCarrierCoverageScale(coarse, 2.25), 1.125);
  assert.equal(defaultGravityWellCarrierCoverageScale(coarse, 2), 1);
  assert.equal(defaultGravityWellCarrierCoverageScale(coarse, 2.625), 1);
  assert.equal(defaultGravityWellCarrierCoverageScale(precise, 2.25), 1);
  assert.equal(defaultGravityWellCarrierCoverageScale(coarse, undefined), 1);
});

test("visibility encoding rejects values that cannot fit its uint16 fields", () => {
  const profile = {
    width: 430,
    height: 960,
    frameCount: 2,
    leafCount: 4,
    initialVisibleIndices: new Uint16Array([0]),
    changeOffsets: new Uint32Array([0, 0, 0]),
    assignments: new Uint16Array(),
  };
  const schedule = {
    schema: CSSGRAVITYWELL_VISIBILITY_SCHEMA,
    encoding: CSSGRAVITYWELL_VISIBILITY_ENCODING,
    marginPixels: 8,
    dilationFrames: 1,
    profiles: [profile],
  };
  assert.throws(
    () => encodeGravityWellViewportVisibility({
      ...schedule,
      profiles: [{ ...profile, width: 65_536 }],
    }),
    /visibility schedule is incomplete/,
  );
  assert.throws(
    () => encodeGravityWellViewportVisibility({
      ...schedule,
      profiles: [{ ...profile, leafCount: 32_769 }],
    }),
    /visibility schedule is incomplete/,
  );
  for (const invalidSchedule of [
    { ...schedule, marginPixels: -1 },
    { ...schedule, dilationFrames: 1.5 },
    { ...schedule, profiles: [{ ...profile, width: 0 }] },
    { ...schedule, profiles: [{ ...profile, frameCount: 1 }] },
  ]) {
    assert.throws(
      () => encodeGravityWellViewportVisibility(invalidSchedule),
      /visibility schedule is incomplete/,
    );
  }
});
