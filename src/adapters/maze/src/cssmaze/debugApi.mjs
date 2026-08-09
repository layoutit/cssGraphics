export function installCssmazeDebugApi(state) {
  const debug = Object.freeze({
    get ready() { return state.ready; },
    get manifest() { return state.manifest; },
    get scene() { return state.sceneData; },
    get route() { return state.route; },
    get player() { return state.mount?.player ?? null; },
    get errors() { return Object.freeze([...state.errors]); },
    pause() { return requirePlayer(state).pause(); },
    resume() { return requirePlayer(state).resume(); },
    step(count = 1) { return requirePlayer(state).step(count); },
    seek(tick) { return requirePlayer(state).setTick(tick); },
    assertStableDomIdentity() {
      state.mount?.assertStableDomIdentity?.();
      return requirePlayer(state).assertStableDomIdentity();
    },
    state() {
      const player = requirePlayer(state);
      const frame = state.sceneData.playback.frameRows[player.tick];
      return Object.freeze({
        sceneId: state.sceneData.id,
        seed: state.sceneData.sourceProfile.seed,
        bankRank: state.route.selectedBankRank,
        rotationScore: state.sceneData.sourceProfile.rotationScore,
        tick: player.tick,
        paused: player.paused,
        cameraTransformIndex: frame[0],
        wallTransformIndex: frame[1],
        leafVisibilityIndex: frame[2],
        sourceCameraPose: Object.freeze([...state.sceneData.playback.sourceCameraPoses[player.tick]]),
        sourceStateCode: state.sceneData.playback.sourceStateCodes[player.tick],
      });
    },
    stats() { return state.mount?.stats?.() ?? null; },
  });
  globalThis.__cssMazeDebug = debug;
  return debug;
}

function requirePlayer(state) {
  if (!state.mount?.player) throw new Error("cssMaze player is not ready");
  return state.mount.player;
}
