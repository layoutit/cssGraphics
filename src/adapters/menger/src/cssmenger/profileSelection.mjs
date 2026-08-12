const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export function selectCssmengerPlaneAtlasProfile({
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  return userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
    mediaMatches("(hover: none) and (pointer: coarse)") || mediaMatches("(max-width: 430px)")
    ? "mobile"
    : "desktop";
}
