const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export const CSSFLIPFLOP_MOBILE_BREAKPOINT_WIDTH = 520;
export const CSSFLIPFLOP_MOBILE_CAPABILITY_QUERY = "(hover: none) and (pointer: coarse)";
export const CSSFLIPFLOP_MODEL_IDS = Object.freeze({
  desktop: "flipflop",
  mobile: "flipflop-mobile",
});

export function selectFlipFlopPreparedBank({
  width = globalThis.innerWidth,
  height = globalThis.innerHeight,
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Prepared Flip Flop viewport drifted");
  }
  return userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
    mediaMatches(CSSFLIPFLOP_MOBILE_CAPABILITY_QUERY) || width < CSSFLIPFLOP_MOBILE_BREAKPOINT_WIDTH
    ? "mobile"
    : "desktop";
}
