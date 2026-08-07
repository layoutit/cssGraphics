export const PUBLIC_ROUTE_PARAMS = ["scene"];

export function createRouteState(search = globalThis.location?.search ?? "") {
  const params = new URLSearchParams(search);
  const scene = cleanSceneId(params.get("scene"));
  return {
    params,
    scene,
    selection: scene ? "explicit-prepared-scene" : "random-prepared-shuffled-bank",
    manifestUrl: "/cssgears/manifest.json",
    publicRoute: publicRouteFor({ scene }),
    routeContract: "/ random; ?scene=<scene-id> explicit",
  };
}

export function publicRouteFor({ scene = null } = {}) {
  if (!scene) return "/";
  const params = new URLSearchParams();
  params.set("scene", scene);
  return "/?" + params.toString();
}

export function sceneEntryForRoute(manifest, routeState, randomUint32 = 0) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  if (routeState.scene) {
    return scenes.find((scene) => scene.id === routeState.scene) ?? null;
  }
  const bankIds = manifest?.preparedBank?.sceneIds;
  if (!Array.isArray(bankIds) || bankIds.length === 0) return null;
  if (!Number.isSafeInteger(randomUint32) || randomUint32 < 0 || randomUint32 > 0xffffffff) {
    throw new RangeError("cssGears prepared-bank random value must be uint32");
  }
  const selectedId = bankIds[randomUint32 % bankIds.length];
  return scenes.find((scene) => scene.id === selectedId) ?? null;
}

export function routeSceneLabel(routeState) {
  return routeState.scene ? "scene=" + routeState.scene : "the prepared random bank";
}

export function cleanSceneId(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = value.trim().toLowerCase();
  return /^[a-z0-9._-]+$/.test(clean) ? clean : null;
}
