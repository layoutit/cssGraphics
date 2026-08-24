// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { distributeGalaxyPrefixCounts } from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { CSSGALAXY_COLOR_FAMILY } from "../src/prepare/cssgalaxy/colorFamilies.mjs";
import { createGalaxyColorStylesheet } from "../src/cssgalaxy/colorFamilyContract.mjs";
import { decodeGalaxyPreparedBank } from "../src/shared/cssgalaxy/preparedBlockTransport.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/cssgalaxy-product-public/cssgalaxy");

test("prepared variants contain direct anonymous PolyCSS point leaves", async () => {
  const metadata = JSON.parse(await readFile(resolve(generatedRoot, "prepared.json"), "utf8"));
  assert.equal(metadata.schema, "cssgalaxy-prepared-scene@5");
  assert.equal(metadata.defaultProfile, "desktop");
  assert.deepEqual(Object.keys(metadata.profiles), ["desktop", "mobile"]);
  assert.deepEqual(metadata.profiles.desktop, {
    id: "desktop",
    galaxyCount: 3,
    starCount: 1500,
    comparisonSeed: 2298,
    catalog: metadata.profiles.desktop.catalog,
  });
  assert.deepEqual(metadata.profiles.mobile, {
    id: "mobile",
    galaxyCount: 2,
    starCount: 1000,
    comparisonSeed: 4947,
    catalog: metadata.profiles.mobile.catalog,
  });
  assert.equal(metadata.profileSelection.mobileBreakpointWidth, 600);
  assert.equal(metadata.profileSelection.mobileCapabilityQuery, "(hover: none) and (pointer: coarse)");
  assert.equal(metadata.seedQualificationsByGalaxyCount, undefined);
  assert.equal(metadata.qualificationsByGalaxyCount, undefined);
  assert.equal(metadata.renderer.artifactMode,
    "prepared-flat-polycss-snapshot-plus-twenty-four-second-banks");
  assert.equal(metadata.renderer.transportBankSeconds, 24);
  assert.equal(metadata.renderer.workerPreparedResponseMode,
    "bounded-four-second-direct-transform-blocks");
  assert.equal(metadata.renderer.animationPathTransformFormatting, false);
  assert.equal(metadata.renderer.workerPreparedTransformMaterialization, true);
  assert.equal(metadata.renderer.workerPreparedPackedCoordinateMaterialization, false);
  assert.equal(metadata.renderer.workerPreparedPositionMaterialization, false);
  assert.equal(metadata.renderer.directPointLeaves, true);
  assert.equal(metadata.renderer.perPointWrapperCount, 0);
  assert.equal(metadata.renderer.perPointIdentityAttributeCount, 0);
  for (const profile of Object.values(metadata.profiles)) {
    const { galaxyCount, starCount: count, comparisonSeed } = profile;
    const relativeRoot = `g${galaxyCount}/${count}`;
    const [catalogBytes, snapshotBytes] = await Promise.all([
      readFile(resolve(generatedRoot, relativeRoot, "catalog.json")),
      readFile(resolve(generatedRoot, relativeRoot, "snapshot.html")),
    ]);
    const catalog = JSON.parse(catalogBytes);
    const descriptor = profile.catalog;
    assert.equal(descriptor.schema, "cssgalaxy-prepared-catalog-descriptor@1");
    assert.equal(descriptor.byteLength, catalogBytes.byteLength);
    assert.equal(descriptor.sha256, createHash("sha256").update(catalogBytes).digest("hex"));
    assert.equal(descriptor.url,
      `/cssgalaxy/${relativeRoot}/catalog.json?sha256=${descriptor.sha256}`);
    const snapshot = snapshotBytes.toString("utf8");
    assert.equal(catalog.snapshot.sha256,
      createHash("sha256").update(snapshotBytes).digest("hex"));
    assert.equal(catalog.snapshot.byteLength, snapshotBytes.byteLength);
    assert.equal(catalog.snapshot.retainedPointLeafCount, count);
    assert.equal(catalog.snapshot.retainedPerPointWrapperCount, 0);
    assert.equal((snapshot.match(/<b><\/b>/gu) ?? []).length, count);
    assert.equal((snapshot.match(/<div\b/gu) ?? []).length, 1);
    assert.equal((snapshot.match(/<main\b/gu) ?? []).length, 1);
    assert.doesNotMatch(snapshot, /<b\s|<b[^>]*(?:id|class|data-)=/iu);
    assert.deepEqual(catalog.prefixStarCounts, distributeGalaxyPrefixCounts(count, galaxyCount));
    assert.equal(catalog.presentationColors.mode, CSSGALAXY_COLOR_FAMILY.mode);
    assert.deepEqual(catalog.presentationColors.signedOklabDistanceSteps,
      CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps);
    assert.equal(catalog.colorFamilyVariantCount,
      CSSGALAXY_COLOR_FAMILY.signedOklabDistanceSteps.length);
    assert.equal(catalog.colorPropertyCount, galaxyCount * catalog.colorFamilyVariantCount);
    assert.equal(catalog.encounterReel.schema, "cssgalaxy-prepared-encounter-reel@5");
    assert.equal(catalog.selection,
      "session-shuffled-qualified-encounter-start-without-replacement");
    assert.equal(catalog.comparisonSeed, comparisonSeed);
    assert.equal(catalog.curatedEncounterSeeds.length, 10);
    assert.equal(new Set(catalog.curatedEncounterSeeds).size, 10);
    assert.equal(catalog.camera.mode, "fixed-retained-camera-source-projection-in-point-transforms");
    assert.equal(catalog.blockFrameCount, 240);
    assert.equal(catalog.blocksPerBank, 6);
    assert.equal(catalog.blockCount, 30);
    assert.equal(catalog.transport.schema, "cssgalaxy-prepared-bank-transport@6");
    assert.equal(catalog.transport.encoding,
      "http-brotli-galaxy-leaf-major-axis-second-difference-decimal-blocks@6");
    assert.equal(catalog.transport.contentEncoding, "br");
    assert.equal(catalog.transport.bankSeconds, 24);
    assert.equal(catalog.transport.coordinateScale, 10);
    assert.equal(catalog.transport.maximumCoordinateQuantizationErrorPixels, 0.05);
    assert.equal(catalog.runtimeMaterializedLookaheadBlockCount, 1);
    assert.equal(catalog.startupMaterializedLookaheadBlockCount, 0);
    if (galaxyCount === 3) {
      assert.equal(catalog.threeGalaxyRolePalette.schema, "cssgalaxy-prepared-three-role-palette@1");
      assert.ok(Object.values(catalog.threeGalaxyRolePalette.centerBlackContrastRatios)
        .every((ratio) => ratio >= 7));
    }
    if (galaxyCount === 2) assert.equal(catalog.threeGalaxyRolePalette, null);
    const expectedColorStyles = createGalaxyColorStylesheet(
      catalog.prefixStarCounts, catalog.colorFamilyVariantCount, catalog.particleCohortColors);
    assert.ok(snapshot.includes(`<style>${expectedColorStyles.stylesheet}</style>`));
    for (const seed of Object.values(catalog.seeds)) {
      assert.equal(seed.banks.length, catalog.bankCount);
      assert.equal(seed.packs, undefined);
      assert.equal(new Set(seed.banks.map(({ assetUrl }) => assetUrl)).size, catalog.bankCount);
      assert.ok(seed.banks.every((bank) =>
        bank.contentEncoding === "br" &&
          bank.maximumCoordinateQuantizationErrorPixels <= 0.05 && bank.coordinateEncoding ===
          "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1" &&
        bank.blockCount === catalog.blocksPerBank &&
        bank.sourceSampleCount === catalog.bankFrameCount * catalog.starCount &&
        bank.visibleSampleCount > 0 && bank.visibleSampleCount <= bank.sourceSampleCount));
      const completeReelByteLength = seed.banks.reduce((sum, bank) => sum + bank.byteLength, 0);
      assert.ok(completeReelByteLength / (catalog.streamDurationMilliseconds / 1000) < 40 * 1024,
        "the complete coordinate reel must stay below 40 KiB per playback second");
      assert.equal(seed.encounterOrder.length, catalog.encounterReel.encounterCount);
      assert.equal(new Set(seed.encounterOrder).size, catalog.encounterReel.encounterCount);
      assert.deepEqual(seed.encounterOrder, catalog.curatedEncounterSeeds);
      assert.equal(seed.encounterEvents.length, catalog.encounterReel.encounterCount);
      for (const event of seed.encounterEvents) {
        assert.equal(event.galaxyNativeColors.length, galaxyCount);
        assert.equal(event.galaxyPresentationRoles.length, galaxyCount);
        assert.equal(event.galaxyColorFamilies.length, galaxyCount);
        assert.deepEqual(event.particleCohortRoles,
          galaxyCount === 3 ? ["magenta", "cyan", "off-white"] : ["magenta", "cyan"]);
        assert.deepEqual(event.particleCohortNativeGalaxyOrder.map(
          (nativeGalaxyIndex) => event.galaxyPresentationRoles[nativeGalaxyIndex]),
        event.particleCohortRoles);
        for (let galaxyIndex = 0; galaxyIndex < galaxyCount; galaxyIndex += 1) {
          const family = event.galaxyColorFamilies[galaxyIndex];
          assert.equal(family.length, catalog.colorFamilyVariantCount);
          assert.equal(family[2], event.galaxyPresentationCenters[galaxyIndex]);
        }
      }
    }
    assert.doesNotMatch(snapshot, /polycss-galaxy|<script\b|<canvas\b|<svg\b/iu);
  }
});

