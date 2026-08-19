const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export const CSSCYCLONE_MOBILE_BREAKPOINT_WIDTH = 600;
export const CSSCYCLONE_MOBILE_CAPABILITY_QUERY = "(hover: none) and (pointer: coarse)";
export const CSSCYCLONE_PREPARED_PROFILES = Object.freeze({
  desktop: Object.freeze({ id: "desktop", modelId: "cyclone" }),
  mobile: Object.freeze({ id: "mobile", modelId: "cyclone-mobile" }),
});

export function selectCyclonePreparedProfile({
  width = globalThis.innerWidth,
  height = globalThis.innerHeight,
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Prepared Cyclone viewport drifted");
  }
  return userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
    mediaMatches(CSSCYCLONE_MOBILE_CAPABILITY_QUERY) || width < CSSCYCLONE_MOBILE_BREAKPOINT_WIDTH
    ? "mobile"
    : "desktop";
}
