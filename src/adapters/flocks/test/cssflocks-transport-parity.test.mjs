import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  CSSFLOCKS_BUG_VERTICES,
} from "../src/prepare/cssflocks/modelBuilder.mjs";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceBlocks,
  selectFlocksProductPrefix,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { buildFlocksBugMatrix } from "../src/shared/cssflocks/bugTransform.mjs";
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  decodeFlocksPreparedSourceValues,
  encodeFlocksPreparedBlock,
} from "../src/shared/cssflocks/preparedBlockTransport.mjs";

test("checkpoint-delta transport stays inside source-state and visible-projection tolerances", { timeout: 60_000 }, () => {
  const qualificationBank = Object.freeze({
    ...CSSFLOCKS_SOURCE_BANK,
    frameCount: 12 * CSSFLOCKS_SOURCE_BANK.framesPerSecond,
  });
  const metrics = {};
  const profileStates = Object.values(CSSFLOCKS_PRODUCT_PROFILES).map((profile) => ({
    profile,
    viewport: profile.id === "desktop" ? [1280, 720] : [390, 844],
    maxPositionError: 0,
    maxVelocityError: 0,
    maxHueError: 0,
    maxProjectedPixelError: 0,
    visibleProjectedVertexCount: 0,
    encodedByteLength: 0,
  }));
  for (const sourceBlock of buildFlocksSourceBlocks({ bank: qualificationBank })) {
    for (const state of profileStates) {
      const selected = selectFlocksProductPrefix(sourceBlock, state.profile);
      const bytes = encodeFlocksPreparedBlock({
        frames: selected.frames,
        bugCount: state.profile.bugCount,
        framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
      });
      state.encodedByteLength += gzipSync(bytes, { level: 9 }).byteLength;
      const descriptor = {
        index: sourceBlock.bank.blockIndex,
        startFrameIndex: sourceBlock.bank.startFrameIndex,
        frameCount: sourceBlock.bank.blockFrameCount,
        encoding: CSSFLOCKS_BLOCK_ENCODING,
        decodedByteLength: bytes.byteLength,
      };
      const catalog = {
        streamId: state.profile.id,
        modelId: state.profile.modelId,
        bugCount: state.profile.bugCount,
        leafCount: state.profile.bugCount * 6,
        framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
        frameMilliseconds: CSSFLOCKS_SOURCE_BANK.frameMilliseconds,
        playbackSchema: CSSFLOCKS_PLAYBACK_SCHEMA,
      };
      const decoded = decodeFlocksPreparedSourceValues(bytes, descriptor, catalog);
      for (let frameIndex = 0; frameIndex < selected.frames.length; frameIndex += 1) {
        const frame = selected.frames[frameIndex];
        for (let bugIndex = 0; bugIndex < state.profile.bugCount; bugIndex += 1) {
          const bug = frame.bugs[bugIndex];
          const offset = (frameIndex * state.profile.bugCount + bugIndex) * 7;
          const position = Array.from(decoded.subarray(offset, offset + 3));
          const velocity = Array.from(decoded.subarray(offset + 3, offset + 6));
          const hue = decoded[offset + 6];
          state.maxPositionError = Math.max(state.maxPositionError,
            ...position.map((value, axis) => Math.abs(value - bug.position[axis])));
          state.maxVelocityError = Math.max(state.maxVelocityError,
            ...velocity.map((value, axis) => Math.abs(value - bug.velocity[axis])));
          const hueError = Math.abs(hue - bug.hue);
          state.maxHueError = Math.max(state.maxHueError, Math.min(hueError, 1 - hueError));
          const sourceMatrix = bug.matrix;
          const decodedMatrix = buildFlocksBugMatrix(position, velocity, CSSFLOCKS_SOURCE.stretch).matrix;
          for (const vertex of CSSFLOCKS_BUG_VERTICES) {
            const sourcePixel = projectVisible(vertex, sourceMatrix, ...state.viewport);
            if (sourcePixel === null) continue;
            const decodedPixel = projectVisible(vertex, decodedMatrix, ...state.viewport, false);
            assert.notEqual(decodedPixel, null, "a visible source vertex crossed the camera plane after decoding");
            state.visibleProjectedVertexCount += 1;
            state.maxProjectedPixelError = Math.max(state.maxProjectedPixelError,
              Math.abs(decodedPixel[0] - sourcePixel[0]), Math.abs(decodedPixel[1] - sourcePixel[1]));
          }
        }
      }
    }
  }
  for (const state of profileStates) {
    metrics[state.profile.id] = {
      maxPositionError: state.maxPositionError,
      maxVelocityError: state.maxVelocityError,
      maxHueError: state.maxHueError,
      maxProjectedPixelError: state.maxProjectedPixelError,
      visibleProjectedVertexCount: state.visibleProjectedVertexCount,
      encodedByteLength: state.encodedByteLength,
    };
    assert.ok(state.maxPositionError <= 0.02, `${state.profile.id} position error ${state.maxPositionError}`);
    assert.ok(state.maxVelocityError <= 1 / 256, `${state.profile.id} velocity error ${state.maxVelocityError}`);
    assert.ok(state.maxHueError <= 1 / 65_535, `${state.profile.id} hue error ${state.maxHueError}`);
    assert.ok(state.maxProjectedPixelError <= 0.25, `${state.profile.id} projected error ${state.maxProjectedPixelError}`);
    assert.ok(state.encodedByteLength <= (state.profile.id === "desktop" ? 1.25 : 0.65) * 1024 * 1024,
      `${state.profile.id} encoded bank is ${state.encodedByteLength} bytes`);
    assert.ok(state.visibleProjectedVertexCount > 10_000);
  }
  console.log(JSON.stringify(metrics));
});

function projectVisible(vertex, matrix, width, height, requireInsideViewport = true) {
  const world = apply(matrix, [...vertex, 1]);
  const depth = 568 - world[2];
  if (depth <= 0.1) return null;
  const pixelsPerSourceUnit = height / (2 * Math.tan(CSSFLOCKS_SOURCE.fieldOfViewDegrees * Math.PI / 360)) / depth;
  const pixel = [width / 2 + world[0] * pixelsPerSourceUnit, height / 2 - world[1] * pixelsPerSourceUnit];
  if (requireInsideViewport && (pixel[0] < 0 || pixel[0] > width || pixel[1] < 0 || pixel[1] > height)) return null;
  return pixel;
}

function apply(matrix, vector) {
  return [0, 1, 2, 3].map((row) => vector.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
}
