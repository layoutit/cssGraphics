import assert from "node:assert/strict";
import test from "node:test";
import { validatePolyMorphModel } from "@layoutit/polycss-morph";
import { buildPlatonicPreparedModel } from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
import {
  CSSPLATONIC_FRAME_MILLISECONDS,
  buildPlatonicSourceSequence,
  platonicSolids,
} from "../src/prepare/cssplatonicfolding/sourceModel.mjs";

test("source census and fold angles match the pinned five solids", () => {
  assert.deepEqual(platonicSolids().map((solid) => [solid.id, solid.faceCount, solid.maximumAngle]), [
    ["icosahedron", 20, 41.8103148957786],
    ["dodecahedron", 12, 63.434948822922],
    ["hexahedron", 6, 90],
    ["octahedron", 8, 70.5287793655093],
    ["tetrahedron", 4, 109.4712206344907],
  ]);
});

test("prepared source sequence is deterministic and follows source cadence", () => {
  const first = buildPlatonicSourceSequence();
  const second = buildPlatonicSourceSequence();
  assert.deepEqual(first, second);
  assert.equal(first.faceDefinitions.length, 50);
  assert.equal(first.frames.length, 2_710);
  assert.equal(first.durationMilliseconds, first.frames.length * CSSPLATONIC_FRAME_MILLISECONDS);
  assert.equal(first.frames[0].solidId, "icosahedron");
  assert.equal(first.frames.at(-1).solidId, "tetrahedron");
  assert.notDeepEqual(first.frames[180].faces[1].matrix, first.frames[270].faces[1].matrix);
  assert.ok(first.faceDefinitions.every((face) => face.lightPalette.length === 64));
  assert.ok(first.frames.every((frame) => frame.faces.every((face) =>
    Number.isInteger(face.lightRow) && face.lightRow >= 0 && face.lightRow < 64)));
});

test("prepared lighting preserves source specular and perspective-facing back sides", () => {
  const source = buildPlatonicSourceSequence();
  const face = source.faceDefinitions.find((candidate) =>
    candidate.solidId === "icosahedron" && candidate.faceIndex === 12);
  const highlighted = source.frames[225].faces[12].lightColor;
  const backFacing = source.frames[235].faces[12].lightColor;
  assert.equal(highlighted[0], 1);
  assert.equal(highlighted[2], 1);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(backFacing[channel] - face.color[channel] * 0.5) < 1e-12);
  }
});

test("Morph package retains one raster leaf per source face", () => {
  const prepared = buildPlatonicPreparedModel();
  const model = validatePolyMorphModel(prepared.model);
  assert.equal(model.render.shapes.length, 50);
  assert.equal(model.render.leaves.length, 50);
  assert.ok(model.render.leaves.every((leaf) => leaf.strategy === "atlas-slice"));
  assert.ok(model.render.leaves.every((leaf) => leaf.atlas?.resourcePath === "assets/face-colors.png"));
  assert.equal(model.playback.frames.length, 2_710);
  assert.equal(model.playback.frames[0].leaves.length, 50);
  assert.equal(prepared.metrics.maximumVisibleLeaves, 20);
  assert.equal(prepared.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(prepared.metrics.runtimeDomGrowth, false);
});

test("mobile changes travel direction without changing topology", () => {
  const desktop = buildPlatonicPreparedModel({ bankId: "desktop" });
  const mobile = buildPlatonicPreparedModel({ bankId: "mobile" });
  assert.equal(desktop.model.render.leaves.length, mobile.model.render.leaves.length);
  assert.notDeepEqual(desktop.model.playback.frames[0].modelMatrix, mobile.model.playback.frames[0].modelMatrix);
});
