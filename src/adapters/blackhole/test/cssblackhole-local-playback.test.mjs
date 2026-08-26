// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE, resolveBlackHoleLocalPlaybackMode } from
  "../src/cssblackhole/localPlayback.mjs";
import {
  createBlackHolePreparedBlockCoordinateDecoder,
  readBlackHolePreparedBankSections,
} from "../src/shared/cssblackhole/preparedBlockTransport.mjs";
import { blackHolePresentationProfile } from
  "../src/shared/cssblackhole/presentationProfiles.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(
  repositoryRoot, "build/generated/public/cssblackhole-side-tilt");

test("topdown=0 selects the dedicated side-tilt bank only on loopback", () => {
  assert.equal(resolveBlackHoleLocalPlaybackMode(new URL(
    "http://127.0.0.1:5173/?topdown=0")), CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE);
  assert.equal(resolveBlackHoleLocalPlaybackMode(new URL(
    "http://localhost:5173/?topdown=0")), CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE);
  assert.equal(resolveBlackHoleLocalPlaybackMode(new URL(
    "https://css.graphics/blackhole/?topdown=0")), null);
  assert.equal(resolveBlackHoleLocalPlaybackMode(new URL(
    "http://127.0.0.1:5173/")), null);
});

test("side-tilt bank preserves the approved holds and morph durations", () => {
  const profile = blackHolePresentationProfile(CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE);
  assert.equal(profile.assetRoot, "/cssblackhole-side-tilt");
  assert.deepEqual(profile.stateIndices, [0, 1]);
  assert.deepEqual(profile.holdSeconds, [6, 2.5]);
  assert.deepEqual(profile.durationSeconds, [8, 4.5]);
  assert.deepEqual(profile.transitionStartFrameIndices, [360, 150]);
  assert.equal(profile.transitionSeconds, 2);
  assert.equal(profile.sequenceSeconds, 12.5);
  assert.equal(profile.combinedLoopSeconds, 450);
  assert.equal(profile.streamFrameCount, 27_000);
});

test("default playback profile keeps its bounded 20-second loop", () => {
  const profile = blackHolePresentationProfile("full");
  assert.equal(profile.assetRoot, "/cssblackhole");
  assert.deepEqual(profile.stateIndices, [0, 1, 2, 1]);
  assert.deepEqual(profile.holdSeconds, [5, 2.5, 2, 2.5]);
  assert.equal(profile.sequenceSeconds, 20);
  assert.equal(profile.streamFrameCount, 10_800);
});

test("side-tilt transport is a complete continuous prepared bank", async () => {
  const [preparedBytes, catalogBytes] = await Promise.all([
    readFile(resolve(generatedRoot, "prepared.json")),
    readFile(resolve(generatedRoot, "catalog.json")),
  ]);
  const prepared = JSON.parse(preparedBytes);
  const catalog = JSON.parse(catalogBytes);
  assert.equal(prepared.presentationProfile, "side-tilt");
  assert.equal(prepared.assetRoot, "/cssblackhole-side-tilt");
  assert.equal(prepared.catalog.sha256, sha256(catalogBytes));
  assert.equal(prepared.catalog.byteLength, catalogBytes.byteLength);
  assert.equal(catalog.presentationProfile, "side-tilt");
  assert.equal(catalog.assetRoot, "/cssblackhole-side-tilt");
  assert.equal(catalog.bankCount, 90);
  assert.equal(catalog.blockCount, 450);
  assert.equal(catalog.streamFrameCount, 27_000);
  assert.equal(catalog.banks.reduce((sum, bank) => sum + bank.byteLength, 0), 24_408_128);
  assert.deepEqual(catalog.configurationLoop.configurationSequence, [
    "luminet-inclination-85deg",
    "luminet-inclination-60deg",
  ]);
  assert.deepEqual(catalog.configurationLoop.presentationSlotHoldSeconds, [6, 2.5]);
  assert.deepEqual(catalog.configurationLoop.presentationSlotDurationSeconds, [8, 4.5]);

  const [returnMorphBlock, cycleBoundaryBlock, finalBlock, initialBlock] = await Promise.all([
    decodeCoordinateBlock(catalog, 2, 0),
    decodeCoordinateBlock(catalog, 2, 2),
    decodeCoordinateBlock(catalog, 89, 4),
    decodeCoordinateBlock(catalog, 0, 0),
  ]);
  assertContinuousBoundary(frameCoordinates(returnMorphBlock, 29, catalog.starCount),
    frameCoordinates(returnMorphBlock, 30, catalog.starCount));
  assertContinuousBoundary(frameCoordinates(cycleBoundaryBlock, 29, catalog.starCount),
    frameCoordinates(cycleBoundaryBlock, 30, catalog.starCount));
  assertContinuousBoundary(frameCoordinates(finalBlock, 59, catalog.starCount),
    frameCoordinates(initialBlock, 0, catalog.starCount));
});

async function decodeCoordinateBlock(catalog, bankIndex, bankBlockIndex) {
  const descriptor = catalog.banks[bankIndex];
  const compressed = await readFile(resolve(
    generatedRoot, "banks", descriptor.assetUrl.split("/").at(-1)));
  assert.equal(compressed.byteLength, descriptor.byteLength);
  assert.equal(sha256(compressed), descriptor.sha256);
  const expanded = brotliDecompressSync(compressed);
  assert.equal(expanded.byteLength, descriptor.decodedByteLength);
  assert.equal(sha256(expanded), descriptor.decodedSha256);
  const bank = readBlackHolePreparedBankSections(expanded, descriptor, catalog);
  const decoder = createBlackHolePreparedBlockCoordinateDecoder(bank, bankBlockIndex, catalog);
  while (!decoder.step()) {}
  return decoder.coordinates;
}

function frameCoordinates(block, frameIndex, starCount) {
  return block.subarray(frameIndex * starCount * 2, (frameIndex + 1) * starCount * 2);
}

function assertContinuousBoundary(from, to) {
  const displacements = [];
  for (let offset = 0; offset < from.length; offset += 2) {
    displacements.push(Math.hypot(to[offset] - from[offset], to[offset + 1] - from[offset + 1]) /
      10);
  }
  displacements.sort((left, right) => left - right);
  assert.ok(displacements[Math.floor(displacements.length * 0.5)] < 3);
  assert.ok(displacements[Math.floor(displacements.length * 0.95)] < 7.5);
  assert.ok(displacements.at(-1) < 30);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
