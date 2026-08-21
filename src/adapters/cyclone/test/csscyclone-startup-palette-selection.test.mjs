import assert from "node:assert/strict";
import test from "node:test";
import { selectCycloneStartupPaletteVariant } from "../src/csscyclone/startupPaletteSelection.mjs";

const variantIds = Object.freeze(Array.from({ length: 12 }, (_, index) =>
  `rotate-${String(index * 30).padStart(3, "0")}`));

test("visits every prepared hue rotation once before repeating across reloads", () => {
  const storage = fixtureStorage();
  let randomValue = 0;
  const options = { storage, randomUint32: () => randomValue++ };
  const firstCycle = Array.from({ length: variantIds.length }, () =>
    selectCycloneStartupPaletteVariant(variantIds, options).paletteVariantId);
  const secondCycle = Array.from({ length: variantIds.length }, () =>
    selectCycloneStartupPaletteVariant(variantIds, options).paletteVariantId);
  assert.equal(new Set(firstCycle).size, variantIds.length);
  assert.equal(new Set(secondCycle).size, variantIds.length);
  assert.notEqual(secondCycle[0], firstCycle.at(-1));
});

test("rejects a broken palette bank or random source", () => {
  assert.throws(() => selectCycloneStartupPaletteVariant(["red", "red"]), /distinct prepared variants/u);
  assert.throws(() => selectCycloneStartupPaletteVariant(variantIds, {
    storage: fixtureStorage(),
    randomUint32: () => -1,
  }), /must be uint32/u);
});

function fixtureStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}
