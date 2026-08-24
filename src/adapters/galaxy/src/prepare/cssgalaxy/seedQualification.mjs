// SPDX-License-Identifier: HPND
import {
  advanceGalaxySource,
  commitGalaxySourceFrame,
  createGalaxySourceUniverse,
  distributeGalaxyPrefixCounts,
  projectGalaxyCenter,
} from "./sourceModel.mjs";
import { readHexHue } from "./colorFamilies.mjs";

const TWO_GALAXY_CENTER_SCORE_WEIGHTS = Object.freeze({
  physicalProximity: 0.13,
  projectedProximity: 0.1,
  approachDepth: 0.1,
  encounterTiming: 0.08,
  projectedSwing: 0.07,
  screenPresence: 0.07,
  landingInset: 0.12,
  landingSeparation: 0.1,
  colorContrast: 0.08,
  colorLegibility: 0.08,
  massBalance: 0.07,
});

const TWO_GALAXY_STELLAR_SCORE_WEIGHTS = Object.freeze({
  collisionPeak: 0.14,
  collisionDuration: 0.12,
  sustainedPairMixing: 0.16,
  postCollisionMixing: 0.12,
  secondaryVortexStructure: 0.16,
  tidalGrowth: 0.14,
  radialGrowth: 0.04,
  spatialExpansion: 0.04,
  visibleDiscPresence: 0.04,
  centerEncounter: 0.04,
});

export const CSSGALAXY_THREE_GALAXY_SEED_QUALIFICATION = Object.freeze({
  galaxyCount: 3,
  candidateSeedMaximum: 8192,
  centerShortlistCount: 192,
  sourceGenerationFrameCount: 410,
  minimumClosestFrameIndex: 180,
  maximumClosestFrameIndex: 320,
  minimumInitialCenterInsetPixels: 96,
  minimumInitialCenterSeparationPixels: 140,
  maximumSimultaneousCenterSpanPixels: 40,
  minimumSustainedPairMixing: 0.35,
  minimumSecondaryVortexStructure: 0.59,
  minimumTidalGrowth: 0.78,
  minimumRadialGrowth: 0.77,
  minimumSpatialExpansion: 0.8,
  minimumVisibleDiscPresence: 0.79,
  requiredLeadSeed: null,
  requiredSeeds: Object.freeze([
    2298, 6359, 7299, 4908, 1105, 2838, 7343, 2542, 57, 374,
  ]),
  selectedSeedCount: 10,
});

export const CSSGALAXY_TWO_GALAXY_MOBILE_SEED_QUALIFICATION = Object.freeze({
  galaxyCount: 2,
  candidateSeedMaximum: 8192,
  centerShortlistCount: 192,
  sourceGenerationFrameCount: 410,
  minimumClosestFrameIndex: 180,
  maximumClosestFrameIndex: 320,
  minimumInitialCenterInsetPixels: 80,
  minimumInitialCenterSeparationPixels: 120,
  minimumSustainedPairMixing: 0.35,
  minimumSecondaryVortexStructure: 0.5,
  requiredLeadSeed: null,
  selectedSeedCount: 10,
});

export const CSSGALAXY_SEED_QUALIFICATION_METHOD = Object.freeze({
  schema: "cssgalaxy-seed-qualification-method@2",
  candidateSeedMinimum: 1,
  candidateSeedMaximum: 256,
  centerShortlistCount: 16,
  sourceGenerationFrameCount: 1001,
  preparedStreamGenerationCount: 4,
  stellarSampleStrideFrames: 25,
  publishedStarCount: 1900,
  densityCellPixels: 8,
  tidalRadiusPixels: 60,
  secondaryVortexRadiusPixels: 96,
  secondaryVortexCaptureFraction: 0.2,
  sourceState: "complete-source-galaxies-integrated-before-deterministic-prefix-analysis",
  centerScoreWeights: Object.freeze({
    simultaneousCenterConvergence: 0.14,
    allPairProximity: 0.05,
    physicalProximity: 0.05,
    projectedProximity: 0.05,
    approachDepth: 0.06,
    encounterTiming: 0.07,
    projectedSwing: 0.06,
    screenPresence: 0.06,
    landingInset: 0.12,
    landingSeparation: 0.1,
    colorContrast: 0.07,
    colorLegibility: 0.07,
    massBalance: 0.1,
  }),
  stellarScoreWeights: Object.freeze({
    minimumPairCollisionPeak: 0.1,
    collisionPeak: 0.04,
    collisionDuration: 0.04,
    sustainedPairMixing: 0.08,
    postCollisionMixing: 0.07,
    secondaryVortexStructure: 0.14,
    tidalGrowth: 0.18,
    radialGrowth: 0.14,
    spatialExpansion: 0.12,
    visibleDiscPresence: 0.05,
    centerEncounter: 0.04,
  }),
  stellarGates: Object.freeze({
    minimumVisibleDiscFraction: 0.5,
    minimumCollisionPeak: 0.25,
    minimumEveryPairCollisionPeak: 0.25,
    minimumTidalGrowth: 0.2,
    maximumEveryPairClosestDistancePixels: 60,
  }),
  threeGalaxyColorGates: Object.freeze({
    minimumInitialTriadHarmony: 0.8,
    minimumInitialHueGapDegrees: 75,
  }),
});

