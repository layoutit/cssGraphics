import { loadPreparedSolitaire } from "./manifestClient.mjs";
import { mountPreparedSolitaireSnapshot } from "./polycssScene.mjs";
import { createCsssolitairePreparedPlayer } from "./preparedPlayback.mjs";

export function mountCsssolitaireClient() {
  const host = document.getElementById("scene");
  const state = { ready: false, manifest: null, mount: null, player: null, errors: [] };
  installDebugApi(state);
  window.addEventListener("error", (event) => recordError(event.message || String(event.error || "error")));
  window.addEventListener("unhandledrejection", (event) =>
    recordError(String(event.reason?.message || event.reason || "unhandled rejection")));
  main().catch((error) => recordError(error.stack || error.message || String(error)));

  async function main() {
    if (!(host instanceof HTMLElement)) throw new Error("Missing #scene host");
    setBodyState("loading");
    const prepared = await loadPreparedSolitaire();
    state.manifest = prepared.manifest;
    state.mount = mountPreparedSolitaireSnapshot({
      host,
      manifest: prepared.manifest,
      snapshotHtml: prepared.snapshotHtml,
    });
    state.player = createCsssolitairePreparedPlayer({
      playback: prepared.playback,
      board: state.mount.board,
      leaves: state.mount.leaves,
    });
    state.ready = true;
    setBodyState("ready");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) state.player.resume();
  }

  function recordError(message) {
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
    host?.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  }
}

function installDebugApi(state) {
  window.__cssSolitaireDebug = Object.freeze({
    get ready() { return state.ready; },
    get manifest() { return state.manifest; },
    pause() { return state.player?.pause() ?? null; },
    resume() { return state.player?.resume() ?? null; },
    seek(timeMs) { return state.player?.seek(timeMs) ?? null; },
    snapshot() { return state.player?.snapshot() ?? null; },
    stats() {
      return state.player && state.mount
        ? Object.freeze({ ...state.mount.stats(), ...state.player.stats() })
        : null;
    },
    assertStableDomIdentity() {
      return Boolean(state.mount?.assertStableDomIdentity() && state.player?.assertStableDomIdentity());
    },
    errors() { return Object.freeze([...state.errors]); },
  });
}
