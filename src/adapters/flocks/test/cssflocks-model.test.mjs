import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CSSFLOCKS_FACE_INDICES,
  CSSFLOCKS_FACE_LIGHT_FACTORS,
  buildFlocksPreparedModel,
} from "../src/prepare/cssflocks/modelBuilder.mjs";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceSequence,
  selectFlocksProductPrefix,
} from "../src/prepare/cssflocks/sourceModel.mjs";

const bank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  warmupFrames: 0,
  frameCount: 1,
  blockFrameCount: 1,
});

test("Flocks geometry-one prepares one triangular bipyramid per product bug", () => {
  const source = selectFlocksProductPrefix(
    buildFlocksSourceSequence({ bank }),
    CSSFLOCKS_PRODUCT_PROFILES.mobile,
  );
  const prepared = buildFlocksPreparedModel({ source });
  assert.equal(CSSFLOCKS_FACE_INDICES.length, 6);
  assert.equal(prepared.model.render.shapes.length, 164);
  assert.equal(prepared.model.render.leaves.length, 984);
  assert.equal(prepared.model.topology.vertices.length, 820);
  assert.equal(prepared.model.topology.polygons.length, 984);
  assert.ok(prepared.model.render.leaves.every((leaf) =>
    leaf.strategy === "solid-triangle" && leaf.atlas === null && leaf.fallback === null));
  assert.equal(new Set(prepared.model.render.leaves.map((leaf) => leaf.shapeId)).size, 164);
});

test("prepared Flocks model records source provenance and zero-runtime geometry", () => {
  const source = selectFlocksProductPrefix(
    buildFlocksSourceSequence({ bank }),
    CSSFLOCKS_PRODUCT_PROFILES.desktop,
  );
  const prepared = buildFlocksPreparedModel({ source });
  assert.equal(prepared.model.identity.id, "flocks");
  assert.equal(prepared.model.provenance.sources[0].license, "GPL-2.0-or-later");
  assert.equal(prepared.metrics.sourceDefaultBugCount, 1_004);
  assert.equal(prepared.metrics.retainedBugRootCount, 324);
  assert.equal(prepared.metrics.retainedPolygonLeafCount, 1_944);
  assert.equal(prepared.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(prepared.metrics.runtimeAtlasRasterizationCount, 0);
  assert.equal(prepared.metrics.runtimeDomGrowth, false);
  assert.deepEqual(prepared.metrics.flatLightingFactors, CSSFLOCKS_FACE_LIGHT_FACTORS);
  assert.ok(CSSFLOCKS_FACE_LIGHT_FACTORS.every((factor) => factor >= 0.75 && factor <= 1));
});
