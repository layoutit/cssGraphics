export function installCssmazeStagePresentation(host, camera, sourceViewport) {
  if (!(host instanceof HTMLElement) || !(camera instanceof HTMLElement) ||
      !(sourceViewport?.width > 0) || !(sourceViewport?.height > 0)) {
    throw new Error("cssMaze stage presentation requires its prepared viewport");
  }
  let updateCount = 0;
  function update() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const scale = Math.max(width / sourceViewport.width, height / sourceViewport.height);
    camera.style.setProperty("--cssmaze-presentation-scale", String(scale));
    updateCount += 1;
  }
  const observer = new ResizeObserver(update);
  observer.observe(host);
  update();
  return Object.freeze({
    stats: () => Object.freeze({
      presentationFit: "cover",
      presentationUpdateCount: updateCount,
    }),
    destroy() { observer.disconnect(); },
  });
}
