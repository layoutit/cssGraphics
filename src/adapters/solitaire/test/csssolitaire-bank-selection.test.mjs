import assert from "node:assert/strict";
import test from "node:test";

import {
  selectSolitairePreparedBank,
  SOLITAIRE_LARGE_DESKTOP_MINIMUM_WIDTH,
} from "../src/csssolitaire/bankSelection.mjs";

const finePointer = () => false;

test("cssSolitaire selects one prepared bank from startup device and viewport state", () => {
  assert.equal(selectSolitairePreparedBank({
    width: 390,
    height: 844,
    mediaMatches: finePointer,
  }), "mobile");
  assert.equal(selectSolitairePreparedBank({
    width: 1_024,
    height: 768,
    mediaMatches: (query) => query.includes("pointer: coarse"),
  }), "mobile");
  assert.equal(selectSolitairePreparedBank({
    width: 1_440,
    height: 900,
    mediaMatches: finePointer,
  }), "small-desktop");
  assert.equal(selectSolitairePreparedBank({
    width: SOLITAIRE_LARGE_DESKTOP_MINIMUM_WIDTH,
    height: 900,
    mediaMatches: finePointer,
  }), "large-desktop");
  assert.equal(selectSolitairePreparedBank({
    width: 1_600,
    height: 2_000,
    mediaMatches: finePointer,
  }), "small-desktop");
  assert.equal(selectSolitairePreparedBank({
    width: 1_024,
    height: 768,
    mediaMatches: finePointer,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  }), "mobile");
});
