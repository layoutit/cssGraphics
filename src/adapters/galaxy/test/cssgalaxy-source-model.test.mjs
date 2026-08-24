// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSGALAXY_SOURCE,
  advanceGalaxySource,
  commitGalaxySourceFrame,
  createGalaxySourceUniverse,
  distributeGalaxyPrefixCounts,
  renderGalaxyPrefixFrame,
} from "../src/prepare/cssgalaxy/sourceModel.mjs";
import {
  CSSGALAXY_CURATED_SEEDS,
  CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT,
  qualifyGalaxyParticleCounts,
} from "../src/prepare/cssgalaxy/qualification.mjs";
import {
  CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION,
  CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION,
  qualifyGalaxySeeds,
} from "../src/prepare/cssgalaxy/seedQualification.mjs";
import {
  CSSGALAXY_COLOR_FAMILY,
  createSourceHueFamily,
  createThreeGalaxyPresentation,
  createThreeGalaxyRolePalette,
} from "../src/prepare/cssgalaxy/colorFamilies.mjs";
import {
  CSSGALAXY_ENCOUNTER_REEL,
  createEncounterSchedule,
} from "../src/prepare/cssgalaxy/encounterReel.mjs";

test("pins the requested galaxy.c source bytes", () => {
  assert.deepEqual(CSSGALAXY_SOURCE, {
    repository: "https://github.com/Zygo/xscreensaver",
    revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
    path: "hacks/galaxy.c",
    sha256: "801b7a7ff3749b032974b8dfe9021c2e3998645f138f9beec7e09037e36d66d9",
    license: "HPND",
  });
});

test("initializes every complete source galaxy before selecting render prefixes", () => {
  for (const galaxyCount of [2, 3]) {
    const universe = createGalaxySourceUniverse({ seed: 3, galaxyCount });
    assert.equal(universe.galaxies.length, galaxyCount);
    for (const galaxy of universe.galaxies) {
      assert.ok(galaxy.nstars >= 1500 && galaxy.nstars <= 2999);
      assert.equal(galaxy.stars.length, galaxy.nstars);
    }
    const frame = advanceGalaxySource(universe);
    assert.equal(renderGalaxyPrefixFrame(frame, 600).transforms.length, 600);
    assert.equal(renderGalaxyPrefixFrame(frame, 1900).transforms.length, 1900);
  }
  assert.deepEqual(distributeGalaxyPrefixCounts(1500, 3), [500, 500, 500]);
  assert.deepEqual(distributeGalaxyPrefixCounts(1000, 2), [500, 500]);
  assert.deepEqual(distributeGalaxyPrefixCounts(1900, 3), [634, 633, 633]);
});

test("keeps the native source RGB at the center of each prepared hue family", () => {
  const family = createSourceHueFamily("#fccc51");
  assert.equal(family.length, CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.length);
  assert.equal(family[2], "#fccc51");
  assert.equal(new Set(family).size, family.length);
  assert.deepEqual(CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps,
    [-0.08, -0.04, 0, 0.04, 0.08]);
  assert.equal(CSSGALAXY_COLOR_FAMILY.maximumHueShiftDegrees, 30);
  assert.deepEqual(family, ["#fcab51", "#fcbb51", "#fccc51", "#fcdc51", "#fcec51"]);
});

test("derives balanced magenta cyan and off-white roles from the qualified native lead", () => {
  const lead = createGalaxySourceUniverse({ seed: 4946, galaxyCount: 3 });
  const palette = createThreeGalaxyRolePalette(lead.galaxies);
  assert.deepEqual(palette.nativeAnchorColors, {
    magenta: "#fc51f1",
    cyan: "#51fceb",
    "off-white": "#fccc51",
  });
  assert.deepEqual(palette.roleCenters, {
    magenta: "#ff7ef4",
    cyan: "#00d3c3",
    "off-white": "#e0ded8",
  });
  assert.deepEqual(palette.roleFamilies["off-white"],
    ["#e3dcda", "#e2ddd8", "#e0ded8", "#dedfd9", "#dbe0da"]);
  assert.ok(Object.values(palette.centerBlackContrastRatios).every((ratio) => ratio >= 7));
  assert.ok(Math.abs(palette.centerOklabLightnesses.magenta -
    palette.centerOklabLightnesses.cyan) <= 0.005);
  assert.ok(palette.centerOklabLightnesses["off-white"] -
    palette.centerOklabLightnesses.magenta >= 0.1);
  const presentation = createThreeGalaxyPresentation(lead.galaxies, palette);
  assert.deepEqual(presentation.roles, ["off-white", "magenta", "cyan"]);
  assert.equal(new Set(presentation.families.flat()).size, 15);
});

