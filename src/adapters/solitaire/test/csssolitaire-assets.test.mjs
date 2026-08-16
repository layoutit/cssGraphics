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
  assert.deepEqual(manifest.sourceProfile.horizontalVelocityRange, [-65, 65]);
  assert.equal(manifest.sourceProfile.minimumHorizontalSpeed, 20);
  assert.equal(manifest.sourceProfile.horizontalVelocityDistribution,
    "mild-slow-bias-first-two-lanes-quarter-right-unique-per-lane-cycle");
  assert.equal(manifest.sourceProfile.horizontalVelocityBiasExponent, 1.1);
  assert.deepEqual(manifest.sourceProfile.rightwardFoundationIndices, [0, 1]);
  assert.equal(manifest.sourceProfile.rightwardSelection, "random-value-modulo-4-zero");
  assert.equal(manifest.sourceProfile.exactSameLaneTrajectoryRepeats, false);
  assert.equal(manifest.sourceProfile.sourceDraws, 1679);
  assert.equal(manifest.sourceProfile.sourceSteps, 1679);
  assert.equal(manifest.sourceProfile.patternCount, 24);
  assert.equal(new Set(manifest.sourceProfile.patternSeeds).size, 24);
  assert.equal(manifest.sourceProfile.patterns.length, 24);
  assert.equal(manifest.renderer.morphTarget, "createPolyMorphPreparedDomTarget");
  assert.equal(manifest.renderer.profile, "prepared-playback");
  assert.equal(manifest.renderer.textureBackend, "atlas");
  assert.equal(manifest.renderer.textureLeafSizing, "raster");
  assert.equal(manifest.renderer.composition, "flat-2d-card-plane");
  assert.deepEqual(manifest.renderer.contentBounds, [-69, -71, 655, 395]);
  assert.deepEqual(manifest.renderer.responsiveProfiles, ["landscape", "portrait"]);
  assert.equal(manifest.renderer.viewportPositioning, "prepared-css-vw-vh-no-letterbox");
  assert.equal(manifest.renderer.viewportFill, true);
  assert.equal(manifest.renderer.verticalMapping, "foundation-and-retained-bounce-bottom-anchored");
  assert.equal(manifest.renderer.foundationTopCssPixels, 80);
  assert.equal(manifest.renderer.archTopCssPixels, 8);
  assert.deepEqual(manifest.renderer.sourceVerticalAnchors, [-71, 4, 299]);
  assert.equal(manifest.renderer.upwardArchMapping,
    "prepared-source-smooth-three-anchor-curve");
  assert.deepEqual(manifest.renderer.cardSourceSize, [71, 96]);
  assert.deepEqual(manifest.renderer.landscapePresentationBase, [960, 540]);
  assert.equal(manifest.renderer.landscapePresentationBaseScale, 1.40625);
  assert.deepEqual(manifest.renderer.portraitPresentationBase, [384, 720]);
  assert.equal(manifest.renderer.portraitMapping, "progressive-card-count-prepared-wall-reflection");
  assert.deepEqual(manifest.renderer.portraitReflectionReferenceWidths, [384, 600, 800, 960]);
  assert.deepEqual(manifest.renderer.portraitCardCounts, [1, 2, 3, 4]);
  assert.deepEqual(manifest.renderer.portraitCardBreakpoints, [520, 720, 920]);
  assert.equal(manifest.renderer.portraitHorizontalMotion,
    "mobile-reflected-wall-bounce-multi-card-full-exit");
  assert.deepEqual(manifest.renderer.portraitWallBounceCardCounts, [1]);
  assert.equal(manifest.renderer.preparedSlotLayout, "source-seven-slot-presentation-scaled-card-size");
  assert.equal(manifest.renderer.slotCount, 7);
  assert.equal(manifest.renderer.minimumSlotGap, 11);
  assert.equal(manifest.renderer.presentationScaleMode, "single-root-contain-scale-viewport-positioned");
  assert.equal(manifest.renderer.runtimeResizeCalculation, "single-root-presentation-scale-only");
  assert.equal(manifest.renderer.seamBleed, 0.2);
  assert.equal(manifest.renderer.runtimeAtlasRasterization, false);
  assert.equal(manifest.renderer.runtimeGeometryCalculation, false);
  assert.equal(manifest.renderer.runtimeTrajectoryCalculation, false);
  assert.equal(manifest.renderer.runtimeDomGrowth, false);
  assert.equal(manifest.transport.runtimeModelPayload, false);
  assert.equal(manifest.metrics.retainedLeafCount, 1952);
  assert.equal(manifest.metrics.foundationLeafCount, 4);
  assert.equal(manifest.metrics.retainedTrailLeafCount, 1948);
  assert.equal(manifest.metrics.preparedPatternCount, 24);
  assert.equal(manifest.metrics.preparedFrameCount, 13774);
  assert.equal(manifest.metrics.initialPatternDurationMs, 27210);
  assert.equal(manifest.metrics.minimumPatternDurationMs, 20475);
  assert.equal(manifest.metrics.maximumPatternDurationMs, 31228);
  assert.equal(manifest.metrics.preparedFoundationOperationCount, 576);
  assert.equal(manifest.metrics.preparedLeafLayoutCount, 38014);
  assert.equal(manifest.provenance.proprietaryProductBytesIncluded, false);
  assert.equal(manifest.provenance.nativeCaptureIncluded, false);
  assert.equal(manifest.provenance.cardAtlas.sourceSha256,
    "e782179fb60932722548e3e6b46038a2df16d15001d3ea8cbdd22cc005f2841d");
  assert.equal(manifest.provenance.cardAtlas.borderColor, "#45484d");
  assert.ok(manifest.provenance.cardAtlas.borderPixelsRecolored > 0);
  assert.equal(manifest.provenance.cardAtlas.redColor, "#e6180a");
  assert.ok(manifest.provenance.cardAtlas.redPixelsRecolored > 0);
  assert.equal(manifest.provenance.cardAtlas.redPaletteReference,
    "https://github.com/htdebeer/SVG-cards");

  const files = (await readdir(generated, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(generated.length + 1))
    .sort();
  assert.deepEqual(files, [
    `assets/card-faces-${manifest.provenance.cardAtlas.sha256}.png`,
    "manifest.json",
    "solitaire-playback.json",
    "solitaire.polycss.txt",
  ]);
  for (const descriptor of Object.values(manifest.assets)) {
    const bytes = await readFile(join(generated, descriptor.path));
    assert.equal(bytes.length, descriptor.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256);
  }

  const snapshot = await readFile(join(generated, "solitaire.polycss.txt"), "utf8");
  assert.match(snapshot, /class="polycss-camera solitaire-prepared-camera"/u);
  assert.match(snapshot, /class="polycss-scene solitaire-prepared-scene"/u);
  assert.doesNotMatch(snapshot, /csssolitaire-board/u);
  assert.equal((snapshot.match(/<s class="[^"]+"><\/s>/gu) ?? []).length, 1952);
  assert.doesNotMatch(snapshot, /<s[^>]+\sstyle=/u);
  assert.doesNotMatch(snapshot, /--csssolitaire-(?:landscape|portrait)-/u);
  assert.equal((snapshot.match(/\.solitaire-prepared-scene>s\.l[0-9a-z]+\{transform:/gu) ?? []).length,
    9760);
  assert.equal((snapshot.match(/\.solitaire-prepared-scene>s\.l[0-9a-z]+\{transform:translate\(/gu) ?? []).length,
    6223);
  assert.equal((snapshot.match(/\{transform:none\}/gu) ?? []).length, 3537);
  assert.equal((snapshot.match(/\.solitaire-prepared-scene>s\.f[0-9a-z]+\{background-position:/gu) ?? []).length,
    52);
  assert.equal((snapshot.match(/<s class="foundation v lane-[0-3] l[0-3] f[0-9a-z]+"><\/s>/gu) ?? []).length, 4);
  assert.match(snapshot, /\.polycss-scene\.solitaire-prepared-scene\{position:absolute;inset:0\}/u);
  assert.match(snapshot, /\.polycss-scene\.solitaire-prepared-scene>s\{position:absolute/u);
  assert.match(snapshot, /--csssolitaire-card-width:calc\(71px \* var\(--csssolitaire-presentation-scale/u);
  assert.doesNotMatch(snapshot, /--csssolitaire-fit/u);
  assert.match(snapshot, /max-width:519px\)\{\.solitaire-prepared-scene>s\.l0\{transform:translate\(/u);
  assert.match(snapshot, /min-width:920px\)\{\.solitaire-prepared-scene>s\.l0\{transform:translate\(/u);
  assert.match(snapshot, /border-radius:14px/u);
  assert.doesNotMatch(snapshot, /box-shadow/u);
  assert.match(snapshot, /image-rendering:auto/u);
  assert.doesNotMatch(snapshot, /matrix3d|preserve-3d|backface-visibility/u);
  assert.doesNotMatch(snapshot, /<(?:script|canvas|svg)\b|\sdata-[a-z0-9-]+=/iu);

  const playback = JSON.parse(await readFile(join(generated, "solitaire-playback.json"), "utf8"));
  assert.equal(playback.schema, "csssolitaire-prepared-playback@2");
  const preparedTransforms = playback.patterns.flatMap((pattern) => [
    ...pattern.leafMatrices,
    ...pattern.leafPortraitMatricesByCardCount.flat().filter(Boolean),
  ]);
  const topAnchoredPixels = preparedTransforms
    .map((transform) => transform.match(/,calc\(0vh \+ ([\d.]+)px/u)?.[1])
    .filter(Boolean)
    .map(Number);
  assert.ok(topAnchoredPixels.length > 0);
  assert.equal(Math.min(...topAnchoredPixels), 8);
  assert.ok(Math.max(...topAnchoredPixels) <= 80);
  assert.equal(playback.selection, "crypto-random-shuffled-bag-no-immediate-repeat");
  assert.equal(playback.patternCount, 24);
  assert.equal(playback.patterns.length, 24);
  assert.equal(playback.retainedTrailLeafCount, 1948);
  assert.equal(new Set(playback.patterns.map(({ seed }) => seed)).size, 24);
  assert.equal(new Set(playback.patterns.map(({ horizontalVelocities }) => horizontalVelocities.join(","))).size, 24);
  assert.equal(playback.patterns.reduce((sum, pattern) => sum + pattern.trailLeafCount, 0), 38014);
  const rightwardVelocities = playback.patterns.flatMap((pattern) =>
    pattern.horizontalVelocities
      .map((velocity, index) => ({ velocity, foundationIndex: index % 4 }))
      .filter(({ velocity }) => velocity > 0));
  assert.equal(rightwardVelocities.length, 37);
  assert.equal(playback.patterns.filter((pattern) =>
    pattern.horizontalVelocities.some((velocity) => velocity > 0)).length, 20);
  assert.ok(playback.patterns.some((pattern) =>
    pattern.horizontalVelocities.every((velocity) => velocity < 0)));
  assert.ok(rightwardVelocities.every(({ foundationIndex }) => foundationIndex < 2));
  assert.ok(playback.patterns.every((pattern) => [0, 1, 2, 3].every((laneIndex) => {
    const velocities = pattern.horizontalVelocities.filter((_, index) => index % 4 === laneIndex);
    return new Set(velocities).size === velocities.length;
  })));
  assert.ok(playback.patterns.every((pattern) =>
    pattern.leafPortraitMatricesByCardCount.length === 4 &&
    pattern.leafPortraitMatricesByCardCount.every((profile) => profile.length === pattern.trailLeafCount)));
  assert.ok(playback.patterns.every((pattern) =>
    pattern.leafFoundationIndices.length === pattern.trailLeafCount &&
    pattern.leafFoundationIndices.every((foundationIndex) => foundationIndex >= 0 && foundationIndex < 4)));
  const initialPattern = playback.patterns[0];
  const oneCardTransforms = initialPattern.leafPortraitMatricesByCardCount[0].filter(Boolean);
  assert.ok(oneCardTransforms.every((transform) => transform.includes("vw") && transform.includes("vh")));
  assert.ok(new Set(oneCardTransforms).size > 100);
  assert.equal(initialPattern.sourceStepCount, 1679);
  assert.equal(initialPattern.frameTimesMs.length, 609);
  assert.equal(initialPattern.visibilityRows.length, 609);
  assert.equal(initialPattern.foundationRows.length, 609);
  assert.equal(initialPattern.foundationRows.reduce((sum, row) => sum + row.length, 0), 24);
  assert.deepEqual(initialPattern.foundationRows.filter((row) => row.length > 0).at(-1), [[0, 0, 1920]]);
  assert.equal(initialPattern.visibilityRows[0].length, 1679);
  assert.ok(Math.max(...initialPattern.visibilityRows.slice(1).map((row) => row.length)) <= 6);
  assert.equal(initialPattern.visibilityRows.at(-1).length, 1);
  assert.equal(initialPattern.visibilityRows.at(-1)[0], -5);
  assert.equal(initialPattern.rewindStartMilliseconds, 13585);
  assert.equal(initialPattern.rewindEndMilliseconds, 26210);
  assert.equal(initialPattern.frameTimesMs.at(-1), 26210);
  assert.equal(playback.runtimeTrajectoryCalculation, false);
  assert.equal(playback.runtimeDomGrowth, false);
});
