export const CSSFLOWER_SEAM_BLEED = 0.2;
export const CSSFLOWER_SEAM_BLEED_TEXT = String(CSSFLOWER_SEAM_BLEED);
export const CSSFLOWER_BOUNDARY_SEAM_BLEED = 0.125;
export const CSSFLOWER_BOUNDARY_SEAM_BLEED_TEXT = String(CSSFLOWER_BOUNDARY_SEAM_BLEED);
export const CSSFLOWER_SEAM_BLEED_POLICY = "side-local-shared-edges-boundary-ring-0.125";
export const CSSFLOWER_LIGHTING_SCHEMA = "cssflower-prepared-space-texel-lighting@6";
export const CSSFLOWER_LIGHTING_LAYOUT = "guttered-leaf-raster-shelves-by-horizontal-page-grid-and-timeline-state-slices";
export const CSSFLOWER_LIGHTING_RASTER_MODE = "leaf-resolution";
export const CSSFLOWER_LIGHTING_SAMPLING = "endpoint-aligned-pixel-centers";
export const CSSFLOWER_LIGHTING_ALPHA_COVERAGE =
  "mario-rounded-triangle-4x4-supersampled-nearest-shared-edge-conjoined-through-sf-3f800001-side-boundary-half-plane-clipped-all-shared-vertex-half-texel-inset-one-texel-guarded-max-pool";
export const CSSFLOWER_BOUNDARY_CLIP_MAXIMUM_SF = 1.0000001192092896;
export const CSSFLOWER_BOUNDARY_CLIP_MAXIMUM_SF_HEX = "3f800001";
export const CSSFLOWER_LIGHTING_PAGE_ROWS = 32;
export const CSSFLOWER_LIGHTING_PAGE_COUNT = 12;
export const CSSFLOWER_LIGHTING_MICRO_CONTENT_SIZE = 2;
export const CSSFLOWER_LIGHTING_GUTTER = 1;
export const CSSFLOWER_LIGHTING_MICRO_SLOT_SIZE = CSSFLOWER_LIGHTING_MICRO_CONTENT_SIZE + CSSFLOWER_LIGHTING_GUTTER * 2;
export const CSSFLOWER_LIGHTING_ATLAS_WIDTH = 768;
export const CSSFLOWER_LIGHTING_MICRO_TILES_PER_SHELF = Math.floor(
  CSSFLOWER_LIGHTING_ATLAS_WIDTH / CSSFLOWER_LIGHTING_MICRO_SLOT_SIZE,
);
export const CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT = 226;
export const CSSFLOWER_LIGHTING_ATLAS_HEIGHT = 7_232;
export const CSSFLOWER_LIGHTING_GRID_COLUMNS = CSSFLOWER_LIGHTING_PAGE_COUNT;
export const CSSFLOWER_LIGHTING_GRID_ROWS = 1;
export const CSSFLOWER_LIGHTING_GRID_WIDTH = CSSFLOWER_LIGHTING_ATLAS_WIDTH * CSSFLOWER_LIGHTING_GRID_COLUMNS;
export const CSSFLOWER_LIGHTING_GRID_HEIGHT = CSSFLOWER_LIGHTING_ATLAS_HEIGHT;
export const CSSFLOWER_LIGHTING_GRID_DECODED_BYTES = CSSFLOWER_LIGHTING_GRID_WIDTH * CSSFLOWER_LIGHTING_GRID_HEIGHT * 4;
export const CSSFLOWER_LIGHTING_ATLAS_ENCODING = "avif-flat-12x1-lossy-q83-alpha-lossless-speed4-yuv444";
export const CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE = "image/avif";
export const CSSFLOWER_LIGHTING_ATLAS_EXTENSION = "avif";
export const CSSFLOWER_LIGHTING_ATLAS_QUALITY = 83;
export const CSSFLOWER_LIGHTING_VISUAL_BANK_MAX_BYTES = 125_000_000;
export const CSSFLOWER_TRANSFORM_BLOCK_SCHEMA = "cssflower-prepared-matrix3d-blocks@1";
export const CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES = 16;
export const CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA = "cssflower-prepared-front-face-transform-schedule@2";
export const CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING = "base64-u16le-sparse-state-ranges";
export const CSSFLOWER_VISIBILITY_POLICY = Object.freeze({
  schema: "cssflower-prepared-depth16-owned-pixel-visibility-policy@1",
  selectionDomain: "prepared-source-camera-depth16-owned-pixel-occlusion",
  depthComparison: "source-depth16-less",
  minimumOwnedPixels: 8,
  sampleGrid: 1,
  adjacency: "edge",
  adjacencyRings: 0,
  temporalDilationTicks: 1,
  dilationPolicy: "cyclic-union-of-previous-current-next-prepared-state",
});
export const CSSFLOWER_FRONT_FACE_DILATION_TICKS = CSSFLOWER_VISIBILITY_POLICY.temporalDilationTicks;
export const CSSFLOWER_PROJECTED_ATLAS_ENCODING = "avif-lossy-q60-speed6-yuv444";
export const CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE = "image/avif";
export const CSSFLOWER_PROJECTED_ATLAS_EXTENSION = "avif";
export const CSSFLOWER_PROJECTED_ATLAS_QUALITY = 60;
export const CSSFLOWER_PROJECTED_VISUAL_BANK_MAX_BYTES = 45_000_000;
export const CSSFLOWER_PROJECTED_VISUAL_ACCEPTANCE = Object.freeze({
  schema: "cssflower-q60-exact-reference-visual-envelope@1",
  selection: "user-rejected-visible-q40-compression-promote-q60-from-calibrated-q90-to-q20-sweep",
  reference: "lossless-webp-retained-dom-browser-sequence",
  meanAbsDelta: 0.35,
  rmsDelta: 2.5,
  changedPixelRatio: 0.38,
  maxAbsDelta: 225,
  alphaMaxAbsDelta: 0,
  interiorMeanAbsDelta: 1.75,
  interiorRmsDelta: 2.5,
  exactBackgroundMaxAbsDelta: 0,
});