export function qualifyGalaxySeeds({
  galaxyCount = 2,
  candidateSeedMinimum = CSSGALAXY_SEED_QUALIFICATION_METHOD.candidateSeedMinimum,
  candidateSeedMaximum = CSSGALAXY_SEED_QUALIFICATION_METHOD.candidateSeedMaximum,
  centerShortlistCount = CSSGALAXY_SEED_QUALIFICATION_METHOD.centerShortlistCount,
  sourceGenerationFrameCount = CSSGALAXY_SEED_QUALIFICATION_METHOD.sourceGenerationFrameCount,
  stellarSampleStrideFrames = CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarSampleStrideFrames,
  publishedStarCount = CSSGALAXY_SEED_QUALIFICATION_METHOD.publishedStarCount,
  minimumClosestFrameIndex = null,
  maximumClosestFrameIndex = null,
  minimumInitialCenterInsetPixels = 0,
  minimumInitialCenterSeparationPixels = 0,
  maximumSimultaneousCenterSpanPixels = null,
  minimumSustainedPairMixing = 0,
  minimumSecondaryVortexStructure = 0,
  minimumTidalGrowth = CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarGates.minimumTidalGrowth,
  minimumRadialGrowth = 0,
  minimumSpatialExpansion = 0,
  minimumVisibleDiscPresence =
    CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarGates.minimumVisibleDiscFraction,
  requiredLeadSeed = null,
  requiredSeeds = null,
  selectedSeedCount = 3,
} = {}) {
  if (!Number.isSafeInteger(candidateSeedMinimum) || candidateSeedMinimum < 1 ||
      !Number.isSafeInteger(candidateSeedMaximum) || candidateSeedMaximum < candidateSeedMinimum ||
      !Number.isSafeInteger(centerShortlistCount) || centerShortlistCount < 1 ||
      !Number.isSafeInteger(sourceGenerationFrameCount) || sourceGenerationFrameCount < 2 ||
      !Number.isSafeInteger(stellarSampleStrideFrames) || stellarSampleStrideFrames < 1 ||
      !Number.isSafeInteger(selectedSeedCount) || selectedSeedCount < 1 ||
      selectedSeedCount > centerShortlistCount ||
      (minimumClosestFrameIndex !== null &&
        (!Number.isSafeInteger(minimumClosestFrameIndex) || minimumClosestFrameIndex < 0)) ||
      (maximumClosestFrameIndex !== null &&
        (!Number.isSafeInteger(maximumClosestFrameIndex) ||
          maximumClosestFrameIndex < minimumClosestFrameIndex)) ||
      ((minimumClosestFrameIndex === null) !== (maximumClosestFrameIndex === null)) ||
      !Number.isFinite(minimumInitialCenterInsetPixels) || minimumInitialCenterInsetPixels < 0 ||
      !Number.isFinite(minimumInitialCenterSeparationPixels) ||
        minimumInitialCenterSeparationPixels < 0 ||
      (maximumSimultaneousCenterSpanPixels !== null &&
        (!Number.isFinite(maximumSimultaneousCenterSpanPixels) ||
          maximumSimultaneousCenterSpanPixels <= 0)) ||
      !Number.isFinite(minimumSustainedPairMixing) || minimumSustainedPairMixing < 0 ||
        minimumSustainedPairMixing > 1 ||
      !Number.isFinite(minimumSecondaryVortexStructure) ||
        minimumSecondaryVortexStructure < 0 || minimumSecondaryVortexStructure > 1 ||
      !Number.isFinite(minimumTidalGrowth) || minimumTidalGrowth < 0 || minimumTidalGrowth > 1 ||
      !Number.isFinite(minimumRadialGrowth) || minimumRadialGrowth < 0 || minimumRadialGrowth > 1 ||
      !Number.isFinite(minimumSpatialExpansion) ||
        minimumSpatialExpansion < 0 || minimumSpatialExpansion > 1 ||
      !Number.isFinite(minimumVisibleDiscPresence) ||
        minimumVisibleDiscPresence < 0 || minimumVisibleDiscPresence > 1 ||
      (requiredLeadSeed !== null && (!Number.isSafeInteger(requiredLeadSeed) ||
        requiredLeadSeed < candidateSeedMinimum || requiredLeadSeed > candidateSeedMaximum)) ||
      (requiredSeeds !== null && (!Array.isArray(requiredSeeds) ||
        requiredSeeds.length !== selectedSeedCount ||
        new Set(requiredSeeds).size !== requiredSeeds.length ||
        requiredSeeds.some((seed) => !Number.isSafeInteger(seed) ||
          seed < candidateSeedMinimum || seed > candidateSeedMaximum))) ||
      (requiredLeadSeed !== null && requiredSeeds !== null &&
        !requiredSeeds.includes(requiredLeadSeed)) ||
      publishedStarCount !== 1900 || (galaxyCount !== 2 && galaxyCount !== 3)) {
    throw new RangeError("Galaxy seed qualification parameters are invalid");
  }
  const centerCandidates = [];
  for (let seed = candidateSeedMinimum; seed <= candidateSeedMaximum; seed += 1) {
    centerCandidates.push(scoreCenterEncounter(seed, sourceGenerationFrameCount, galaxyCount,
      minimumClosestFrameIndex, maximumClosestFrameIndex,
      minimumInitialCenterInsetPixels, minimumInitialCenterSeparationPixels,
      maximumSimultaneousCenterSpanPixels));
  }
  centerCandidates.sort(compareScoreThenSeed);
  const eligibleCenterCandidates = centerCandidates.filter((candidate) => candidate.qualified);
  const requiredCenterSeeds = requiredSeeds ?? (requiredLeadSeed === null ? [] : [requiredLeadSeed]);
  const requiredCenterCandidates = requiredCenterSeeds.map((seed) =>
    eligibleCenterCandidates.find((candidate) => candidate.seed === seed));
  const requiredCenterCandidate = requiredLeadSeed === null ? null :
    eligibleCenterCandidates.find((candidate) => candidate.seed === requiredLeadSeed);
  if (requiredLeadSeed !== null && !requiredCenterCandidate) {
    throw new Error("Galaxy required lead seed did not clear the center encounter gates");
  }
  if (requiredCenterCandidates.some((candidate) => candidate === undefined)) {
    throw new Error("Galaxy required curated seed did not clear the center encounter gates");
  }
  const requiredCenterSeedSet = new Set(requiredCenterSeeds);
  const shortlist = [...requiredCenterCandidates, ...eligibleCenterCandidates
    .filter((candidate) => !requiredCenterSeedSet.has(candidate.seed))]
    .slice(0, Math.min(centerShortlistCount, eligibleCenterCandidates.length));
  const finalists = shortlist.map((candidate) => scoreStellarEncounter(
    candidate, sourceGenerationFrameCount, stellarSampleStrideFrames, publishedStarCount, galaxyCount,
    minimumSustainedPairMixing, minimumSecondaryVortexStructure, minimumTidalGrowth,
    minimumRadialGrowth, minimumSpatialExpansion, minimumVisibleDiscPresence));
  finalists.sort(compareScoreThenSeed);
  const qualifiedFinalists = finalists.filter((candidate) => candidate.qualified);
  const requiredCandidate = requiredLeadSeed === null ? null :
    qualifiedFinalists.find((candidate) => candidate.seed === requiredLeadSeed);
  if (requiredLeadSeed !== null && !requiredCandidate) {
    throw new Error("Galaxy required lead seed did not qualify under the encounter gates");
  }
  const requiredQualifiedCandidates = requiredSeeds === null ? null : requiredSeeds.map((seed) =>
    qualifiedFinalists.find((candidate) => candidate.seed === seed));
  if (requiredQualifiedCandidates?.some((candidate) => candidate === undefined)) {
    throw new Error("Galaxy required curated seed did not qualify under the encounter gates");
  }
  const selectedSeeds = requiredSeeds !== null
    ? [...requiredSeeds]
    : requiredCandidate === null
    ? qualifiedFinalists.slice(0, selectedSeedCount).map((candidate) => candidate.seed)
    : [requiredCandidate.seed, ...qualifiedFinalists
      .filter((candidate) => candidate.seed !== requiredCandidate.seed)
      .slice(0, selectedSeedCount - 1).map((candidate) => candidate.seed)];
  if (selectedSeeds.length !== selectedSeedCount) {
    throw new Error("Galaxy seed qualification produced too few qualified encounters");
  }
  return Object.freeze({
    schema: "cssgalaxy-seed-qualification@2",
    method: Object.freeze({
      ...CSSGALAXY_SEED_QUALIFICATION_METHOD,
      galaxyCount,
      candidateSeedMinimum,
      candidateSeedMaximum,
      centerShortlistCount: shortlist.length,
      sourceGenerationFrameCount,
      stellarSampleStrideFrames,
      publishedStarCount,
      minimumClosestFrameIndex,
      maximumClosestFrameIndex,
      minimumInitialCenterInsetPixels,
      minimumInitialCenterSeparationPixels,
      maximumSimultaneousCenterSpanPixels,
      minimumSustainedPairMixing,
      minimumSecondaryVortexStructure,
      minimumTidalGrowth,
      minimumRadialGrowth,
      minimumSpatialExpansion,
      minimumVisibleDiscPresence,
      requiredLeadSeed,
      requiredSeeds: requiredSeeds === null ? null : Object.freeze([...requiredSeeds]),
      selectedSeedCount,
    }),
    centerScreenedCount: centerCandidates.length,
    colorAndVisibilityEligibleCenterCount: eligibleCenterCandidates.length,
    centerShortlist: Object.freeze(shortlist),
    finalists: Object.freeze(finalists),
    selectedSeeds: Object.freeze(selectedSeeds),
  });
}

