// SPDX-License-Identifier: GPL-2.0-only
import { loadPreparedElectropaint } from "./manifestClient.mjs";
import { mountPreparedElectropaintSnapshot } from "./polycssScene.mjs";
import { createPreparedElectropaintPlayer } from "./preparedPlayback.mjs";

const PRESENTATION_VERTICAL_OFFSET_SOURCE_PIXELS = -45;

export async function mountElectropaintClient(body = document.body) {
  const host = body.querySelector("#scene");
  if (!(host instanceof HTMLElement)) throw new Error("Missing ElectroPaint scene host");
  const debug = { status: "loading" };
  globalThis.__cssElectropaint = debug;
  try {
    const prepared = await loadPreparedElectropaint();
    const mounted = mountPreparedElectropaintSnapshot({ host, ...prepared });
    const player = await createPreparedElectropaintPlayer({
      playback: prepared.sceneData.playback,
      sceneRoot: mounted.scene,
      quads: mounted.quads,
    });
    const presentation = mountPresentationScale(host, mounted.camera);
    Object.assign(debug, {
      status: "ready",
      manifest: prepared.manifest,
      selectedVariant: prepared.selectedVariant,
      scene: prepared.sceneData,
      pause: () => player.pause(),
      resume: () => player.resume(),
      step: (count) => player.step(count),
      setState: (stateIndex) => player.setState(stateIndex),
      assertStableDomIdentity: () => mounted.assertStableDomIdentity() && player.assertStableDomIdentity(),
      stats: () => Object.freeze({
        scene: mounted.stats(),
        player: player.stats(),
        presentation: presentation.stats(),
      }),
      destroy() {
        presentation.destroy();
        player.destroy();
        mounted.destroy();
        debug.status = "destroyed";
      },
    });
    body.classList.remove("loading");
    host.setAttribute("aria-busy", "false");
    player.resume();
    return debug;
  } catch (error) {
    debug.status = "error";
    debug.error = error.stack || error.message || String(error);
    body.classList.remove("loading");
    host.setAttribute("aria-busy", "false");
    const message = document.createElement("pre");
    message.className = "cssselectropaint-error-message";
    message.textContent = debug.error;
    host.replaceChildren(message);
    throw error;
  }
}

function mountPresentationScale(host, camera) {
  let resizeCount = 0;
  function resize() {
    const scale = Math.min(host.clientWidth / 960, host.clientHeight / 540);
    const boundedScale = Math.max(0.01, scale);
    camera.style.setProperty("--cssselectropaint-presentation-scale", String(boundedScale));
    camera.style.setProperty("--cssselectropaint-inverse-presentation-scale", String(1 / boundedScale));
    camera.style.setProperty(
      "--cssselectropaint-presentation-y",
      `${PRESENTATION_VERTICAL_OFFSET_SOURCE_PIXELS * boundedScale}px`,
    );
    resizeCount += 1;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  return Object.freeze({
    stats: () => Object.freeze({
      sourceViewport: Object.freeze({ width: 960, height: 540 }),
      verticalCenterOffsetSourcePixels: PRESENTATION_VERTICAL_OFFSET_SOURCE_PIXELS,
      resizeCount,
      semanticCameraCalculationCount: 0,
    }),
    destroy: () => observer.disconnect(),
  });
}
