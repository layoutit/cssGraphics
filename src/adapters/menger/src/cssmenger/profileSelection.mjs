const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod|Mobile/u;

export function selectCssmengerPlaneAtlasProfile({
  search = globalThis.location?.search ?? "",
  mediaMatches = (query) => globalThis.matchMedia(query).matches,
  userAgentDataMobile = globalThis.navigator?.userAgentData?.mobile === true,
  userAgent = globalThis.navigator?.userAgent ?? "",
} = {}) {
  const override = new URLSearchParams(search).get("profile");
  if (override === "mobile" || override === "desktop") return override;
  return userAgentDataMobile || MOBILE_USER_AGENT.test(userAgent) ||
    mediaMatches("(hover: none) and (pointer: coarse)") || mediaMatches("(max-width: 430px)")
    ? "mobile"
    : "desktop";
}
