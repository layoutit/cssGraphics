import assert from "node:assert/strict";
import test from "node:test";
import {
  createRouteState,
  publicRouteFor,
  sceneEntryForRoute,
} from "../src/cssgears/routeState.mjs";

const manifest = Object.freeze({
  defaultScene: Object.freeze({ id: "fixed-non-planetary" }),
  preparedBank: Object.freeze({ sceneIds: Object.freeze(["fixed-non-planetary", "seed-26080608", "seed-26080609"]) }),
  scenes: Object.freeze([
    Object.freeze({ id: "fixed-non-planetary" }),
    Object.freeze({ id: "seed-26080608" }),
    Object.freeze({ id: "seed-26080609" }),
  ]),
});

test("cssgears route defaults to one startup selection from the prepared bank", () => {
  const route = createRouteState("");
  assert.equal(route.scene, null);
  assert.equal(route.selection, "random-prepared-shuffled-bank");
  assert.equal(route.manifestUrl, "/cssgears/manifest.json");
  assert.equal(publicRouteFor({ scene: route.scene }), "/");
  assert.equal(sceneEntryForRoute(manifest, route, 0).id, "fixed-non-planetary");
  assert.equal(sceneEntryForRoute(manifest, route, 1).id, "seed-26080608");
  assert.equal(sceneEntryForRoute(manifest, route, 2).id, "seed-26080609");
  assert.equal(sceneEntryForRoute(manifest, route, 0xffffffff).id, "fixed-non-planetary");
});

test("cssgears route accepts safe scene ids", () => {
  const route = createRouteState("?scene=demo-room_01");
  assert.equal(route.scene, "demo-room_01");
  assert.equal(route.selection, "explicit-prepared-scene");
  assert.equal(publicRouteFor({ scene: route.scene }), "/?scene=demo-room_01");
});

test("cssgears route rejects unsafe scene ids", () => {
  const route = createRouteState("?scene=../../retail");
  assert.equal(route.scene, null);
  assert.equal(route.selection, "random-prepared-shuffled-bank");
});

test("cssgears explicit routes pin one prepared bank entry for oracle work", () => {
  const route = createRouteState("?scene=seed-26080609");
  assert.equal(sceneEntryForRoute(manifest, route, 1).id, "seed-26080609");
});

test("cssgears does not carry an unknown-scene compatibility fallback", () => {
  const route = createRouteState("?scene=missing-scene");
  assert.equal(sceneEntryForRoute(manifest, route, 0), null);
});