test("tiles each prepared bank with native motion and an identity-preserving reformation", () => {
  const schedule = createEncounterSchedule(4946, 953);
  assert.deepEqual([
    schedule.source.endFrameIndexExclusive - schedule.source.startFrameIndex,
    schedule.reformation.endFrameIndexExclusive - schedule.reformation.startFrameIndex,
  ], [540, 180]);
  assert.equal(schedule.reformation.endFrameIndexExclusive,
    CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.encounterFrameCount *
    CSSGALAXY_ENCOUNTER_REEL.encounterCount,
    CSSGALAXY_ENCOUNTER_REEL.bankFrameCount * CSSGALAXY_ENCOUNTER_REEL.bankCount);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.sourceFramesPerSecond, 50);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.presentationFramesPerSecond, 60);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeProjectionFrameCount, 410);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeMotionStartFrameIndex, 0);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameSpan, 409);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepNumerator, 409);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameStepDenominator, 540);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nativeMotionFrameCount, 540);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.reformationStartsAtSeconds, 9);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.nextEncounterFullyVisibleAtSeconds, 12);
  assert.deepEqual([
    schedule.reformation.startFrameIndex,
    schedule.reformation.endFrameIndexExclusive,
  ], [540, 720]);
  assert.equal(schedule.reformation.outgoingNativeFrameIndex, 409);
  assert.equal(schedule.reformation.incomingNativeFrameIndex, 0);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.reformationControlFrameScale, 60);
  assert.equal(CSSGALAXY_ENCOUNTER_REEL.reformationMaximumControlDisplacement, 560);
});

test("prefix selection cannot feed back into galaxy-center integration", () => {
  for (const galaxyCount of [2, 3]) {
    const left = createGalaxySourceUniverse({ seed: 3, galaxyCount });
    const right = createGalaxySourceUniverse({ seed: 3, galaxyCount });
    for (let frameIndex = 0; frameIndex < 300; frameIndex += 1) {
      const leftFrame = advanceGalaxySource(left);
      const rightFrame = advanceGalaxySource(right);
      renderGalaxyPrefixFrame(leftFrame, 600);
      renderGalaxyPrefixFrame(rightFrame, 1900);
      assert.deepEqual(left.galaxies.map(({ pos, vel }) => ({ pos, vel })),
        right.galaxies.map(({ pos, vel }) => ({ pos, vel })));
      commitGalaxySourceFrame(left);
      commitGalaxySourceFrame(right);
    }
  }
});

test("restarts only after the source's cycles-times-four boundary", () => {
  const universe = createGalaxySourceUniverse({ seed: 3 });
  let frame;
  for (let frameIndex = 0; frameIndex <= 1001; frameIndex += 1) {
    frame = advanceGalaxySource(universe);
    commitGalaxySourceFrame(universe);
    if (frameIndex <= 1000) assert.equal(frame.generation, 0);
  }
  assert.equal(frame.generation, 1);
  assert.equal(frame.generationFrameIndex, 0);
  assert.equal(frame.rotY, 0.01);
  assert.equal(frame.rotX, 0.004);
});

test("selects the lowest candidate that clears all fixed structural gates", () => {
  const report = qualifyGalaxyParticleCounts();
  assert.equal(report.selectedParticleCount, 1500);
  assert.deepEqual(report.candidates.map(({ count, passed }) => [count, passed]), [
    [600, false], [800, false], [1200, false], [1500, true], [1600, true], [1900, true],
  ]);
  const threeGalaxyReport = qualifyGalaxyParticleCounts({ galaxyCount: 3 });
  assert.equal(threeGalaxyReport.selectedParticleCount, 1500);
  assert.equal(threeGalaxyReport.candidates.find(({ count }) => count === 1500).passed, true);
});

