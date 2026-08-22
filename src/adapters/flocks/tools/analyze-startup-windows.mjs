#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceEndpointSamples,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { flocksVisualFeature } from "../src/prepare/cssflocks/terminalSeam.mjs";

const candidates = [];
for (const frame of buildFlocksSourceEndpointSamples({ bank: CSSFLOCKS_SOURCE_BANK })) {
  if (frame.index % CSSFLOCKS_SOURCE_BANK.framesPerSecond !== 0) continue;
  const profiles = Object.fromEntries(Object.values(CSSFLOCKS_PRODUCT_PROFILES).map((profile) => [
    profile.id,
    measure(frame.bugs.slice(0, profile.bugCount), profile.id === "desktop" ? [1280, 800] : [390, 844], profile.leaderCount),
  ]));
  const objective = score(profiles.desktop) + score(profiles.mobile);
  candidates.push({
    id: `source-${String(frame.index / 60).padStart(3, "0")}s`,
    blockIndex: frame.index / 60,
    sourceFrameIndex: frame.index,
    objective,
    profiles,
  });
}
candidates.sort((left, right) => right.objective - left.objective);
console.log(JSON.stringify({
  schema: "cssflocks-startup-window-analysis@1",
  candidateCount: candidates.length,
  top: candidates.slice(0, 24),
}, null, 2));

function measure(bugs, viewport, leaderCount) {
  const visible = [];
  const cells = new Set();
  const hueBins = new Uint16Array(12);
  const sizes = [];
  const stretches = [];
  let nearEdgeCount = 0;
  for (const bug of bugs) {
    const feature = flocksVisualFeature(bug, viewport);
    const depth = 568 - bug.position[2];
    if (feature.visible) {
      visible.push(feature);
      const column = Math.min(11, Math.max(0, Math.floor(feature.x / viewport[0] * 12)));
      const row = Math.min(7, Math.max(0, Math.floor(feature.y / viewport[1] * 8)));
      cells.add(row * 12 + column);
      if (feature.x < 24 || feature.x > viewport[0] - 24 || feature.y < 24 || feature.y > viewport[1] - 24) nearEdgeCount += 1;
      sizes.push(depth > 0 ? 5 * viewport[1] / (2 * Math.tan(CSSFLOCKS_SOURCE.fieldOfViewDegrees * Math.PI / 360)) / depth : Infinity);
    }
    hueBins[Math.min(11, Math.floor((((bug.hue % 1) + 1) % 1) * 12))] += 1;
    stretches.push(Math.max(Math.hypot(...bug.velocity) * 0.04, 1));
  }
  const leaderFeatures = bugs.slice(0, leaderCount).map((bug) => flocksVisualFeature(bug, viewport));
  const leaderDistances = [];
  for (let left = 0; left < leaderFeatures.length; left += 1) {
    for (let right = left + 1; right < leaderFeatures.length; right += 1) {
      if (leaderFeatures[left].visible && leaderFeatures[right].visible) {
        leaderDistances.push(Math.hypot(
          leaderFeatures[left].x - leaderFeatures[right].x,
          leaderFeatures[left].y - leaderFeatures[right].y,
        ));
      }
    }
  }
  sizes.sort((left, right) => left - right);
  stretches.sort((left, right) => left - right);
  const x = visible.map((feature) => feature.x);
  const y = visible.map((feature) => feature.y);
  return {
    visibleBugFraction: visible.length / bugs.length,
    clippedBugFraction: 1 - visible.length / bugs.length,
    nearEdgeVisibleFraction: nearEdgeCount / Math.max(1, visible.length),
    occupiedCellFraction: cells.size / 96,
    horizontalSpanFraction: visible.length ? (Math.max(...x) - Math.min(...x)) / viewport[0] : 0,
    verticalSpanFraction: visible.length ? (Math.max(...y) - Math.min(...y)) / viewport[1] : 0,
    minimumVisibleLeaderSeparationPixels: leaderDistances.length ? Math.min(...leaderDistances) : 0,
    projectedSizeMedianPixels: percentile(sizes, 0.5),
    projectedSizeP95Pixels: percentile(sizes, 0.95),
    stretchP95: percentile(stretches, 0.95),
    stretchMaximum: stretches.at(-1) ?? 0,
    occupiedHueBins: [...hueBins].filter((count) => count > 0).length,
    hueEntropyBits: entropy(hueBins),
  };
}

function score(metrics) {
  const visibleBalance = 1 - Math.min(1, Math.abs(metrics.visibleBugFraction - 0.72) / 0.72);
  const sizePenalty = Math.max(0, metrics.projectedSizeP95Pixels - 48) / 48;
  return metrics.occupiedCellFraction * 4 +
    Math.min(1, metrics.horizontalSpanFraction) +
    Math.min(1, metrics.verticalSpanFraction) +
    visibleBalance * 2 +
    Math.min(1, metrics.minimumVisibleLeaderSeparationPixels / 120) +
    metrics.hueEntropyBits / Math.log2(12) -
    metrics.nearEdgeVisibleFraction -
    sizePenalty;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

function entropy(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return counts.reduce((sum, count) => {
    if (count === 0) return sum;
    const probability = count / total;
    return sum - probability * Math.log2(probability);
  }, 0);
}
