export function selectFlocksPreparedProfile({
  width,
  coarsePointer = globalThis.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ?? false,
} = {}) {
  const viewportWidth = Number(width ?? globalThis.innerWidth);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) throw new RangeError("Flocks viewport width is invalid");
  return coarsePointer || viewportWidth <= 599 ? "mobile" : "desktop";
}
