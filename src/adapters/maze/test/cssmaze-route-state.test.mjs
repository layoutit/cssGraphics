import assert from "node:assert/strict";
import test from "node:test";
import { createRouteState, validSceneId } from "../src/cssmaze/routeState.mjs";

test("default route delegates to startup random prepared-bank selection", () => {
  assert.deepEqual(createRouteState("https://example.test/"), {
    requestedScene: null,
    scene: null,
    explicitScene: false,
    selection: "startup-random-common-loop-low-consecutive-turn-prepared-scene",
  });
});

test("clean prepared scene ids can be pinned", () => {
  assert.equal(validSceneId("default-maze"), true);
  assert.equal(validSceneId("seed-26081048"), true);
  assert.equal(validSceneId("../synthetic"), false);
  assert.deepEqual(createRouteState("https://example.test/?scene=default-maze"), {
    requestedScene: "default-maze",
    scene: "default-maze",
    explicitScene: true,
    selection: "explicit-prepared-scene",
  });
  assert.deepEqual(createRouteState("https://example.test/?scene=../synthetic"), {
    requestedScene: null,
    scene: null,
    explicitScene: false,
    selection: "startup-random-common-loop-low-consecutive-turn-prepared-scene",
  });
});
