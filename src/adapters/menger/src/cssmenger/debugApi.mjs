export function installCssmengerDebugApi(state) {
  const api = Object.freeze({
    get ready() { return state.ready; },
    get manifest() { return state.manifest; },
    get scene() { return state.sceneData; },
    get route() { return state.route; },
    errors() { return [...state.errors]; },
    stats() { return state.mount?.stats?.() ?? null; },
    state() {
      return Object.freeze({
        ready: state.ready,
        scene: state.route?.selectedScene ?? null,
        tick: state.mount?.player?.tick ?? null,
        paused: state.mount?.player?.paused ?? true,
      });
    },
    pause() { return state.mount?.player?.pause?.() ?? null; },
    resume() { return state.mount?.player?.resume?.() ?? null; },
    step(count = 1) { return state.mount?.player?.step?.(count) ?? null; },
    profileStep() { return state.mount?.player?.profileStep?.() ?? null; },
    seek(tick) { return state.mount?.player?.setTick?.(tick) ?? null; },
    assertStableDomIdentity() { return state.mount?.assertStableDomIdentity?.() ?? false; },
  });
  globalThis.__cssMengerDebug = api;
  return api;
}
