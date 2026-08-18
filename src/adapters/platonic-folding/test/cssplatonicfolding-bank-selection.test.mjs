import assert from "node:assert/strict";
import test from "node:test";
import { selectPlatonicBank } from "../src/cssplatonicfolding/bankSelection.mjs";

test("portrait viewports use the horizontal-travel mobile bank", () => {
  assert.equal(selectPlatonicBank({ width: 390, height: 844 }), "mobile");
  assert.equal(selectPlatonicBank({ width: 1024, height: 768 }), "desktop");
});
