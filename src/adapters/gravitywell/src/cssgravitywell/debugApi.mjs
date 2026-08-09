export function installGravityWellDebugApi(state) {
  const api = Object.freeze({
    get ready() { return state.ready; },
    errors() { return [...state.errors]; },
    catalog() { return state.catalog; },
    selection() { return state.selection; },
    scene() { return state.scene; },
    state() {
      return Object.freeze({
        ready: state.ready,
        tick: state.player?.tick ?? null,
        frameIndex: state.player?.frameIndex ?? null,
        sourceFrameIndex: state.player?.sourceFrameIndex ?? null,
        activeBankIndex: state.player?.activeBankIndex ?? null,
        paused: state.player?.paused ?? true,
      });
    },
    stats() {
      return state.player ? Object.freeze({
        ...state.player.stats(),
        retainedLeafCount: state.mounted?.leafHandles.size ?? 0,
        retainedShapeRootCount: state.mounted?.shapeElements.size ?? 0,
        morph: state.mounted?.stats ?? null,
      }) : null;
    },
    pause() { return state.player?.pause() ?? null; },
    resume() { return state.player?.resume() ?? null; },
    step(count = 1) { return state.player?.step(count) ?? null; },
    seek(tick) { return state.player?.setTick(tick) ?? null; },
    seekSourceTick(tick) { return state.player?.seekSourceTick(tick) ?? null; },
    assertStableDomIdentity() { return state.player?.assertStableDomIdentity() ?? false; },
  });
  globalThis.__cssGravityWellDebug = api;
  return api;
}
