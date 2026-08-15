import assert from "node:assert/strict";
import test from "node:test";
import { selectInitialGravityWellBank } from "../src/cssgravitywell/preparedAssets.mjs";

const catalog = Object.freeze({ bankCount: 24 });

test("Gravity Well honors a fresh explicit bank selection", () => {
  assert.deepEqual(
    selectInitialGravityWellBank(catalog, {
      search: "?bank=7",
      previousBankIndex: 6,
      randomUint32: () => 0,
    }),
    { bankIndex: 7, mode: "explicit" },
  );
});

test("Gravity Well does not repeat an explicit bank after refresh", () => {
  assert.deepEqual(
    selectInitialGravityWellBank(catalog, {
      search: "?bank=7",
      previousBankIndex: 7,
      randomUint32: () => 7,
    }),
    { bankIndex: 8, mode: "crypto-random-no-repeat" },
  );
});

test("Gravity Well does not repeat a randomly selected bank after refresh", () => {
  assert.deepEqual(
    selectInitialGravityWellBank(catalog, {
      previousBankIndex: 5,
      randomUint32: () => 5,
    }),
    { bankIndex: 6, mode: "crypto-random-no-repeat" },
  );
});

test("Gravity Well keeps the first load crypto-random", () => {
  assert.deepEqual(
    selectInitialGravityWellBank(catalog, { randomUint32: () => 29 }),
    { bankIndex: 5, mode: "crypto-random" },
  );
});
