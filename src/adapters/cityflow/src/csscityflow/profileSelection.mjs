// SPDX-License-Identifier: HPND

const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export const CSSCITYFLOW_MOBILE_BREAKPOINT_WIDTH = 600;
export const CSSCITYFLOW_MOBILE_CAPABILITY_QUERY = "(hover: none) and (pointer: coarse)";
export const CSSCITYFLOW_PREPARED_BANKS = Object.freeze({
  desktop: Object.freeze({ id: "desktop", modelId: "cityflow" }),
  mobile: Object.freeze({ id: "mobile", modelId: "cityflow-mobile" }),
});

export function selectCityflowPreparedBank({
  width = globalThis.innerWidth,
  height = globalThis.innerHeight,
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Prepared Cityflow viewport drifted");
  }
  return userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
    mediaMatches(CSSCITYFLOW_MOBILE_CAPABILITY_QUERY) ||
    width < CSSCITYFLOW_MOBILE_BREAKPOINT_WIDTH
    ? "mobile"
    : "desktop";
}
