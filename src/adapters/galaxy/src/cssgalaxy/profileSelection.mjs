// SPDX-License-Identifier: HPND

export const CSSGALAXY_MOBILE_BREAKPOINT_WIDTH = 600;
export const CSSGALAXY_MOBILE_CAPABILITY_QUERY = "(hover: none) and (pointer: coarse)";

const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export function selectGalaxyPreparedProfile({
  innerWidth,
  userAgent,
  mobileCapabilityMatches,
}) {
  if (!Number.isFinite(innerWidth) || typeof userAgent !== "string" ||
      typeof mobileCapabilityMatches !== "boolean") {
    throw new TypeError("Galaxy profile selection requires viewport and device capabilities");
  }
  return innerWidth < CSSGALAXY_MOBILE_BREAKPOINT_WIDTH || mobileCapabilityMatches ||
    MOBILE_USER_AGENT.test(userAgent) ? "mobile" : "desktop";
}

export function selectGalaxyPreparedProfileForWindow(target = window) {
  return selectGalaxyPreparedProfile({
    innerWidth: target.innerWidth,
    userAgent: target.navigator.userAgent,
    mobileCapabilityMatches: target.matchMedia(CSSGALAXY_MOBILE_CAPABILITY_QUERY).matches,
  });
}
