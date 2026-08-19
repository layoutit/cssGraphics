const STORAGE_KEY = "csscyclone:startup-palette-shuffle@1";
const STORAGE_SCHEMA = "csscyclone-startup-palette-shuffle@1";

export function selectCycloneStartupPaletteFamily(paletteFamilies, options = {}) {
  const families = [...(paletteFamilies ?? [])];
  if (families.length < 2 || new Set(families).size !== families.length ||
      families.some((family) => typeof family !== "string" || family.length < 1)) {
    throw new Error("Cyclone startup palette shuffle requires distinct prepared families");
  }
  const signature = families.join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, families);
  let remaining = restored?.remainingPaletteFamilies ?? [];
  const lastPaletteFamily = restored?.lastPaletteFamily ?? null;

  if (remaining.length === 0) {
    remaining = [...families];
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const value = randomUint32();
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError("Cyclone startup palette shuffle value must be uint32");
      }
      const swapIndex = value % (index + 1);
      [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
    }
    if (lastPaletteFamily && remaining.at(-1) === lastPaletteFamily) {
      [remaining[0], remaining[remaining.length - 1]] =
        [remaining[remaining.length - 1], remaining[0]];
    }
  }

  const paletteFamily = remaining.pop();
  if (!paletteFamily || paletteFamily === lastPaletteFamily) {
    throw new Error("Cyclone startup palette shuffle repeated its previous family");
  }
  writeState(storage, {
    schema: STORAGE_SCHEMA,
    paletteSignature: signature,
    lastPaletteFamily: paletteFamily,
    remainingPaletteFamilies: remaining,
  });
  return Object.freeze({
    paletteFamily,
    remainingPaletteFamilyCount: remaining.length,
    sessionPersistence: Boolean(storage),
  });
}

function readState(storage, signature, families) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    const remaining = value?.remainingPaletteFamilies;
    const allowed = new Set(families);
    if (value?.schema !== STORAGE_SCHEMA || value.paletteSignature !== signature ||
        (value.lastPaletteFamily !== null && !allowed.has(value.lastPaletteFamily)) ||
        !Array.isArray(remaining) || new Set(remaining).size !== remaining.length ||
        remaining.some((family) => !allowed.has(family) || family === value.lastPaletteFamily)) {
      return null;
    }
    return Object.freeze({
      lastPaletteFamily: value.lastPaletteFamily,
      remainingPaletteFamilies: [...remaining],
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
