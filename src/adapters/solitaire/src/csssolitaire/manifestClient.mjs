const MANIFEST_URL = "/csssolitaire/manifest.json";

export async function loadPreparedSolitaire() {
  const manifest = await fetchJson(MANIFEST_URL);
  validateManifest(manifest);
  const [snapshotHtml, playback] = await Promise.all([
    fetchText(manifest.transport.snapshotUrl),
    fetchJson(manifest.transport.playbackUrl),
    decodeImage(manifest.transport.cardAtlasUrl),
  ]);
  validatePlayback(playback, manifest);
  return Object.freeze({ manifest, snapshotHtml, playback });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prepared cssSolitaire resource failed: ${url} (${response.status})`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function decodeImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  if (image.naturalWidth !== 1920 || image.naturalHeight !== 4160) {
    throw new Error("Prepared cssSolitaire card atlas dimensions drifted");
  }
  return image;
}

function validateManifest(manifest) {
  if (manifest?.schema !== "csssolitaire-manifest@1" || manifest.status !== "ready" ||
      manifest.scope !== "public-prepared-product" ||
      manifest.identity?.id !== "solitaire-victory" ||
      manifest.renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      manifest.renderer?.profile !== "prepared-playback" ||
      manifest.renderer?.retainedDom !== true ||
      manifest.renderer?.textureBackend !== "atlas" ||
      manifest.renderer?.textureLeafSizing !== "raster" ||
      manifest.renderer?.composition !== "flat-2d-card-plane" ||
      manifest.renderer?.seamBleed !== 0.2 ||
      manifest.renderer?.runtimeCanvasCount !== 0 ||
      manifest.renderer?.runtimeAtlasRasterization !== false ||
      manifest.renderer?.runtimeGeometryCalculation !== false ||
      manifest.renderer?.runtimeTrajectoryCalculation !== false ||
      manifest.renderer?.runtimeDomGrowth !== false ||
      manifest.renderer?.preparedPatternBankCount !== 24 ||
      manifest.renderer?.runtimePatternSelectionOnly !== true ||
      JSON.stringify(manifest.renderer?.portraitPlayfield) !== "[384,720]" ||
      JSON.stringify(manifest.renderer?.responsiveProfiles) !== '["landscape","portrait"]' ||
      manifest.renderer?.portraitMapping !== "progressive-card-count-prepared-wall-reflection" ||
      JSON.stringify(manifest.renderer?.portraitCardCounts) !== "[1,2,3,4]" ||
      JSON.stringify(manifest.renderer?.portraitCardBreakpoints) !== "[520,720,920]" ||
      manifest.renderer?.portraitHorizontalMotion !== "prepared-reflected-wall-bounce" ||
      manifest.transport?.runtimeModelPayload !== false ||
      manifest.sourceProfile?.cards !== 12 ||
      manifest.sourceProfile?.sourceSteps !== 1614 ||
      manifest.sourceProfile?.patternCount !== 24 ||
      manifest.sourceProfile?.patternSelection !== "crypto-random-shuffled-bag-no-immediate-repeat" ||
      !Array.isArray(manifest.sourceProfile?.patternSeeds) ||
      manifest.sourceProfile.patternSeeds.length !== 24 ||
      new Set(manifest.sourceProfile.patternSeeds).size !== 24 ||
      !Array.isArray(manifest.sourceProfile?.patterns) || manifest.sourceProfile.patterns.length !== 24 ||
      manifest.sourceProfile?.launchCycleCount !== 3 ||
      JSON.stringify(manifest.sourceProfile?.startingCards) !==
        '["king-of-spades","queen-of-hearts","jack-of-diamonds","ace-of-clubs"]' ||
      JSON.stringify(manifest.renderer?.contentBounds) !== "[-70,-71,574,395]" ||
      manifest.metrics?.retainedLeafCount !== 1911 ||
      manifest.metrics?.foundationLeafCount !== 4 ||
      manifest.metrics?.retainedTrailLeafCount !== 1907 ||
      manifest.metrics?.preparedPatternCount !== 24 ||
      manifest.metrics?.preparedFoundationOperationCount !== 576 ||
      manifest.metrics?.preparedFrameCount !== 13640 ||
      manifest.metrics?.preparedLeafLayoutCount !== 37634 ||
      manifest.metrics?.initialPatternDurationMs !== 26223 ||
      manifest.metrics?.minimumPatternDurationMs !== 21305 ||
      manifest.metrics?.maximumPatternDurationMs !== 30628) {
    throw new Error("Prepared cssSolitaire manifest drifted");
  }
}

function validatePlayback(playback, manifest) {
  if (playback?.schema !== "csssolitaire-prepared-playback@2" || playback.loop !== true ||
      playback.selection !== "crypto-random-shuffled-bag-no-immediate-repeat" ||
      playback.patternCount !== 24 || playback.initialPatternIndex !== 0 ||
      playback.sourceStepMilliseconds !== 7.5 || playback.initialHoldMilliseconds !== 500 ||
      playback.foundationLeafCount !== manifest.metrics.foundationLeafCount ||
      playback.retainedLeafCount !== manifest.metrics.retainedLeafCount ||
      playback.retainedTrailLeafCount !== manifest.metrics.retainedTrailLeafCount ||
      !Array.isArray(playback.atlasPositions) || playback.atlasPositions.length !== 52 ||
      playback.atlasPositions.some((position) => !/^-?\d+px -?\d+px$/u.test(position)) ||
      !Array.isArray(playback.patterns) || playback.patterns.length !== playback.patternCount ||
      playback.patterns.some((pattern, index) => !validPattern(pattern, playback, manifest, index)) ||
      playback.patterns.reduce((sum, pattern) => sum + pattern.frameTimesMs.length, 0) !==
        manifest.metrics.preparedFrameCount ||
      playback.patterns.reduce((sum, pattern) => sum + pattern.trailLeafCount, 0) !==
        manifest.metrics.preparedLeafLayoutCount ||
      playback.runtimeSelectionOnly !== true ||
      playback.runtimeGeometryCalculation !== false ||
      playback.runtimeTrajectoryCalculation !== false ||
      playback.runtimeAtlasRasterization !== false ||
      playback.runtimeDomGrowth !== false) {
    throw new Error("Prepared cssSolitaire playback drifted");
  }
}

function validPattern(pattern, playback, manifest, index) {
  const sourcePattern = manifest.sourceProfile.patterns[index];
  const frameTimes = pattern?.frameTimesMs;
  const visibilityRows = pattern?.visibilityRows;
  const foundationRows = pattern?.foundationRows;
  return pattern?.id === `pattern-${String(index + 1).padStart(2, "0")}` &&
    pattern.seed === manifest.sourceProfile.patternSeeds[index] &&
    sourcePattern?.id === pattern.id && sourcePattern.seed === pattern.seed &&
    pattern.trailLeafCount === sourcePattern.trailLeafCount &&
    pattern.trailLeafCount > 0 && pattern.trailLeafCount <= playback.retainedTrailLeafCount &&
    pattern.sourceDrawCount === sourcePattern.sourceDraws &&
    pattern.sourceStepCount === sourcePattern.sourceSteps &&
    pattern.durationMs === sourcePattern.durationMs &&
    pattern.rewindStartMilliseconds > 0 &&
    pattern.rewindEndMilliseconds > pattern.rewindStartMilliseconds &&
    pattern.durationMs > pattern.rewindEndMilliseconds &&
    Array.isArray(frameTimes) && frameTimes.length === sourcePattern.preparedFrameCount &&
    frameTimes[0] === 0 && frameTimes.at(-1) === pattern.rewindEndMilliseconds &&
    !frameTimes.some((time, frameIndex, times) =>
      !Number.isFinite(time) || time < 0 || (frameIndex > 0 && time <= times[frameIndex - 1])) &&
    Array.isArray(visibilityRows) && visibilityRows.length === frameTimes.length &&
    visibilityRows[0].length === pattern.trailLeafCount &&
    !visibilityRows.some((row) => !Array.isArray(row) || row.some((operation) =>
      !Number.isSafeInteger(operation) ||
      Math.abs(operation) <= playback.foundationLeafCount ||
      Math.abs(operation) > playback.foundationLeafCount + pattern.trailLeafCount)) &&
    Array.isArray(foundationRows) && foundationRows.length === frameTimes.length &&
    !foundationRows.some((row) => !Array.isArray(row) || row.some((operation) =>
      !Array.isArray(operation) || operation.length !== 3 ||
      !Number.isSafeInteger(operation[0]) || operation[0] < 0 ||
      operation[0] >= playback.foundationLeafCount ||
      !Number.isSafeInteger(operation[1]) || !Number.isSafeInteger(operation[2]) ||
      !((operation[1] === -1 && operation[2] === -1) ||
        (operation[1] >= 0 && operation[1] <= 720 && operation[2] >= 0 && operation[2] <= 1920)))) &&
    Array.isArray(pattern.leafMatrices) && pattern.leafMatrices.length === pattern.trailLeafCount &&
    !pattern.leafMatrices.some((transform) => !/^matrix\([^)]*\)$/u.test(transform)) &&
    Array.isArray(pattern.leafPortraitMatricesByCardCount) &&
    pattern.leafPortraitMatricesByCardCount.length === 4 &&
    !pattern.leafPortraitMatricesByCardCount.some((profile) =>
      !Array.isArray(profile) || profile.length !== pattern.trailLeafCount ||
      profile.some((transform) => transform !== null && !/^matrix\([^)]*\)$/u.test(transform))) &&
    !pattern.leafPortraitMatricesByCardCount[3].some((transform) => transform === null) &&
    !Array.from({ length: pattern.trailLeafCount }, (_, leafIndex) => leafIndex).some((leafIndex) =>
      pattern.leafPortraitMatricesByCardCount.some((profile, profileIndex, profiles) =>
        profileIndex > 0 && profiles[profileIndex - 1][leafIndex] !== null && profile[leafIndex] === null)) &&
    Array.isArray(pattern.leafAtlasIndices) && pattern.leafAtlasIndices.length === pattern.trailLeafCount &&
    !pattern.leafAtlasIndices.some((atlasIndex) =>
      !Number.isSafeInteger(atlasIndex) || atlasIndex < 0 || atlasIndex >= playback.atlasPositions.length);
}
