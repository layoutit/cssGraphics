export function installCssgearsStagePresentation(host, camera, sourceViewport, initialResponsivePresentation) {
  if (!(host instanceof HTMLElement) || !(camera instanceof HTMLElement)) {
    throw new Error("cssGears stage presentation requires its retained camera");
  }
  const sourceWidth = sourceViewport?.width ?? 720;
  const sourceHeight = sourceViewport?.height ?? 720;
  let scaleWrites = 0;
  let profileWrites = 0;
  let scale = 1;
  let profile = "desktop";
  let rotationDegrees = 0;
  let horizontalOffset = 0;
  let verticalOffset = 0;
  let responsivePresentation = initialResponsivePresentation;

  function update() {
    const width = host.clientWidth || sourceWidth;
    const height = host.clientHeight || sourceHeight;
    const breakpoint = responsivePresentation?.breakpointPixels ?? 600;
    const nextProfile = width < breakpoint ? "mobile" : "desktop";
    const preparedProfile = responsivePresentation?.[nextProfile];
    if (!preparedProfile || preparedProfile.id !== nextProfile ||
        ![0, 1].includes(preparedProfile.quarterTurns) ||
        preparedProfile.rotationDegrees !== preparedProfile.quarterTurns * 90) {
      throw new Error("cssGears prepared responsive presentation is invalid");
    }
    profile = nextProfile;
    rotationDegrees = preparedProfile.rotationDegrees;
    const resolved = resolvePreparedFit({
      width,
      height,
      sourceWidth,
      sourceHeight,
      profile,
      preparedProfile,
    });
    scale = resolved.scale;
    horizontalOffset = resolved.horizontalOffset;
    verticalOffset = resolved.verticalOffset;
    const serialized = String(Number(scale.toFixed(8)));
    if (host.style.getPropertyValue("--cssgears-presentation-scale") !== serialized) {
      host.style.setProperty("--cssgears-presentation-scale", serialized);
      scaleWrites += 1;
    }
    const rotation = `${rotationDegrees}deg`;
    const horizontal = `${Number(horizontalOffset.toFixed(4))}px`;
    const offset = `${Number(verticalOffset.toFixed(4))}px`;
    if (host.style.getPropertyValue("--cssgears-presentation-rotation") !== rotation ||
        host.style.getPropertyValue("--cssgears-presentation-x") !== horizontal ||
        host.style.getPropertyValue("--cssgears-presentation-y") !== offset) {
      host.style.setProperty("--cssgears-presentation-rotation", rotation);
      host.style.setProperty("--cssgears-presentation-x", horizontal);
      host.style.setProperty("--cssgears-presentation-y", offset);
      profileWrites += 1;
    }
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
  observer?.observe(host);
  globalThis.addEventListener?.("resize", update);
  update();
  return Object.freeze({
    setScene(scene) {
      responsivePresentation = scene?.showreel?.responsivePresentation;
      update();
    },
    stats: () => Object.freeze({
      stagePresentation: "product",
      sourceWidth,
      sourceHeight,
      scale,
      scaleWrites,
      profile,
      rotationDegrees,
      horizontalOffset,
      verticalOffset,
      profileWrites,
      runtimeOrientationCalculationCount: 0,
      runtimeGeometryBoundsCalculationCount: 0,
    }),
    destroy() {
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", update);
    },
  });
}

export function resolvePreparedFit({ width, height, sourceWidth, sourceHeight, profile, preparedProfile }) {
  if (profile === "desktop") {
    if (preparedProfile.scaleMode !== "contain") {
      throw new Error("cssGears prepared desktop fit mode is invalid");
    }
    return Object.freeze({
      scale: Math.min(width / sourceWidth, height / sourceHeight),
      horizontalOffset: 0,
      verticalOffset: 0,
    });
  }
  if (profile !== "mobile" || preparedProfile.scaleMode !== "prepared-bounds-contain") {
    throw new Error("cssGears prepared mobile fit mode is invalid");
  }
  const bounds = preparedProfile.preparedBounds;
  const inset = preparedProfile.safeInsetPixels;
  const verticalBias = preparedProfile.verticalBiasViewportFraction;
  if (bounds?.schema !== "cssgears-prepared-projection-bounds@1" ||
      ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.width, bounds.height, inset, verticalBias]
        .every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || inset < 0 ||
      width <= inset * 2 || height <= inset * 2) {
    throw new Error("cssGears prepared mobile projection bounds are invalid");
  }
  const scale = Math.min(
    (width - inset * 2) / bounds.width,
    (height - inset * 2) / bounds.height,
  );
  const horizontalOffset = clampOffset(
    -scale * (bounds.minX + bounds.maxX) / 2,
    inset - width / 2 - scale * bounds.minX,
    width / 2 - inset - scale * bounds.maxX,
  );
  const verticalOffset = clampOffset(
    height * verticalBias - scale * (bounds.minY + bounds.maxY) / 2,
    inset - height / 2 - scale * bounds.minY,
    height / 2 - inset - scale * bounds.maxY,
  );
  return Object.freeze({ scale, horizontalOffset, verticalOffset });
}

function clampOffset(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
