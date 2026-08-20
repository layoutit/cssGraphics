export function resolveFlocksRoute({ search = globalThis.location?.search ?? "", manifest } = {}) {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.some((key) => key !== "window") || params.getAll("window").length > 1) {
    throw new RangeError("Flocks route accepts only one startup window selector");
  }
  if (manifest?.status !== "ready" || typeof manifest.defaultScene !== "string" ||
      !manifest.scenes?.some((scene) => scene.id === manifest.defaultScene)) {
    throw new Error("Flocks manifest default scene binding drifted");
  }
  const startupWindowId = params.get("window");
  return Object.freeze({
    sceneId: manifest.defaultScene,
    startupWindowId,
    mode: startupWindowId === null ? "manifest-default" : "explicit-startup-window",
  });
}
