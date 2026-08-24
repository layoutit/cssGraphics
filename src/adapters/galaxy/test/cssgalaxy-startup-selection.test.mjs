// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import { selectGalaxyStartupEncounter } from "../src/cssgalaxy/startupEncounterSelection.mjs";

const seeds = Object.freeze([
  2298, 6359, 7299, 4908, 1105, 2838, 7343, 2542, 57, 374,
]);
const catalog = Object.freeze({
  comparisonSeed: 2298,
  curatedEncounterSeeds: seeds,
  encounterReel: Object.freeze({ encounterCount: 10, encounterFrameCount: 720 }),
  blockFrameCount: 240,
  bankFrameCount: 1440,
  seeds: Object.freeze({ 2298: Object.freeze({ encounterOrder: seeds }) }),
});

test("visits every qualified encounter once before refilling the session bag", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const selected = Array.from({ length: seeds.length }, () =>
    selectGalaxyStartupEncounter(catalog, { storage, randomUint32: () => 0 }));
  assert.equal(new Set(selected.map(({ sourceSeed }) => sourceSeed)).size, seeds.length);
  assert.deepEqual(selected.map(({ initialStreamFrame }) => initialStreamFrame),
    selected.map(({ encounterIndex }) => encounterIndex * 720));
  assert.deepEqual(selected.map(({ initialBlockIndex }) => initialBlockIndex),
    selected.map(({ encounterIndex }) => Math.floor(encounterIndex * 720 / 240)));
  assert.deepEqual(selected.map(({ initialBankIndex }) => initialBankIndex),
    selected.map(({ encounterIndex }) => Math.floor(encounterIndex * 720 / 1440)));
  const next = selectGalaxyStartupEncounter(catalog, { storage, randomUint32: () => 0 });
  assert.notEqual(next.sourceSeed, selected.at(-1).sourceSeed);
});

test("rejects duplicate prepared encounters", () => {
  assert.throws(() => selectGalaxyStartupEncounter({
    ...catalog,
    curatedEncounterSeeds: [...seeds.slice(0, -1), seeds[0]],
  }, { storage: null, randomUint32: () => 0 }), /bank drifted/u);
});
