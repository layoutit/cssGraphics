export const CSSFLOWER_PREPARED_STAGE_EDGE = 720;
export const CSSFLOWER_RESPONSIVE_PRESENTATION_INSET = 1;

export function cssflowerStageScale(viewportWidth, viewportHeight) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
      viewportWidth <= 0 || viewportHeight <= 0) {
    throw new RangeError("cssFlower viewport dimensions must be positive finite numbers");
  }
  return Math.min(viewportWidth, viewportHeight) / CSSFLOWER_PREPARED_STAGE_EDGE *
    CSSFLOWER_RESPONSIVE_PRESENTATION_INSET;
}

export function installCssflowerStagePresentation(host) {
  if (!(host instanceof HTMLElement)) throw new TypeError("cssFlower stage host is missing");
  const mode = "product";
  let scale = 1;
  let writes = 0;

  document.body.dataset.stagePresentation = mode;

  function apply() {
    const nextScale = cssflowerStageScale(host.clientWidth, host.clientHeight);
    const serialized = String(Number(nextScale.toFixed(8)));
    if (host.style.getPropertyValue("--cssflower-presentation-scale") !== serialized) {
      host.style.setProperty("--cssflower-presentation-scale", serialized);
      writes += 1;
    }
    scale = nextScale;
  }

  apply();
  window.addEventListener("resize", apply, { passive: true });

  return Object.freeze({
    get mode() { return mode; },
    stats() {
      return Object.freeze({
        stagePresentation: mode,
        preparedStageEdgePixels: CSSFLOWER_PREPARED_STAGE_EDGE,
        responsivePresentationInset: CSSFLOWER_RESPONSIVE_PRESENTATION_INSET,
        presentationScale: scale,
        runtimePresentationScaleWrites: writes,
        runtimeModelGeometryCalculations: 0,
      });
    },
    destroy() {
      window.removeEventListener("resize", apply);
    },
  });
}
