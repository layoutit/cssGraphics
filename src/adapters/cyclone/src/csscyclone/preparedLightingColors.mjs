export async function loadCyclonePreparedLightingColors(lighting, paletteVariantId) {
  const variant = lighting?.variants?.find((entry) => entry?.paletteVariantId === paletteVariantId);
  if (lighting?.schema !== "csscyclone-prepared-energy-balanced-three-color-vertex-lighting-colors@16" ||
      lighting.preparedMinimumSaturation !== 0.55 ||
      lighting.preparedMinimumValue !== 0.75 ||
      !isFinalLitColorProfileValid(lighting.finalLitColorProfile, lighting.paletteVariantIds) ||
      !Array.isArray(lighting.paletteVariantIds) ||
      lighting.paletteVariantCount !== lighting.paletteVariantIds.length ||
      !lighting.paletteVariantIds.includes(paletteVariantId) ||
      lighting.variants?.length !== lighting.paletteVariantIds.length ||
      typeof variant?.hueRotation !== "number" ||
      typeof variant?.assetUrl !== "string" ||
      !Number.isSafeInteger(variant?.byteLength) || variant.byteLength < 1 ||
      !/^[a-f0-9]{64}$/u.test(variant?.sha256 ?? "") ||
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
  const bytes = new Uint8Array(await fetchBytes(variant.assetUrl));
  await verifyBytes(bytes, variant.byteLength, variant.sha256);
  const preparedVariant = JSON.parse(new TextDecoder().decode(bytes));
  if (preparedVariant?.schema !== "csscyclone-prepared-lighting-color-variant@1" ||
      preparedVariant.streamId !== lighting.streamId ||
      preparedVariant.paletteVariantId !== paletteVariantId ||
      preparedVariant.hueRotation !== variant.hueRotation ||
      preparedVariant.uniqueColorCount !== lighting.uniqueColorCount ||
      !Array.isArray(preparedVariant.colors) ||
      preparedVariant.colors.length !== lighting.uniqueColorCount ||
      preparedVariant.colors.some((color) => !/^#[a-f0-9]{6}$/u.test(color))) {
    throw new Error("Prepared Cyclone lighting color variant is invalid");
  }
  return Object.freeze({
    paletteVariantId,
    hueRotation: variant.hueRotation,
    colors: Object.freeze(preparedVariant.colors),
    colorSlotIndices,
    destroy() {},
  });
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Prepared Cyclone lighting color asset failed: ${response.status} ${url}`);
  }
  return response.arrayBuffer();
}

async function verifyBytes(bytes, expectedLength, expectedSha256) {
  if (bytes.byteLength !== expectedLength) {
    throw new Error("Prepared Cyclone lighting color asset byte length drifted");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actualSha256 = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actualSha256 !== expectedSha256) {
    throw new Error("Prepared Cyclone lighting color asset hash drifted");
  }
}

function isFinalLitColorProfileValid(profile, paletteVariantIds) {
  return profile?.schema === "csscyclone-prepared-final-lit-color-profile@2" &&
    profile.darkFaceValueThreshold === 0.4 &&
    profile.maximumDarkFaceShare === 0.2 &&
    profile.minimumMedianLitValue === 0.5 &&
    profile.targetSrgbEnergyRatio === 0.8215 &&
    profile.minimumTargetEnergyRatio === 1 &&
    profile.maximumTargetEnergyRatio === 1.03 &&
    profile.srgbLumaWeights?.length === 3 &&
    profile.srgbLumaWeights.every((value, index) =>
      value === [0.2126, 0.7152, 0.0722][index]) &&
    profile.variants?.length === paletteVariantIds?.length &&
    profile.variants.every((variant, index) =>
      variant?.paletteVariantId === paletteVariantIds[index] &&
      variant.medianLitValue >= profile.minimumMedianLitValue &&
      variant.darkFaceShare <= profile.maximumDarkFaceShare &&
      variant.minimumTargetEnergyRatio >= profile.minimumTargetEnergyRatio &&
      variant.maximumTargetEnergyRatio <= profile.maximumTargetEnergyRatio);
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
