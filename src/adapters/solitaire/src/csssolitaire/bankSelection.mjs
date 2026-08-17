const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export const SOLITAIRE_LARGE_DESKTOP_MINIMUM_WIDTH = 1_600;

export function selectSolitairePreparedBank({
  width = globalThis.innerWidth,
  height = globalThis.innerHeight,
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Prepared cssSolitaire viewport drifted");
  }
  if (userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
      mediaMatches("(hover: none) and (pointer: coarse)") || width < 520) {
    return "mobile";
  }
  return width >= SOLITAIRE_LARGE_DESKTOP_MINIMUM_WIDTH && width > height
    ? "large-desktop"
    : "small-desktop";
}
