#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildPlatonicPreparedModel,
  buildPlatonicPreparedPlayback,
} from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
import { buildPlatonicRasterAtlas } from "../src/prepare/cssplatonicfolding/rasterAtlas.mjs";

const firstModel = buildPlatonicPreparedModel();
const secondModel = buildPlatonicPreparedModel();
assert.equal(hash(JSON.stringify(firstModel.model)), hash(JSON.stringify(secondModel.model)));
assert.deepEqual(firstModel.metrics, secondModel.metrics);
for (const bankId of ["desktop", "mobile"]) {
  const first = buildPlatonicPreparedPlayback({ bankId });
  const second = buildPlatonicPreparedPlayback({ bankId });
  assert.equal(hash(JSON.stringify(first.playback)), hash(JSON.stringify(second.playback)));
  assert.deepEqual(first.metrics, second.metrics);
}
const source = firstModel.source;
assert.equal(
  hash(buildPlatonicRasterAtlas(source.faceDefinitions)),
  hash(buildPlatonicRasterAtlas(source.faceDefinitions)),
);
console.log(JSON.stringify({ status: "deterministic", banks: ["desktop", "mobile"] }));

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
