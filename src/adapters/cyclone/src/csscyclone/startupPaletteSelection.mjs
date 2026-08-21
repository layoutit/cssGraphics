const STORAGE_KEY = "csscyclone:startup-palette-variant-shuffle@2";
const STORAGE_SCHEMA = "csscyclone-startup-palette-variant-shuffle@2";

export function selectCycloneStartupPaletteVariant(paletteVariantIds, options = {}) {
  const variantIds = [...(paletteVariantIds ?? [])];
  if (variantIds.length < 2 || new Set(variantIds).size !== variantIds.length ||
      variantIds.some((variantId) => typeof variantId !== "string" || variantId.length < 1)) {
    throw new Error("Cyclone startup palette shuffle requires distinct prepared variants");
  }
  const signature = variantIds.join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, variantIds);
  let remaining = restored?.remainingPaletteVariantIds ?? [];
  const lastPaletteVariantId = restored?.lastPaletteVariantId ?? null;

  if (remaining.length === 0) {
    remaining = [...variantIds];
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const value = randomUint32();
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError("Cyclone startup palette shuffle value must be uint32");
      }
      const swapIndex = value % (index + 1);
      [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
    }
    if (lastPaletteVariantId && remaining.at(-1) === lastPaletteVariantId) {
      [remaining[0], remaining[remaining.length - 1]] =
        [remaining[remaining.length - 1], remaining[0]];
    }
  }

  const paletteVariantId = remaining.pop();
  if (!paletteVariantId || paletteVariantId === lastPaletteVariantId) {
    throw new Error("Cyclone startup palette shuffle repeated its previous variant");
  }
  writeState(storage, {
    schema: STORAGE_SCHEMA,
    paletteSignature: signature,
    lastPaletteVariantId: paletteVariantId,
    remainingPaletteVariantIds: remaining,
  });
  return Object.freeze({
    paletteVariantId,
    remainingPaletteVariantCount: remaining.length,
    sessionPersistence: Boolean(storage),
  });
}

function readState(storage, signature, variantIds) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    const remaining = value?.remainingPaletteVariantIds;
    const allowed = new Set(variantIds);
    if (value?.schema !== STORAGE_SCHEMA || value.paletteSignature !== signature ||
        (value.lastPaletteVariantId !== null && !allowed.has(value.lastPaletteVariantId)) ||
        !Array.isArray(remaining) || new Set(remaining).size !== remaining.length ||
        remaining.some((variantId) =>
          !allowed.has(variantId) || variantId === value.lastPaletteVariantId)) {
      return null;
    }
    return Object.freeze({
      lastPaletteVariantId: value.lastPaletteVariantId,
      remainingPaletteVariantIds: [...remaining],
    });
  } catch {
    return null;
  }
}

function writeState(storage, value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Selection remains balanced within this load when browser storage is unavailable.
  }
}

function safeSessionStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
