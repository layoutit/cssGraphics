// SPDX-License-Identifier: HPND

const HALF_VERTICAL_FIELD_OF_VIEW_RADIANS = Math.PI / 12;

export function cityflowSourceProjection(width, height) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("Cityflow projection dimensions must be positive finite numbers");
  }
  const usesWideSourceViewport = width > height * 2;
  const viewportHeight = usesWideSourceViewport ? width : height;
  return Object.freeze({
    perspective: viewportHeight / (2 * Math.tan(HALF_VERTICAL_FIELD_OF_VIEW_RADIANS)),
    viewportHeight,
    viewportTop: usesWideSourceViewport ? height - viewportHeight / 2 : 0,
    usesWideSourceViewport,
  });
}

export function bindCityflowSourceProjection(host, cameraElement, onProjection = () => {}) {
  if (!(host instanceof HTMLElement) || !(cameraElement instanceof HTMLElement)) {
    throw new TypeError("Cityflow projection binding requires retained host and camera elements");
  }
  const apply = () => {
    const projection = cityflowSourceProjection(host.clientWidth, host.clientHeight);
    cameraElement.style.setProperty("--csscityflow-camera-height", `${projection.viewportHeight}px`);
    cameraElement.style.setProperty("--csscityflow-camera-top", `${projection.viewportTop}px`);
    cameraElement.style.setProperty("--csscityflow-perspective", `${projection.perspective}px`);
    onProjection(projection);
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(host);
  return () => observer.disconnect();
}
