import assert from "node:assert/strict";
import test from "node:test";

import {
  selectFlipFlopPreparedBank,
} from "../src/cssflipflop/bankSelection.mjs";

const finePointer = () => false;

test("Flip Flop selects one prepared bank from startup device and viewport state", () => {
  assert.equal(selectFlipFlopPreparedBank({
    width: 390,
    height: 844,
    mediaMatches: finePointer,
  }), "mobile");
  assert.equal(selectFlipFlopPreparedBank({
    width: 1_024,
    height: 768,
    mediaMatches: (query) => query.includes("pointer: coarse"),
  }), "mobile");
  assert.equal(selectFlipFlopPreparedBank({
    width: 1_440,
    height: 900,
    mediaMatches: finePointer,
  }), "desktop");
  assert.equal(selectFlipFlopPreparedBank({
    width: 1_024,
    height: 768,
    mediaMatches: finePointer,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  }), "mobile");
});

test("Flip Flop rejects invalid startup viewport dimensions", () => {
  assert.throws(() => selectFlipFlopPreparedBank({
    width: 0,
    height: 844,
    mediaMatches: finePointer,
  }), /viewport drifted/u);
});
