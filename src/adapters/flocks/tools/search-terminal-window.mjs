#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceEndpointSamples,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import {
  buildFlocksTerminalCorrespondence,
  buildFlocksVisualSignature,
  compareFlocksVisualSignatures,
} from "../src/prepare/cssflocks/terminalSeam.mjs";

const horizonSeconds = Number.parseInt(process.env.CSSFLOCKS_SEAM_SEARCH_SECONDS ?? "480", 10);
const minimumSeconds = 216;
const maximumSeconds = 238;
if (!Number.isSafeInteger(horizonSeconds) || horizonSeconds < minimumSeconds) {
  throw new RangeError(`CSSFLOCKS_SEAM_SEARCH_SECONDS must be at least ${minimumSeconds}`);
}
const bank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  frameCount: horizonSeconds * CSSFLOCKS_SOURCE_BANK.framesPerSecond,
});
const viewport = [1280, 800];
const desktop = CSSFLOCKS_PRODUCT_PROFILES.desktop;
const samples = new Map();
for (const frame of buildFlocksSourceEndpointSamples({ bank })) {
  const bugs = frame.bugs.slice(0, desktop.bugCount);
  samples.set(frame.index, Object.freeze({
    signature: buildFlocksVisualSignature(bugs, viewport),
  }));
  if (frame.index % (300 * bank.framesPerSecond) === 0) {
    process.stderr.write(`signature pass ${Math.floor(frame.index / bank.framesPerSecond)}/${horizonSeconds}s\n`);
  }
}

const candidates = [];
for (let startFrame = 0; startFrame < bank.frameCount; startFrame += bank.framesPerSecond) {
  const initial = samples.get(startFrame);
  if (!initial) continue;
  for (let durationSeconds = minimumSeconds; durationSeconds <= maximumSeconds; durationSeconds += 1) {
    const endFrame = startFrame + durationSeconds * bank.framesPerSecond - 1;
    const final = samples.get(endFrame);
    if (!final) continue;
    insertCandidate({
      startFrame,
      endFrame,
      durationSeconds,
      signatureDifference: compareFlocksVisualSignatures(final.signature, initial.signature),
    });
  }
}

const selectedFrameIndices = new Set(candidates.flatMap(({ startFrame, endFrame }) => [startFrame, endFrame]));
const selectedFrames = new Map();
for (const frame of buildFlocksSourceEndpointSamples({ bank })) {
  if (selectedFrameIndices.has(frame.index)) selectedFrames.set(frame.index, Object.freeze(frame.bugs.slice(0, desktop.bugCount)));
  if (frame.index % (300 * bank.framesPerSecond) === 0) {
    process.stderr.write(`state pass ${Math.floor(frame.index / bank.framesPerSecond)}/${horizonSeconds}s\n`);
  }
}

const qualified = candidates.map((candidate) => {
  const initial = selectedFrames.get(candidate.startFrame);
  const final = selectedFrames.get(candidate.endFrame);
  const desktopSeam = buildFlocksTerminalCorrespondence(final, initial, viewport, desktop.leaderCount);
  const mobile = CSSFLOCKS_PRODUCT_PROFILES.mobile;
  const mobileSeam = buildFlocksTerminalCorrespondence(
    final.slice(0, mobile.bugCount),
    initial.slice(0, mobile.bugCount),
    [390, 844],
    mobile.leaderCount,
  );
  const objective = candidate.signatureDifference * 1_000 +
    desktopSeam.metrics.visibilityMismatchCount * 2 +
    desktopSeam.metrics.projectedCenterDistanceP95 +
    desktopSeam.metrics.circularHueDistanceP95 * 400;
  return { ...candidate, objective, profiles: { desktop: desktopSeam, mobile: mobileSeam } };
}).sort((left, right) => left.objective - right.objective);

const selected = qualified[0];
if (!selected) throw new Error("No Flocks terminal source-window candidate was produced");
console.log(JSON.stringify({
  schema: "cssflocks-terminal-window-search@1",
  search: {
    horizonSeconds,
    minimumSeconds,
    maximumSeconds,
    candidatePairCount: countCandidatePairs(),
    fullyQualifiedCandidateCount: qualified.length,
  },
  selected: {
    ...selected,
    warmupFrames: CSSFLOCKS_SOURCE_BANK.warmupFrames + selected.startFrame,
    frameCount: selected.durationSeconds * CSSFLOCKS_SOURCE_BANK.framesPerSecond,
  },
  alternatives: qualified.slice(1).map(({ profiles, ...candidate }) => ({
    ...candidate,
    metrics: {
      desktop: profiles.desktop.metrics,
      mobile: profiles.mobile.metrics,
    },
  })),
}, null, 2));

function insertCandidate(candidate) {
  candidates.push(candidate);
  candidates.sort((left, right) => left.signatureDifference - right.signatureDifference);
  if (candidates.length > 8) candidates.length = 8;
}

function countCandidatePairs() {
  let count = 0;
  for (let startFrame = 0; startFrame < bank.frameCount; startFrame += bank.framesPerSecond) {
    for (let durationSeconds = minimumSeconds; durationSeconds <= maximumSeconds; durationSeconds += 1) {
      if (startFrame + durationSeconds * bank.framesPerSecond <= bank.frameCount) count += 1;
    }
  }
  return count;
}
