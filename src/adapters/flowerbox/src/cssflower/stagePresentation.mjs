export const CSSFLOWER_PREPARED_STAGE_EDGE = 720;
export const CSSFLOWER_RESPONSIVE_STAGE_FRACTION = 1;

export function cssflowerStageScale(viewportWidth, viewportHeight) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
      viewportWidth <= 0 || viewportHeight <= 0) {
    throw new RangeError("cssFlower viewport dimensions must be positive finite numbers");
  }
  return Math.min(viewportWidth, viewportHeight) / CSSFLOWER_PREPARED_STAGE_EDGE *
    CSSFLOWER_RESPONSIVE_STAGE_FRACTION;
}

export function installCssflowerStagePresentation({ host, camera }) {
  if (!(host instanceof HTMLElement)) throw new TypeError("cssFlower stage host is missing");
  if (!(camera instanceof HTMLElement) || !camera.classList.contains("polycss-camera")) {
    throw new TypeError("cssFlower prepared camera is missing");
  }
  let scale = 1;
  let writes = 0;
  let resizeObserver = null;

  function apply() {
    const rect = host.getBoundingClientRect();
    const nextScale = cssflowerStageScale(rect.width, rect.height);
    const serialized = String(Number(nextScale.toFixed(8)));
    if (camera.style.scale !== serialized) {
      camera.style.scale = serialized;
      writes += 1;
    }
    scale = Number(serialized);
  }

  apply();
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(apply);
    resizeObserver.observe(host);
  } else {
    window.addEventListener("resize", apply, { passive: true });
  }

  return Object.freeze({
    stats() {
      return Object.freeze({
        stagePresentation: "responsive",
        preparedStageEdgePixels: CSSFLOWER_PREPARED_STAGE_EDGE,
        responsivePresentationFit: "contain",
        responsivePresentationStageFraction: CSSFLOWER_RESPONSIVE_STAGE_FRACTION,
        presentationScale: scale,
        runtimePresentationScaleWrites: writes,
        runtimeModelGeometryCalculations: 0,
      });
    },
    destroy() {
      resizeObserver?.disconnect();
      if (resizeObserver === null) {
        window.removeEventListener("resize", apply);
      }
      camera.style.removeProperty("scale");
    },
  });
}
