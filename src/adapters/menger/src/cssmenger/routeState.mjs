export const DEFAULT_SCENE_ID = "depth-3";
export const MOBILE_SCENE_ID = "depth-2";
export const DEFAULT_LIGHTING_PRESENTATION = "atlas";
export const PUBLIC_ROUTE_PARAMS = ["scene", "lighting"];

export function createRouteState(search = globalThis.location?.search ?? "") {
  const params = new URLSearchParams(search);
  const scene = cleanSceneId(params.get("scene")) ?? DEFAULT_SCENE_ID;
  const lighting = params.get("lighting") === "opacity" ? "opacity" : DEFAULT_LIGHTING_PRESENTATION;
  return {
    params,
    scene,
    lighting,
    sceneExplicit: params.has("scene"),
    lightingExplicit: params.has("lighting"),
    manifestUrl: "/cssmenger/manifest.json",
    publicRoute: publicRouteFor({ scene, lighting }),
    routeContract: "?scene=<scene-id>&lighting=<atlas|opacity>",
  };
}

export function publicRouteFor({
  scene = DEFAULT_SCENE_ID,
  lighting = DEFAULT_LIGHTING_PRESENTATION,
} = {}) {
  if (scene === DEFAULT_SCENE_ID && lighting === DEFAULT_LIGHTING_PRESENTATION) return "/";
  const params = new URLSearchParams();
  if (scene !== DEFAULT_SCENE_ID) params.set("scene", scene);
  if (lighting === "opacity") params.set("lighting", lighting);
  return "/?" + params.toString();
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
