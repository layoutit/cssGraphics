// SPDX-License-Identifier: HPND
import { CSSGALAXY_COMPARISON_SEED } from "../src/prepare/cssgalaxy/qualification.mjs";

export const CSSGALAXY_FRAME_SEQUENCE_PLAN = Object.freeze({
  seed: CSSGALAXY_COMPARISON_SEED,
  viewport: Object.freeze({ width: 800, height: 600 }),
  sourceFrameCount: 1200,
  sourceFramesPerSecond: 50,
  sourceFrameStride: 1,
  capturedFrameCount: 1200,
  capturedFramesPerSecond: 50,
  durationSeconds: 24,
});
