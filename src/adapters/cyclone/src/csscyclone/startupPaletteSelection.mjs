const STORAGE_KEY = "csscyclone:startup-palette-variant-shuffle@3";
const STORAGE_SCHEMA = "csscyclone-startup-palette-variant-shuffle@3";

export function selectCycloneStartupPaletteVariant(paletteVariantIds, options = {}) {
  const variantIds = [...(paletteVariantIds ?? [])];
  if (variantIds.length < 2 || new Set(variantIds).size !== variantIds.length ||
      variantIds.some((variantId) => typeof variantId !== "string" || variantId.length < 1)) {
    throw new Error("Cyclone startup palette shuffle requires distinct prepared variants");
  }
  const weights = [...(options.weights ?? [])];
  if (weights.length !== variantIds.length ||
      weights.some((weight) => !Number.isSafeInteger(weight) || weight < 1)) {
    throw new Error("Cyclone startup palette shuffle requires positive prepared weights");
  }
  const signature = variantIds.map((variantId, index) =>
    `${variantId}:${weights[index]}`).join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, variantIds, weights);
  let remaining = restored?.remainingPaletteVariantIds ?? [];
  const lastPaletteVariantId = restored?.lastPaletteVariantId ?? null;

  if (remaining.length === 0) {
    remaining = buildWeightedCycle(
      variantIds,
      weights,
      lastPaletteVariantId,
      randomUint32,
    ).reverse();
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

function buildWeightedCycle(variantIds, weights, previousVariantId, randomUint32) {
  const counts = new Map(variantIds.map((variantId, index) => [variantId, weights[index]]));
  const cycle = [];
  let previous = previousVariantId;
  let remainingCount = weights.reduce((sum, weight) => sum + weight, 0);
  while (remainingCount > 0) {
    let maximumCount = 0;
    let candidates = [];
    for (const variantId of variantIds) {
      const count = counts.get(variantId);
      if (variantId === previous || count < maximumCount) continue;
      if (count > maximumCount) {
        maximumCount = count;
        candidates = [];
      }
      if (count === maximumCount && count > 0) candidates.push(variantId);
    }
    if (candidates.length === 0) {
      throw new Error("Cyclone startup palette weights cannot avoid an adjacent repeat");
    }
    const selected = candidates[readRandomUint32(randomUint32) % candidates.length];
    cycle.push(selected);
    counts.set(selected, counts.get(selected) - 1);
    previous = selected;
    remainingCount -= 1;
  }
  return cycle;
}

function readState(storage, signature, variantIds, weights) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    const remaining = value?.remainingPaletteVariantIds;
    const allowed = new Set(variantIds);
    const maximumCounts = new Map(variantIds.map((variantId, index) =>
      [variantId, weights[index]]));
    const remainingCounts = new Map();
    if (value?.schema !== STORAGE_SCHEMA || value.paletteSignature !== signature ||
        (value.lastPaletteVariantId !== null && !allowed.has(value.lastPaletteVariantId)) ||
        !Array.isArray(remaining) || remaining.some((variantId) => !allowed.has(variantId))) {
      return null;
    }
    for (const variantId of remaining) {
      remainingCounts.set(variantId, (remainingCounts.get(variantId) ?? 0) + 1);
      if (remainingCounts.get(variantId) > maximumCounts.get(variantId)) return null;
    }
    let previous = value.lastPaletteVariantId;
    for (const variantId of [...remaining].reverse()) {
      if (variantId === previous) return null;
      previous = variantId;
    }
    return Object.freeze({
      lastPaletteVariantId: value.lastPaletteVariantId,
      remainingPaletteVariantIds: [...remaining],
    });
  } catch {
    return null;
  }
}

function readRandomUint32(randomUint32) {
  const value = randomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("Cyclone startup palette shuffle value must be uint32");
  }
  return value;
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
