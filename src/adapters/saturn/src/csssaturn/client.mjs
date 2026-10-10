import {
  CSSSATURN_GLOBE_FACE_COUNT,
  CSSSATURN_SCENE_HTML,
} from "./sceneMarkup.mjs";

export function mountSaturn(host) {
  if (!(host instanceof HTMLElement)) throw new TypeError("Saturn host must be an element");

  host.innerHTML = CSSSATURN_SCENE_HTML;
  const root = host.querySelector(".csssaturn-stage");
  const zoom = root?.querySelector(".zoom");
  if (!(root instanceof HTMLElement) || !(zoom instanceof HTMLElement) ||
      root.querySelectorAll(".globe > s").length !== CSSSATURN_GLOBE_FACE_COUNT) {
    throw new Error("Saturn retained scene failed to mount");
  }

  // The scroll surface opens on its marker, where the zoom leaves the scene as its styles draw it.
  zoom.scrollTop = zoom.firstElementChild.offsetTop;

  let destroyed = false;
  let paused = false;
  let ready = false;

  const pause = () => {
    if (destroyed || paused) return;
    paused = true;
    root.classList.add("is-paused");
  };

  const resume = () => {
    if (destroyed || !paused) return;
    paused = false;
    root.classList.remove("is-paused");
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    host.replaceChildren();
    if (globalThis.__cssSaturnDebug === debug) delete globalThis.__cssSaturnDebug;
  };

  const stats = () => Object.freeze({
    ready,
    paused,
    retainedGlobeFaceCount: root.querySelectorAll(".globe > s").length,
    retainedMoonCount: root.querySelectorAll(".orbit").length,
    retainedElementCount: root.querySelectorAll("*").length,
    runtimeDomGrowth: false,
    runtimeFrameConstruction: false,
  });

  const debug = Object.freeze({
    get ready() { return ready; },
    pause,
    resume,
    stats,
  });
  Object.defineProperty(globalThis, "__cssSaturnDebug", { configurable: true, value: debug });

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (destroyed) return;
    ready = true;
    document.body.classList.remove("loading", "priming", "error");
    document.body.classList.add("ready");
  }));

  return Object.freeze({ pause, resume, destroy });
}