function scoreCenterEncounter(seed, frameCount, galaxyCount,
  minimumClosestFrameIndex, maximumClosestFrameIndex,
  minimumInitialCenterInsetPixels, minimumInitialCenterSeparationPixels,
  maximumSimultaneousCenterSpanPixels) {
  const universe = createGalaxySourceUniverse({ seed, galaxyCount });
  const galaxyFacts = universe.galaxies.map((galaxy) => ({
    mass: galaxy.mass,
    nstars: galaxy.nstars,
    color: galaxy.color,
  }));
  const initialPhysicalDistancePixels = physicalCenterDistance(universe) * universe.scale;
  const pairIndices = galaxyPairIndices(galaxyCount);
  const initialPairPhysicalDistancePixels = pairIndices.map(([left, right]) =>
    pointDistance(universe.galaxies[left].pos, universe.galaxies[right].pos) * universe.scale);
  const minimumPairPhysicalDistancePixels = pairIndices.map(() => Infinity);
  const colorReadability = analyzePreparedStreamColors(seed,
    CSSGALAXY_SEED_QUALIFICATION_METHOD.preparedStreamGenerationCount, galaxyCount);
  for (const galaxy of universe.galaxies) galaxy.stars.length = 0;
  let minimumPhysicalDistancePixels = Infinity;
  let minimumProjectedDistancePixels = Infinity;
  let maximumProjectedDistancePixels = 0;
  let closestFrameIndex = 0;
  let minimumSimultaneousCenterSpanPixels = Infinity;
  let simultaneousCenterConvergenceFrameIndex = 0;
  let minimumSimultaneousProjectedCenterSpanPixels = Infinity;
  let bothCentersOnScreenFrames = 0;
  let initialProjectedCenters = null;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    advanceGalaxySource(universe);
    const physical = physicalCenterDistance(universe) * universe.scale;
    let simultaneousCenterSpanPixels = 0;
    pairIndices.forEach(([left, right], pairIndex) => {
      const pairDistance =
        pointDistance(universe.galaxies[left].pos, universe.galaxies[right].pos) * universe.scale;
      minimumPairPhysicalDistancePixels[pairIndex] = Math.min(
        minimumPairPhysicalDistancePixels[pairIndex], pairDistance);
      simultaneousCenterSpanPixels = Math.max(simultaneousCenterSpanPixels, pairDistance);
    });
    if (simultaneousCenterSpanPixels < minimumSimultaneousCenterSpanPixels) {
      minimumSimultaneousCenterSpanPixels = simultaneousCenterSpanPixels;
      simultaneousCenterConvergenceFrameIndex = frameIndex;
    }
    const centers = universe.galaxies.map((galaxy) => projectGalaxyCenter(universe, galaxy));
    initialProjectedCenters ??= centers.map(([x, y]) => [x, y]);
    const projected = minimumPairDistance(centers);
    minimumSimultaneousProjectedCenterSpanPixels = Math.min(
      minimumSimultaneousProjectedCenterSpanPixels, maximumPairDistance(centers));
    if (physical < minimumPhysicalDistancePixels) {
      minimumPhysicalDistancePixels = physical;
      closestFrameIndex = frameIndex;
    }
    minimumProjectedDistancePixels = Math.min(minimumProjectedDistancePixels, projected);
    maximumProjectedDistancePixels = Math.max(maximumProjectedDistancePixels,
      maximumPairDistance(centers));
    const onScreenCount = centers.filter(([x, y]) =>
      x >= 0 && x < universe.width && y >= 0 && y < universe.height).length;
    bothCentersOnScreenFrames += galaxyCount === 2
      ? Number(onScreenCount === galaxyCount)
      : onScreenCount / galaxyCount;
    commitGalaxySourceFrame(universe);
  }
  const initialCenterInsetPixels = Math.min(...initialProjectedCenters.flatMap(([x, y]) =>
    [x, universe.width - x, y, universe.height - y]));
  const initialMinimumProjectedSeparationPixels = minimumPairDistance(initialProjectedCenters);
  const encounterTimingFrameIndex = galaxyCount === 3
    ? simultaneousCenterConvergenceFrameIndex
    : closestFrameIndex;
  const metrics = Object.freeze({
    initialPhysicalDistancePixels: rounded(initialPhysicalDistancePixels),
    minimumPhysicalDistancePixels: rounded(minimumPhysicalDistancePixels),
    minimumProjectedDistancePixels: rounded(minimumProjectedDistancePixels),
    maximumProjectedDistancePixels: rounded(maximumProjectedDistancePixels),
    closestFrameIndex,
    simultaneousCenterConvergenceFrameIndex,
    minimumSimultaneousCenterSpanPixels: rounded(minimumSimultaneousCenterSpanPixels),
    minimumSimultaneousProjectedCenterSpanPixels:
      rounded(minimumSimultaneousProjectedCenterSpanPixels),
    initialPairPhysicalDistancePixels: Object.freeze(initialPairPhysicalDistancePixels.map(rounded)),
    initialProjectedCenters: Object.freeze(initialProjectedCenters.map(
      ([x, y]) => Object.freeze([rounded(x), rounded(y)]))),
    initialCenterInsetPixels: rounded(initialCenterInsetPixels),
    initialMinimumProjectedSeparationPixels: rounded(initialMinimumProjectedSeparationPixels),
    minimumPairPhysicalDistancePixels: Object.freeze(minimumPairPhysicalDistancePixels.map(rounded)),
    maximumPairClosestDistancePixels: rounded(Math.max(...minimumPairPhysicalDistancePixels)),
    simultaneousCenterConvergence:
      rounded(1 - clamp01(minimumSimultaneousCenterSpanPixels / 120)),
    allPairProximity: rounded(1 - clamp01(Math.max(...minimumPairPhysicalDistancePixels) / 120)),
    physicalProximity: rounded(1 - clamp01(minimumPhysicalDistancePixels / 180)),
    projectedProximity: rounded(1 - clamp01(minimumProjectedDistancePixels / 180)),
    approachDepth: rounded(clamp01((initialPhysicalDistancePixels - minimumPhysicalDistancePixels) / 180)),
    encounterTiming: rounded(1 - clamp01(Math.abs(encounterTimingFrameIndex -
      (minimumClosestFrameIndex === null
        ? 500
        : (minimumClosestFrameIndex + maximumClosestFrameIndex) / 2)) / 500)),
    projectedSwing: rounded(clamp01((maximumProjectedDistancePixels - minimumProjectedDistancePixels) / 300)),
    screenPresence: rounded(bothCentersOnScreenFrames / frameCount),
    landingInset: rounded(clamp01(initialCenterInsetPixels / Math.max(
      1, minimumInitialCenterInsetPixels * 1.5))),
    landingSeparation: rounded(clamp01(initialMinimumProjectedSeparationPixels / Math.max(
      1, minimumInitialCenterSeparationPixels * 1.5))),
    colorContrast: colorReadability.minimumInterGalaxyColorDistance,
    colorLegibility: rounded(clamp01((colorReadability.minimumBlackContrastRatio - 1) / 9)),
    nativeInitialTriadHarmony: colorReadability.initialTriadHarmony,
    nativeInitialHueGapDegrees: colorReadability.initialMinimumHueGapDegrees,
    massBalance: rounded(Math.min(...galaxyFacts.map((galaxy) => galaxy.mass)) /
      Math.max(...galaxyFacts.map((galaxy) => galaxy.mass))),
  });
  const directSourceColorGates = galaxyCount === 2 ? {
    distinctGalaxyColorsAcrossPreparedStream: colorReadability.minimumInterGalaxyColorDistance >= 0.35,
    readableAgainstBlackAcrossPreparedStream: colorReadability.minimumBlackContrastRatio >= 4.5,
  } : {};
  const gates = Object.freeze({
    ...directSourceColorGates,
    everyPairMakesMaterialClosePassage: galaxyCount !== 3 ||
      metrics.maximumPairClosestDistancePixels <=
        CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarGates.maximumEveryPairClosestDistancePixels,
    bothDiscsUsuallyVisible: metrics.screenPresence >= (galaxyCount === 2 ? 0.55 : 0.45),
    landingCentersInsideSafeFrame:
      metrics.initialCenterInsetPixels >= minimumInitialCenterInsetPixels,
    landingDiscsStartSeparated:
      metrics.initialMinimumProjectedSeparationPixels >= minimumInitialCenterSeparationPixels,
    ...(galaxyCount !== 3 || maximumSimultaneousCenterSpanPixels === null ? {} : {
      allThreeGalaxiesCrashTogether:
        metrics.minimumSimultaneousCenterSpanPixels <= maximumSimultaneousCenterSpanPixels,
    }),
    ...(minimumClosestFrameIndex === null ? {} : {
      collisionOccursInBalancedWindow:
        encounterTimingFrameIndex >= minimumClosestFrameIndex &&
        encounterTimingFrameIndex <= maximumClosestFrameIndex,
    }),
  });
  return Object.freeze({
    seed,
    score: weightedScore(metrics, galaxyCount === 2
      ? TWO_GALAXY_CENTER_SCORE_WEIGHTS
      : CSSGALAXY_SEED_QUALIFICATION_METHOD.centerScoreWeights),
    qualified: Object.values(gates).every(Boolean),
    gates,
    galaxies: Object.freeze(galaxyFacts),
    preparedStreamColors: colorReadability,
    metrics,
  });
}

