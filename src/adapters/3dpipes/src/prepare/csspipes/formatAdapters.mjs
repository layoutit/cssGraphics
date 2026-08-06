// OpenGL material constants are linear-light values. CSS hex colors are sRGB,
// so a direct value * 255 conversion makes the retained scene visibly dark.
const linearToSrgb = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;
const byte = (value) => Math.max(0, Math.min(255, Math.round(linearToSrgb(value) * 255)));
const hex = (value) => byte(value).toString(16).padStart(2, "0");

export function sourceMaterialColor(material) {
  if (!Array.isArray(material) || material.length !== 4 || !material.every(Number.isFinite)) {
    throw new TypeError("Source material must be a finite RGBA tuple");
  }
  return `#${hex(material[0])}${hex(material[1])}${hex(material[2])}`;
}
