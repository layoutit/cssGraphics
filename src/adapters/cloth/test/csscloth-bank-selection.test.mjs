import assert from "node:assert/strict";
import test from "node:test";
import { selectClothStartingBank } from "../src/shared/csscloth/bankSelection.mjs";

test("cloth selects one prepared starting bank from a uint32", () => {
  assert.equal(selectClothStartingBank(8, () => 0), 0);
  assert.equal(selectClothStartingBank(8, () => 0x8000_0000), 4);
  assert.equal(selectClothStartingBank(8, () => 0xffff_ffff), 7);
});

test("cloth rejects invalid starting-bank selection inputs", () => {
  assert.throws(() => selectClothStartingBank(1, () => 0), /at least two prepared banks/u);
  assert.throws(() => selectClothStartingBank(8, () => -1), /invalid uint32/u);
  assert.throws(() => selectClothStartingBank(8, () => 0x1_0000_0000), /invalid uint32/u);
});
