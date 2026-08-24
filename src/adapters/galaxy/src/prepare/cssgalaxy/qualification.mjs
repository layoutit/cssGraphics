// SPDX-License-Identifier: HPND
import {
  CSSGALAXY_CADENCE,
  CSSGALAXY_PREPARED_GALAXY_COUNTS,
  CSSGALAXY_VARIANT_COUNTS,
  advanceGalaxySource,
  commitGalaxySourceFrame,
  createGalaxySourceUniverse,
  distributeGalaxyPrefixCounts,
  projectGalaxyCenter,
} from "./sourceModel.mjs";

export const CSSGALAXY_COMPARISON_SEED = 101;
export const CSSGALAXY_MOBILE_COMPARISON_SEED = 4947;
export const CSSGALAXY_CURATED_SEEDS = Object.freeze([149, 101, 191]);
export const CSSGALAXY_THREE_GALAXY_PALETTE_SEED = 4946;
export const CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT = Object.freeze({
  2: CSSGALAXY_COMPARISON_SEED,
  3: 2298,
});
export const CSSGALAXY_MOBILE_CURATED_SEEDS = Object.freeze([
  4947, 4190, 3287, 1848, 3891, 7259, 3399, 3245, 7056, 1082,
]);
export const CSSGALAXY_CURATED_SEEDS_BY_GALAXY_COUNT = Object.freeze({
  2: CSSGALAXY_MOBILE_CURATED_SEEDS,
  3: Object.freeze([
    2298, 6359, 7299, 4908, 1105, 2838, 7343, 2542, 57, 374,
  ]),
});
export const CSSGALAXY_QUALIFICATION_THRESHOLDS = Object.freeze({
  densityPixelRetention: 0.7,
  normalizedDensitySimilarity: 0.8,
  collisionCellRetention: 0.68,
  tidalCellRetention: 0.68,
});

export function qualifyGalaxyParticleCounts({ seed = null, galaxyCount = 2 } = {}) {
  if (!CSSGALAXY_PREPARED_GALAXY_COUNTS.includes(galaxyCount)) {
    throw new RangeError("Galaxy particle qualification requires a prepared galaxy count");
  }
  const comparisonSeed = seed ?? CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT[galaxyCount];
  if (!Number.isSafeInteger(comparisonSeed) || comparisonSeed < 1) {
    throw new RangeError("Galaxy particle qualification requires a positive seed");
  }
  const universe = createGalaxySourceUniverse({ seed: comparisonSeed, galaxyCount });
  const referenceCount = Math.max(...CSSGALAXY_VARIANT_COUNTS);
  const sampleStride = CSSGALAXY_CADENCE.sourceFramesPerSecond;
  const sampleCount = CSSGALAXY_CADENCE.bankSeconds;
  const accumulators = new Map(CSSGALAXY_VARIANT_COUNTS.map((count) => [count, createAccumulator()]));
  const fullAccumulator = createAccumulator();

  for (let frameIndex = 0; frameIndex < CSSGALAXY_CADENCE.bankSeconds *
    CSSGALAXY_CADENCE.sourceFramesPerSecond; frameIndex += 1) {
    advanceGalaxySource(universe);
    if (frameIndex % sampleStride === 0) {
      const centers = universe.galaxies.map((galaxy) => projectGalaxyCenter(universe, galaxy));
      const reference = analyzePrefix(universe, referenceCount, centers);
      const full = analyzeFull(universe, centers);
      accumulate(fullAccumulator, compareAnalysis(reference, full));
      for (const count of CSSGALAXY_VARIANT_COUNTS) {
        const candidate = analyzePrefix(universe, count, centers);
        accumulate(accumulators.get(count), compareAnalysis(candidate, reference));
      }
    }
    commitGalaxySourceFrame(universe);
  }

  const candidates = CSSGALAXY_VARIANT_COUNTS.map((count) => {
    const metrics = finalize(accumulators.get(count), sampleCount);
    const gates = Object.freeze(Object.fromEntries(Object.entries(CSSGALAXY_QUALIFICATION_THRESHOLDS)
      .map(([name, threshold]) => [name, metrics[name] >= threshold])));
    return Object.freeze({ count, metrics, gates, passed: Object.values(gates).every(Boolean) });
  });
  const selected = candidates.find((candidate) => candidate.passed)?.count ?? null;
  return Object.freeze({
    schema: "cssgalaxy-particle-count-qualification@1",
    method: Object.freeze({
      seed: comparisonSeed,
      galaxyCount,
      viewport: Object.freeze({ width: universe.width, height: universe.height }),
      comparison: `fixed-prefix screen occupancy against the ${referenceCount}-star candidate`,
      sourceState: "all source stars integrated before prefix analysis",
      sampleFrames: sampleCount,
      sampleStrideFrames: sampleStride,
      densityGridPixels: 8,
      tidalRadiusPixels: 60,
    }),
    thresholds: CSSGALAXY_QUALIFICATION_THRESHOLDS,
    candidates: Object.freeze(candidates),
    highestCandidateAgainstFullSource: finalize(fullAccumulator, sampleCount),
    selectedParticleCount: selected,
    status: selected === null ? "no-candidate-qualified" : "qualified",
  });
}

