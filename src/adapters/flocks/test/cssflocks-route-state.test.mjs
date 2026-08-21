import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFlocksRoute } from "../src/cssflocks/routeState.mjs";
import { selectFlocksPreparedProfile } from "../src/cssflocks/profileSelection.mjs";

const manifest = Object.freeze({
  status: "ready",
  defaultScene: "flocks-default",
  scenes: Object.freeze([Object.freeze({ id: "flocks-default", url: "/cssflocks/scenes/flocks-default.json" })]),
});

test("no-param Flocks route resolves only through the manifest default", () => {
  assert.deepEqual(resolveFlocksRoute({ search: "", manifest }), {
    sceneId: "flocks-default", startupWindowId: null, paletteVariantId: null, mode: "manifest-default",
  });
  assert.deepEqual(resolveFlocksRoute({ search: "?window=source-114s", manifest }), {
    sceneId: "flocks-default", startupWindowId: "source-114s", paletteVariantId: null, mode: "explicit-presentation",
  });
  assert.deepEqual(resolveFlocksRoute({ search: "?window=source-114s&palette=rotate-120", manifest }), {
    sceneId: "flocks-default", startupWindowId: "source-114s", paletteVariantId: "rotate-120", mode: "explicit-presentation",
  });
  assert.throws(() => resolveFlocksRoute({ search: "?scene=fake", manifest }), /only one startup window/u);
  assert.throws(() => resolveFlocksRoute({ search: "?palette=sepia", manifest }), /palette selector is invalid/u);
  assert.throws(() => resolveFlocksRoute({ search: "?palette=rotate-120&palette=rotate-150", manifest }), /only one startup window/u);
});

test("Flocks startup profile selection is bounded and startup-only", () => {
  assert.equal(selectFlocksPreparedProfile({ width: 1_200, coarsePointer: false }), "desktop");
  assert.equal(selectFlocksPreparedProfile({ width: 390, coarsePointer: false }), "mobile");
  assert.equal(selectFlocksPreparedProfile({ width: 1_200, coarsePointer: true }), "mobile");
});