function scoreStellarEncounter(centerCandidate, frameCount, sampleStride, publishedStarCount, galaxyCount,
  minimumSustainedPairMixing, minimumSecondaryVortexStructure, minimumTidalGrowth,
  minimumRadialGrowth, minimumSpatialExpansion, minimumVisibleDiscPresence) {
  const universe = createGalaxySourceUniverse({ seed: centerCandidate.seed, galaxyCount });
  const prefixCounts = distributeGalaxyPrefixCounts(publishedStarCount, universe.galaxies.length);
  let sampleCount = 0;
  let visibleFractionSum = 0;
  let collisionDurationSamples = 0;
  let sustainedPairMixingSamples = 0;
  let postCollisionSampleCount = 0;
  let postCollisionMixingTotal = 0;
  let postCollisionVortexTotal = 0;
  let secondaryVortexPeak = 0;
  let collisionPeak = 0;
  const pairCollisionPeaks = galaxyPairIndices(galaxyCount).map(() => 0);
  let initialTidalFraction = null;
  let maximumTidalFraction = 0;
  let initialRadialMean = null;
  let maximumRadialMean = 0;
  let initialOccupiedCellCount = null;
  let maximumOccupiedCellCount = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    advanceGalaxySource(universe);
    if (frameIndex % sampleStride === 0) {
      const sample = analyzeStellarSample(universe, prefixCounts);
      sampleCount += 1;
      visibleFractionSum += sample.visibleFraction;
      collisionPeak = Math.max(collisionPeak, sample.collisionRatio);
      sample.pairCollisionRatios.forEach((ratio, pairIndex) => {
        pairCollisionPeaks[pairIndex] = Math.max(pairCollisionPeaks[pairIndex], ratio);
      });
      if (sample.collisionRatio >= 0.08) collisionDurationSamples += 1;
      if (sample.minimumPairCollisionRatio >= 0.08) sustainedPairMixingSamples += 1;
      secondaryVortexPeak = Math.max(secondaryVortexPeak, sample.secondaryVortexStructure);
      if (frameIndex >= centerCandidate.metrics.closestFrameIndex) {
        postCollisionSampleCount += 1;
        postCollisionMixingTotal += sample.meanPairCollisionRatio;
        postCollisionVortexTotal += sample.secondaryVortexStructure;
      }
      initialTidalFraction ??= sample.tidalFraction;
      maximumTidalFraction = Math.max(maximumTidalFraction, sample.tidalFraction);
      initialRadialMean ??= sample.radialMeanPixels;
      maximumRadialMean = Math.max(maximumRadialMean, sample.radialMeanPixels);
      initialOccupiedCellCount ??= sample.occupiedCellCount;
      maximumOccupiedCellCount = Math.max(maximumOccupiedCellCount, sample.occupiedCellCount);
    }
    commitGalaxySourceFrame(universe);
  }
  const metrics = Object.freeze({
    collisionPeak: rounded(collisionPeak),
    pairCollisionPeaks: Object.freeze(pairCollisionPeaks.map(rounded)),
    minimumPairCollisionPeak: rounded(Math.min(...pairCollisionPeaks)),
    collisionDuration: rounded(collisionDurationSamples / sampleCount),
    sustainedPairMixing: rounded(sustainedPairMixingSamples / sampleCount),
    postCollisionMixing: rounded(postCollisionMixingTotal / Math.max(1, postCollisionSampleCount)),
    secondaryVortexStructure: rounded(secondaryVortexPeak * 0.4 +
      postCollisionVortexTotal / Math.max(1, postCollisionSampleCount) * 0.6),
    tidalGrowth: rounded(clamp01(maximumTidalFraction - initialTidalFraction)),
    radialGrowth: rounded(clamp01(Math.log1p(Math.max(0, maximumRadialMean - initialRadialMean)) /
      Math.log1p(5000))),
    spatialExpansion: rounded(clamp01(1 - initialOccupiedCellCount /
      Math.max(1, maximumOccupiedCellCount))),
    visibleDiscPresence: rounded(visibleFractionSum / sampleCount),
    centerEncounter: centerCandidate.score,
    raw: Object.freeze({
      sampleCount,
      initialTidalFraction: rounded(initialTidalFraction),
      maximumTidalFraction: rounded(maximumTidalFraction),
      initialRadialMeanPixels: rounded(initialRadialMean),
      maximumRadialMeanPixels: rounded(maximumRadialMean),
      initialOccupiedCellCount,
      maximumOccupiedCellCount,
      postCollisionSampleCount,
      secondaryVortexPeak: rounded(secondaryVortexPeak),
      postCollisionVortexMean: rounded(
        postCollisionVortexTotal / Math.max(1, postCollisionSampleCount)),
    }),
  });
  const gates = Object.freeze({
    ...centerCandidate.gates,
    sustainedVisibleDiscs: metrics.visibleDiscPresence >= minimumVisibleDiscPresence,
    materialCollisionStructure: metrics.collisionPeak >=
      CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarGates.minimumCollisionPeak,
    everyPairMakesMaterialCollision: galaxyCount !== 3 || metrics.minimumPairCollisionPeak >=
      CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarGates.minimumEveryPairCollisionPeak,
    materialTidalDispersal: metrics.tidalGrowth >= minimumTidalGrowth,
    materialRadialDispersal: metrics.radialGrowth >= minimumRadialGrowth,
    materialSpatialExpansion: metrics.spatialExpansion >= minimumSpatialExpansion,
    sustainedMultiPairMixing: metrics.sustainedPairMixing >=
      minimumSustainedPairMixing,
    materialSecondaryVortexStructure: metrics.secondaryVortexStructure >=
      minimumSecondaryVortexStructure,
  });
  return Object.freeze({
    seed: centerCandidate.seed,
    score: weightedScore(metrics, galaxyCount === 2
      ? TWO_GALAXY_STELLAR_SCORE_WEIGHTS
      : CSSGALAXY_SEED_QUALIFICATION_METHOD.stellarScoreWeights),
    qualified: Object.values(gates).every(Boolean),
    gates,
    centerScore: centerCandidate.score,
    galaxies: centerCandidate.galaxies,
    preparedStreamColors: centerCandidate.preparedStreamColors,
    centerMetrics: centerCandidate.metrics,
    metrics,
  });
}