test("curates source-generated encounters with all-pair collision gates", () => {
  const report = qualifyGalaxySeeds();
  assert.deepEqual(report.selectedSeeds, CSSGALAXY_CURATED_SEEDS);
  for (const seed of CSSGALAXY_CURATED_SEEDS) {
    const candidate = report.finalists.find((entry) => entry.seed === seed);
    assert.equal(candidate.qualified, true);
    assert.ok(candidate.preparedStreamColors.minimumBlackContrastRatio >= 4.5);
    assert.ok(candidate.preparedStreamColors.minimumInterGalaxyColorDistance >= 0.35);
    assert.equal(candidate.preparedStreamColors.generations.length, 4);
  }
  const mobileReport = qualifyGalaxySeeds(CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION);
  assert.deepEqual(mobileReport.selectedSeeds, CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT[2]);
  assert.deepEqual(mobileReport.selectedSeeds,
    mobileReport.finalists.filter(({ qualified }) => qualified).slice(0, 10)
      .map(({ seed }) => seed));
  assert.ok(mobileReport.finalists.filter(({ seed }) => mobileReport.selectedSeeds.includes(seed))
    .every(({ centerMetrics }) => centerMetrics.closestFrameIndex >= 180 &&
      centerMetrics.closestFrameIndex <= 320));
  assert.ok(mobileReport.finalists.filter(({ seed }) => mobileReport.selectedSeeds.includes(seed))
    .every(({ centerMetrics, metrics, gates }) =>
      centerMetrics.initialCenterInsetPixels >=
        CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION.minimumInitialCenterInsetPixels &&
      centerMetrics.initialMinimumProjectedSeparationPixels >=
        CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION.minimumInitialCenterSeparationPixels &&
      metrics.sustainedPairMixing >=
        CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION.minimumSustainedPairMixing &&
      metrics.secondaryVortexStructure >=
        CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION.minimumSecondaryVortexStructure &&
      gates.sustainedMultiPairMixing && gates.materialSecondaryVortexStructure));
  const threeGalaxyReport = qualifyGalaxySeeds(CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION);
  assert.deepEqual(threeGalaxyReport.selectedSeeds, CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT[3]);
  assert.deepEqual(threeGalaxyReport.selectedSeeds,
    CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.requiredSeeds);
  assert.equal(new Set(threeGalaxyReport.selectedSeeds).size,
    CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.selectedSeedCount);
  for (const seed of threeGalaxyReport.selectedSeeds) {
    const candidate = threeGalaxyReport.finalists.find((entry) => entry.seed === seed);
    assert.equal(candidate.qualified, true);
    assert.ok(candidate.centerMetrics.maximumPairClosestDistancePixels <= 60);
    assert.ok(candidate.metrics.minimumPairCollisionPeak >= 0.25);
    assert.equal(candidate.gates.everyPairMakesMaterialCollision, true);
    assert.ok(candidate.centerMetrics.simultaneousCenterConvergenceFrameIndex >= 180);
    assert.ok(candidate.centerMetrics.simultaneousCenterConvergenceFrameIndex <= 320);
    assert.ok(candidate.centerMetrics.minimumSimultaneousCenterSpanPixels <=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.maximumSimultaneousCenterSpanPixels);
    assert.equal(candidate.centerMetrics.minimumSimultaneousProjectedCenterSpanPixels <=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.maximumSimultaneousCenterSpanPixels, true);
    assert.equal(candidate.gates.allThreeGalaxiesCrashTogether, true);
    assert.ok(candidate.centerMetrics.initialCenterInsetPixels >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumInitialCenterInsetPixels);
    assert.ok(candidate.centerMetrics.initialMinimumProjectedSeparationPixels >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumInitialCenterSeparationPixels);
    assert.ok(candidate.metrics.sustainedPairMixing >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumSustainedPairMixing);
    assert.ok(candidate.metrics.secondaryVortexStructure >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumSecondaryVortexStructure);
    assert.ok(candidate.metrics.tidalGrowth >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumTidalGrowth);
    assert.ok(candidate.metrics.radialGrowth >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumRadialGrowth);
    assert.ok(candidate.metrics.spatialExpansion >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumSpatialExpansion);
    assert.ok(candidate.metrics.visibleDiscPresence >=
      CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION.minimumVisibleDiscPresence);
    assert.equal(candidate.gates.sustainedMultiPairMixing, true);
    assert.equal(candidate.gates.materialSecondaryVortexStructure, true);
    assert.equal(candidate.gates.materialTidalDispersal, true);
    assert.equal(candidate.gates.materialRadialDispersal, true);
    assert.equal(candidate.gates.materialSpatialExpansion, true);
  }
});
