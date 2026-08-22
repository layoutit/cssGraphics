import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_PREPARED_CADENCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceEndpointSamples,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import {
  buildFlocksTerminalBridge,
  buildFlocksTerminalCorrespondence,
  flocksVisualFeature,
} from "../src/prepare/cssflocks/terminalSeam.mjs";
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  decodeFlocksPreparedSourceValues,
  encodeFlocksPreparedBlock,
} from "../src/shared/cssflocks/preparedBlockTransport.mjs";

test("216 exact-source seconds close through a bounded prepare-only correspondence bridge", { timeout: 30_000 }, () => {
  let initialFrame;
  let terminalFrame;
  for (const frame of buildFlocksSourceEndpointSamples({ bank: CSSFLOCKS_SOURCE_BANK })) {
    initialFrame ??= frame;
    terminalFrame = frame;
  }
  assert.equal(initialFrame.index, 0);
  assert.equal(terminalFrame.index, CSSFLOCKS_SOURCE_BANK.frameCount - 1);
  const reports = {};
  for (const profile of Object.values(CSSFLOCKS_PRODUCT_PROFILES)) {
    const initial = { ...initialFrame, bugs: initialFrame.bugs.slice(0, profile.bugCount) };
    const terminal = { ...terminalFrame, bugs: terminalFrame.bugs.slice(0, profile.bugCount) };
    const viewport = profile.id === "desktop" ? [1280, 800] : [390, 844];
    const correspondence = buildFlocksTerminalCorrespondence(terminal.bugs, initial.bugs, viewport, profile.leaderCount);
    assert.deepEqual([...correspondence.permutation].sort((left, right) => left - right),
      Array.from({ length: profile.bugCount }, (_, index) => index));
    assert.ok(correspondence.permutation.slice(0, profile.leaderCount).every((index) => index < profile.leaderCount));
    assert.ok(correspondence.permutation.slice(profile.leaderCount).every((index) => index >= profile.leaderCount));
    const frameCount = CSSFLOCKS_PREPARED_CADENCE.terminalBridgeSeconds * CSSFLOCKS_SOURCE_BANK.framesPerSecond;
    const bridge = buildFlocksTerminalBridge({
      finalFrame: terminal,
      initialFrame: initial,
      correspondence: correspondence.permutation,
      frameCount,
      framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
    });
    assert.equal(bridge.frames.length, frameCount);
    assert.equal(bridge.frames[0].timeMs, 1_000 / 60);
    assert.equal(bridge.frames.at(-1).timeMs, frameCount / 60 * 1_000);
    let maxDecodedPositionError = 0;
    let maxTerminalPositionStep = 0;
    let maxTerminalHueStep = 0;
    const terminalProjectedSteps = [];
    for (let blockIndex = 0; blockIndex < bridge.frames.length / CSSFLOCKS_SOURCE_BANK.blockFrameCount; blockIndex += 1) {
      const frames = bridge.frames.slice(blockIndex * 60, (blockIndex + 1) * 60);
      const bytes = encodeFlocksPreparedBlock({ frames, bugCount: profile.bugCount, framesPerSecond: 60 });
      const decoded = decodeFlocksPreparedSourceValues(bytes, {
        index: blockIndex,
        frameCount: 60,
        encoding: CSSFLOCKS_BLOCK_ENCODING,
        decodedByteLength: bytes.byteLength,
      }, {
        streamId: profile.id,
        modelId: profile.modelId,
        bugCount: profile.bugCount,
        leafCount: profile.bugCount * 6,
        framesPerSecond: 60,
        frameMilliseconds: 1_000 / 60,
        playbackSchema: CSSFLOCKS_PLAYBACK_SCHEMA,
      });
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        for (let bugIndex = 0; bugIndex < profile.bugCount; bugIndex += 1) {
          const offset = (frameIndex * profile.bugCount + bugIndex) * 7;
          maxDecodedPositionError = Math.max(maxDecodedPositionError,
            ...frames[frameIndex].bugs[bugIndex].position.map((value, axis) => Math.abs(value - decoded[offset + axis])));
        }
      }
    }
    for (let bugIndex = 0; bugIndex < profile.bugCount; bugIndex += 1) {
      const last = bridge.frames.at(-1).bugs[bugIndex];
      const target = initial.bugs[correspondence.permutation[bugIndex]];
      maxTerminalPositionStep = Math.max(maxTerminalPositionStep,
        ...target.position.map((value, axis) => Math.abs(value - last.position[axis])));
      const hueDistance = Math.abs(target.hue - last.hue);
      maxTerminalHueStep = Math.max(maxTerminalHueStep, Math.min(hueDistance, 1 - hueDistance));
      const lastFeature = flocksVisualFeature(last, viewport);
      const targetFeature = flocksVisualFeature(target, viewport);
      if (lastFeature.visible && targetFeature.visible) {
        terminalProjectedSteps.push(Math.hypot(lastFeature.x - targetFeature.x, lastFeature.y - targetFeature.y));
      }
    }
    assert.ok(maxDecodedPositionError <= 0.02);
    assert.ok(maxTerminalPositionStep <= 2.6, `${profile.id} terminal position step ${maxTerminalPositionStep}`);
    assert.ok(maxTerminalHueStep <= 1 / 65_535, `${profile.id} terminal hue step ${maxTerminalHueStep}`);
    terminalProjectedSteps.sort((left, right) => left - right);
    const terminalProjectedStepP95 = terminalProjectedSteps[Math.ceil(terminalProjectedSteps.length * 0.95) - 1] ?? 0;
    assert.ok(terminalProjectedStepP95 <= 12, `${profile.id} terminal projected p95 step ${terminalProjectedStepP95}`);
    reports[profile.id] = {
      maxDecodedPositionError,
      maxTerminalPositionStep,
      maxTerminalHueStep,
      terminalProjectedStepP95,
      correspondenceMetrics: correspondence.metrics,
    };
  }
  console.log(JSON.stringify(reports));
});
