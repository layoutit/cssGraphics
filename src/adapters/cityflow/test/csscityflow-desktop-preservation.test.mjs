// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preparedMobileBank } from "../src/csscityflow/mobilePlayback.mjs";
import { decodeMobileHeights } from "../src/csscityflow/mobileTransforms.mjs";

const root = new URL("../../../../build/generated/public/csscityflow/", import.meta.url);
test("DOM cleanup changes only the desktop structural stylesheet", async () => {
  for (const [path, expected] of [
    ["cityflow.playback.json", "aa05e854b3b4241869cf05cc069fcec10da68944c7c77de8c9eeb8ecd15ed231"],
    ["cityflow/model.json", "2324022d137aabe5cb37e56b2d6c7c4ba1e5ad5996d8007fb71b9774fea63642"],
    ["cityflow/manifest.json", "9bb0740dd8bad387a2d347450d7cbbf591b93e7cab5916ae8b28a132153d1d19"],
  ]) {
    assert.equal(createHash("sha256").update(await readFile(new URL(path, root))).digest("hex"), expected, path);
  }
  const stylesheet = await readFile(new URL("cityflow.css", root), "utf8");
  assert.equal(createHash("sha256").update(stylesheet).digest("hex"),
    "5ab5e01b3bea2e0886a7744e3bedcd1587f33746b9462ef2860f6a46105aeb0b");
  assert.match(stylesheet, /\.polycss-scene>div>b/u);
  assert.doesNotMatch(stylesheet, /csscityflow-box/u);
});

test("new mobile assets are content-addressed and carry scalars rather than matrices", async () => {
  const metadata = JSON.parse(await readFile(new URL("prepared.json", root), "utf8"));
  const bank = preparedMobileBank(metadata);
  for (const kind of ["snapshot", "stylesheet", "playback"]) {
    const asset = bank[kind];
    const bytes = await readFile(new URL(asset.assetUrl.replace("/csscityflow/", ""), root));
    assert.equal(bytes.length, asset.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    assert.doesNotMatch(bytes.toString(), /matrix3d|translateZ|preserve-3d|will-change|clip-path|mask/u);
    if (kind === "playback") {
      assert.doesNotMatch(bytes.toString(), /matrix\(/u);
      assert.equal(decodeMobileHeights(JSON.parse(bytes)).length, 360 * 72);
    }
  }
});
