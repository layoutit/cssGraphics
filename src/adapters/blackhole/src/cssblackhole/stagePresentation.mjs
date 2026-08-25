// SPDX-License-Identifier: MIT

const PRESENTATION_SCALE_PROPERTY = "--cssblackhole-presentation-scale";
const PRESENTATION_OFFSET_X_PROPERTY = "--cssblackhole-presentation-offset-x";
const PRESENTATION_OFFSET_Y_PROPERTY = "--cssblackhole-presentation-offset-y";
export const CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS = 90;
export const CSSBLACKHOLE_PRESENTATION_VERTICAL_VIEWPORT_PADDING_PIXELS = 22;

export function calculateBlackHolePresentationFrame({
  hostWidth,
  hostHeight,
  sourceViewport,
  sourceBounds,
  paddingPixels = CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS,
  verticalViewportPaddingPixels =
    CSSBLACKHOLE_PRESENTATION_VERTICAL_VIEWPORT_PADDING_PIXELS,
}) {
  const width = positiveDimension(hostWidth, "Luminet presentation host width");
  const height = positiveDimension(hostHeight, "Luminet presentation host height");
  const sourceWidth = positiveDimension(sourceViewport?.width, "Luminet source viewport width");
  const sourceHeight = positiveDimension(sourceViewport?.height, "Luminet source viewport height");
  const bounds = validSourceBounds(sourceBounds, sourceWidth, sourceHeight);
  if (!Number.isFinite(paddingPixels) || paddingPixels < 0) {
    throw new RangeError("Luminet presentation padding must be a non-negative finite number");
  }
  if (!Number.isFinite(verticalViewportPaddingPixels) || verticalViewportPaddingPixels < 0) {
    throw new RangeError(
      "Luminet vertical viewport padding must be a non-negative finite number");
  }
  const paddedBounds = Object.freeze({
    minimumX: Math.max(0, bounds.minimumX - paddingPixels),
    maximumX: Math.min(sourceWidth, bounds.maximumX + paddingPixels),
    minimumY: Math.max(0, bounds.minimumY - paddingPixels),
    maximumY: Math.min(sourceHeight, bounds.maximumY + paddingPixels),
  });
  const paddedWidth = paddedBounds.maximumX - paddedBounds.minimumX;
  const paddedHeight = paddedBounds.maximumY - paddedBounds.minimumY;
  const availableHeight = Math.max(1, height - verticalViewportPaddingPixels * 2);
  return Object.freeze({
    scale: Math.min(width / paddedWidth, availableHeight / paddedHeight),
    centerX: (paddedBounds.minimumX + paddedBounds.maximumX) / 2,
    centerY: (paddedBounds.minimumY + paddedBounds.maximumY) / 2,
    paddedBounds,
    paddedWidth,
    paddedHeight,
  });
}

export function installBlackHoleStagePresentation({
  host,
  camera,
  sourceViewport,
  sourceBounds,
  paddingPixels = CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS,
  verticalViewportPaddingPixels =
    CSSBLACKHOLE_PRESENTATION_VERTICAL_VIEWPORT_PADDING_PIXELS,
  ResizeObserverImpl = globalThis.ResizeObserver,
  windowImpl = host?.ownerDocument?.defaultView ?? globalThis.window,
}) {
  if (!(host instanceof HTMLElement) || !(camera instanceof HTMLElement)) {
    throw new TypeError("Luminet stage presentation requires its retained camera");
  }
  let scale = 1;
  let updateCount = 0;
  let styleWriteCount = 0;
  let frame = null;

  function refresh() {
    if (!(host.clientWidth > 0) || !(host.clientHeight > 0)) return scale;
    const nextFrame = calculateBlackHolePresentationFrame({
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      sourceViewport,
      sourceBounds,
      paddingPixels,
      verticalViewportPaddingPixels,
    });
    for (const [property, value] of [
      [PRESENTATION_SCALE_PROPERTY, String(Number(nextFrame.scale.toFixed(8)))],
      [PRESENTATION_OFFSET_X_PROPERTY, `${Number((-nextFrame.centerX).toFixed(4))}px`],
      [PRESENTATION_OFFSET_Y_PROPERTY, `${Number((-nextFrame.centerY).toFixed(4))}px`],
    ]) {
      if (camera.style.getPropertyValue(property) !== value) {
        camera.style.setProperty(property, value);
        styleWriteCount += 1;
      }
    }
    frame = nextFrame;
    scale = Number(camera.style.getPropertyValue(PRESENTATION_SCALE_PROPERTY));
    updateCount += 1;
    return scale;
  }

  refresh();
  const observer = typeof ResizeObserverImpl === "function"
    ? new ResizeObserverImpl(refresh)
    : null;
  observer?.observe(host);
  if (!observer) windowImpl?.addEventListener?.("resize", refresh, { passive: true });

  return Object.freeze({
    refresh,
    stats: () => Object.freeze({
      sourceViewport: Object.freeze({
        width: sourceViewport.width,
        height: sourceViewport.height,
      }),
      sourceBounds: Object.freeze({ ...sourceBounds }),
      presentationBounds: frame?.paddedBounds ?? null,
      presentationPaddingPixels: paddingPixels,
      presentationVerticalViewportPaddingPixels: verticalViewportPaddingPixels,
      presentationCenter: frame ? Object.freeze({ x: frame.centerX, y: frame.centerY }) : null,
      presentationFit: "prepared-content-bounds-contain",
      presentationScale: scale,
      presentationUpdateCount: updateCount,
      runtimePresentationStyleWriteCount: styleWriteCount,
    }),
    destroy() {
      observer?.disconnect();
      if (!observer) windowImpl?.removeEventListener?.("resize", refresh);
      camera.style.removeProperty(PRESENTATION_SCALE_PROPERTY);
      camera.style.removeProperty(PRESENTATION_OFFSET_X_PROPERTY);
      camera.style.removeProperty(PRESENTATION_OFFSET_Y_PROPERTY);
    },
  });
}

function validSourceBounds(bounds, sourceWidth, sourceHeight) {
  const values = [
    bounds?.minimumX,
    bounds?.maximumX,
    bounds?.minimumY,
    bounds?.maximumY,
  ];
  if (values.some((value) => !Number.isFinite(value)) ||
      bounds.minimumX < 0 || bounds.maximumX > sourceWidth ||
      bounds.minimumY < 0 || bounds.maximumY > sourceHeight ||
      bounds.minimumX >= bounds.maximumX || bounds.minimumY >= bounds.maximumY) {
    throw new RangeError("Luminet presentation bounds must fit its source viewport");
  }
  return bounds;
}

function positiveDimension(value, label) {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return value;
}
