import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCITYFLOW_SOURCE_FAR_PLANE,
  buildCityflowMorphModel,
  buildCityflowPreparedCss,
  buildCityflowPreparedPlayback,
  cityflowClippedBottoms,
  cityflowEyeZ,
} from "../src/prepare/csscityflow/model.mjs";

test("builds one retained root and three solid quad leaves per source box", () => {
  for (const [bankId, boxCount] of [["desktop", 200]]) {
    const { state, model } = buildCityflowMorphModel({ bankId });
    assert.equal(model.profile, "static-prepared");
    assert.equal(model.render.shapes.length, boxCount);
    assert.equal(model.render.leaves.length, boxCount * 3);
    assert.equal(model.topology.polygons.length, boxCount * 3);
    assert.equal(model.topology.vertices.length, boxCount * 12);
    assert.ok(model.render.leaves.every((leaf) =>
      leaf.strategy === "solid-quad" && leaf.width === 1 && leaf.height === 1 && leaf.atlas === null));
    assert.deepEqual(model.materials, [{ id: "cityflow-face", color: [1, 1, 1, 1] }]);
  }
});

test("prepares DOMFORMAT-precedented elapsed playback without author keyframes", () => {
  const { state } = buildCityflowMorphModel();
  const css = buildCityflowPreparedCss(state);
  const playback = buildCityflowPreparedPlayback(state);
  assert.equal(playback.schema, "csscityflow-prepared-playback@1");
  assert.equal(playback.precedent, "domformat@0/polycss-playback@0@cc8da736");
  assert.equal(playback.catchUpPolicy, "elapsed");
  assert.deepEqual(playback.tickIntervalUs, [20_000, 1]);
  assert.equal(playback.boxCount, 200);
  assert.equal(
    Buffer.from(playback.transformIndicesBase64, "base64").byteLength,
    playback.frameCount * playback.boxCount * Uint32Array.BYTES_PER_ELEMENT,
  );
  assert.equal(
    Buffer.from(playback.colorIndicesBase64, "base64").byteLength,
    playback.frameCount * playback.boxCount * Uint8Array.BYTES_PER_ELEMENT,
  );
  assert.ok(playback.transforms.length >= playback.boxCount);
  assert.doesNotMatch(css, /@keyframes|animation-/u);
  assert.match(css, /\.csscityflow-color-255\{/u);
  assert.match(css, /b:first-child\{backface-visibility:visible!important\}/u);
  assert.equal((css.match(/hypot\(/gu) ?? []).length, 0);
  assert.doesNotMatch(css, /filter|clip-path|mask|linear-gradient|radial-gradient/u);
});

test("clips source side faces at the native far plane during preparation", () => {
  const { state } = buildCityflowMorphModel();
  for (const box of state.boxes) {
    const x = box.centerX;
    const y = box.centerY;
    const xw = box.cth * box.width / 2;
    const xd = box.sth * box.depth / 2;
    const yw = -box.sth * box.width / 2;
    const yd = box.cth * box.depth / 2;
    const bottoms = cityflowClippedBottoms(box);
    assert.ok(cityflowEyeZ(x + xw + xd, y + yw + yd, bottoms.front) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x - xw + xd, y - yw + yd, bottoms.front) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x + xw - xd, y + yw - yd, bottoms.right) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x + xw + xd, y + yw + yd, bottoms.right) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
  }
});
