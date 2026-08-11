import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCENE_ID,
  createRouteState,
  publicRouteFor,
} from "../src/cssmenger/routeState.mjs";
import { selectCssmengerPlaneAtlasProfile } from "../src/cssmenger/profileSelection.mjs";

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

test("cssmenger profile selection supports explicit preview overrides", () => {
  assert.equal(selectCssmengerPlaneAtlasProfile({
    search: "?profile=mobile",
    mediaMatches: () => false,
  }), "mobile");
  assert.equal(selectCssmengerPlaneAtlasProfile({
    search: "?profile=desktop",
    mediaMatches: () => true,
    userAgentDataMobile: true,
  }), "desktop");
});

test("cssmenger profile selection recognizes phones beyond the portrait breakpoint", () => {
  assert.equal(selectCssmengerPlaneAtlasProfile({
    search: "",
    mediaMatches: (query) => query.includes("pointer: coarse"),
  }), "mobile");
  assert.equal(selectCssmengerPlaneAtlasProfile({
    search: "",
    mediaMatches: () => false,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  }), "mobile");
  assert.equal(selectCssmengerPlaneAtlasProfile({
    search: "",
    mediaMatches: () => false,
  }), "desktop");
});
