export const DEFAULT_SCENE_ID = "default-cube";
export const PUBLIC_ROUTE_PARAMS = ["scene"];

export function createRouteState(search = globalThis.location?.search ?? "") {
  const params = new URLSearchParams(search);
  const scene = cleanSceneId(params.get("scene")) ?? DEFAULT_SCENE_ID;
  return {
    params,
    scene,
    manifestUrl: "/cssflower/manifest.json",
    publicRoute: publicRouteFor({ scene }),
    routeContract: "?scene=<scene-id>",
  };
}

export function publicRouteFor({ scene = DEFAULT_SCENE_ID } = {}) {
  const base = globalThis.location?.pathname?.startsWith("/flowerbox") ? "/flowerbox/" : "/";
  if (scene === DEFAULT_SCENE_ID) return base;
  const params = new URLSearchParams();
  params.set("scene", scene);
  return base + "?" + params.toString();
}

export function sceneEntryForRoute(manifest, routeState) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  return scenes.find((scene) => scene.id === routeState.scene)
    ?? scenes.find((scene) => scene.id === manifest?.defaultScene?.id)
    ?? scenes[0]
    ?? null;
}

export function routeSceneLabel(routeState) {
  return "scene=" + routeState.scene;
}

export function cleanSceneId(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = value.trim().toLowerCase();
  return /^[a-z0-9._-]+$/.test(clean) ? clean : null;
}
