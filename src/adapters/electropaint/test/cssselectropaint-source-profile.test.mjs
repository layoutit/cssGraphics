// SPDX-License-Identifier: GPL-2.0-only
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  buildPreparedElectropaintScene,
  serializePreparedElectropaintChunk,
} from "../src/prepare/cssselectropaint/sceneBuilder.mjs";
import { decodePreparedElectropaintTransformSchedule } from
  "../src/cssselectropaint/preparedPlayback.mjs";

const authorities = Object.freeze({
  kentReference: Object.freeze({
    repository: "https://github.com/srirangav/electropaintosx",
    commit: "3be67ea1562c0df573edc21e8bfa9f88e62b5b38",
  }),
  ralphReference: Object.freeze({
    repository: "https://github.com/iamralpht/elektropaintjs",
    commit: "12d5f43ab34f26eb388651de3b870800972ac96c",
  }),
  browserReference: Object.freeze({
    repository: "https://github.com/oppegard/electropaint",
    commit: "714092ad588e668bee9eb66dfdc94c66f516452b",
  }),
  sha256: Object.freeze({}),
});

const chunks = [];
const scene = buildPreparedElectropaintScene(authorities, {
  chunkCount: 20,
  framesPerChunk: 500,
  emitChunk(chunk) {
    chunks.push(chunk);
    return serializePreparedElectropaintChunk(chunk).descriptor;
  },
});

test("prepared Kent motion is one continuous forty-wing stream split into seamless chunks", () => {
  assert.equal(scene.schema, "cssselectropaint-prepared-scene@2");
  assert.equal(scene.id, "default-kent");
  assert.equal(scene.mode, "model-viewer");
  assert.equal(scene.artifactMode, "prepared-polycss-snapshot-plus-timeline-chunks");
  assert.equal(scene.meshes.length, 40);
  assert.ok(scene.meshes.every((mesh) => mesh.polygons.length === 1));
  assert.equal(scene.sourceProfile.motion, "Kent Rosenkoetter random-walk clone");
  assert.equal(scene.sourceProfile.deterministicPreparationSeed, "0x45504a53");
  assert.equal(scene.sourceProfile.visibleSquareCount, 40);
  assert.equal(scene.playback.schema, "cssselectropaint-prepared-playback@4");
  assert.equal(scene.playback.stateCount, 10_000);
  assert.equal(scene.playback.sourceFrameDelayMilliseconds, 1_000 / 60);
  assert.deepEqual(scene.playback.presentationCadence, {
    policy: "fixed-kent-animation-interval",
    dynamic: false,
    statesPerDisplay: 1,
    sourceTicksPerSecond: 60,
    sourceFrameDelayMilliseconds: 1_000 / 60,
    sourceLoopCadence: "one-kent-random-walk-step-per-60hz-animation-callback",
    runtimeSelection: "single-constant-frame-period-no-cadence-table",
    effectiveMeanStatesPerSecond: 60,
    totalDurationMilliseconds: 166_666.6666666667,
  });
  assert.equal(scene.playback.cadenceSchedule, undefined);
  assert.equal(scene.playback.rootTransforms, undefined);
  assert.equal(scene.playback.rootTransform, "translateY(135px) rotateX(45deg)");
  assert.equal(scene.playback.initial.leafTransforms.length, 40);
  assert.equal(scene.playback.initial.colorIndices.length, 40);
  assert.equal(
    scene.playback.initial.leafTransforms[0],
    "matrix3d(1,0.002,-0.001,0,-0.002,1,-0.001,0,0.001,0.001,1,0,0.026,0,4.32,1)",
  );
  assert.deepEqual(scene.playback.palette.slice(0, 3), [
    { fill: "rgb(0 1 1)", outline: "rgb(255 255 255)", className: "c00000" },
    { fill: "rgb(0 3 3)", outline: "rgb(255 255 255)", className: "c00001" },
    { fill: "rgb(0 6 5)", outline: "rgb(255 255 255)", className: "c00002" },
  ]);
  assert.ok(scene.playback.palette.every(({ className }, index) =>
    className === `c${String(index).padStart(5, "0")}`));
  assert.equal(scene.playback.chunks.schema, "cssselectropaint-prepared-timeline-chunks@1");
  assert.equal(scene.playback.chunks.continuity, "single-prepared-state-stream-split-without-inner-resets");
  assert.equal(scene.playback.chunks.count, 20);
  assert.equal(scene.playback.chunks.framesPerChunk, 500);
  assert.equal(scene.playback.chunks.runtimeLookaheadChunkCount, 4);
  assert.equal(scene.playback.chunks.descriptors.length, 20);
  assert.ok(chunks.every((chunk) =>
    chunk.transformSchedule.schema === "cssselectropaint-prepared-chunk-transform-schedule@2" &&
    chunk.transformSchedule.affineQuantizationScale === 1_000 &&
    chunk.transformSchedule.affinePredictorOrder === 3 &&
    chunk.transformSchedule.transforms === undefined));
  assert.equal(scene.playback.metrics.transformAssignmentCount, 399_960);
  assert.equal(scene.playback.metrics.colorAssignmentCount, 9_406);
  assert.equal(scene.playback.metrics.maximumTransformAssignmentsPerSequentialState, 40);
  assert.equal(scene.playback.metrics.maximumColorAssignmentsPerSequentialState, 1);
  assert.equal(scene.playback.metrics.innerChunkBoundaryResetCount, 0);
  assert.equal(scene.playback.metrics.meanTransformAssignmentsPerSequentialState, 40);
  assert.equal(scene.playback.metrics.meanColorAssignmentsPerSequentialState, 9_406 / 9_999);
  assert.equal(scene.playback.restart.transformCount, 40);
  assert.equal(scene.playback.restart.colorCount, 40);
  assert.deepEqual(scene.oracle.randomStateWitnesses, [
    { stateIndex: 0, randomState: 2_298_678_757 },
    { stateIndex: 39, randomState: 1_035_007_417 },
    { stateIndex: 359, randomState: 19_524_565 },
    { stateIndex: 1_199, randomState: 3_227_491_512 },
    { stateIndex: 9_999, randomState: 2_651_106_033 },
  ]);
  assert.equal(scene.playback.outline.invariant, true);
  assert.equal(scene.playback.outline.runtimeWrites, 0);
  assert.equal(scene.renderer.stableDom, true);
  assert.equal(scene.renderer.preparedFlatPolycssQuadLeaves, true);
  assert.equal(scene.metrics.preparedRetainedQuadCount, 40);
  assert.equal(scene.renderer.alternateRenderer, false);
  assert.equal(scene.renderer.runtimeGeometryConstruction, false);
  assert.equal(scene.renderer.runtimeMatrixCalculation, false);
  assert.equal(scene.renderer.runtimeColorCalculation, false);
  assert.equal(scene.renderer.runtimeRandomGeneration, false);
  assert.equal(scene.renderer.runtimeCameraCalculation, false);
  assert.equal(scene.renderer.runtimeCadenceCalculation, false);
  assert.equal(scene.oracle.nativeBrowserVisualParity, "not-claimed");
});

