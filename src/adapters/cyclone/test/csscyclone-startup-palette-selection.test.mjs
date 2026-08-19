import assert from "node:assert/strict";
import test from "node:test";
import { selectCycloneStartupPaletteFamily } from "../src/csscyclone/startupPaletteSelection.mjs";

const families = Object.freeze(["blue", "yellow", "red", "magenta", "green"]);

test("visits every prepared three-family palette once before repeating across reloads", () => {
  const storage = fixtureStorage();
  let randomValue = 0;
  const options = { storage, randomUint32: () => randomValue++ };
  const firstCycle = Array.from({ length: families.length }, () =>
    selectCycloneStartupPaletteFamily(families, options).paletteFamily);
  const secondCycle = Array.from({ length: families.length }, () =>
    selectCycloneStartupPaletteFamily(families, options).paletteFamily);
  assert.equal(new Set(firstCycle).size, families.length);
  assert.equal(new Set(secondCycle).size, families.length);
  assert.notEqual(secondCycle[0], firstCycle.at(-1));
});

test("rejects a broken palette bank or random source", () => {
  assert.throws(() => selectCycloneStartupPaletteFamily(["red", "red"]), /distinct prepared families/u);
  assert.throws(() => selectCycloneStartupPaletteFamily(families, {
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
