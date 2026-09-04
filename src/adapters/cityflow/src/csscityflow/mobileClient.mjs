// SPDX-License-Identifier: HPND
import { mountCityflowPreparedSnapshot } from "./preparedDom.mjs";
import { createCityflowMobilePlayer, preparedMobileBank } from "./mobilePlayback.mjs";

export function mountCityflow(host) {
  let destroyed = false;
  const state = { ready: false, errors: [], metadata: null, bankId: "mobile",
    dom: null, player: null, stylesheetElement: null };
  const controller = Object.freeze({
    pause() { return state.player?.pause(); },
    resume() { if (!destroyed) return state.player?.resume(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup();
      if (globalThis.__csscityflow === state) delete globalThis.__csscityflow;
    },
  });
  Object.defineProperty(globalThis, "__csscityflow", { configurable: true, value: state });
  main().catch((error) => {
    if (destroyed) return;
    cleanup();
    state.errors.push(String(error?.stack || error));
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    console.error(error);
  });
  return controller;

  function cleanup() {
    state.player?.destroy();
    state.dom?.destroy();
    state.stylesheetElement?.remove();
    state.ready = false;
  }

  async function main() {
    const metadata = await fetchAsset("/csscityflow/prepared.json", "json", "no-store");
    if (destroyed) return;
    const bank = preparedMobileBank(metadata);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = bank.stylesheet.assetUrl;
    state.stylesheetElement = link;
    const stylesheet = new Promise((done, reject) => {
      link.addEventListener("load", done, { once: true });
      link.addEventListener("error", () => reject(new Error("Cityflow mobile stylesheet failed")), { once: true });
    });
    document.head.append(link);
    const [snapshotHtml, playback] = await Promise.all([
      fetchAsset(bank.snapshot.assetUrl, "text"),
      fetchAsset(bank.playback.assetUrl, "json"),
      stylesheet,
    ]);
    if (destroyed) return;
    state.metadata = metadata;
    state.dom = mountCityflowPreparedSnapshot({ host, snapshotHtml, expectedBoxCount: bank.boxCount });
    state.player = createCityflowMobilePlayer({ playback, dom: state.dom });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    if (destroyed) return;
    state.ready = true;
    document.body.classList.replace("loading", "ready");
    performance.mark("csscityflow-ready");
    state.player.resume();
  }
}

async function fetchAsset(url, type, cache = "force-cache") {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`Cityflow mobile asset failed: ${response.status} ${url}`);
  return response[type]();
}
