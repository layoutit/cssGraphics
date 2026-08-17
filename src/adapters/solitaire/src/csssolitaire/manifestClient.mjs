import { selectSolitairePreparedBank } from "./bankSelection.mjs";

const MANIFEST_URL = "/csssolitaire/manifest.json";
const BANK_IDS = Object.freeze(["mobile", "small-desktop", "large-desktop"]);
const jsonPromises = new Map();

export async function loadPreparedSolitaire({
  width = innerWidth,
  height = innerHeight,
  bankId = selectSolitairePreparedBank({ width, height }),
} = {}) {
  const manifest = await fetchJson(MANIFEST_URL);
  validateManifest(manifest);
  const bank = manifest.transport.preparedBanks.find(({ id }) => id === bankId);
  if (!bank) throw new RangeError("Prepared cssSolitaire bank selection drifted");
  const profileIndex = resolveSolitaireBankProfileIndex(
    bankId,
    width,
    height,
    manifest.renderer.portraitCardBreakpoints,
  );
  const descriptor = bank.profiles.find(({ index }) => index === profileIndex);
  if (!descriptor) throw new RangeError("Prepared cssSolitaire bank profile drifted");
  const [snapshotHtml, schedule, layout] = await Promise.all([
    fetchText(bank.snapshotUrl),
    fetchCachedJson(bank.scheduleUrl),
    fetchCachedJson(descriptor.layoutUrl),
    decodeImage(manifest.transport.cardAtlasUrl),
  ]);
  validateSchedule(schedule, manifest, bank);
  validateLayout(layout, schedule, bank, descriptor);
  const playback = Object.freeze({
    ...schedule,
    schema: "csssolitaire-prepared-profile@1",
    profileIndex,
    profileName: descriptor.name,
    foundationLayouts: layout.foundationLayouts,
    patterns: schedule.patterns.map((pattern, index) => Object.freeze({
      ...pattern,
      layouts: layout.patterns[index].layouts,
    })),
  });
  return Object.freeze({ manifest, bank, snapshotHtml, playback });
}

export function resolveSolitaireBankProfileIndex(bankId, width, height, breakpoints) {
  if (bankId === "mobile") return 1;
  if (bankId === "large-desktop") return 0;
  if (bankId !== "small-desktop") {
    throw new RangeError("Prepared cssSolitaire bank selection drifted");
  }
  const profileIndex = resolveSolitaireProfileIndex(width, height, breakpoints);
  if (profileIndex === 1) throw new RangeError("Phone viewport selected the desktop bank");
  return profileIndex;
}

