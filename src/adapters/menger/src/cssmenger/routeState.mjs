export const DEFAULT_SCENE_ID = "depth-3";
export const MOBILE_SCENE_ID = "depth-2";

export function createRouteState() {
  return {
    scene: DEFAULT_SCENE_ID,
    manifestUrl: "/cssmenger/manifest.json",
  };
}

export function canonicalizeCssmengerRoute({
  location = globalThis.location,
  history = globalThis.history,
} = {}) {
  if (!location?.search || typeof history?.replaceState !== "function") return false;
  history.replaceState(history.state, "", `${location.pathname}${location.hash ?? ""}`);
  return true;
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
