// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { prepareShuffledPlaybackOrder } from "../src/cssdysts/client.mjs";
import { createChaosPreparedPlayer } from "../src/cssdysts/preparedPlayback.mjs";
import { decodeChaosTrajectoryAsset, encodeChaosTrajectoryAsset, formatChaosTransform } from
  "../src/shared/cssdysts/preparedRailTransport.mjs";

test("compact Chaos transport preserves trajectories and prepared handoff controls", () => {
  const descriptor = { name: "Test", systemIndex: 1, sampleCount: 5, starCount: 4,
    handoffControlPointCount: 4 };
  const coordinates = Uint16Array.from([
    500, 300, 450,
    493, 312, 455,
    501, 307, 449,
    480, 329, 460,
    482, 328, 441,
  ]);
  const leafPhaseIndices = Uint16Array.from([2, 0, 3, 1]);
  const leafRevealOrder = Uint16Array.from([1, 3, 0, 2]);
  const handoffControlCoordinates = Uint16Array.from([
    210, 400, 505,
    205, 387, 499,
    219, 391, 512,
    198, 380, 493,
  ]);
  const bytes = encodeChaosTrajectoryAsset({ descriptor, coordinates, leafPhaseIndices,
    leafRevealOrder, handoffControlCoordinates });
  const decoded = decodeChaosTrajectoryAsset(bytes,
    { ...descriptor, decodedByteLength: bytes.byteLength, materializedByteLength: 70,
      contentEncoding: "br",
      transportEncoding:
        "axis-split-zigzag-varint-second-difference-u16-plus-sorted-phase-ranks-packed-reveal@1" });
  assert.deepEqual(decoded.coordinates, coordinates);
  assert.deepEqual(decoded.leafPhaseIndices, leafPhaseIndices);
  assert.deepEqual(decoded.leafRevealOrder, leafRevealOrder);
  assert.deepEqual(decoded.handoffControlCoordinates, handoffControlCoordinates);
  assert.equal(decoded.coordinates.buffer, decoded.handoffControlCoordinates.buffer);
  assert.equal(formatChaosTransform(1323, 1656, 5234),
    "translate(12.3px,45.6px) scale(1.0267)");
  assert.equal(formatChaosTransform(1323, 1656, 5000), "translate(12.3px,45.6px)");
});

test("shuffle visits every shape once, honors a pinned start, and avoids cycle repeats", () => {
  const pinned = prepareShuffledPlaybackOrder(50, { firstIndex: 42, random: () => 0.25 });
  assert.equal(pinned.length, 50);
  assert.equal(pinned[0], 42);
  assert.equal(new Set(pinned).size, 50);
  assert.deepEqual([...pinned].sort((left, right) => left - right),
    Array.from({ length: 50 }, (_, index) => index));

  const nextCycle = prepareShuffledPlaybackOrder(50,
    { excludedFirstIndex: 0, random: () => 0.999999 });
  assert.notEqual(nextCycle[0], 0);
  assert.equal(new Set(nextCycle).size, 50);
});

test("initial prepared attractor animates along its contiguous source line while growing", () => {
  const starCount = 2000;
  const opacityWrites = [];
  const transformWrites = [];
  let completionCount = 0;
  const player = createChaosPreparedPlayer({
    catalog: { starCount, sampleCount: 7, framesPerSecond: 60, revealSeconds: 3,
      handoffSeconds: 2,
      holdSeconds: 3, handoffControlPointCount: starCount, sourcePhaseOffset: 2 },
    prepared: {
      transforms: ["a", "b", "c", "d", "e", "f", "g"],
      coordinates: new Uint16Array(7 * 3),
      handoffControlCoordinates: new Uint16Array(starCount * 3),
    },
    leafPhaseIndices: Uint16Array.from({ length: starCount }, (_, index) => (index + 2) % 7),
    leafRevealOrder: Uint16Array.from({ length: starCount }, (_, index) => starCount - index - 1),
    leafOpacities: Array.from({ length: starCount }, () => "0.6"),
    publish(leafIndex, transform) { transformWrites.push([leafIndex, transform]); },
    publishOpacity(leafIndex, opacity) { opacityWrites.push([leafIndex, opacity]); },
    handoff: false,
    rankToPhysical: Uint16Array.from({ length: starCount }, (_, rank) => rank),
    onCycleComplete() { completionCount += 1; },
    requestFrame() { return 1; },
    cancelFrame() {},
  });
  player.publishFrame(0);
  assert.equal(player.stats().visibleLeafCount, 0);
  assert.equal(transformWrites.length, 0);
  assert.equal(opacityWrites.length, starCount);
  player.publishFrame(90);
  assert.equal(player.stats().visibleLeafCount, 1000);
  assert.equal(transformWrites.length, 1000);
  assert.ok(new Set(transformWrites.map(([, transform]) => transform)).size > 1);
  player.publishFrame(180);
  assert.equal(player.stats().visibleLeafCount, starCount);
  assert.equal(player.stats().growthComplete, true);
  assert.equal(transformWrites.length, 3000);
  assert.ok(new Set(transformWrites.slice(-starCount).map(([, transform]) => transform)).size > 1);
  player.publishFrame(181);
  assert.equal(transformWrites.length, 5000);
  assert.notDeepEqual(transformWrites.slice(-starCount),
    transformWrites.slice(-starCount * 2, -starCount));
  player.publishFrame(360);
  assert.equal(transformWrites.length, 7000);
  assert.equal(player.stats().cycleComplete, true);
  assert.equal(completionCount, 1);
  const terminal = player.captureTerminalPreparedComponents();
  assert.ok(terminal instanceof Float64Array);
  assert.equal(terminal.length, starCount * 3);
});