test("prepared reformation keeps the same statically-colored leaves moving without reset frames", async () => {
  const catalog = JSON.parse(await readFile(resolve(generatedRoot, "g3/1500/catalog.json"), "utf8"));
  const selected = catalog.seeds["2298"];
  const payload = await readPreparedBank(catalog, selected, 0);
  assert.equal(payload.colors, undefined);
  assert.equal(payload.sceneOpacities, undefined);
  for (const [leftFrame, rightFrame] of [[508, 509], [509, 510], [539, 540], [629, 630], [718, 719]]) {
    assert.ok(changedTransformCount(payload, leftFrame, payload, rightFrame, catalog.starCount) > 0,
      `bank 0 froze between frames ${leftFrame} and ${rightFrame}`);
  }
  assert.ok(changedTransformCount(payload, 719, payload, 720, catalog.starCount) > 0);
  assert.equal(selected.banks[0].sourceContinuousFromPrevious, true);
  assert.equal(selected.banks[1].sourceContinuousFromPrevious, true);
  assert.equal(selected.banks[0].presentationContinuousFromPrevious, true);
  assert.equal(selected.banks[1].presentationContinuousFromPrevious, true);
});

async function readPreparedBank(catalog, seed, bankIndex) {
  const descriptor = seed.banks[bankIndex];
  const relative = descriptor.assetUrl.replace(/^\/cssgalaxy\//u, "");
  const encoded = await readFile(resolve(generatedRoot, relative));
  assert.equal(encoded.byteLength, descriptor.byteLength);
  assert.equal(createHash("sha256").update(encoded).digest("hex"), descriptor.sha256);
  const decoded = brotliDecompressSync(encoded);
  assert.equal(decoded.byteLength, descriptor.decodedByteLength);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), descriptor.decodedSha256);
  return decodeGalaxyPreparedBank(decoded, descriptor, { ...catalog, selectedSeed: seed.seed });
}

function changedTransformCount(leftPayload, leftFrame, rightPayload, rightFrame, starCount) {
  let changed = 0;
  for (let leafIndex = 0; leafIndex < starCount; leafIndex += 1) {
    const left = transformAt(leftPayload, leftFrame, leafIndex, starCount);
    const right = transformAt(rightPayload, rightFrame, leafIndex, starCount);
    if (left !== right) changed += 1;
  }
  return changed;
}

function transformAt(payload, frameIndex, leafIndex, starCount) {
  const blockIndex = Math.floor(frameIndex / payload.blockFrameCount);
  const localFrame = frameIndex % payload.blockFrameCount;
  return payload.decodedBlocks[blockIndex].transforms[localFrame * starCount + leafIndex];
}
