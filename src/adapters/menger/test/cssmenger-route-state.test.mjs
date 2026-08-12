import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCENE_ID,
  canonicalizeCssmengerRoute,
  createRouteState,
} from "../src/cssmenger/routeState.mjs";
import { selectCssmengerPlaneAtlasProfile } from "../src/cssmenger/profileSelection.mjs";

test("cssmenger route defaults to the first slice", () => {
  const route = createRouteState("");
  assert.equal(route.scene, DEFAULT_SCENE_ID);
  assert.equal(route.manifestUrl, "/cssmenger/manifest.json");
});

test("cssmenger route has no query-selectable product variants", () => {
  const route = createRouteState();
  assert.equal(route.scene, DEFAULT_SCENE_ID);
  assert.equal(Object.hasOwn(route, "params"), false);
  assert.equal(Object.hasOwn(route, "lighting"), false);
});

test("cssmenger strips obsolete query selectors without reloading", () => {
  const calls = [];
  assert.equal(canonicalizeCssmengerRoute({
    location: { search: "?obsolete=1", pathname: "/menger/", hash: "#x" },
    history: { state: { stable: true }, replaceState: (...args) => calls.push(args) },
  }), true);
  assert.deepEqual(calls, [[{ stable: true }, "", "/menger/#x"]]);
});

test("cssmenger profile selection recognizes phones beyond the portrait breakpoint", () => {
  assert.equal(selectCssmengerPlaneAtlasProfile({
    mediaMatches: (query) => query.includes("pointer: coarse"),
  }), "mobile");
  assert.equal(selectCssmengerPlaneAtlasProfile({
    mediaMatches: () => false,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  }), "mobile");
  assert.equal(selectCssmengerPlaneAtlasProfile({
    mediaMatches: () => false,
  }), "desktop");
});
