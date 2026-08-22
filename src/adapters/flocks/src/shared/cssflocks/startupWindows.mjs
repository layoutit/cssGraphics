// SPDX-License-Identifier: GPL-2.0-or-later
export const CSSFLOCKS_STARTUP_WINDOWS = deepFreeze([
  {
    id: "source-005s", blockIndex: 5, sourceFrameIndex: 300,
    profiles: {
      desktop: metrics(0.882716, 0.117284, 0.055944, 0.197917, 0.700926, 0.876395, 260.276, 7.968, 8.454, 7.436, 9.835, 5, 1.724),
      mobile: metrics(0.713415, 0.286585, 0.008547, 0.197917, 0.855946, 0.567339, 457.177, 8.555, 8.960, 7.075, 9.368, 5, 1.804),
    },
  },
  {
    id: "source-114s", blockIndex: 114, sourceFrameIndex: 6_840,
    profiles: {
      desktop: metrics(1, 0, 0.012346, 0.229167, 0.796193, 0.670112, 205.826, 10.130, 12.164, 8.481, 10.081, 7, 1.521),
      mobile: metrics(0.743902, 0.256098, 0.057377, 0.229167, 1.042307, 0.645892, 217.147, 10.782, 13.060, 8.377, 8.866, 6, 1.620),
    },
  },
  {
    id: "source-129s", blockIndex: 129, sourceFrameIndex: 7_740,
    profiles: {
      desktop: metrics(0.996914, 0.003086, 0.015480, 0.229167, 0.564304, 0.910388, 136.762, 12.493, 13.865, 6.407, 9.116, 6, 1.215),
      mobile: metrics(0.774390, 0.225610, 0, 0.3125, 0.642610, 0.869473, 144.284, 13.307, 14.633, 6.443, 8.314, 6, 1.292),
    },
  },
  {
    id: "source-172s", blockIndex: 172, sourceFrameIndex: 10_320,
    profiles: {
      desktop: metrics(1, 0, 0.021605, 0.260417, 0.497974, 0.893601, 283.246, 6.349, 8.501, 7.251, 8.077, 8, 2.165),
      mobile: metrics(0.573171, 0.426829, 0.021277, 0.208333, 0.782856, 0.872178, 298.824, 6.064, 8.977, 7.138, 8.077, 8, 2.129),
    },
  },
]);

export function selectFlocksStartupWindow({
  requestedId = null,
  previousId = null,
  randomValue = Math.random(),
} = {}) {
  if (requestedId !== null) {
    const selected = CSSFLOCKS_STARTUP_WINDOWS.find((window) => window.id === requestedId);
    if (!selected) throw new RangeError(`Unknown Flocks startup window: ${requestedId}`);
    return selected;
  }
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("Flocks startup random value must be in [0, 1)");
  }
  const candidates = CSSFLOCKS_STARTUP_WINDOWS.filter((window) =>
    CSSFLOCKS_STARTUP_WINDOWS.length === 1 || window.id !== previousId);
  return candidates[Math.min(candidates.length - 1, Math.floor(randomValue * candidates.length))];
}

function metrics(
  visibleBugFraction,
  clippedBugFraction,
  nearEdgeVisibleFraction,
  occupiedCellFraction,
  horizontalSpanFraction,
  verticalSpanFraction,
  minimumVisibleLeaderSeparationPixels,
  projectedSizeMedianPixels,
  projectedSizeP95Pixels,
  stretchP95,
  stretchMaximum,
  occupiedHueBins,
  hueEntropyBits,
) {
  return {
    visibleBugFraction,
    clippedBugFraction,
    nearEdgeVisibleFraction,
    occupiedCellFraction,
    horizontalSpanFraction,
    verticalSpanFraction,
    minimumVisibleLeaderSeparationPixels,
    projectedSizeMedianPixels,
    projectedSizeP95Pixels,
    stretchP95,
    stretchMaximum,
    occupiedHueBins,
    hueEntropyBits,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
