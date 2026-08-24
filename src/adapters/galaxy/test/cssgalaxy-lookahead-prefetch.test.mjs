// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";

import {
  createGalaxyPreparedBankWindow,
  createGalaxyPreparedBlockWindow,
} from "../src/cssgalaxy/preparedStream.mjs";

const catalog = Object.freeze({
  bankCount: 14,
  blockCount: 84,
  runtimeLookaheadBankCount: 1,
  runtimeMaterializedLookaheadBlockCount: 1,
});

test("retains exactly the current and next 24-second bank", () => {
  assert.deepEqual(createGalaxyPreparedBankWindow(catalog, 0), [0, 1]);
  assert.deepEqual(createGalaxyPreparedBankWindow(catalog, 6), [6, 7]);
  assert.deepEqual(createGalaxyPreparedBankWindow(catalog, 13), [13, 0]);
});

test("materializes exactly the current and next four-second block", () => {
  assert.deepEqual(createGalaxyPreparedBlockWindow(catalog, 0), [0, 1]);
  assert.deepEqual(createGalaxyPreparedBlockWindow(catalog, 35), [35, 36]);
  assert.deepEqual(createGalaxyPreparedBlockWindow(catalog, 83), [83, 0]);
});
