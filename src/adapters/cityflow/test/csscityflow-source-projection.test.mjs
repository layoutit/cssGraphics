// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import { cityflowSourceProjection } from "../src/csscityflow/sourceProjection.mjs";

test("preserves the ordinary source viewport through a 2:1 aspect ratio", () => {
  const projection = cityflowSourceProjection(1280, 720);
  assert.equal(projection.viewportHeight, 720);
  assert.equal(projection.viewportTop, 0);
  assert.equal(projection.usesWideSourceViewport, false);
  assert.ok(Math.abs(projection.perspective - 1343.5382907247958) < 1e-9);

  assert.equal(cityflowSourceProjection(1440, 720).usesWideSourceViewport, false);
});

test("reproduces cityflow.c's square viewport and lower-half crop above 2:1", () => {
  const projection = cityflowSourceProjection(2560, 1224);
  assert.equal(projection.viewportHeight, 2560);
  assert.equal(projection.viewportTop, -56);
  assert.equal(projection.usesWideSourceViewport, true);
  assert.ok(Math.abs(projection.perspective - 4777.025033688163) < 1e-9);
});

test("rejects invalid viewport dimensions", () => {
  assert.throws(() => cityflowSourceProjection(0, 720), /positive finite/u);
  assert.throws(() => cityflowSourceProjection(1280, Number.NaN), /positive finite/u);
});
