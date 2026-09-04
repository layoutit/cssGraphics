// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import { buildCityflowMobileProduct } from "../src/prepare/csscityflow/mobileModel.mjs";
import { decodeMobileHeights, mobileFaceTransforms } from "../src/csscityflow/mobileTransforms.mjs";
import { createCityflowMobilePlayer } from "../src/csscityflow/mobilePlayback.mjs";
import { selectCityflowPreparedBank } from "../src/csscityflow/profileSelection.mjs";

test("mobile selection stays mobile in landscape and leaves desktop alone", () => {
  const base = { width: 1280, height: 720, mediaMatches: () => false, userAgent: "desktop", userAgentDataMobile: false };
  assert.equal(selectCityflowPreparedBank(base), "desktop");
  for (const userAgent of ["Android", "iPhone", "iPad"]) {
    assert.equal(selectCityflowPreparedBank({ ...base, userAgent }), "mobile");
  }
  assert.equal(selectCityflowPreparedBank({ ...base, userAgentDataMobile: true }), "mobile");
  for (const query of ["(hover: none) and (pointer: coarse)"]) {
    assert.equal(selectCityflowPreparedBank({ ...base, mediaMatches: (value) => value === query }), "mobile");
  }
  assert.equal(selectCityflowPreparedBank({ ...base, width: 599 }), "mobile");
});

test("mobile is deterministic, compact, 2D, and has a bounded complete loop", () => {
  const product = buildCityflowMobileProduct();
  assert.deepEqual(product, buildCityflowMobileProduct());
  const text = JSON.stringify(product.playback);
  assert.ok(Buffer.byteLength(text) < 90000);
  assert.doesNotMatch(text, /matrix\(|matrix3d\(/u);
  assert.doesNotMatch(product.css + product.snapshotHtml,
    /matrix3d|preserve-3d|translateZ|will-change|clip-path|mask|gradient|filter|::before|::after/u);
  const count = product.boxes.length;
  assert.ok(count >= 60 && count <= 100);
  assert.equal((product.snapshotHtml.match(/<b\b/gu) ?? []).length, count * 3);
  const heights = decodeMobileHeights(product.playback);
  assert.equal(product.playback.heightScale, 2);
  let maxStep = 0;
  for (let frame = 0; frame < 360; frame += 1) {
    let motion = 0;
    for (let box = 0; box < count; box += 1) {
      const height = heights[frame * count + box] * product.playback.heightScale / 1000;
      const step = Math.abs(heights[((frame + 1) % 360) * count + box] * product.playback.heightScale / 1000 - height);
      maxStep = Math.max(maxStep, step);
      motion += step;
      const { x, y, width, depth } = product.boxes[box];
      assert.ok(Math.abs(x) < 400 && Math.abs(y) < 400);
      const [top, left, right] = mobileFaceTransforms(heights[frame * count + box], width, depth, product.playback.heightScale)
        .map((value) => value.slice(7, -1).split(",").map(Number));
      const point = (matrix, u, v, faceWidth, faceHeight) => [
        matrix[0] * u * faceWidth + matrix[2] * v * faceHeight + matrix[4],
        matrix[1] * u * faceWidth + matrix[3] * v * faceHeight + matrix[5]];
      const near = (a, b) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-10));
      near(point(top, 0, 1, width, depth), point(left, 0, 0, width, 124));
      near(point(top, 0, 0, width, depth), [0, -height]);
      near(point(top, 1, 1, width, depth), point(left, 1, 0, width, 124));
      near(point(top, 1, 1, width, depth), point(right, 0, 0, depth, 124));
      near(point(top, 1, 0, width, depth), point(right, 1, 0, depth, 124));
      near(point(left, 1, 1, width, 124), point(right, 0, 1, depth, 124));
      near(point(left, 0, 1, width, 124), [-depth * 0.36, depth * 0.6]);
      near(point(right, 1, 1, depth, 124), [width, width * 0.22]);
    }
    assert.ok(motion > 0, `frame ${frame} must not repeat the preceding image`);
  }
  assert.ok(maxStep < 0.91, `including the loop seam: ${maxStep}`);
  for (let index = 1; index < count; index += 1) {
    const a = product.boxes[index];
    const b = product.boxes[index - 1];
    assert.ok(a.row > b.row || (a.row === b.row && a.column > b.column));
  }
  for (let a = 0; a < count; a += 1) for (let b = a + 1; b < count; b += 1) {
    const first = product.boxes[a];
    const second = product.boxes[b];
    const overlapX = Math.min(first.worldX + first.width, second.worldX + second.width) -
      Math.max(first.worldX, second.worldX);
    const overlapY = Math.min(first.worldY + first.depth, second.worldY + second.depth) -
      Math.max(first.worldY, second.worldY);
    assert.ok(overlapX <= 1e-9 || overlapY <= 1e-9, "ground footprints must never intersect");
  }
  // Every point in the camera's ground projection has an owner: no streets,
  // omitted plots, or invented gaps between the towers.
  for (let y = -170; y <= 170; y += 5) for (let x = -256; x <= 256; x += 5) {
    const worldX = (0.6 * x + 0.36 * y) / 0.6792;
    const worldY = (-0.22 * x + y) / 0.6792;
    assert.ok(product.boxes.some((box) => worldX >= box.worldX - 1e-9 &&
      worldX <= box.worldX + box.width + 1e-9 && worldY >= box.worldY - 1e-9 &&
      worldY <= box.worldY + box.depth + 1e-9), `uncovered ground at ${x},${y}`);
  }
  assert.throws(() => decodeMobileHeights({ ...product.playback, heightsBase64: "AA==" }));
  for (const heightScale of [undefined, 0, -1, Infinity, NaN, 2.01]) {
    assert.throws(() => decodeMobileHeights({ ...product.playback, heightScale }));
  }
});

test("mobile uses the existing adjacent scheduler, cached transforms and stable leaves", () => {
  const { playback, snapshotHtml } = buildCityflowMobileProduct();
  const heights = decodeMobileHeights(playback);
  const count = playback.boxCount;
  const leaves = Array.from({ length: count }, (_, box) =>
    mobileFaceTransforms(heights[box], ...playback.footprints[box], playback.heightScale).map((transform) => ({ style: { transform } })));
  const dom = { shapeElements: Array(count).fill({}), leafElements: leaves, stats: () => ({}) };
  let now = 0;
  let callback;
  const player = createCityflowMobilePlayer({ playback, dom, readNow: () => now,
    requestFrame: (next) => { callback = next; return 1; }, cancelFrame: () => { callback = null; } });
  assert.match(snapshotHtml, /cityflow-mobile/u);
  player.resume();
  for (let tick = 0; tick < 720; tick += 1) {
    now += 1000 / 60;
    callback(now);
    assert.equal(player.stats().frameIndex, (tick + 1) % 360);
  }
  assert.equal(player.stats().preparedStateSkipCount, 0);
  player.pause();
  assert.equal(callback, null);
  player.seekFrame(179);
  for (let box = 0; box < count; box += 1) {
    assert.deepEqual(leaves[box].map((leaf) => leaf.style.transform),
      mobileFaceTransforms(heights[179 * count + box], ...playback.footprints[box], playback.heightScale));
  }
  assert.throws(() => player.seekFrame(360));
  player.destroy();
  player.resume();
  assert.equal(callback, null);
});