test("every inner chunk boundary is an ordinary sparse state transition with no reset or no-op writes", () => {
  const transforms = [...scene.playback.initial.leafTransforms];
  const colors = [...scene.playback.initial.colorIndices];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const decodedTransforms = decodePreparedElectropaintTransformSchedule(
      chunk.transformSchedule,
      chunk.stateCount,
      40,
    );
    const transformIndices = new Uint8Array(Buffer.from(
      chunk.transformSchedule.physicalIndicesBase64, "base64",
    ));
    const colorIndices = new Uint8Array(Buffer.from(
      chunk.colorSchedule.physicalIndicesBase64, "base64",
    ));
    const colorBytes = Buffer.from(chunk.colorSchedule.colorIndicesBase64, "base64");
    const paletteIndices = Array.from({ length: colorBytes.length / 2 }, (_, index) =>
      colorBytes.readUInt16LE(index * 2));
    for (let localStateIndex = chunkIndex === 0 ? 1 : 0;
      localStateIndex < chunk.stateCount; localStateIndex += 1) {
      const transformStart = chunk.transformSchedule.offsets[localStateIndex];
      const transformEnd = chunk.transformSchedule.offsets[localStateIndex + 1];
      const colorStart = chunk.colorSchedule.offsets[localStateIndex];
      const colorEnd = chunk.colorSchedule.offsets[localStateIndex + 1];
      assert.equal(transformEnd - transformStart, 40);
      assert.ok(colorEnd - colorStart <= 1);
      for (let assignment = transformStart; assignment < transformEnd; assignment += 1) {
        const physicalIndex = transformIndices[assignment];
        assert.notEqual(transforms[physicalIndex], decodedTransforms.transforms[assignment]);
        transforms[physicalIndex] = decodedTransforms.transforms[assignment];
      }
      for (let assignment = colorStart; assignment < colorEnd; assignment += 1) {
        const physicalIndex = colorIndices[assignment];
        assert.notEqual(colors[physicalIndex], paletteIndices[assignment]);
        colors[physicalIndex] = paletteIndices[assignment];
      }
      if (localStateIndex === 0) {
        assert.deepEqual(transforms, chunk.initial.leafTransforms);
        assert.deepEqual(colors, chunk.initial.colorIndices);
      }
    }
  }
  for (let physicalIndex = 0; physicalIndex < 40; physicalIndex += 1) {
    assert.notEqual(transforms[physicalIndex], scene.playback.restart.leafTransforms[physicalIndex]);
    assert.notEqual(colors[physicalIndex], scene.playback.restart.colorIndices[physicalIndex]);
  }
});