test("automatic handoff follows one curved scatter path into the next attractor", () => {
  const starCount = 2000;
  const writes = [];
  const opacityWrites = [];
  let completionCount = 0;
  const rankToPhysical = Uint16Array.from({ length: starCount },
    (_, rank) => (rank + 37) % starCount);
  const player = createChaosPreparedPlayer({
    catalog: { starCount, sampleCount: 3, framesPerSecond: 60, revealSeconds: 3,
      handoffSeconds: 2,
      holdSeconds: 3, handoffControlPointCount: starCount, sourcePhaseOffset: 0 },
    prepared: {
      transforms: ["incoming-a", "incoming-b", "incoming-c"],
      coordinates: Uint16Array.from({ length: 3 * 3 }, (_, index) =>
        index % 3 === 2 ? 5000 : 1200),
      handoffControlCoordinates: Uint16Array.from({ length: starCount * 3 }, (_, index) =>
        index % 3 === 0 ? 2200 : index % 3 === 1 ? 1200 : 5000),
    },
    leafPhaseIndices: Uint16Array.from({ length: starCount }, (_, index) => index % 3),
    leafRevealOrder: Uint16Array.from({ length: starCount }, (_, index) => starCount - index - 1),
    leafOpacities: Array.from({ length: starCount }, () => "0.6"),
    publish(leafIndex, transform) { writes.push([leafIndex, transform]); },
    publishOpacity(leafIndex, opacity) { opacityWrites.push([leafIndex, opacity]); },
    handoff: true,
    handoffStartCoordinates: prepareFlatHandoffStartCoordinates(starCount),
    rankToPhysical,
    onCycleComplete() { completionCount += 1; },
    requestFrame() { return 1; },
    cancelFrame() {},
  });

  player.publishFrame(0);
  assert.equal(player.stats().visibleLeafCount, starCount);
  assert.equal(writes.length, 0);

  player.publishFrame(30);
  assert.equal(writes.length, starCount);
  assert.equal(new Set(writes.map(([leafIndex]) => leafIndex)).size, starCount);

  player.publishFrame(60);
  assert.equal(writes.length, starCount * 2);
  assert.equal(writes.at(-starCount)[1], "translate(50px,0px) scale(1)");

  player.publishFrame(90);
  assert.equal(writes.length, starCount * 3);

  player.publishFrame(120);
  assert.equal(player.stats().growthComplete, true);
  assert.equal(writes.length, starCount * 4);
  assert.equal(new Set(writes.slice(-starCount).map(([leafIndex]) => leafIndex)).size, starCount);
  assert.deepEqual(writes.slice(-starCount, -starCount + 3), [
    [rankToPhysical[0], "incoming-b"],
    [rankToPhysical[1], "incoming-a"],
    [rankToPhysical[2], "incoming-c"],
  ]);

  player.publishFrame(301);
  assert.equal(player.stats().cycleComplete, true);
  assert.equal(completionCount, 1);
  assert.equal(opacityWrites.length, 0);
  assert.equal(player.captureTerminalPreparedComponents().length, starCount * 3);
});

test("handoff interpolation is deadline-gated to the prepared source cadence", () => {
  const starCount = 2000;
  let now = 0;
  let nextFrame = null;
  let writeCount = 0;
  const player = createChaosPreparedPlayer({
    catalog: { starCount, sampleCount: 3, framesPerSecond: 60, revealSeconds: 3,
      handoffSeconds: 2, holdSeconds: 3, handoffControlPointCount: starCount,
      sourcePhaseOffset: 0 },
    prepared: {
      transforms: ["incoming-a", "incoming-b", "incoming-c"],
      coordinates: new Uint16Array(3 * 3),
      handoffControlCoordinates: new Uint16Array(starCount * 3),
    },
    leafPhaseIndices: new Uint16Array(starCount),
    leafRevealOrder: Uint16Array.from({ length: starCount }, (_, index) => index),
    leafOpacities: Array.from({ length: starCount }, () => "0.6"),
    publish() { writeCount += 1; },
    publishOpacity() {},
    handoff: true,
    handoffStartCoordinates: prepareFlatHandoffStartCoordinates(starCount),
    rankToPhysical: Uint16Array.from({ length: starCount }, (_, rank) => rank),
    onCycleComplete() {},
    readNow() { return now; },
    requestFrame(callback) { nextFrame = callback; return 1; },
    cancelFrame() {},
  });

  player.resume();
  now = 1000 / 120;
  nextFrame(now);
  assert.equal(player.stats().publishedFrame, 0);
  assert.equal(writeCount, 0);
  now = 1000 / 60;
  nextFrame(now);
  assert.equal(player.stats().publishedFrame, 1);
  assert.equal(writeCount, starCount);
  now = 1000 / 40;
  nextFrame(now);
  assert.equal(player.stats().publishedFrame, 1);
  assert.equal(writeCount, starCount);
  now = 1000 / 30;
  nextFrame(now);
  assert.equal(player.stats().publishedFrame, 2);
  assert.equal(writeCount, starCount * 2);
  assert.equal(player.stats().sourceFrameDropCount, 0);
});

function prepareFlatHandoffStartCoordinates(starCount) {
  const coordinates = new Float64Array(starCount * 3);
  for (let rank = 0; rank < starCount; rank += 1) coordinates[rank * 3 + 2] = 1;
  return coordinates;
}