function analyzeStellarSample(universe, prefixCounts) {
  const centers = universe.galaxies.map((galaxy) => projectGalaxyCenter(universe, galaxy));
  const cells = universe.galaxies.map(() => new Set());
  const occupied = new Set();
  const secondaryVortexCaptureCounts = new Uint16Array(
    universe.galaxies.length * universe.galaxies.length);
  const secondaryVortexRotationSigns = new Int16Array(
    universe.galaxies.length * universe.galaxies.length);
  const secondaryVortexRadiusSquared =
    CSSGALAXY_SEED_QUALIFICATION_METHOD.secondaryVortexRadiusPixels ** 2;
  let visible = 0;
  let tidal = 0;
  let radialTotal = 0;
  for (let galaxyIndex = 0; galaxyIndex < universe.galaxies.length; galaxyIndex += 1) {
    const galaxy = universe.galaxies[galaxyIndex];
    const center = centers[galaxyIndex];
    for (let starIndex = 0; starIndex < prefixCounts[galaxyIndex]; starIndex += 1) {
      const star = galaxy.stars[starIndex];
      const radial = Math.hypot(star.x - center[0], star.y - center[1]);
      radialTotal += radial;
      if (radial > CSSGALAXY_SEED_QUALIFICATION_METHOD.tidalRadiusPixels) tidal += 1;
      if (star.x < 0 || star.x >= universe.width || star.y < 0 || star.y >= universe.height) continue;
      visible += 1;
      const cell = `${star.x >> 3},${star.y >> 3}`;
      cells[galaxyIndex].add(cell);
      occupied.add(cell);
      if (universe.step <= 1) continue;
      for (let targetIndex = 0; targetIndex < centers.length; targetIndex += 1) {
        if (targetIndex === galaxyIndex) continue;
        const dx = star.x - centers[targetIndex][0];
        const dy = star.y - centers[targetIndex][1];
        if (dx * dx + dy * dy > secondaryVortexRadiusSquared) continue;
        const cross = dx * (star.y - star.oldY) - dy * (star.x - star.oldX);
        if (Math.abs(cross) < 1) continue;
        const pairIndex = galaxyIndex * centers.length + targetIndex;
        secondaryVortexCaptureCounts[pairIndex] += 1;
        secondaryVortexRotationSigns[pairIndex] += Math.sign(cross);
      }
    }
  }
  let collisionCellCount = 0;
  let collisionDenominator = 1;
  const pairCollisionRatios = [];
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      let pairCollisionCellCount = 0;
      for (const cell of cells[leftIndex]) if (cells[rightIndex].has(cell)) pairCollisionCellCount += 1;
      const pairDenominator = Math.max(1, Math.min(cells[leftIndex].size, cells[rightIndex].size));
      pairCollisionRatios.push(pairCollisionCellCount / pairDenominator);
      if (pairCollisionCellCount / pairDenominator > collisionCellCount / collisionDenominator) {
        collisionCellCount = pairCollisionCellCount;
        collisionDenominator = pairDenominator;
      }
    }
  }
  const publishedStarCount = prefixCounts.reduce((sum, count) => sum + count, 0);
  let secondaryVortexStructure = 0;
  for (let sourceIndex = 0; sourceIndex < centers.length; sourceIndex += 1) {
    for (let targetIndex = 0; targetIndex < centers.length; targetIndex += 1) {
      if (sourceIndex === targetIndex) continue;
      const pairIndex = sourceIndex * centers.length + targetIndex;
      const captureCount = secondaryVortexCaptureCounts[pairIndex];
      if (captureCount === 0) continue;
      const captureFraction = captureCount / prefixCounts[sourceIndex];
      const rotationCoherence = Math.abs(secondaryVortexRotationSigns[pairIndex]) / captureCount;
      secondaryVortexStructure = Math.max(secondaryVortexStructure,
        clamp01(captureFraction /
          CSSGALAXY_SEED_QUALIFICATION_METHOD.secondaryVortexCaptureFraction) *
        rotationCoherence);
    }
  }
  const minimumPairCollisionRatio = Math.min(...pairCollisionRatios);
  return Object.freeze({
    visibleFraction: visible / publishedStarCount,
    collisionRatio: collisionCellCount / collisionDenominator,
    pairCollisionRatios: Object.freeze(pairCollisionRatios),
    minimumPairCollisionRatio,
    meanPairCollisionRatio:
      pairCollisionRatios.reduce((sum, ratio) => sum + ratio, 0) / pairCollisionRatios.length,
    secondaryVortexStructure,
    tidalFraction: tidal / publishedStarCount,
    radialMeanPixels: radialTotal / publishedStarCount,
    occupiedCellCount: occupied.size,
  });
}

