import { CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS } from "../../../shared/reallyslickPalette.mjs";

export function resolveFlocksRoute({ search = globalThis.location?.search ?? "", manifest } = {}) {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.some((key) => key !== "window" && key !== "palette") ||
      params.getAll("window").length > 1 || params.getAll("palette").length > 1) {
    throw new RangeError("Flocks route accepts only one startup window and palette selector");
  }
  if (manifest?.status !== "ready" || typeof manifest.defaultScene !== "string" ||
      !manifest.scenes?.some((scene) => scene.id === manifest.defaultScene)) {
    throw new Error("Flocks manifest default scene binding drifted");
  }
  const startupWindowId = params.get("window");
  const paletteVariantId = params.get("palette");
  if (paletteVariantId !== null &&
      !CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS.includes(paletteVariantId)) {
    throw new RangeError("Flocks route palette selector is invalid");
  }
  return Object.freeze({
    sceneId: manifest.defaultScene,
    startupWindowId,
    paletteVariantId,
    mode: startupWindowId === null && paletteVariantId === null
      ? "manifest-default"
      : "explicit-presentation",
  });
}
