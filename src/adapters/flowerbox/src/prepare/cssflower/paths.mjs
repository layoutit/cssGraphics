import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  CSSFLOWER_LIGHTING_ATLAS_EXTENSION,
  CSSFLOWER_PROJECTED_ATLAS_EXTENSION,
} from "../../cssflower/renderContract.mjs";

export const repoRoot = resolve(fileURLToPath(new URL("../../../../../../", import.meta.url)));
export const adapterRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const localRoot = join(repoRoot, ".local", "cssflower");
export const generatedRoot = resolve(
  process.env.CSSFLOWER_GENERATED_ROOT ?? join(repoRoot, "build", "generated"),
);
export const generatedPublicRoot = join(generatedRoot, "public", "cssflower");
export const generatedSceneDir = join(generatedPublicRoot, "scenes");
export const generatedAssetDir = join(generatedPublicRoot, "assets");
export const generatedTransformAssetDir = join(generatedAssetDir, "transforms");
export const generatedLightingAssetDir = join(generatedAssetDir, "lighting");
export const generatedProjectedAssetDir = join(generatedAssetDir, "projected");
export const manifestPath = join(generatedPublicRoot, "manifest.json");
export const generatedTransformsPath = join(generatedAssetDir, "flower-box-transforms.f32");
export const generatedLightingPath = join(generatedAssetDir, "flower-box-space-texels.png");
export const generatedStateEvidencePath = join(generatedAssetDir, "flower-box-state-evidence.json");
export const localPreparedTransformsPath = join(localRoot, "prepared", "flower-box-transforms.f32");

export function generatedScenePath(sceneId) {
  return join(generatedSceneDir, sceneId + ".json");
}

export function generatedSceneUrl(sceneId) {
  return "/cssflower/scenes/" + sceneId + ".json";
}

export function generatedLightingPagePath(pageIndex) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError("cssFlower lighting page index must be a non-negative integer");
  }
  return pageIndex === 0
    ? generatedLightingPath
    : join(generatedAssetDir, `flower-box-space-texels-page-${String(pageIndex).padStart(3, "0")}.png`);
}

export function generatedTransformBlockPath(sha256) {
  assertSha256(sha256);
  return join(generatedTransformAssetDir, `block-${sha256}.matrix3d.pack`);
}

export function generatedTransformBlockUrl(sha256) {
  assertSha256(sha256);
  return `/cssflower/assets/transforms/block-${sha256}.matrix3d.pack`;
}

export function generatedPreparedLightingPath(sha256) {
  assertSha256(sha256);
  return join(generatedLightingAssetDir, `grid-${sha256}.${CSSFLOWER_LIGHTING_ATLAS_EXTENSION}`);
}

export function generatedPreparedLightingUrl(sha256) {
  assertSha256(sha256);
  return `/cssflower/assets/lighting/grid-${sha256}.${CSSFLOWER_LIGHTING_ATLAS_EXTENSION}`;
}

export function generatedProjectedAtlasPath(sha256) {
  assertSha256(sha256);
  return join(generatedProjectedAssetDir, `atlas-${sha256}.${CSSFLOWER_PROJECTED_ATLAS_EXTENSION}`);
}

export function generatedProjectedAtlasUrl(sha256) {
  assertSha256(sha256);
  return `/cssflower/assets/projected/atlas-${sha256}.${CSSFLOWER_PROJECTED_ATLAS_EXTENSION}`;
}

export function generatedProjectedLayoutPath(sha256) {
  assertSha256(sha256);
  return join(generatedProjectedAssetDir, `layout-${sha256}.i16`);
}

export function generatedProjectedLayoutUrl(sha256) {
  assertSha256(sha256);
  return `/cssflower/assets/projected/layout-${sha256}.i16`;
}

export function generatedSharedLayoutBlockPath(sha256) {
  assertSha256(sha256);
  return join(generatedProjectedAssetDir, `layout-block-${sha256}.i16pack`);
}

export function generatedSharedLayoutBlockUrl(sha256) {
  assertSha256(sha256);
  return `/cssflower/assets/projected/layout-block-${sha256}.i16pack`;
}

function assertSha256(value) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? "")) throw new TypeError("cssFlower content-addressed asset hash is invalid");
}
