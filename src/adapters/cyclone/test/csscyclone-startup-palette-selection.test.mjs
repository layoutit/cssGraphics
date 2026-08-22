import assert from "node:assert/strict";
import test from "node:test";
import { selectCycloneStartupPaletteVariant } from "../src/csscyclone/startupPaletteSelection.mjs";

const variantIds = Object.freeze(Array.from({ length: 12 }, (_, index) =>
  `rotate-${String(index * 30).padStart(3, "0")}`));
const weights = Object.freeze(Array(12).fill(1));

test("gives every prepared rotation equal reload odds without adjacent repeats", () => {
  const storage = fixtureStorage();
  let randomValue = 0;
  const options = { storage, weights, randomUint32: () => randomValue++ };
  const cycleLength = weights.reduce((sum, weight) => sum + weight, 0);
  const firstCycle = Array.from({ length: cycleLength }, () =>
    selectCycloneStartupPaletteVariant(variantIds, options).paletteVariantId);
  const secondCycle = Array.from({ length: cycleLength }, () =>
    selectCycloneStartupPaletteVariant(variantIds, options).paletteVariantId);
  for (const cycle of [firstCycle, secondCycle]) {
    assert.deepEqual(
      variantIds.map((variantId) => cycle.filter((entry) => entry === variantId).length),
      weights,
    );
  }
  const combined = [...firstCycle, ...secondCycle];
  assert.ok(combined.every((variantId, index) =>
    index === 0 || variantId !== combined[index - 1]));
  assert.equal(new Set(firstCycle).size, variantIds.length);
});

test("rejects a broken palette bank or random source", () => {
  assert.throws(() => selectCycloneStartupPaletteVariant(["red", "red"]), /distinct prepared variants/u);
  assert.throws(() => selectCycloneStartupPaletteVariant(variantIds, {
    storage: fixtureStorage(),
    weights,
    randomUint32: () => -1,
  }), /must be uint32/u);
  assert.throws(() => selectCycloneStartupPaletteVariant(variantIds, {
    storage: fixtureStorage(),
    weights: weights.slice(1),
  }), /positive prepared weights/u);
});

function fixtureStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}