function physicalCenterDistance(universe) {
  return minimumPairDistance(universe.galaxies.map((galaxy) => galaxy.pos));
}

function galaxyPairIndices(galaxyCount) {
  const pairs = [];
  for (let left = 0; left < galaxyCount; left += 1) {
    for (let right = left + 1; right < galaxyCount; right += 1) pairs.push([left, right]);
  }
  return pairs;
}

function pointDistance(left, right) {
  return Math.hypot(...left.map((coordinate, axis) => right[axis] - coordinate));
}

function colorContrast(left, right) {
  const a = [1, 3, 5].map((offset) => Number.parseInt(left.slice(offset, offset + 2), 16));
  const b = [1, 3, 5].map((offset) => Number.parseInt(right.slice(offset, offset + 2), 16));
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / Math.sqrt(3 * 255 * 255);
}

function analyzePreparedStreamColors(seed, generationCount, galaxyCount) {
  const universe = createGalaxySourceUniverse({ seed, galaxyCount });
  const generations = [];
  let recordedGeneration = -1;
  for (;;) {
    if (universe.generation !== recordedGeneration) {
      const colors = universe.galaxies.map((galaxy) => galaxy.color);
      const hueHarmony = analyzeHueHarmony(colors);
      generations.push(Object.freeze({
        generation: universe.generation,
        colors: Object.freeze(colors),
        interGalaxyColorDistance: rounded(minimumPairColorDistance(colors)),
        blackContrastRatios: Object.freeze(colors.map((color) => rounded(blackContrastRatio(color)))),
        ...hueHarmony,
      }));
      recordedGeneration = universe.generation;
      if (generations.length === generationCount) break;
    }
    for (const galaxy of universe.galaxies) galaxy.stars.length = 0;
    advanceGalaxySource(universe);
    commitGalaxySourceFrame(universe);
  }
  return Object.freeze({
    generationCount,
    minimumInterGalaxyColorDistance: Math.min(...generations.map((entry) => entry.interGalaxyColorDistance)),
    minimumBlackContrastRatio: Math.min(...generations.flatMap((entry) => entry.blackContrastRatios)),
    initialTriadHarmony: generations[0].triadHarmony,
    initialMinimumHueGapDegrees: generations[0].minimumHueGapDegrees,
    generations: Object.freeze(generations),
  });
}

