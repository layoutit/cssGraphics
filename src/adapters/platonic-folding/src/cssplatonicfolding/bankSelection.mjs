export function selectPlatonicBank({ width = innerWidth, height = innerHeight } = {}) {
  return width < height ? "mobile" : "desktop";
}