export function resolveSolitaireProfileIndex(width, height, breakpoints) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
      JSON.stringify(breakpoints) !== "[520,720,920]") {
    throw new TypeError("Prepared cssSolitaire viewport drifted");
  }
  if (height < width) return 0;
  if (width < breakpoints[0]) return 1;
  if (width < breakpoints[1]) return 2;
  if (width < breakpoints[2]) return 3;
  return 4;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prepared cssSolitaire resource failed: ${url} (${response.status})`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function fetchCachedJson(url) {
  let promise = jsonPromises.get(url);
  if (!promise) {
    promise = fetchJson(url).catch((error) => {
      jsonPromises.delete(url);
      throw error;
    });
    jsonPromises.set(url, promise);
  }
  return promise;
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
  const renderer = manifest?.renderer;
  const source = manifest?.sourceProfile;
  const transport = manifest?.transport;
  const metrics = manifest?.metrics;
  const atlas = manifest?.provenance?.cardAtlas;
  const banks = transport?.preparedBanks;
  const bankMetrics = metrics?.preparedBanks;
  const bankIds = banks?.map(({ id }) => id);
  const metricIds = bankMetrics?.map(({ id }) => id);
  if (manifest?.schema !== "csssolitaire-manifest@1" || manifest.status !== "ready" ||
      manifest.scope !== "public-prepared-product" || manifest.identity?.id !== "solitaire-victory" ||
      renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      renderer.profile !== "prepared-playback" || renderer.retainedDom !== true ||
      renderer.leafTag !== "b" || renderer.textureBackend !== "atlas" ||
      renderer.textureLeafSizing !== "raster" || renderer.composition !== "flat-2d-card-plane" ||
      renderer.transformPublication !== "prepared-inline-style" || renderer.seamBleed !== 0.2 ||
      renderer.runtimeCanvasCount !== 0 || renderer.runtimeAtlasRasterization !== false ||
      renderer.runtimeGeometryCalculation !== false || renderer.runtimeTrajectoryCalculation !== false ||
      renderer.runtimeDomGrowth !== false || renderer.preparedPatternBankCount !== 24 ||
      renderer.runtimePatternSelectionOnly !== true ||
      JSON.stringify(renderer.responsiveProfiles) !== '["landscape","portrait"]' ||
      renderer.viewportPositioning !== "prepared-layout-resolved-inline-matrix-no-letterbox" ||
      renderer.viewportFill !== true ||
      renderer.verticalMapping !== "foundation-and-retained-bounce-bottom-anchored" ||
      renderer.foundationTopCssPixels !== 80 || renderer.archTopCssPixels !== 8 ||
      JSON.stringify(renderer.sourceVerticalAnchors) !== "[-71,4,299]" ||
      renderer.upwardArchMapping !== "prepared-source-smooth-three-anchor-curve" ||
      JSON.stringify(renderer.cardSourceSize) !== "[71,96]" ||
      JSON.stringify(renderer.cardPrimitiveSize) !== "[240,160]" ||
      JSON.stringify(renderer.landscapePresentationBase) !== "[960,540]" ||
      renderer.landscapePresentationBaseScale !== 1.40625 ||
      renderer.landscapeCardMaximumWidthCssPixels !== 200 ||
      JSON.stringify(renderer.portraitPresentationBase) !== "[384,720]" ||
      renderer.portraitMapping !== "progressive-card-count-prepared-source-lane-folding" ||
      JSON.stringify(renderer.portraitReflectionReferenceWidths) !== "[384,600,800,960]" ||
      JSON.stringify(renderer.portraitCardCounts) !== "[1,2,3,4]" ||
      JSON.stringify(renderer.portraitCardBreakpoints) !== "[520,720,920]" ||
      renderer.portraitHorizontalMotion !==
        "phone-source-gravity-prepared-wall-and-floor-impact-response-one-card" ||
      JSON.stringify(renderer.portraitWallBounceCardCounts) !== "[1]" ||
      renderer.phoneLaunchCardCount !== 1 || renderer.phonePlaybackTimeScale !== 3 ||
      renderer.phoneHorizontalDistanceScale !== 2 || renderer.phoneFloorBounceCount !== 3 ||
      renderer.phoneImpactResponse !==
        "prepared-new-horizontal-step-after-wall-and-nonterminal-floor-impact" ||
      JSON.stringify(renderer.phoneImpactHorizontalSteps) !== "[6,2,5,3,4]" ||
      renderer.phoneTrailSubstepCount !== 3 || renderer.largeDesktopTrailSubstepCount !== 2 ||
      renderer.largeDesktopMinimumWidthCssPixels !== 1_600 || renderer.phoneProfileIndex !== 1 ||
      renderer.preparedSlotLayout !== "source-seven-slot-presentation-scaled-card-size" ||
      renderer.slotCount !== 7 || renderer.minimumSlotGap !== 11 ||
      renderer.presentationScaleMode !== "single-root-contain-scale-viewport-positioned" ||
      renderer.runtimeResizeCalculation !== "prepared-layout-inline-matrix-resolution" ||
      transport?.startupBankSelection !== "mobile-capability-then-large-landscape-width" ||
      JSON.stringify(bankIds) !== JSON.stringify(BANK_IDS) ||
      JSON.stringify(metricIds) !== JSON.stringify(BANK_IDS) ||
      transport.runtimeModelPayload !== false || transport.runtimeManifestRequired !== true ||
      source?.cards !== 12 || source.sourceSteps !== 1679 || source.patternCount !== 24 ||
      source.patternSelection !==
        "crypto-random-initial-and-shuffled-bag-alternating-phone-direction-unique-angle" ||
      source.horizontalVelocityDistribution !==
        "mild-slow-bias-first-two-lanes-quarter-right-unique-per-lane-cycle" ||
      JSON.stringify(source.horizontalVelocityRange) !== "[-65,65]" ||
      source.minimumHorizontalSpeed !== 20 || source.horizontalVelocityBiasExponent !== 1.1 ||
      source.phoneLaunchVelocityDistribution !==
        "source-effective-steps-balanced-direction-unique-angle" ||
      source.phoneRightwardPatternCount !== 12 || source.phoneEffectiveLaunchAngleCount !== 24 ||
      source.phoneExactTrajectoryRepeats !== false ||
      JSON.stringify(source.rightwardFoundationIndices) !== "[0,1]" ||
      source.rightwardSelection !== "random-value-modulo-4-zero" ||
      source.exactSameLaneTrajectoryRepeats !== false ||
      !Array.isArray(source.patternSeeds) || source.patternSeeds.length !== 24 ||
      new Set(source.patternSeeds).size !== 24 ||
      !Array.isArray(source.patterns) || source.patterns.length !== 24 ||
      source.launchCycleCount !== 3 ||
      JSON.stringify(source.startingCards) !==
        '["king-of-spades","queen-of-hearts","jack-of-diamonds","ace-of-clubs"]' ||
      JSON.stringify(renderer.contentBounds) !== "[-69,-71,655,395]" ||
      metrics?.foundationLeafCount !== 4 || metrics.preparedPatternCount !== 24 ||
      metrics.preparedFoundationOperationCount !== 576 || metrics.preparedFrameCount !== 13774 ||
      !Number.isSafeInteger(metrics.preparedPhoneFrameCount) || metrics.preparedPhoneFrameCount <= 0 ||
      metrics.preparedLargeDesktopFrameCount !== metrics.preparedFrameCount ||
      metrics.preparedLeafLayoutCount !== 38014 || metrics.initialPatternDurationMs !== 27210 ||
      metrics.minimumPatternDurationMs !== 20475 || metrics.maximumPatternDurationMs !== 31228 ||
      banks.some((bank, index) => !validBankDescriptor(bank, bankMetrics[index])) ||
      banks[0].retainedLeafCount >= banks[1].retainedLeafCount ||
      banks[2].retainedLeafCount <= banks[1].retainedLeafCount ||
      atlas?.sourceSha256 !== "e782179fb60932722548e3e6b46038a2df16d15001d3ea8cbdd22cc005f2841d" ||
      atlas.sha256 !== "cb5832bac7b12c650ddae6880a1ce63825db07974dd378def9d6e1630bcca207" ||
      atlas.borderColor !== "#45484d" || atlas.borderPixelsRecolored !== 62598 ||
      atlas.redColor !== "#e6180a" || atlas.redPixelsRecolored !== 468866 ||
      atlas.redPaletteReference !== "https://github.com/htdebeer/SVG-cards") {
    throw new Error("Prepared cssSolitaire manifest drifted");
  }
}

function validBankDescriptor(bank, metrics) {
  const profileIndices = bank?.profiles?.map(({ index }) => index);
  const expectedProfileIndices = bank?.id === "mobile" ? [1]
    : bank?.id === "large-desktop" ? [0] : [0, 2, 3, 4];
  return bank?.id === metrics?.id &&
    /^\/csssolitaire\/solitaire-(?:mobile|small-desktop|large-desktop)\.polycss\.txt$/u
      .test(bank.snapshotUrl) &&
    /^\/csssolitaire\/solitaire-schedule-(?:mobile|small-desktop|large-desktop)\.json$/u
      .test(bank.scheduleUrl) &&
    Number.isSafeInteger(bank.retainedLeafCount) && bank.retainedLeafCount > 4 &&
    bank.retainedTrailLeafCount === bank.retainedLeafCount - 4 &&
    metrics.retainedLeafCount === bank.retainedLeafCount &&
    metrics.retainedTrailLeafCount === bank.retainedTrailLeafCount &&
    Number.isSafeInteger(metrics.preparedFrameCount) && metrics.preparedFrameCount > 0 &&
    Number.isSafeInteger(metrics.preparedLeafLayoutCount) && metrics.preparedLeafLayoutCount > 0 &&
    JSON.stringify(profileIndices) === JSON.stringify(expectedProfileIndices) &&
    bank.profiles.every((profile) => typeof profile.name === "string" &&
      /^\/csssolitaire\/solitaire-layout-[a-z0-9-]+\.json$/u.test(profile.layoutUrl));
}

function validateSchedule(schedule, manifest, bank) {
  const bankMetric = manifest.metrics.preparedBanks.find(({ id }) => id === bank.id);
  if (schedule?.schema !== "csssolitaire-prepared-schedule@1" ||
      schedule.bankId !== bank.id || schedule.profileKind !== expectedProfileKind(bank.id) ||
      schedule.loop !== true || schedule.selection !==
        "crypto-random-initial-and-shuffled-bag-alternating-phone-direction-unique-angle" ||
      schedule.patternCount !== 24 || schedule.initialPatternIndex !== 0 ||
      schedule.phoneProfileIndex !== 1 || schedule.sourceStepMilliseconds !== 7.5 ||
      schedule.initialHoldMilliseconds !== 500 ||
      schedule.foundationLeafCount !== manifest.metrics.foundationLeafCount ||
      schedule.retainedLeafCount !== bank.retainedLeafCount ||
      schedule.retainedTrailLeafCount !== bank.retainedTrailLeafCount ||
      schedule.snapshotProfileIndex !== (bank.id === "mobile" ? 1 : 0) ||
      !Array.isArray(schedule.snapshotPlayfield) || schedule.snapshotPlayfield.length !== 2 ||
      !Number.isFinite(schedule.snapshotPresentationScale) ||
      JSON.stringify(schedule.layoutComponentOrder) !==
        '["xViewportPercent","xCardWidthFactor","yViewportPercent","yPixels","yCardHeightFactor"]' ||
      !Array.isArray(schedule.atlasPositions) || schedule.atlasPositions.length !== 52 ||
      schedule.atlasPositions.some((position) => !/^-?\d+px -?\d+px$/u.test(position)) ||
      !Array.isArray(schedule.patterns) || schedule.patterns.length !== schedule.patternCount ||
      schedule.patterns.some((pattern, index) =>
        !validPattern(pattern, schedule, manifest.sourceProfile.patterns[index], index, bank.id)) ||
      new Set(schedule.patterns.map(phoneLaunchAngleKey)).size !== 24 ||
      schedule.patterns.filter(({ phoneHorizontalVelocity }) => phoneHorizontalVelocity > 0).length !== 12 ||
      schedule.patterns.reduce((sum, pattern) => sum + pattern.frameTimesMs.length, 0) !==
        bankMetric.preparedFrameCount ||
      schedule.patterns.reduce((sum, pattern) => sum + pattern.trailLeafCount, 0) !==
        bankMetric.preparedLeafLayoutCount ||
      schedule.runtimeSelectionOnly !== true || schedule.runtimeGeometryCalculation !== false ||
      schedule.runtimeTrajectoryCalculation !== false || schedule.runtimeAtlasRasterization !== false ||
      schedule.runtimeDomGrowth !== false) {
    throw new Error("Prepared cssSolitaire schedule drifted");
  }
}

function expectedProfileKind(bankId) {
  if (bankId === "mobile") return "phone";
  if (bankId === "large-desktop") return "large-desktop";
  return "source";
}

function validPattern(pattern, schedule, source, index, bankId) {
  const mobile = bankId === "mobile";
  const largeDesktop = bankId === "large-desktop";
  const expectedTrailLeafCount = mobile ? source.phoneTrailLeafCount
    : largeDesktop ? source.largeDesktopTrailLeafCount : source.trailLeafCount;
  const expectedFrameCount = mobile ? source.phonePreparedFrameCount
    : largeDesktop ? source.largeDesktopPreparedFrameCount : source.preparedFrameCount;
  const expectedDuration = mobile ? source.phoneDurationMs
    : largeDesktop ? source.largeDesktopDurationMs : source.durationMs;
  return pattern?.id === `pattern-${String(index + 1).padStart(2, "0")}` &&
    source?.id === pattern.id && pattern.seed === source.seed &&
    pattern.trailLeafCount === expectedTrailLeafCount && pattern.trailLeafCount > 0 &&
    pattern.trailLeafCount <= schedule.retainedTrailLeafCount &&
    pattern.launchCardCount === (mobile ? 1 : 12) &&
    pattern.sourceStepCount === (mobile ? source.phoneSourceSteps : source.sourceSteps) &&
    pattern.sourceStepMilliseconds === (mobile ? 22.5 : 7.5) &&
    pattern.phoneHorizontalVelocity === source.phoneHorizontalVelocity &&
    pattern.phoneVerticalVelocity === source.phoneVerticalVelocity &&
    JSON.stringify(pattern.phoneImpactVelocitySteps) === JSON.stringify(source.phoneImpactVelocitySteps) &&
    validPhoneImpactVelocitySteps(pattern.phoneImpactVelocitySteps) &&
    pattern.durationMs === expectedDuration && pattern.durationMs > pattern.rewindEndMilliseconds &&
    pattern.rewindEndMilliseconds > pattern.rewindStartMilliseconds &&
    pattern.rewindStartMilliseconds > 0 && validTimeline(pattern, schedule.foundationLeafCount) &&
    (mobile
      ? Number.isSafeInteger(pattern.atlasIndex) && pattern.atlasIndex >= 0 &&
        pattern.atlasIndex < schedule.atlasPositions.length && pattern.leafAtlasIndices === undefined
      : pattern.sourceDrawCount === source.sourceDraws &&
        Array.isArray(pattern.horizontalVelocities) && pattern.horizontalVelocities.length === 12 &&
        Array.isArray(pattern.leafAtlasIndices) &&
        pattern.leafAtlasIndices.length === pattern.trailLeafCount &&
        pattern.leafAtlasIndices.every((atlasIndex) => Number.isSafeInteger(atlasIndex) &&
          atlasIndex >= 0 && atlasIndex < schedule.atlasPositions.length)) &&
    pattern.frameTimesMs.length === expectedFrameCount;
}

function validTimeline(pattern, foundationLeafCount) {
  const frameTimes = pattern.frameTimesMs;
  return Array.isArray(frameTimes) && frameTimes.length > 1 && frameTimes[0] === 0 &&
    frameTimes.at(-1) === pattern.rewindEndMilliseconds &&
    !frameTimes.some((time, index) => !Number.isFinite(time) || time < 0 ||
      (index > 0 && time <= frameTimes[index - 1])) &&
    Array.isArray(pattern.visibilityRows) && pattern.visibilityRows.length === frameTimes.length &&
    pattern.visibilityRows[0].length === pattern.trailLeafCount &&
    !pattern.visibilityRows.some((row) => !Array.isArray(row) || row.some((operation) =>
      !Number.isSafeInteger(operation) || Math.abs(operation) <= foundationLeafCount ||
      Math.abs(operation) > foundationLeafCount + pattern.trailLeafCount)) &&
    Array.isArray(pattern.foundationRows) && pattern.foundationRows.length === frameTimes.length &&
    !pattern.foundationRows.some((row) => !Array.isArray(row) || row.some((operation) =>
      !Array.isArray(operation) || operation.length !== 3 ||
      !Number.isSafeInteger(operation[0]) || operation[0] < 0 || operation[0] >= foundationLeafCount ||
      !Number.isSafeInteger(operation[1]) || !Number.isSafeInteger(operation[2]) ||
      !((operation[1] === -1 && operation[2] === -1) ||
        (operation[1] >= 0 && operation[1] <= 720 && operation[2] >= 0 && operation[2] <= 1920))));
}

function validateLayout(layout, schedule, bank, descriptor) {
  if (layout?.schema !== "csssolitaire-prepared-layout@1" || layout.bankId !== bank.id ||
      layout.profileIndex !== descriptor.index || layout.profileName !== descriptor.name ||
      layout.patternCount !== schedule.patternCount ||
      !Array.isArray(layout.foundationLayouts) ||
      layout.foundationLayouts.length !== schedule.foundationLeafCount ||
      layout.foundationLayouts.some((entry) => !validPreparedLayout(entry)) ||
      !Array.isArray(layout.patterns) || layout.patterns.length !== schedule.patternCount ||
      layout.patterns.some((pattern, index) => pattern?.id !== schedule.patterns[index].id ||
        !Array.isArray(pattern.layouts) ||
        pattern.layouts.length !== schedule.patterns[index].trailLeafCount ||
        pattern.layouts.some((entry) => !validPreparedLayout(entry)))) {
    throw new Error("Prepared cssSolitaire layout drifted");
  }
}

function validPreparedLayout(layout) {
  return Array.isArray(layout) && layout.length === 5 && layout.every(Number.isFinite);
}

function validPhoneImpactVelocitySteps(steps) {
  return Array.isArray(steps) && steps.length >= 3 &&
    steps.filter((entry) => Array.isArray(entry) && entry[0] === "floor").length === 2 &&
    steps.some((entry) => Array.isArray(entry) && entry[0] === "wall") &&
    steps.every((entry, index) => Array.isArray(entry) && entry.length === 2 &&
      (entry[0] === "wall" || entry[0] === "floor") &&
      Number.isSafeInteger(entry[1]) && Math.abs(entry[1]) >= 2 && Math.abs(entry[1]) <= 6 &&
      (index === 0 || Math.abs(entry[1]) !== Math.abs(steps[index - 1][1])));
}

function phoneLaunchAngleKey({ phoneHorizontalVelocity, phoneVerticalVelocity }) {
  let horizontalStep = Math.abs(Math.trunc(phoneHorizontalVelocity / 10));
  let verticalStep = Math.abs(Math.trunc(phoneVerticalVelocity / 10));
  let left = horizontalStep;
  let right = verticalStep;
  while (right !== 0) [left, right] = [right, left % right];
  horizontalStep /= left;
  verticalStep /= left;
  return `${horizontalStep}:${verticalStep}`;
}