function analyzeHueHarmony(colors) {
  const hues = colors.map(readHexHue).sort((left, right) => left - right);
  const hueGapsDegrees = hues.map((hue, index) => {
    const next = hues[(index + 1) % hues.length];
    return index + 1 < hues.length ? next - hue : 360 - hue + next;
  });
  const idealGap = 360 / hues.length;
  const triadHarmony = colors.length === 3
    ? 1 - hueGapsDegrees.reduce((sum, gap) => sum + Math.abs(gap - idealGap), 0) / 480
    : null;
  return Object.freeze({
    huesDegrees: Object.freeze(hues.map(rounded)),
    hueGapsDegrees: Object.freeze(hueGapsDegrees.map(rounded)),
    minimumHueGapDegrees: rounded(Math.min(...hueGapsDegrees)),
    triadHarmony: triadHarmony === null ? null : rounded(triadHarmony),
  });
}

function minimumPairColorDistance(colors) {
  let minimum = Infinity;
  for (let leftIndex = 0; leftIndex < colors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < colors.length; rightIndex += 1) {
      minimum = Math.min(minimum, colorContrast(colors[leftIndex], colors[rightIndex]));
    }
  }
  return minimum;
}

function minimumPairDistance(points) {
  let minimum = Infinity;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      minimum = Math.min(minimum, Math.hypot(...points[leftIndex].map(
        (coordinate, axis) => points[rightIndex][axis] - coordinate)));
    }
  }
  return minimum;
}

function maximumPairDistance(points) {
  let maximum = 0;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      maximum = Math.max(maximum, Math.hypot(...points[leftIndex].map(
        (coordinate, axis) => points[rightIndex][axis] - coordinate)));
    }
  }
  return maximum;
}

function blackContrastRatio(color) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return (luminance + 0.05) / 0.05;
}

function weightedScore(metrics, weights) {
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) score += metrics[name] * weight;
  return rounded(score);
}

function compareScoreThenSeed(left, right) {
  return right.score - left.score || left.seed - right.seed;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function rounded(value) {
  return Number(value.toFixed(6));
}
