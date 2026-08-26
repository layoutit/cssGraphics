// SPDX-License-Identifier: MIT

const sourceConfigurationIds = Object.freeze([
  "luminet-inclination-85deg",
  "luminet-inclination-60deg",
  "luminet-inclination-0deg",
]);

export const CSSBLACKHOLE_PRESENTATION_PROFILES = Object.freeze({
  full: profile({
    id: "full",
    assetDirectory: "cssblackhole",
    mode: "prepared-variable-dwell-side-angled-top-angled-luminet-photon-configuration-loop",
    stateIndices: [0, 1, 2, 1],
    holdSeconds: [5, 2.5, 2, 2.5],
    combinedLoopSeconds: 180,
  }),
  "side-tilt": profile({
    id: "side-tilt",
    assetDirectory: "cssblackhole-side-tilt",
    mode: "prepared-variable-dwell-side-angled-luminet-photon-configuration-loop",
    stateIndices: [0, 1],
    holdSeconds: [6, 2.5],
    combinedLoopSeconds: 450,
  }),
});

export function blackHolePresentationProfile(id) {
  const result = CSSBLACKHOLE_PRESENTATION_PROFILES[id];
  if (!result) throw new RangeError(`Unsupported BlackHole presentation profile: ${id}`);
  return result;
}

function profile({ id, assetDirectory, mode, stateIndices, holdSeconds, combinedLoopSeconds }) {
  const transitionSeconds = 2;
  const framesPerSecond = 60;
  const durationSeconds = holdSeconds.map((hold) => hold + transitionSeconds);
  const frameCounts = durationSeconds.map((duration) => duration * framesPerSecond);
  const startFrameIndices = frameCounts.map((_, index) =>
    frameCounts.slice(0, index).reduce((sum, count) => sum + count, 0));
  const transitionStartFrameIndices = holdSeconds.map((hold) => hold * framesPerSecond);
  const sequenceFrameCount = frameCounts.reduce((sum, count) => sum + count, 0);
  const streamFrameCount = combinedLoopSeconds * framesPerSecond;
  return Object.freeze({
    id,
    assetDirectory,
    assetRoot: `/${assetDirectory}`,
    cacheSuffix: id === "full" ? "" : `-${id}`,
    mode,
    stateIndices: Object.freeze(stateIndices),
    configurationSequence: Object.freeze(stateIndices.map((index) => sourceConfigurationIds[index])),
    presentationConfigurationCount: stateIndices.length,
    holdSeconds: Object.freeze(holdSeconds),
    durationSeconds: Object.freeze(durationSeconds),
    frameCounts: Object.freeze(frameCounts),
    startFrameIndices: Object.freeze(startFrameIndices),
    transitionStartFrameIndices: Object.freeze(transitionStartFrameIndices),
    transitionSeconds,
    transitionFrameCount: transitionSeconds * framesPerSecond,
    sequenceSeconds: sequenceFrameCount / framesPerSecond,
    sequenceFrameCount,
    combinedLoopSeconds,
    streamFrameCount,
    bankCount: streamFrameCount / (framesPerSecond * 5),
    blockCount: streamFrameCount / framesPerSecond,
    naturalTimePerSlot: Object.freeze(durationSeconds.map((seconds) => seconds * 50)),
    naturalTimePerHold: Object.freeze(holdSeconds.map((seconds) => seconds * 50)),
  });
}
