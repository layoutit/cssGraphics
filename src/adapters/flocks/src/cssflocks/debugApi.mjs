import { CSSFLOCKS_DEBUG_API_NAME } from "./types.mjs";

export function installFlocksDebugApi(state) {
  Object.defineProperty(window, CSSFLOCKS_DEBUG_API_NAME, {
    configurable: true,
    value: Object.freeze({
      get ready() { return state.ready; },
      get errors() { return Object.freeze([...state.errors]); },
      get manifest() { return state.manifest; },
      get scene() { return state.scene; },
      get route() { return state.route; },
      get startupWindow() { return state.startupWindow; },
      get paletteSelection() { return state.paletteSelection; },
      pause() { return state.player?.pause(); },
      resume() { return state.player?.resume(); },
      seekFrame(index) { return state.player?.seekFrame(index); },
      seekStreamFrame(index) { return state.player?.seekStreamFrame(index); },
      stepFrame() { return state.player?.stepFrame(); },
      stats() {
        if (!state.player || !state.blockLoader || !state.mounted) return null;
        return Object.freeze({
          profileId: state.profile.id,
          sourceDefaultBugCount: state.profile.presentation.sourceDefaultBugCount,
          productBugCount: state.profile.presentation.productBugCount,
          retainedBugRootCount: state.mounted.shapeElements.size,
          retainedPolygonLeafCount: state.mounted.leafHandles.size,
          ...state.blockLoader.stats(),
          ...state.player.stats(),
        });
      },
    }),
  });
}
