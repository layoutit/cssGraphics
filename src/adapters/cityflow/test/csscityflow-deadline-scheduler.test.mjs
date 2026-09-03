// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import { createCityflowDeadlineScheduler } from "../src/csscityflow/deadlineScheduler.mjs";

test("publishes only the next prepared state and resets a missed deadline", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 20,
    publishDue(tick, due) { publications.push({ tick, due }); },
    ...harness.overrides,
  });

  scheduler.resume();
  scheduler.resume();
  assert.equal(harness.frames.size, 1, "resume must not double-schedule");
  harness.now = 116;
  harness.runFrame(116);
  assert.deepEqual(publications, [{ tick: 1, due: 1 }]);
  harness.now = 120;
  harness.runFrame(120);
  assert.deepEqual(
    publications,
    [{ tick: 1, due: 1 }],
    "the immediate first publication must restart the full deadline interval",
  );

  harness.now = 181;
  harness.runFrame(181);
  assert.deepEqual(publications.at(-1), { tick: 2, due: 1 });
  assert.equal(scheduler.stats().preparedStateSkipCount, 0);
  assert.equal(scheduler.stats().lateDeadlineResetCount, 1);
  assert.equal(scheduler.stats().timerCallbackCount, 0);
  assert.equal(scheduler.stats().animationFrameCallbackCount, 3);
  assert.equal(scheduler.stats().schedulerTimeSource,
    "maximum-animation-frame-timestamp-and-callback-delivery");
  assert.equal(scheduler.stats().resumePublicationPolicy,
    "first-animation-frame-immediate-then-deadline-paced");
  assert.equal(scheduler.stats().earlyDeadlineToleranceMilliseconds, 5);

  harness.now = 190;
  harness.runFrame(190);
  assert.equal(publications.length, 2, "an early callback after resync must not duplicate motion");
  harness.now = 201;
  harness.runFrame(201);
  assert.deepEqual(publications.at(-1), { tick: 3, due: 1 });

  scheduler.pause();
  assert.equal(harness.frames.size, 0);
  assert.equal(scheduler.stats().paused, true);
});

test("uses callback delivery time when the animation-frame timestamp stalls", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 50 / 3,
    publishDue(tick) { publications.push(tick); },
    ...harness.overrides,
  });

  scheduler.resume();
  harness.now = 101;
  harness.runFrame(100);
  assert.deepEqual(publications, [1]);

  harness.now = 117.7;
  harness.runFrame(100);
  assert.deepEqual(
    publications,
    [1, 2],
    "a normally delivered callback must not be discarded because its presentation timestamp stalled",
  );

  harness.now = 117.8;
  harness.runFrame(100);
  assert.deepEqual(publications, [1, 2]);
  assert.equal(scheduler.stats().preparedStateSkipCount, 0);
});

test("does not republish a prepared state for two callbacks in one delivery interval", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 50 / 3,
    publishDue(tick) { publications.push(tick); },
    ...harness.overrides,
  });

  scheduler.resume();
  harness.now = 101;
  harness.runFrame(101);
  assert.deepEqual(publications, [1]);

  harness.now = 104.053;
  harness.runFrame(101);
  assert.deepEqual(
    publications,
    [1],
    "a due animation-frame timestamp delivered 3.053 ms later must not republish",
  );
  harness.now = 117.7;
  harness.runFrame(117.7);
  assert.deepEqual(publications, [1, 2], "the next spaced callback must publish the next state");
  assert.equal(scheduler.stats().preparedStateSkipCount, 0);
  assert.equal(scheduler.stats().publicationPacingTimeSource, "adjacent-state-deadline-schedule");
});

test("accepts the next display callback when delivery is slightly ahead of the shifted deadline", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 50 / 3,
    publishDue(tick) { publications.push(tick); },
    ...harness.overrides,
  });

  scheduler.resume();
  harness.now = 100.599;
  harness.runFrame(100);
  assert.deepEqual(publications, [1]);

  harness.now = 103.758;
  harness.runFrame(103.758);
  assert.deepEqual(publications, [1], "a same-vsync callback must remain suppressed");

  harness.now = 114.83;
  harness.runFrame(114.819);
  assert.deepEqual(
    publications,
    [1, 2],
    "the next display callback must not become a held presentation frame",
  );
});

test("rescues a normal-cadence callback after deadline phase drift and rephases once", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 50 / 3,
    publishDue(tick) { publications.push(tick); },
    ...harness.overrides,
  });

  scheduler.resume();
  for (const timestamp of [100, 115.436, 130.872, 146.308]) {
    harness.now = timestamp;
    harness.runFrame(timestamp);
  }
  assert.deepEqual(publications, [1, 2, 3, 4]);

  harness.now = 161.744;
  harness.runFrame(161.744);
  assert.deepEqual(
    publications,
    [1, 2, 3, 4, 5],
    "a callback 15.436 ms after the last publication must not create a 33 ms hold",
  );

  harness.now = 164.903;
  harness.runFrame(164.903);
  assert.deepEqual(publications, [1, 2, 3, 4, 5], "a 3.159 ms duplicate must remain suppressed");

  harness.now = 177.18;
  harness.runFrame(177.18);
  assert.deepEqual(publications, [1, 2, 3, 4, 5, 6]);
  assert.equal(scheduler.stats().displayPhaseResyncCount, 1);
  assert.equal(scheduler.stats().earlyCallbackCount, 1);
  assert.equal(scheduler.stats().minimumDistinctPublicationSpacingMilliseconds, 12.5);
});

test("keeps the accumulated deadline cadence on a 90 Hz callback stream", () => {
  const harness = createHarness();
  const publications = [];
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 50 / 3,
    publishDue(tick) { publications.push(tick); },
    ...harness.overrides,
  });

  scheduler.resume();
  for (let callbackIndex = 0; callbackIndex < 19; callbackIndex += 1) {
    const timestamp = 100 + callbackIndex * (1000 / 90);
    harness.now = timestamp;
    harness.runFrame(timestamp);
  }

  assert.equal(publications.length, 13, "90 Hz callbacks must remain paced near 60 Hz, not 45 Hz");
  assert.equal(scheduler.stats().displayPhaseResyncCount, 0);
});

test("seek resets the deadline without changing pause state", () => {
  const harness = createHarness();
  const scheduler = createCityflowDeadlineScheduler({
    frameMilliseconds: 20,
    publishDue() {},
    ...harness.overrides,
  });
  assert.equal(scheduler.seekTick(19).tick, 19);
  assert.equal(harness.frames.size, 0);
  scheduler.resume();
  assert.equal(harness.frames.size, 1);
  harness.now = 300;
  const stats = scheduler.seekTick(7);
  assert.equal(stats.tick, 7);
  assert.equal(stats.paused, false);
  assert.equal(harness.frames.size, 1);
  assert.throws(() => scheduler.seekTick(-1), /out of range/u);
  scheduler.destroy();
});

function createHarness() {
  let nextId = 1;
  const frames = new Map();
  const harness = {
    now: 100,
    frames,
    overrides: {
      readNow: () => harness.now,
      requestFrame(callback) {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id) { frames.delete(id); },
    },
    runFrame(timestamp) { take(frames)(timestamp); },
  };
  return harness;
}

function take(queue) {
  const [id, value] = queue.entries().next().value ?? [];
  if (id === undefined) throw new Error("Expected a queued callback");
  queue.delete(id);
  return value;
}
