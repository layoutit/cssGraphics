import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCENE_ID,
  createRouteState,
  publicRouteFor,
} from "../src/cssmenger/routeState.mjs";

test("cssmenger route defaults to the first slice", () => {
  const route = createRouteState("");
  assert.equal(route.scene, DEFAULT_SCENE_ID);
  assert.equal(route.manifestUrl, "/cssmenger/manifest.json");
});

test("cssmenger route accepts safe scene ids", () => {
  const route = createRouteState("?scene=demo-room_01");
  assert.equal(route.scene, "demo-room_01");
  assert.equal(publicRouteFor({ scene: route.scene }), "/?scene=demo-room_01");
});

test("cssmenger route rejects unsafe scene ids", () => {
  const route = createRouteState("?scene=../../retail");
  assert.equal(route.scene, DEFAULT_SCENE_ID);
});
