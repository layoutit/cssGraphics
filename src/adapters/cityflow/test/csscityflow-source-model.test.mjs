// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import sourceLock from "../notes/references/source-lock.json" with { type: "json" };
import {
  CITYFLOW_BANKS,
  CSSCITYFLOW_FACE_IDS,
  CSSCITYFLOW_FRAME_MILLISECONDS,
  CSSCITYFLOW_PREPARED_FRAME_COUNT,
  CSSCITYFLOW_PRESENTATION_FRAME_COUNT,
  CSSCITYFLOW_PRESENTATION_FRAME_MILLISECONDS,
  buildCityflowSourceState,
  cityflowFrameAt,
} from "../src/prepare/csscityflow/sourceModel.mjs";

test("locks the Cityflow source settings and source-supported product count", () => {
  assert.equal(CITYFLOW_BANKS.desktop.boxCount, 200);
  assert.equal(CITYFLOW_BANKS.mobile.boxCount, 100);
  assert.equal(CITYFLOW_BANKS.mobile.modelId, "cityflow-mobile");
  assert.equal(CITYFLOW_BANKS.desktop.commit, sourceLock.revision);
  assert.equal(CITYFLOW_BANKS.desktop.primarySha256, sourceLock.primary.sha256);
  assert.equal(CITYFLOW_BANKS.desktop.configSha256, sourceLock.config.sha256);
  assert.equal(sourceLock.license.spdx, "HPND");
  assert.equal(CITYFLOW_BANKS.desktop.waveCount, 6);
  assert.equal(CITYFLOW_BANKS.desktop.waveRadius, 256);
  assert.equal(CITYFLOW_BANKS.desktop.textureSize, 512);
  assert.equal(CSSCITYFLOW_FRAME_MILLISECONDS, 20);
  assert.equal(CSSCITYFLOW_PREPARED_FRAME_COUNT, 251);
  assert.equal(CSSCITYFLOW_PRESENTATION_FRAME_COUNT, 301);
  assert.equal(CSSCITYFLOW_PRESENTATION_FRAME_MILLISECONDS, 1_000 / 60);
  assert.deepEqual(CSSCITYFLOW_FACE_IDS, ["top", "front", "right"]);
  assert.ok(buildCityflowSourceState().boxes.every((box) => box.lightFactors[0] > 1));
});

test("prepares deterministic source state and exact checkpoint frames", () => {
  const left = buildCityflowSourceState();
  const right = buildCityflowSourceState();
  assert.deepEqual(left, right);
  assert.equal(left.boxes.length, 200);
  assert.equal(left.palette.length, 256);
  assert.equal(left.waves.length, 6);
  const frame = cityflowFrameAt(left, 73);
  assert.equal(frame.boxes.length, 200);
  assert.equal(frame.wavePositions.length, 6);
  assert.ok(frame.boxes.every(({ height, colorIndex }) =>
    height >= 0.1 && height < 0.62 && colorIndex >= 0 && colorIndex < 256));
});

test("prepares a deterministic source-supported mobile count bank", () => {
  const left = buildCityflowSourceState({ bankId: "mobile" });
  const right = buildCityflowSourceState({ bankId: "mobile" });
  assert.deepEqual(left, right);
  assert.equal(left.source.boxCount, 100);
  assert.equal(left.boxes.length, 100);
  assert.equal(cityflowFrameAt(left, 73).boxes.length, 100);
  assert.ok(left.boxes.every((box) => box.width > 0 && box.depth > 0));
});

test("keeps source front-to-back box ordering", () => {
  const state = buildCityflowSourceState();
  for (let index = 1; index < state.boxes.length; index += 1) {
    const previous = Math.trunc(state.boxes[index - 1].y * 10_000);
    const current = Math.trunc(state.boxes[index].y * 10_000);
    assert.ok(previous >= current);
  }
});
