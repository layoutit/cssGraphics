export const CSSFLOWER_SEAM_BLEED = 0.2;
export const CSSFLOWER_SEAM_BLEED_TEXT = String(CSSFLOWER_SEAM_BLEED);
export const CSSFLOWER_BOUNDARY_SEAM_BLEED = 0.05;
export const CSSFLOWER_BOUNDARY_SEAM_BLEED_TEXT = String(CSSFLOWER_BOUNDARY_SEAM_BLEED);
export const CSSFLOWER_SEAM_BLEED_POLICY = "side-local-shared-edges-boundary-ring-damped";
export const CSSFLOWER_LIGHTING_SCHEMA = "cssflower-prepared-space-texel-lighting@3";
export const CSSFLOWER_LIGHTING_LAYOUT = "guttered-leaf-raster-shelves-by-paged-timeline-state-slices";
export const CSSFLOWER_LIGHTING_PAGE_ROWS = 32;
export const CSSFLOWER_LIGHTING_PAGE_COUNT = 292;
export const CSSFLOWER_LIGHTING_ATLAS_WIDTH = 768;
export const CSSFLOWER_LIGHTING_ATLAS_HEIGHT = 7_232;
export const CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT = 226;
export const CSSFLOWER_LIGHTING_GUTTER = 1;
export const CSSFLOWER_PROJECTED_ATLAS_ENCODING = "avif-lossy-q40-speed6-yuv444";
export const CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE = "image/avif";
export const CSSFLOWER_PROJECTED_ATLAS_EXTENSION = "avif";
export const CSSFLOWER_PROJECTED_ATLAS_QUALITY = 40;
export const CSSFLOWER_PROJECTED_VISUAL_BANK_MAX_BYTES = 40_000_000;
export const CSSFLOWER_PROJECTED_VISUAL_ACCEPTANCE = Object.freeze({
  schema: "cssflower-q40-exact-reference-visual-envelope@1",
  selection: "preselected-between-clean-q40-and-first-visible-blocking-q35",
  reference: "lossless-webp-retained-dom-browser-sequence",
  meanAbsDelta: 0.55,
  rmsDelta: 3.25,
  changedPixelRatio: 0.4,
  maxAbsDelta: 250,
  alphaMaxAbsDelta: 0,
  interiorMeanAbsDelta: 2.5,
  interiorRmsDelta: 3.5,
  exactBackgroundMaxAbsDelta: 0,
});
