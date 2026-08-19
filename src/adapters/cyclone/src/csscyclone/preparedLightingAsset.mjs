export async function loadCyclonePreparedLightingAsset(lighting, paletteFamily) {
  const variant = lighting?.variants?.find((entry) => entry?.paletteFamily === paletteFamily);
  if (lighting?.schema !== "csscyclone-prepared-smooth-lighting-atlas@6" ||
      lighting.maximumColorFamilyCount !== 3 ||
      lighting.paletteHueSlotCount !== 3 ||
      !Array.isArray(lighting.paletteFamilies) ||
      !lighting.paletteFamilies.includes(paletteFamily) ||
      lighting.variants?.length !== lighting.paletteFamilies.length ||
      typeof variant?.assetUrl !== "string" ||
      !/^[a-f0-9]{64}$/u.test(variant.assetSha256 ?? "") ||
      !Number.isSafeInteger(variant.byteLength) || variant.byteLength < 1 ||
      variant.hueSlots?.length !== lighting.maximumColorFamilyCount ||
      !Number.isSafeInteger(lighting.width) || lighting.width < 1 ||
      !Number.isSafeInteger(lighting.height) || lighting.height < 1 ||
      !Number.isSafeInteger(lighting.tileCount) || lighting.tileCount < 1 ||
      !Number.isSafeInteger(lighting.uniqueTileCount) || lighting.uniqueTileCount < 1 ||
      lighting.uniqueTileCount > lighting.tileCount ||
      lighting.deduplicatedTileCount !== lighting.tileCount - lighting.uniqueTileCount ||
      lighting.tileDeduplication !== "exact-cross-palette-rgba8-slot-content" ||
      lighting.packing !== "near-square-row-major-unique-slots") {
    throw new Error("Prepared Cyclone lighting asset contract is invalid");
  }
  const response = await fetch(variant.assetUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Prepared Cyclone lighting failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== variant.byteLength) {
    throw new Error(`Prepared Cyclone lighting byte length drifted (${bytes.byteLength})`);
  }
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (actualSha256 !== variant.assetSha256) {
    throw new Error(`Prepared Cyclone lighting hash drifted (${actualSha256})`);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: lighting.mimeType }));
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    if (image.naturalWidth !== lighting.width || image.naturalHeight !== lighting.height) {
      throw new Error(
        `Prepared Cyclone lighting dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`,
      );
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  let destroyed = false;
  return Object.freeze({
    url,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    paletteFamily,
    hueSlots: variant.hueSlots,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      URL.revokeObjectURL(url);
    },
  });
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
