export function installCssgearsDebugApi(state) {
  const api = {
    get ready() { return state.ready; },
    get bankLoading() { return state.bankLoading; },
    get manifest() { return state.manifest; },
    get scene() { return state.sceneData; },
    get route() { return state.route; },
    errors() { return [...state.errors]; },
    stats() { return state.mount?.stats?.() ?? null; },
    tick() { return state.mount?.player?.tick ?? null; },
    pause() { return state.mount?.player?.pause?.() ?? null; },
    resume() { return state.mount?.player?.resume?.() ?? null; },
    step(count = 1) { return state.mount?.player?.step?.(count) ?? null; },
    setTick(tick) { return state.mount?.player?.setTick?.(tick) ?? null; },
    nodes() { return state.mount?.player?.nodes?.() ?? null; },
    assertStableDomIdentity() {
      state.mount?.assertStableDomIdentity?.();
      state.mount?.player?.assertStableDomIdentity?.();
      return true;
    },
    meshes() {
      const scene = state.sceneData;
      return scene?.meshDescriptors?.map((mesh) => ({ id: mesh.id, polygons: mesh.polygonCount })) ?? [];
    },
  };
  globalThis.__cssGearsDebug = api;
  return api;
}
