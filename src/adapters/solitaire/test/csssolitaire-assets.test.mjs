import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { generatedProductRoot } from "../src/prepare/csssolitaire/paths.mjs";

const generated = generatedProductRoot();

test("generated product is one complete retained snapshot plus sparse prepared playback", async () => {
  const manifest = JSON.parse(await readFile(join(generated, "manifest.json"), "utf8"));
  assert.equal(manifest.schema, "csssolitaire-manifest@1");
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.scope, "public-prepared-product");
  assert.equal(manifest.sourceProfile.cards, 52);
  assert.equal(manifest.sourceProfile.sourceDraws, 9131);
  assert.equal(manifest.sourceProfile.sourceSteps, 9131);
  assert.equal(manifest.renderer.morphTarget, "createPolyMorphPreparedDomTarget");
  assert.equal(manifest.renderer.profile, "prepared-playback");
  assert.equal(manifest.renderer.textureBackend, "atlas");
  assert.equal(manifest.renderer.textureLeafSizing, "raster");
  assert.equal(manifest.renderer.seamBleed, 0.2);
  assert.equal(manifest.renderer.runtimeAtlasRasterization, false);
  assert.equal(manifest.renderer.runtimeGeometryCalculation, false);
  assert.equal(manifest.renderer.runtimeTrajectoryCalculation, false);
  assert.equal(manifest.renderer.runtimeDomGrowth, false);
  assert.equal(manifest.transport.runtimeModelPayload, false);
  assert.equal(manifest.metrics.retainedLeafCount, 8839);
  assert.equal(manifest.metrics.foundationLeafCount, 4);
  assert.equal(manifest.metrics.trailLeafCount, 8835);
  assert.equal(manifest.metrics.preparedFrameCount, 1647);
  assert.equal(manifest.metrics.durationMs, 70475);
  assert.equal(manifest.provenance.proprietaryProductBytesIncluded, false);
  assert.equal(manifest.provenance.nativeCaptureIncluded, false);

  const files = (await readdir(generated, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(generated.length + 1))
    .sort();
  assert.deepEqual(files, [
    `assets/card-faces-${manifest.provenance.cardAtlas.sha256}.png`,
    "manifest.json",
    "solitaire-playback.json",
    "solitaire.polycss.html",
  ]);
  for (const descriptor of Object.values(manifest.assets)) {
    const bytes = await readFile(join(generated, descriptor.path));
    assert.equal(bytes.length, descriptor.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256);
  }

  const snapshot = await readFile(join(generated, "solitaire.polycss.html"), "utf8");
  assert.match(snapshot, /class="polycss-camera solitaire-prepared-camera"/u);
  assert.match(snapshot, /class="polycss-scene solitaire-prepared-scene"/u);
  assert.match(snapshot, /class="csssolitaire-board"/u);
  assert.equal((snapshot.match(/<s(?: class="foundation")? style=/gu) ?? []).length, 8839);
  assert.equal((snapshot.match(/<s class="foundation"/gu) ?? []).length, 4);
  assert.match(snapshot, /border-radius:14px/u);
  assert.match(snapshot, /image-rendering:auto/u);
  assert.doesNotMatch(snapshot, /<(?:script|canvas|svg)\b|\sdata-[a-z0-9-]+=/iu);

  const playback = JSON.parse(await readFile(join(generated, "solitaire-playback.json"), "utf8"));
  assert.equal(playback.schema, "csssolitaire-prepared-playback@1");
  assert.equal(playback.frameTimesMs.length, 1647);
  assert.equal(playback.visibilityRows.length, 1647);
  assert.equal(playback.visibilityRows[0].length, 8835);
  assert.equal(playback.visibilityRows.at(-1).length, 8835);
  assert.equal(playback.frameTimesMs.at(-1), 69475);
  assert.equal(playback.runtimeTrajectoryCalculation, false);
  assert.equal(playback.runtimeDomGrowth, false);
});
