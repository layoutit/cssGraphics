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
    verticalOffset = profile === "mobile" ? height * -0.06 : 0;
    scale = preparedProfile.scaleMode === "cover"
      ? Math.max(width / sourceWidth, (height + 2 * Math.abs(verticalOffset)) / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
    const serialized = String(Number(scale.toFixed(8)));
    if (host.style.getPropertyValue("--cssgears-presentation-scale") !== serialized) {
      host.style.setProperty("--cssgears-presentation-scale", serialized);
      scaleWrites += 1;
    }
    const rotation = `${rotationDegrees}deg`;
    const offset = `${Number(verticalOffset.toFixed(4))}px`;
    if (host.style.getPropertyValue("--cssgears-presentation-rotation") !== rotation ||
        host.style.getPropertyValue("--cssgears-presentation-y") !== offset) {
      host.style.setProperty("--cssgears-presentation-rotation", rotation);
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
      verticalOffset,
      profileWrites,
      runtimeOrientationCalculationCount: 0,
    }),
    destroy() {
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", update);
    },
  });
}
