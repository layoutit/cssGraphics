export function loadCyclonePreparedLightingColors(lighting, paletteFamily) {
  const variant = lighting?.variants?.find((entry) => entry?.paletteFamily === paletteFamily);
  if (lighting?.schema !== "csscyclone-prepared-flat-lighting-colors@9" ||
      lighting.maximumColorFamilyCount !== 3 ||
      lighting.paletteHueSlotCount !== 3 ||
      lighting.preparedMinimumSaturation !== 0.55 ||
      lighting.preparedMinimumValue !== 0.75 ||
      !Array.isArray(lighting.paletteFamilies) ||
      !lighting.paletteFamilies.includes(paletteFamily) ||
      lighting.variants?.length !== lighting.paletteFamilies.length ||
      variant?.hueSlots?.length !== lighting.maximumColorFamilyCount ||
      !Array.isArray(variant?.colors) ||
      variant.colors.length !== lighting.uniqueColorCount ||
      variant.colors.some((color) => !/^#[a-f0-9]{6}$/u.test(color)) ||
      !Number.isSafeInteger(lighting.colorEntryCount) || lighting.colorEntryCount < 1 ||
      !Number.isSafeInteger(lighting.uniqueColorCount) || lighting.uniqueColorCount < 1 ||
      lighting.uniqueColorCount > lighting.colorEntryCount ||
      lighting.deduplicatedColorCount !== lighting.colorEntryCount - lighting.uniqueColorCount ||
      lighting.colorDeduplication !== "exact-cross-palette-css-srgb-tuples" ||
      ![2, 4].includes(lighting.colorSlotIndexBytes) ||
      lighting.colorSlotIndexCount !== lighting.colorEntryCount ||
      lighting.colorSlotIndexEncoding !==
        (lighting.colorSlotIndexBytes === 2 ? "uint16-le-base64" : "uint32-le-base64") ||
      typeof lighting.colorSlotIndicesBase64 !== "string") {
    throw new Error("Prepared Cyclone lighting color contract is invalid");
  }
  const colorSlotIndices = decodeColorSlotIndices(
    lighting.colorSlotIndicesBase64,
    lighting.colorSlotIndexBytes,
    lighting.colorSlotIndexCount,
  );
  if (colorSlotIndices.some((slotIndex) => slotIndex >= lighting.uniqueColorCount)) {
    throw new Error("Prepared Cyclone lighting color slot drifted");
  }
  return Object.freeze({
    paletteFamily,
    hueSlots: variant.hueSlots,
    colors: variant.colors,
    colorSlotIndices,
    destroy() {},
  });
}

function decodeColorSlotIndices(encoded, bytesPerIndex, count) {
  let binary;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("Prepared Cyclone lighting color slot encoding is invalid");
  }
  if (binary.length !== count * bytesPerIndex) {
    throw new Error("Prepared Cyclone lighting color slot byte length drifted");
  }
  const indices = bytesPerIndex === 2 ? new Uint16Array(count) : new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * bytesPerIndex;
    indices[index] = bytesPerIndex === 2
      ? binary.charCodeAt(offset) | binary.charCodeAt(offset + 1) << 8
      : (binary.charCodeAt(offset) |
          binary.charCodeAt(offset + 1) << 8 |
          binary.charCodeAt(offset + 2) << 16 |
          binary.charCodeAt(offset + 3) << 24) >>> 0;
  }
  return indices;
}
