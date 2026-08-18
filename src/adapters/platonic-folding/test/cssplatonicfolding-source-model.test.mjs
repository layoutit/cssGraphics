import assert from "node:assert/strict";
import test from "node:test";
import { formatMatrix3dValues } from "@layoutit/polycss";
import { validatePolyMorphModel } from "@layoutit/polycss-morph";
import {
  buildPlatonicPreparedModel,
  buildPlatonicPreparedPlayback,
} from "../src/prepare/cssplatonicfolding/modelBuilder.mjs";
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

test("static Morph package retains one raster leaf per source face", () => {
  const prepared = buildPlatonicPreparedModel();
  const model = validatePolyMorphModel(prepared.model);
  assert.equal(model.profile, "static-prepared");
  assert.equal(model.render.shapes.length, 50);
  assert.equal(model.render.leaves.length, 50);
  assert.ok(model.render.leaves.every((leaf) => leaf.strategy === "atlas-slice"));
  assert.ok(model.render.leaves.every((leaf) => leaf.atlas?.resourcePath === "assets/face-colors.png"));
  assert.equal(model.playback, null);
  assert.equal(prepared.metrics.maximumVisibleLeaves, 20);
  assert.equal(prepared.metrics.runtimeGeometryConstructionCount, 0);
  assert.equal(prepared.metrics.runtimeDomGrowth, false);
});

test("prepared DOM playback contains sparse source-ordered operations only", () => {
  const { playback, metrics } = buildPlatonicPreparedPlayback();
  assert.equal(playback.frames.length, 2_710);
  assert.equal(playback.frames[0][3].length, 30);
  assert.equal(playback.shapeCount, 50);
  assert.equal(playback.leafCount, 50);
  assert.equal(metrics.loopHiddenShapeTransformSelections, 0);
  assert.equal(metrics.loopHiddenAtlasRowSelections, 0);
  assert.ok(playback.frames.every((row) => row.length === 5));
  assert.ok(playback.frames.every((row) => row[1].length % 2 === 0 && row[2].length % 2 === 0));
  assert.ok(playback.transforms.every((transform) => /^matrix3d\([^)]+\)$/u.test(transform)));
});

test("sparse playback reconstructs every visible source frame and the loop boundary", () => {
  const { source, playback } = buildPlatonicPreparedPlayback();
  let modelTransformIndex = playback.mounted.modelTransformIndex;
  const shapeTransformIndices = [...playback.mounted.shapeTransformIndices];
  const atlasRows = [...playback.mounted.atlasRows];
  const visibility = [...playback.mounted.visibility];
  for (let frameIndex = 0; frameIndex < playback.frameCount; frameIndex += 1) {
    applyRow(playback.frames[frameIndex]);
    assertFrame(source.frames[frameIndex]);
  }
  applyRow(playback.wrap);
  assertFrame(source.frames[0]);

  function applyRow(row) {
    for (const leafIndex of row[3]) visibility[leafIndex] = 0;
    if (row[0] >= 0) modelTransformIndex = row[0];
    for (let index = 0; index < row[1].length; index += 2) {
      shapeTransformIndices[row[1][index]] = row[1][index + 1];
    }
    for (let index = 0; index < row[2].length; index += 2) {
      atlasRows[row[2][index]] = row[2][index + 1];
    }
    for (const leafIndex of row[4]) visibility[leafIndex] = 1;
  }

  function assertFrame(frame) {
    assert.equal(playback.transforms[modelTransformIndex], matrixText(frame.modelMatrix));
    for (let faceIndex = 0; faceIndex < source.faceDefinitions.length; faceIndex += 1) {
      const face = source.faceDefinitions[faceIndex];
      const active = face.solidId === frame.solidId;
      assert.equal(visibility[faceIndex], Number(active));
      if (!active) continue;
      const sample = frame.faces[face.faceIndex];
      assert.equal(playback.transforms[shapeTransformIndices[faceIndex]], matrixText(sample.matrix));
      assert.equal(atlasRows[faceIndex], sample.lightRow);
    }
  }
});

test("mobile changes travel direction without changing prepared topology", () => {
  const desktop = buildPlatonicPreparedPlayback({ bankId: "desktop" }).playback;
  const mobile = buildPlatonicPreparedPlayback({ bankId: "mobile" }).playback;
  assert.equal(desktop.shapeCount, mobile.shapeCount);
  assert.equal(desktop.leafCount, mobile.leafCount);
  assert.notEqual(
    desktop.transforms[desktop.frames[0][0]],
    mobile.transforms[mobile.frames[0][0]],
  );
});

function matrixText(matrix) {
  return `matrix3d(${formatMatrix3dValues(matrix)})`;
}
