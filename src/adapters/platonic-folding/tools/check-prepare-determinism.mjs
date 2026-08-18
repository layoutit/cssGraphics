#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPlatonicPreparedModel } from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
import { buildPlatonicRasterAtlas } from "../src/prepare/cssplatonicfolding/rasterAtlas.mjs";

for (const bankId of ["desktop", "mobile"]) {
  const first = buildPlatonicPreparedModel({ bankId });
  const second = buildPlatonicPreparedModel({ bankId });
  assert.equal(hash(JSON.stringify(first.model)), hash(JSON.stringify(second.model)));
  assert.deepEqual(first.metrics, second.metrics);
}
const source = buildPlatonicPreparedModel().source;
assert.equal(
  hash(buildPlatonicRasterAtlas(source.faceDefinitions)),
  hash(buildPlatonicRasterAtlas(source.faceDefinitions)),
);
console.log(JSON.stringify({ status: "deterministic", banks: ["desktop", "mobile"] }));

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
