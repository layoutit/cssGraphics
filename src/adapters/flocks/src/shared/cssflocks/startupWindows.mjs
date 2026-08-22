// SPDX-License-Identifier: GPL-2.0-or-later
export const CSSFLOCKS_STARTUP_WINDOWS_BY_PROFILE = deepFreeze({
  desktop: [
    window("source-057s", 57, 0.985, 0.957, 0.824),
    window("source-071s", 71, 0.996, 0.994, 0.867),
    window("source-085s", 85, 0.986, 0.981, 0.723),
    window("source-153s", 153, 0.986, 0.966, 0.627),
  ],
  mobile: [
    window("source-121s", 121, 0.725, 0.518, 1.295),
    window("source-150s", 150, 0.425, 0.372, 1.556),
    window("source-165s", 165, 0.464, 0.305, 1.489),
    window("source-191s", 191, 0.446, 0.201, 1.588),
  ],
});

export function getFlocksStartupWindows(profileId) {
  const windows = CSSFLOCKS_STARTUP_WINDOWS_BY_PROFILE[profileId];
  if (!windows) throw new RangeError(`Unknown Flocks startup profile: ${profileId}`);
  return windows;
}

export function selectFlocksStartupWindow({
  profileId,
  requestedId = null,
  previousId = null,
  randomValue = Math.random(),
} = {}) {
  const windows = getFlocksStartupWindows(profileId);
  if (requestedId !== null) {
    const selected = windows.find((entry) => entry.id === requestedId);
    if (selected) return selected;
    const match = /^source-(\d{3})s$/u.exec(requestedId);
    const blockIndex = match ? Number(match[1]) : -1;
    if (!Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= 216) {
      throw new RangeError(`Unknown Flocks startup window: ${requestedId}`);
    }
    return deepFreeze({ id: requestedId, blockIndex, sourceFrameIndex: blockIndex * 60 });
  }
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("Flocks startup random value must be in [0, 1)");
  }
  const candidates = windows.filter((entry) => windows.length === 1 || entry.id !== previousId);
  return candidates[Math.min(candidates.length - 1, Math.floor(randomValue * candidates.length))];
}

function window(id, blockIndex, meanVisibleBugFraction, p10VisibleBugFraction, p90NormalizedRadius) {
  return {
    id,
    blockIndex,
    sourceFrameIndex: blockIndex * 60,
    centeredWindow: {
      durationSeconds: 8,
      sampleIntervalFrames: 15,
      meanVisibleBugFraction,
      p10VisibleBugFraction,
      p90NormalizedRadius,
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
