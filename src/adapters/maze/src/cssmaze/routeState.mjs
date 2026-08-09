export function createRouteState(url = globalThis.location?.href ?? "http://localhost/") {
  const parsed = new URL(url, "http://localhost/");
  const requestedScene = parsed.searchParams.get("scene");
  return Object.freeze({
    requestedScene: validSceneId(requestedScene) ? requestedScene : null,
    scene: validSceneId(requestedScene) ? requestedScene : null,
    explicitScene: validSceneId(requestedScene),
    selection: validSceneId(requestedScene)
      ? "explicit-prepared-scene"
      : "startup-random-common-loop-low-consecutive-turn-prepared-scene",
  });
}

export function validSceneId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/u.test(value);
}
