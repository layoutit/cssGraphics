export function installCssflowerDebugApi(state) {
  const api = {
    get ready() {
      return state.ready;
    },
    get status() {
      return state.status;
    },
    get manifest() {
      return state.manifest;
    },
    get scene() {
      return state.sceneData;
    },
    get route() {
      return state.route;
    },
    errors() {
      return [...state.errors];
    },
    stats() {
      return state.mount?.stats?.() ?? null;
    },
    pause() {
      return state.mount?.player?.pause?.() ?? null;
    },
    resume() {
      return state.mount?.player?.resume?.() ?? null;
    },
    step(count = 1) {
      return state.mount?.player?.step?.(count) ?? null;
    },
    setTick(tick) {
      return state.mount?.player?.setTick?.(tick) ?? null;
    },
    sample() {
      return state.mount?.player?.sample?.() ?? null;
    },
    nodes() {
      return state.mount?.player?.nodes?.() ?? null;
    },
    assertStableDomIdentity() {
      state.mount?.assertStableDomIdentity?.();
      state.mount?.player?.assertStableDomIdentity?.();
      return true;
    },
    meshes() {
      const stats = state.mount?.stats?.();
      return stats ? [{ id: "flower-box-default-cube", polygons: stats.retainedTriangleLeafCount }] : [];
    },
  };
  globalThis.__cssFlowerDebug = api;
  return api;
}
