// SPDX-License-Identifier: GPL-2.0-only
import { loadPreparedElectropaint } from "./manifestClient.mjs";
import { mountPreparedElectropaintSnapshot } from "./polycssScene.mjs";
import { createPreparedElectropaintPlayer } from "./preparedPlayback.mjs";

const SOURCE_VIEWPORT = Object.freeze({ width: 960, height: 540 });
const PRESENTATION_ARTWORK_SAFE_FRAME_WIDTH = 640;
const PRESENTATION_RULE_MARKER = "--cssselectropaint-presentation-rule";

export async function mountElectropaintClient(body = document.body) {
  const host = body;
  if (!(host instanceof HTMLElement)) throw new Error("Missing ElectroPaint host");
  const debug = { status: "loading" };
  globalThis.__cssElectropaint = debug;
  const presentation = mountPresentation(host);
  try {
    const prepared = await loadPreparedElectropaint();
    const mounted = mountPreparedElectropaintSnapshot({ host, ...prepared });
    const player = await createPreparedElectropaintPlayer({
      playback: prepared.sceneData.playback,
      sceneRoot: mounted.scene,
      quads: mounted.quads,
    });
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
    player.resume();
    return debug;
  } catch (error) {
    presentation.destroy();
    debug.status = "error";
    debug.error = error.stack || error.message || String(error);
    body.classList.remove("loading");
    const message = document.createElement("pre");
    message.className = "cssselectropaint-error-message";
    message.textContent = debug.error;
    for (const mounted of host.querySelectorAll(
      ":scope > .polycss-camera, :scope > .cssselectropaint-error-message",
    )) mounted.remove();
    host.append(message);
    throw error;
  }
}

function mountPresentation(host) {
  const rule = findPresentationRule(host.ownerDocument);
  let resizeCount = 0;
  let runtimeStylesheetRuleWriteCount = 0;
  const resize = () => {
    const scale = Math.max(0.01, Math.min(
      host.clientWidth / PRESENTATION_ARTWORK_SAFE_FRAME_WIDTH,
      (host.clientHeight / 2 - 2) / 311,
    ));
    rule.style.setProperty("--cssselectropaint-presentation-scale", String(scale));
    rule.style.setProperty("--cssselectropaint-inverse-presentation-scale", String(1 / scale));
    rule.style.setProperty("--cssselectropaint-presentation-y", `${35 * scale}px`);
    resizeCount += 1;
    runtimeStylesheetRuleWriteCount += 1;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  return Object.freeze({
    stats: () => Object.freeze({
      sourceViewport: SOURCE_VIEWPORT,
      artworkSafeFrameWidth: PRESENTATION_ARTWORK_SAFE_FRAME_WIDTH,
      policy: "stylesheet-responsive-high-composition-with-top-safe-frame",
      verticalCenterOffsetSourcePixels: -35,
      resizeCount,
      runtimeStyleWriteCount: 0,
      runtimeStylesheetRuleWriteCount,
      semanticCameraCalculationCount: 0,
    }),
    destroy() {
      observer.disconnect();
      rule.style.removeProperty("--cssselectropaint-presentation-scale");
      rule.style.removeProperty("--cssselectropaint-inverse-presentation-scale");
      rule.style.removeProperty("--cssselectropaint-presentation-y");
    },
  });
}

function findPresentationRule(document) {
  for (const stylesheet of document.styleSheets) {
    for (const rule of stylesheet.cssRules) {
      if (rule.style?.getPropertyValue(PRESENTATION_RULE_MARKER).trim() === "1") return rule;
    }
  }
  throw new Error("ElectroPaint presentation stylesheet rule is missing");
}
