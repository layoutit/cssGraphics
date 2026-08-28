// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { COORDINATE_SCALE, PREPARED_POSITION_BIAS, decodeChaosTrajectoryAsset } from
  "../src/shared/cssdysts/preparedRailTransport.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/csschaos");

test("Chaos prepared bank is complete, compact, and source-locked", async () => {
  const [prepared, snapshot, sourceLock] = await Promise.all([
    readJson(resolve(generatedRoot, "prepared.json")),
    readFile(resolve(generatedRoot, "snapshot.html"), "utf8"),
    readJson(resolve(import.meta.dirname, "../notes/references/source-lock.json")),
  ]);
  assert.equal(prepared.schema, "csschaos-prepared-sequence@14");
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.adapterId, "chaos");
  assert.equal(prepared.source.commit, sourceLock.upstream.commit);
  assert.equal(prepared.starCount, 2000);
  assert.equal(prepared.sampleCount, 5760);
  assert.equal(prepared.sourceFrameStep, 2);
  assert.equal(prepared.source.integrationSampleCount, 2880);
  assert.equal(prepared.source.preparedSampleCount, 5760);
  assert.equal(prepared.source.preparedInterpolationFactor, 2);
  assert.equal(prepared.source.samplesPerCharacteristicPeriod, 240);
  assert.equal(prepared.sequence.length, 50);
  assert.equal(prepared.framesPerSecond, 60);
  assert.equal(prepared.renderer.kind,
    "retained-dom-polycss-prepared-chaotic-attractor-sequence");
  assert.equal(prepared.renderer.runtimePhysics, false);
  assert.equal(prepared.renderer.runtimeRasterization, false);
  assert.equal(prepared.renderer.runtimePointMatching, false);
  assert.equal(prepared.renderer.runtimeHandoffCalculation, false);
  assert.equal(prepared.renderer.preparedDenseSourceInterpolation, true);
  assert.equal(prepared.renderer.runtimeSourceInterpolation, false);
  assert.equal(prepared.renderer.retainedCameraRootCount, 1);
  assert.equal(prepared.renderer.retainedSceneRootCount, 1);
  assert.equal(prepared.renderer.retainedPointWrapperCount, 0);
  assert.equal(prepared.renderer.retainedPointLeafCount, 2000);
  assert.equal(prepared.renderer.retainedPointIdCount, 0);
  assert.equal(prepared.renderer.retainedPointDataAttributeCount, 0);
  assert.equal(prepared.audition.reviewState, "published-motion-curated-shortlist");
  assert.equal(Object.hasOwn(prepared.audition, "removalStorageKey"), false);
  assert.deepEqual(sourceLock.sources.find(({ path }) => path === "dysts/flows.py")
    .adaptedClasses, prepared.sequence.map(({ name }) => name));
  assert.equal(prepared.sequence.reduce((sum, item) => sum + item.encodedByteLength, 0) <
    850_000, true);
  assert.equal((snapshot.match(/<b\b/gu) ?? []).length, 2000);
  assert.equal((snapshot.match(/color:transparent/gu) ?? []).length, 2000);
  assert.doesNotMatch(snapshot, /opacity:/u);
  assert.equal(prepared.leafColors.length, 2000);
  assert.equal(prepared.leafColors.every((color) =>
    /^rgba\(\d{1,3},\d{1,3},\d{1,3},0\.[4-8]\)$/u.test(color)), true);
  assert.equal(Object.hasOwn(prepared, "leafOpacities"), false);
  assert.equal((snapshot.match(/<i\b/gu) ?? []).length, 0);
  assert.doesNotMatch(snapshot, /<script|<canvas|<svg|clip-path/iu);

  for (const descriptor of prepared.sequence) {
    assert.equal(descriptor.sampleCount, 5760, descriptor.name);
    assert.equal(descriptor.sourceFrameStep, 2, descriptor.name);
    const encoded = await readFile(resolve(generatedRoot, descriptor.asset));
    assert.equal(encoded.byteLength, descriptor.encodedByteLength, descriptor.name);
    const decoded = brotliDecompressSync(encoded);
    assert.equal(decoded.byteLength, descriptor.decodedByteLength, descriptor.name);
    assert.equal(sha256(decoded), descriptor.sha256, descriptor.name);
    assert.equal(descriptor.contentEncoding, "br", descriptor.name);
    assert.equal(descriptor.transportEncoding,
      "axis-split-zigzag-varint-second-difference-u16-plus-sorted-phase-ranks-packed-reveal@1",
      descriptor.name);
    assert.equal(descriptor.materializedByteLength, 54_560, descriptor.name);
    const asset = decodeChaosTrajectoryAsset(decoded, descriptor);
    assert.equal(asset.coordinates.length, descriptor.sampleCount * 3, descriptor.name);
    assert.equal(asset.leafPhaseIndices.length, 2000, descriptor.name);
    assert.equal(new Set(asset.leafPhaseIndices).size, 2000, descriptor.name);
    assert.equal(new Set(asset.leafRevealOrder).size, 2000, descriptor.name);
    assert.equal(asset.handoffControlCoordinates.length, 6000, descriptor.name);
    assert.equal(asset.coordinates.buffer, asset.leafPhaseIndices.buffer, descriptor.name);
    assert.equal(asset.coordinates.buffer, asset.leafRevealOrder.buffer, descriptor.name);
    assert.equal(asset.coordinates.buffer, asset.handoffControlCoordinates.buffer,
      descriptor.name);
    assert.equal(descriptor.presentationOrientation.screenSafeArea.marginPixels, 48,
      descriptor.name);
    assert.match(descriptor.presentationOrientation.screenSafeArea.method,
      /uniform screen-space fit/u, descriptor.name);
    let minimumEdge = Infinity;
    for (let sampleIndex = 0; sampleIndex < descriptor.sampleCount; sampleIndex += 1) {
      const offset = sampleIndex * 3;
      const x = asset.coordinates[offset] / COORDINATE_SCALE - PREPARED_POSITION_BIAS;
      const y = asset.coordinates[offset + 1] / COORDINATE_SCALE - PREPARED_POSITION_BIAS;
      minimumEdge = Math.min(minimumEdge, x, 800 - x, y, 600 - y);
    }
    assert.equal(minimumEdge >= 47.95, true,
      `${descriptor.name}: ${minimumEdge}px minimum prepared edge`);
  }
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
