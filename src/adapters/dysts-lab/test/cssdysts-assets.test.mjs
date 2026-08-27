// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { decodeChaosTrajectoryAsset } from
  "../src/shared/cssdysts/preparedRailTransport.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/csschaos");

test("Chaos prepared bank is complete, compact, and source-locked", async () => {
  const [prepared, snapshot, sourceLock] = await Promise.all([
    readJson(resolve(generatedRoot, "prepared.json")),
    readFile(resolve(generatedRoot, "snapshot.html"), "utf8"),
    readJson(resolve(import.meta.dirname, "../notes/references/source-lock.json")),
  ]);
  assert.equal(prepared.schema, "csschaos-prepared-sequence@11");
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.adapterId, "chaos");
  assert.equal(prepared.source.commit, sourceLock.upstream.commit);
  assert.equal(prepared.starCount, 2000);
  assert.equal(prepared.sequence.length, 50);
  assert.equal(prepared.framesPerSecond, 60);
  assert.equal(prepared.renderer.kind,
    "retained-dom-polycss-prepared-chaotic-attractor-sequence");
  assert.equal(prepared.renderer.runtimePhysics, false);
  assert.equal(prepared.renderer.runtimeRasterization, false);
  assert.equal(prepared.renderer.runtimePointMatching, false);
  assert.equal(prepared.renderer.runtimeHandoffCalculation, false);
  assert.equal(prepared.audition.reviewState, "published-motion-curated-shortlist");
  assert.equal(Object.hasOwn(prepared.audition, "removalStorageKey"), false);
  assert.deepEqual(sourceLock.sources.find(({ path }) => path === "dysts/flows.py")
    .adaptedClasses, prepared.sequence.map(({ name }) => name));
  assert.equal(prepared.sequence.reduce((sum, item) => sum + item.encodedByteLength, 0) <
    1_500_000, true);
  assert.equal((snapshot.match(/<b\b/gu) ?? []).length, 2000);
  assert.equal((snapshot.match(/<i\b/gu) ?? []).length, 3);
  assert.doesNotMatch(snapshot, /<script|<canvas|<svg|clip-path/iu);

  for (const descriptor of prepared.sequence) {
    const encoded = await readFile(resolve(generatedRoot, descriptor.asset));
    assert.equal(encoded.byteLength, descriptor.encodedByteLength, descriptor.name);
    const decoded = brotliDecompressSync(encoded);
    assert.equal(decoded.byteLength, descriptor.decodedByteLength, descriptor.name);
    assert.equal(sha256(decoded), descriptor.sha256, descriptor.name);
    const asset = decodeChaosTrajectoryAsset(decoded, descriptor);
    assert.equal(asset.coordinates.length, descriptor.sampleCount * 3, descriptor.name);
    assert.equal(asset.leafPhaseIndices.length, 2000, descriptor.name);
    assert.equal(new Set(asset.leafRevealOrder).size, 2000, descriptor.name);
    assert.equal(asset.handoffControlCoordinates.length, 6000, descriptor.name);
  }
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
