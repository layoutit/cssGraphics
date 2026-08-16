import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { generatedProductRoot } from "../src/prepare/csssolitaire/paths.mjs";

const generated = generatedProductRoot();

test("generated product is one complete retained snapshot plus sparse prepared playback", async () => {
  const manifest = JSON.parse(await readFile(join(generated, "manifest.json"), "utf8"));
  assert.equal(manifest.schema, "csssolitaire-manifest@1");
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.scope, "public-prepared-product");
  assert.equal(manifest.sourceProfile.cards, 12);
  assert.deepEqual(manifest.sourceProfile.startingCards, [
    "king-of-spades",
    "queen-of-hearts",
    "jack-of-diamonds",
    "ace-of-clubs",
  ]);
  assert.equal(manifest.sourceProfile.launchCycleCount, 3);
  assert.deepEqual(manifest.sourceProfile.launchCards, [
    "king-of-spades", "queen-of-hearts", "jack-of-diamonds", "ace-of-clubs",
    "queen-of-spades", "jack-of-hearts", "ten-of-diamonds", "king-of-clubs",
    "jack-of-spades", "ten-of-hearts", "nine-of-diamonds", "queen-of-clubs",
  ]);
  assert.deepEqual(manifest.sourceProfile.initialVelocityY, [-70, -50, -30, -10]);
  assert.deepEqual(manifest.sourceProfile.horizontalVelocityRange, [-65, -20]);
  assert.equal(manifest.sourceProfile.sourceDraws, 1614);
  assert.equal(manifest.sourceProfile.sourceSteps, 1614);
  assert.equal(manifest.sourceProfile.patternCount, 24);
  assert.equal(new Set(manifest.sourceProfile.patternSeeds).size, 24);
  assert.equal(manifest.sourceProfile.patterns.length, 24);
  assert.equal(manifest.renderer.morphTarget, "createPolyMorphPreparedDomTarget");
  assert.equal(manifest.renderer.profile, "prepared-playback");
  assert.equal(manifest.renderer.textureBackend, "atlas");
  assert.equal(manifest.renderer.textureLeafSizing, "raster");
  assert.equal(manifest.renderer.composition, "flat-2d-card-plane");
  assert.deepEqual(manifest.renderer.contentBounds, [-70, -71, 574, 395]);
  assert.deepEqual(manifest.renderer.portraitPlayfield, [384, 720]);
  assert.deepEqual(manifest.renderer.responsiveProfiles, ["landscape", "portrait"]);
  assert.equal(manifest.renderer.portraitMapping, "progressive-card-count-prepared-wall-reflection");
  assert.deepEqual(manifest.renderer.portraitCardCounts, [1, 2, 3, 4]);
  assert.deepEqual(manifest.renderer.portraitCardBreakpoints, [520, 720, 920]);
  assert.equal(manifest.renderer.portraitHorizontalMotion, "prepared-reflected-wall-bounce");
  assert.equal(manifest.renderer.seamBleed, 0.2);
  assert.equal(manifest.renderer.runtimeAtlasRasterization, false);
  assert.equal(manifest.renderer.runtimeGeometryCalculation, false);
  assert.equal(manifest.renderer.runtimeTrajectoryCalculation, false);
  assert.equal(manifest.renderer.runtimeDomGrowth, false);
  assert.equal(manifest.transport.runtimeModelPayload, false);
  assert.equal(manifest.metrics.retainedLeafCount, 1911);
  assert.equal(manifest.metrics.foundationLeafCount, 4);
  assert.equal(manifest.metrics.retainedTrailLeafCount, 1907);
  assert.equal(manifest.metrics.preparedPatternCount, 24);
  assert.equal(manifest.metrics.preparedFrameCount, 13640);
  assert.equal(manifest.metrics.initialPatternDurationMs, 26223);
  assert.equal(manifest.metrics.minimumPatternDurationMs, 21305);
  assert.equal(manifest.metrics.maximumPatternDurationMs, 30628);
  assert.equal(manifest.metrics.preparedFoundationOperationCount, 576);
  assert.equal(manifest.metrics.preparedLeafLayoutCount, 37634);
  assert.equal(manifest.provenance.proprietaryProductBytesIncluded, false);
  assert.equal(manifest.provenance.nativeCaptureIncluded, false);

  const files = (await readdir(generated, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(generated.length + 1))
    .sort();
  assert.deepEqual(files, [
    `assets/card-faces-${manifest.provenance.cardAtlas.sha256}.png`,
    "manifest.json",
    "solitaire-playback.json",
    "solitaire.polycss.html",
  ]);
  for (const descriptor of Object.values(manifest.assets)) {
    const bytes = await readFile(join(generated, descriptor.path));
    assert.equal(bytes.length, descriptor.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256);
  }

  const snapshot = await readFile(join(generated, "solitaire.polycss.html"), "utf8");
  assert.match(snapshot, /class="polycss-camera solitaire-prepared-camera"/u);
  assert.match(snapshot, /class="polycss-scene solitaire-prepared-scene"/u);
  assert.match(snapshot, /class="csssolitaire-board"/u);
  assert.equal((snapshot.match(/<s class="[^"]+" style=/gu) ?? []).length, 1911);
  assert.equal((snapshot.match(/--csssolitaire-landscape-transform:matrix\(/gu) ?? []).length, 1911);
  const portraitTransformCounts = [1, 2, 3, 4].map((cardCount) =>
    (snapshot.match(new RegExp(`--csssolitaire-portrait-${cardCount}-transform:matrix\\(`, "gu")) ?? []).length);
  assert.ok(portraitTransformCounts.every((count, index) => index === 0 || count > portraitTransformCounts[index - 1]));
  assert.equal(portraitTransformCounts[3], 1911);
  assert.equal((snapshot.match(/transform:var\(--csssolitaire-landscape-transform\)/gu) ?? []).length, 1);
  assert.equal((snapshot.match(/<s class="foundation lane-[0-3]"/gu) ?? []).length, 4);
  assert.match(snapshot, /\.csssolitaire-board\{[^}]*translate\(-292\.5px,-192px\)/u);
  assert.match(snapshot, /@media \(orientation:portrait\)\{\.csssolitaire-board\{transform:translate\(-192px,-360px\)\}/u);
  assert.match(snapshot, /max-width:519px\)\{\.csssolitaire-board>s\{transform:var\(--csssolitaire-portrait-1-transform\)\}/u);
  assert.match(snapshot, /min-width:920px\)\{\.csssolitaire-board>s\{transform:var\(--csssolitaire-portrait-4-transform\)\}/u);
  assert.match(snapshot, /border-radius:14px/u);
  assert.match(snapshot, /image-rendering:auto/u);
  assert.doesNotMatch(snapshot, /matrix3d|preserve-3d|backface-visibility/u);
  assert.doesNotMatch(snapshot, /<(?:script|canvas|svg)\b|\sdata-[a-z0-9-]+=/iu);

  const playback = JSON.parse(await readFile(join(generated, "solitaire-playback.json"), "utf8"));
  assert.equal(playback.schema, "csssolitaire-prepared-playback@2");
  assert.equal(playback.selection, "crypto-random-shuffled-bag-no-immediate-repeat");
  assert.equal(playback.patternCount, 24);
  assert.equal(playback.patterns.length, 24);
  assert.equal(playback.retainedTrailLeafCount, 1907);
  assert.equal(new Set(playback.patterns.map(({ seed }) => seed)).size, 24);
  assert.equal(new Set(playback.patterns.map(({ horizontalVelocities }) => horizontalVelocities.join(","))).size, 24);
  assert.equal(playback.patterns.reduce((sum, pattern) => sum + pattern.trailLeafCount, 0), 37634);
  assert.ok(playback.patterns.every((pattern) =>
    pattern.leafPortraitMatricesByCardCount.length === 4 &&
    pattern.leafPortraitMatricesByCardCount.every((profile) => profile.length === pattern.trailLeafCount)));
  const initialPattern = playback.patterns[0];
  const oneCardLefts = initialPattern.leafPortraitMatricesByCardCount[0]
    .filter(Boolean)
    .map((transform) => Number(transform.slice(7, -1).split(",")[4]) - 71);
  assert.ok(Math.min(...oneCardLefts) <= 2);
  assert.ok(Math.max(...oneCardLefts) >= 311);
  assert.equal(initialPattern.sourceStepCount, 1614);
  assert.equal(initialPattern.frameTimesMs.length, 585);
  assert.equal(initialPattern.visibilityRows.length, 585);
  assert.equal(initialPattern.foundationRows.length, 585);
  assert.equal(initialPattern.foundationRows.reduce((sum, row) => sum + row.length, 0), 24);
  assert.deepEqual(initialPattern.foundationRows.filter((row) => row.length > 0).at(-1), [[0, 0, 1920]]);
  assert.equal(initialPattern.visibilityRows[0].length, 1614);
  assert.ok(Math.max(...initialPattern.visibilityRows.slice(1).map((row) => row.length)) <= 6);
  assert.equal(initialPattern.visibilityRows.at(-1).length, 1);
  assert.equal(initialPattern.visibilityRows.at(-1)[0], -5);
  assert.equal(initialPattern.rewindStartMilliseconds, 13098);
  assert.equal(initialPattern.rewindEndMilliseconds, 25223);
  assert.equal(initialPattern.frameTimesMs.at(-1), 25223);
  assert.equal(playback.runtimeTrajectoryCalculation, false);
  assert.equal(playback.runtimeDomGrowth, false);
});
