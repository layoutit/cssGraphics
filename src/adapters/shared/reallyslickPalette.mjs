// SPDX-License-Identifier: GPL-2.0-or-later
const STORAGE_KEY = "cssgraphics:reallyslick-palette-variant-shuffle@1";
const STORAGE_SCHEMA = "cssgraphics-reallyslick-palette-variant-shuffle@1";
const THIRD_HUE_SHARE = 0.2;

const STARTUP_WEIGHTS = Object.freeze([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
const HUES_DEGREES = Object.freeze([
  Object.freeze([90, 120, 150]),
  Object.freeze([105, 135, 165]),
  Object.freeze([135, 165, 195]),
  Object.freeze([165, 195, 225]),
  Object.freeze([180, 210, 240]),
  Object.freeze([210, 240, 270]),
  Object.freeze([225, 255, 285]),
  Object.freeze([240, 270, 300]),
  Object.freeze([255, 285, 315]),
  Object.freeze([270, 300, 330]),
  Object.freeze([285, 315, 345]),
  Object.freeze([300, 330, 0]),
]);

export const CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANTS = Object.freeze(
  HUES_DEGREES.map((hues, index) => Object.freeze({
    id: `rotate-${String(index * 30).padStart(3, "0")}`,
    hueRotation: index / HUES_DEGREES.length,
    preparedHues: Object.freeze(hues.map((hue) => hue / 360)),
    startupWeight: STARTUP_WEIGHTS[index],
  })),
);

export const CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS = Object.freeze(
  CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANTS.map(({ id }) => id),
);

export const CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS = STARTUP_WEIGHTS;

const PREPARED_HEX_COLORS = new Map(CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANTS.map((variant) => [
  variant.id,
  Object.freeze(variant.preparedHues.map(hsvHueToHex)),
]));

export function mapReallySlickHueToPreparedHex(hue, paletteVariantId) {
  if (!Number.isFinite(hue)) throw new TypeError("Really Slick source hue must be finite");
  const colors = PREPARED_HEX_COLORS.get(paletteVariantId);
  if (!colors) throw new RangeError("Really Slick prepared palette variant is invalid");
  const wrappedHue = ((hue % 1) + 1) % 1;
  const primaryShare = (1 - THIRD_HUE_SHARE) / 2;
  return colors[wrappedHue < primaryShare ? 0 : wrappedHue < primaryShare * 2 ? 1 : 2];
}

export function selectReallySlickPaletteVariant(paletteVariantIds, options = {}) {
  const variantIds = [...(paletteVariantIds ?? [])];
  if (variantIds.length < 2 || new Set(variantIds).size !== variantIds.length ||
      variantIds.some((variantId) => typeof variantId !== "string" || variantId.length < 1)) {
    throw new Error("Really Slick startup palette shuffle requires distinct prepared variants");
  }
  const weights = [...(options.weights ?? [])];
  if (weights.length !== variantIds.length ||
      weights.some((weight) => !Number.isSafeInteger(weight) || weight < 1)) {
    throw new Error("Really Slick startup palette shuffle requires positive prepared weights");
  }
  const signature = variantIds.map((variantId, index) =>
    `${variantId}:${weights[index]}`).join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, variantIds, weights);
  let remaining = restored?.remainingPaletteVariantIds ?? [];
  const lastPaletteVariantId = restored?.lastPaletteVariantId ?? null;

  if (remaining.length === 0) {
    remaining = buildWeightedCycle(variantIds, weights, lastPaletteVariantId, randomUint32)
      .reverse();
  }

  const paletteVariantId = remaining.pop();
  if (!paletteVariantId || paletteVariantId === lastPaletteVariantId) {
    throw new Error("Really Slick startup palette shuffle repeated its previous variant");
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

function hsvHueToHex(hue) {
  const sector = hue * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const descending = 1 - fraction;
  const ascending = fraction;
  const rgb = [
    [1, ascending, 0],
    [descending, 1, 0],
    [0, 1, ascending],
    [0, descending, 1],
    [ascending, 0, 1],
    [1, 0, descending],
  ][index];
  return `#${rgb.map((channel) =>
    Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
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
      throw new Error("Really Slick startup palette weights cannot avoid an adjacent repeat");
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
    throw new RangeError("Really Slick startup palette shuffle value must be uint32");
  }
  return value;
}

function writeState(storage, value) {
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
}

function safeSessionStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