function analyzePrefix(universe, totalCount, centers) {
  const prefixCounts = distributeGalaxyPrefixCounts(totalCount, universe.galaxies.length);
  return analyze(universe, centers, (_, galaxyIndex) => prefixCounts[galaxyIndex]);
}

function analyzeFull(universe, centers) {
  return analyze(universe, centers, (galaxy) => galaxy.stars.length);
}

function analyze(universe, centers, countForGalaxy) {
  const pixels = new Set();
  const density = new Map();
  const galaxyCells = universe.galaxies.map(() => new Set());
  const tidalCells = new Set();
  for (let galaxyIndex = 0; galaxyIndex < universe.galaxies.length; galaxyIndex += 1) {
    const galaxy = universe.galaxies[galaxyIndex];
    const count = countForGalaxy(galaxy, galaxyIndex);
    const center = centers[galaxyIndex];
    for (let starIndex = 0; starIndex < count; starIndex += 1) {
      const star = galaxy.stars[starIndex];
      if (star.x < 0 || star.x >= universe.width || star.y < 0 || star.y >= universe.height) continue;
      const pixel = `${star.x},${star.y}`;
      const cell = `${star.x >> 3},${star.y >> 3}`;
      pixels.add(pixel);
      galaxyCells[galaxyIndex].add(cell);
      density.set(cell, (density.get(cell) ?? 0) + 1);
      if (Math.hypot(star.x - center[0], star.y - center[1]) > 60) {
        tidalCells.add(`${galaxyIndex}:${cell}`);
      }
    }
  }
  const collisionCells = new Set();
  for (let leftIndex = 0; leftIndex < galaxyCells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < galaxyCells.length; rightIndex += 1) {
      for (const cell of galaxyCells[leftIndex]) {
        if (galaxyCells[rightIndex].has(cell)) collisionCells.add(`${leftIndex}:${rightIndex}:${cell}`);
      }
    }
  }
  return { pixels, density, collisionCells, tidalCells };
}

function compareAnalysis(candidate, reference) {
  return Object.freeze({
    densityPixelRetention: retention(candidate.pixels, reference.pixels),
    normalizedDensitySimilarity: histogramSimilarity(candidate.density, reference.density),
    collisionCellRetention: retention(candidate.collisionCells, reference.collisionCells),
    tidalCellRetention: retention(candidate.tidalCells, reference.tidalCells),
  });
}

function retention(candidate, reference) {
  if (reference.size === 0) return 1;
  let common = 0;
  for (const value of candidate) if (reference.has(value)) common += 1;
  return common / reference.size;
}

function histogramSimilarity(candidate, reference) {
  const candidateTotal = [...candidate.values()].reduce((sum, value) => sum + value, 0);
  const referenceTotal = [...reference.values()].reduce((sum, value) => sum + value, 0);
  if (candidateTotal === 0 || referenceTotal === 0) return Number(candidateTotal === referenceTotal);
  const keys = new Set([...candidate.keys(), ...reference.keys()]);
  let absoluteDelta = 0;
  for (const key of keys) {
    absoluteDelta += Math.abs((candidate.get(key) ?? 0) / candidateTotal -
      (reference.get(key) ?? 0) / referenceTotal);
  }
  return 1 - absoluteDelta / 2;
}

function createAccumulator() {
  return { densityPixelRetention: 0, normalizedDensitySimilarity: 0, collisionCellRetention: 0, tidalCellRetention: 0 };
}

function accumulate(accumulator, metrics) {
  for (const [name, value] of Object.entries(metrics)) accumulator[name] += value;
}

function finalize(accumulator, count) {
  return Object.freeze(Object.fromEntries(Object.entries(accumulator)
    .map(([name, value]) => [name, Number((value / count).toFixed(6))])));
}
