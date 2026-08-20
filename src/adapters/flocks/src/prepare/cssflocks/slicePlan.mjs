import { CSSFLOCKS_PRODUCT_PROFILES, CSSFLOCKS_SOURCE_BANK } from "./sourceModel.mjs";

export const CSSFLOCKS_SLICE_PLAN = Object.freeze({
  id: "flocks-default",
  scaffoldMode: "particle-systems",
  artifactMode: "prepared-polycss-model-with-blocked-source-state",
  sourceDefaultBugCount: CSSFLOCKS_SOURCE_BANK.bugCount,
  profiles: CSSFLOCKS_PRODUCT_PROFILES,
  defaultProfileId: "desktop",
  mobileProfileId: "mobile",
  geometry: "six-solid-triangle-glu-sphere-topology",
  lighting: "fixed-flat-face-factors-currentColor",
  sourceModes: Object.freeze({ geometry: true, dots: false, chromatek: false, connections: false }),
});
