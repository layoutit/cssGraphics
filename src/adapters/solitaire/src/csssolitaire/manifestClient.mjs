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
      JSON.stringify(manifest.renderer?.responsiveProfiles) !== '["landscape","portrait"]' ||
      manifest.renderer?.viewportPositioning !== "prepared-css-vw-vh-no-letterbox" ||
      manifest.renderer?.viewportFill !== true ||
      manifest.renderer?.verticalMapping !== "foundation-and-retained-bounce-bottom-anchored" ||
      manifest.renderer?.foundationTopCssPixels !== 80 ||
      manifest.renderer?.archTopCssPixels !== 8 ||
      JSON.stringify(manifest.renderer?.sourceVerticalAnchors) !== "[-71,4,299]" ||
      manifest.renderer?.upwardArchMapping !==
        "prepared-source-smooth-three-anchor-curve" ||
      JSON.stringify(manifest.renderer?.cardSourceSize) !== "[71,96]" ||
      JSON.stringify(manifest.renderer?.landscapePresentationBase) !== "[960,540]" ||
      manifest.renderer?.landscapePresentationBaseScale !== 1.40625 ||
      JSON.stringify(manifest.renderer?.portraitPresentationBase) !== "[384,720]" ||
      manifest.renderer?.portraitMapping !== "progressive-card-count-prepared-wall-reflection" ||
      JSON.stringify(manifest.renderer?.portraitReflectionReferenceWidths) !== "[384,600,800,960]" ||
      JSON.stringify(manifest.renderer?.portraitCardCounts) !== "[1,2,3,4]" ||
      JSON.stringify(manifest.renderer?.portraitCardBreakpoints) !== "[520,720,920]" ||
      manifest.renderer?.portraitHorizontalMotion !==
        "mobile-reflected-wall-bounce-multi-card-full-exit" ||
      JSON.stringify(manifest.renderer?.portraitWallBounceCardCounts) !== "[1]" ||
      manifest.renderer?.preparedSlotLayout !== "source-seven-slot-presentation-scaled-card-size" ||
      manifest.renderer?.slotCount !== 7 || manifest.renderer?.minimumSlotGap !== 11 ||
      manifest.renderer?.presentationScaleMode !== "single-root-contain-scale-viewport-positioned" ||
      manifest.renderer?.runtimeResizeCalculation !== "single-root-presentation-scale-only" ||
      manifest.transport?.snapshotUrl !== "/csssolitaire/solitaire.polycss.txt" ||
      manifest.transport?.runtimeModelPayload !== false ||
      manifest.sourceProfile?.cards !== 12 ||
      manifest.sourceProfile?.sourceSteps !== 1679 ||
      manifest.sourceProfile?.patternCount !== 24 ||
      manifest.sourceProfile?.patternSelection !== "crypto-random-shuffled-bag-no-immediate-repeat" ||
      manifest.sourceProfile?.horizontalVelocityDistribution !==
        "mild-slow-bias-first-two-lanes-quarter-right-unique-per-lane-cycle" ||
      JSON.stringify(manifest.sourceProfile?.horizontalVelocityRange) !== "[-65,65]" ||
      manifest.sourceProfile?.minimumHorizontalSpeed !== 20 ||
      manifest.sourceProfile?.horizontalVelocityBiasExponent !== 1.1 ||
      JSON.stringify(manifest.sourceProfile?.rightwardFoundationIndices) !== "[0,1]" ||
      manifest.sourceProfile?.rightwardSelection !== "random-value-modulo-4-zero" ||
      manifest.sourceProfile?.exactSameLaneTrajectoryRepeats !== false ||
      !Array.isArray(manifest.sourceProfile?.patternSeeds) ||
      manifest.sourceProfile.patternSeeds.length !== 24 ||
      new Set(manifest.sourceProfile.patternSeeds).size !== 24 ||
      !Array.isArray(manifest.sourceProfile?.patterns) || manifest.sourceProfile.patterns.length !== 24 ||
      manifest.sourceProfile?.launchCycleCount !== 3 ||
      JSON.stringify(manifest.sourceProfile?.startingCards) !==
        '["king-of-spades","queen-of-hearts","jack-of-diamonds","ace-of-clubs"]' ||
      JSON.stringify(manifest.renderer?.contentBounds) !== "[-69,-71,655,395]" ||
      manifest.metrics?.retainedLeafCount !== 1952 ||
      manifest.metrics?.foundationLeafCount !== 4 ||
      manifest.metrics?.retainedTrailLeafCount !== 1948 ||
      manifest.metrics?.preparedPatternCount !== 24 ||
      manifest.metrics?.preparedFoundationOperationCount !== 576 ||
      manifest.metrics?.preparedFrameCount !== 13774 ||
      manifest.metrics?.preparedLeafLayoutCount !== 38014 ||
      manifest.metrics?.initialPatternDurationMs !== 27210 ||
      manifest.metrics?.minimumPatternDurationMs !== 20475 ||
      manifest.metrics?.maximumPatternDurationMs !== 31228 ||
      manifest.provenance?.cardAtlas?.sourceSha256 !==
        "e782179fb60932722548e3e6b46038a2df16d15001d3ea8cbdd22cc005f2841d" ||
      manifest.provenance?.cardAtlas?.sha256 !==
        "cb5832bac7b12c650ddae6880a1ce63825db07974dd378def9d6e1630bcca207" ||
      manifest.provenance?.cardAtlas?.borderColor !== "#45484d" ||
      manifest.provenance?.cardAtlas?.borderPixelsRecolored !== 62598 ||
      manifest.provenance?.cardAtlas?.redColor !== "#e6180a" ||
      manifest.provenance?.cardAtlas?.redPixelsRecolored !== 468866 ||
      manifest.provenance?.cardAtlas?.redPaletteReference !==
        "https://github.com/htdebeer/SVG-cards") {
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
    !pattern.leafMatrices.some((transform) => !validPreparedTransform(transform)) &&
    Array.isArray(pattern.leafPortraitMatricesByCardCount) &&
    pattern.leafPortraitMatricesByCardCount.length === 4 &&
    !pattern.leafPortraitMatricesByCardCount.some((profile) =>
      !Array.isArray(profile) || profile.length !== pattern.trailLeafCount ||
      profile.some((transform) => transform !== null && !validPreparedTransform(transform))) &&
    !pattern.leafPortraitMatricesByCardCount[3].some((transform) => transform === null) &&
    !Array.from({ length: pattern.trailLeafCount }, (_, leafIndex) => leafIndex).some((leafIndex) =>
      pattern.leafPortraitMatricesByCardCount.some((profile, profileIndex, profiles) =>
        profileIndex > 0 && profiles[profileIndex - 1][leafIndex] !== null && profile[leafIndex] === null)) &&
    Array.isArray(pattern.leafFoundationIndices) &&
    pattern.leafFoundationIndices.length === pattern.trailLeafCount &&
    !pattern.leafFoundationIndices.some((foundationIndex) =>
      !Number.isSafeInteger(foundationIndex) || foundationIndex < 0 ||
      foundationIndex >= playback.foundationLeafCount) &&
    Array.isArray(pattern.leafAtlasIndices) && pattern.leafAtlasIndices.length === pattern.trailLeafCount &&
    !pattern.leafAtlasIndices.some((atlasIndex) =>
      !Number.isSafeInteger(atlasIndex) || atlasIndex < 0 || atlasIndex >= playback.atlasPositions.length);
}

function validPreparedTransform(transform) {
  return typeof transform === "string" &&
    transform.startsWith("translate(calc(") && transform.includes("vw") &&
    transform.includes("--csssolitaire-card-width") && transform.includes("vh") &&
    transform.includes("--csssolitaire-card-height") &&
    transform.endsWith(
      "rotate(90deg) scale(var(--csssolitaire-card-transform-x),var(--csssolitaire-card-transform-y))",
    );
}
