import { loadPreparedSolitaire } from "./manifestClient.mjs";
import { mountPreparedSolitaireSnapshot } from "./polycssScene.mjs";
import { createCsssolitairePreparedPlayer } from "./preparedPlayback.mjs";

export function mountCsssolitaireClient(host) {
  const state = {
    ready: false,
    manifest: null,
    bank: null,
    mount: null,
    player: null,
    resizeObserver: null,
    errors: [],
  };
  let disposed = false;
  let shouldPlay = true;
  const onError = (event) => recordError(event.message || String(event.error || "error"));
  const onUnhandledRejection = (event) =>
    recordError(String(event.reason?.message || event.reason || "unhandled rejection"));
  const controller = Object.freeze({
    pause() {
      shouldPlay = false;
      state.player?.pause();
    },
    resume() {
      shouldPlay = true;
      state.player?.resume();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      shouldPlay = false;
      state.resizeObserver?.disconnect();
      window.removeEventListener("resize", syncPresentation);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      state.player?.destroy();
      state.mount?.destroy();
    },
  });
  installDebugApi(state, controller);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  main().catch((error) => recordError(error.stack || error.message || String(error)));
  return controller;

  async function main() {
    setBodyState("loading");
    const width = host.clientWidth || innerWidth;
    const height = host.clientHeight || innerHeight;
    const prepared = await loadPreparedSolitaire({ width, height });
    if (disposed) return;
    state.manifest = prepared.manifest;
    state.bank = prepared.bank;
    state.mount = mountPreparedSolitaireSnapshot({
      host,
      retainedLeafCount: prepared.playback.retainedLeafCount,
      snapshotHtml: prepared.snapshotHtml,
    });
    state.player = createCsssolitairePreparedPlayer({
      playback: prepared.playback,
      host,
      renderer: prepared.manifest.renderer,
      scene: state.mount.scene,
      leaves: state.mount.leaves,
      width,
      height,
    });
    state.ready = true;
    setBodyState("ready");
    if (shouldPlay) state.player.resume();
    state.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(syncPresentation)
      : null;
    state.resizeObserver?.observe(host);
    window.addEventListener("resize", syncPresentation);
  }

  function syncPresentation() {
    if (!state.ready) return;
    state.player.resize(host.clientWidth || innerWidth, host.clientHeight || innerHeight);
  }

  function recordError(message) {
    if (disposed) return;
    state.errors.push(message);
    setBodyState("error");
    if (!(host instanceof HTMLElement) || host.querySelector(":scope > .csssolitaire-error-message")) return;
    const output = document.createElement("p");
    output.className = "csssolitaire-error-message";
    output.setAttribute("role", "alert");
    output.textContent = message;
    host.append(output);
  }

  function setBodyState(kind) {
    document.body.classList.remove("loading", "ready", "error");
    document.body.classList.add(kind);
  }
}

function installDebugApi(state, controller) {
  window.__cssSolitaireDebug = Object.freeze({
    get ready() { return state.ready; },
    get manifest() { return state.manifest; },
    pause() { return state.player?.pause() ?? null; },
    resume() { return state.player?.resume() ?? null; },
    destroy() { controller.destroy(); },
    seek(timeMs) { return state.player?.seek(timeMs) ?? null; },
    snapshot() { return state.player?.snapshot() ?? null; },
    stats() {
      return state.player && state.mount
        ? Object.freeze({
          ...state.mount.stats(),
          ...state.player.stats(),
          selectedPreparedBank: state.bank.id,
          preparedBankLoadCount: 1,
          runtimePreparedBankSwitchCount: 0,
        })
        : null;
    },
    assertStableDomIdentity() {
      return Boolean(state.mount?.assertStableDomIdentity() && state.player?.assertStableDomIdentity());
    },
    errors() { return Object.freeze([...state.errors]); },
  });
}
