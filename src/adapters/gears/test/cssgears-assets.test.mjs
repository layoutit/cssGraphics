import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { CSSGEARS_PREPARED_BANK } from "../src/prepare/cssgears/prepare.mjs";

const generatedRoot = "build/generated/public/cssgears";
const manifestPath = join(generatedRoot, "manifest.json");

if (!existsSync(manifestPath)) {
  test("generated cssgears manifest exists", { skip: "Run pnpm prepare:cssgears after implementing the first parser." }, () => {});
} else {
  test("generated cssgears prepared bank is browser-safe and exact", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expectedIds = CSSGEARS_PREPARED_BANK.map((entry) => entry.id);
    const expectedSeeds = CSSGEARS_PREPARED_BANK.map((entry) => entry.seed);
    assert.equal(manifest.schema, "cssgears-manifest@3");
    assert.equal(manifest.status, "ready");
    assert.match(manifest.generatedAssetRoot, /^\/cssgears\//u);
    assert.deepEqual(manifest.scenes.map((scene) => scene.id), expectedIds);
    assert.deepEqual(manifest.scenes.map((scene) => scene.nativeSeed), expectedSeeds);
    assert.equal(manifest.defaultScene.id, expectedIds[0]);
    assert.deepEqual(manifest.preparedBank, {
      schema: "cssgears-prepared-bank@2",
      selection: "crypto-random-shuffled-bag-no-immediate-repeat",
      sceneIds: expectedIds,
      seeds: expectedSeeds,
      runtimeSceneGeneration: false,
      runtimeGeometryConstruction: false,
      mountedSceneCount: 1,
      retainedSceneBankCount: 24,
    });
    assert.equal(manifest.showreel.schema, "cssgears-prepared-showreel-bank@2");
    assert.equal(manifest.showreel.endless, true);
    assert.equal(manifest.showreel.selection, "crypto-random-shuffled-bag-no-immediate-repeat");
    assert.equal(manifest.showreel.retainedSceneBankCount, 24);
    assert.equal(manifest.showreel.activeSceneCount, 1);
    assert.equal(manifest.showreel.retainedGearRootCount, 3);
    assert.equal(manifest.showreel.runtimeDomGrowth, false);
    assert.equal(manifest.showreel.runtimeGeometryConstruction, false);
    assert.equal(manifest.showreel.runtimeInterpolation, false);
    assert.equal(manifest.showreel.runtimeEasingCalculation, false);
    assert.equal(manifest.showreel.preparedEdgeSelection, true);
    assert.equal(manifest.showreel.edgeSelectionPolicy, "three-distinct-viewport-edges-no-pair-closer-than-locked-spacing");
    assert.equal(manifest.showreel.runtimeEdgeSelection, false);
    assert.equal(manifest.showreel.runtimeRootClassWritesPerSwitch, 3);
    assert.equal(manifest.showreel.runtimeRandomSelectionOnly, true);
    assert.equal(manifest.showreel.phases.spin.durationMilliseconds, 15_000);
    assert.equal(manifest.showreel.sceneTokens.length, expectedIds.length);
    assert.equal(new Set(manifest.showreel.sceneTokens.map(({ token }) => token)).size, expectedIds.length);
    assert.equal(manifest.metrics.preparedSceneCount, expectedIds.length);
    assert.equal(manifest.metrics.mountedSceneCount, 1);
    assert.equal(manifest.metrics.retainedSceneBankCount, 24);
    assert.equal(
      manifest.metrics.maximumRetainedShowreelLeafCount,
      manifest.scenes.reduce((total, scene) => total + scene.metrics.preparedLeafCount, 0),
    );
    assert.equal(manifest.metrics.runtimeSceneGenerationCount, 0);
    assert.equal(manifest.metrics.runtimeGeometryConstructionCount, 0);
    assert.equal(manifest.metrics.runtimeCameraCalculationCount, 0);
    assert.equal(manifest.metrics.runtimeDomGrowth, false);
    assert.doesNotMatch(JSON.stringify(manifest), /\/Users\/|\\\\Users\\\\|file:\/\//u);

    for (const scene of manifest.scenes) assertPreparedScene(scene);
    assertPreparedShowreelBank(manifest);

    const defaultScene = manifest.scenes[0];
    assert.equal(defaultScene.metrics.sourcePolygonCount, 2130);
    assert.equal(defaultScene.metrics.preparedLeafCount, 1136);
    assert.equal(defaultScene.metrics.preparedPolygonLeafCount, 1126);
    assert.equal(defaultScene.metrics.preparedRenderBundleCount, 10);
    assert.equal(defaultScene.metrics.mergedSourceFaceCount, 1004);
  });
}

function assertPreparedScene(entry) {
  assert.match(entry.sceneUrl, /^\/cssgears\/scenes\/.+\.json$/u);
  assert.match(entry.snapshotUrl, /^\/cssgears\/scenes\/.+\.polycss\.html$/u);
  assert.equal(entry.sourceProfileId, `xscreensaver-gears-native-seed-${entry.nativeSeed}-v1`);
  assert.equal(entry.metrics.sourceGearCount, 3);
  assert.equal(entry.metrics.preparedGearRootCount, 3);
  assert.equal(entry.metrics.sourceTriangleCount, 0);
  assert.equal(entry.metrics.sourceQuadCount, entry.metrics.sourcePolygonCount);
  assert.equal(entry.metrics.preparedTimelineStateCount, 720);
  assert.ok(entry.metrics.preparedLeafCount > 0 && entry.metrics.preparedLeafCount <= 4000);
  assert.equal(entry.metrics.sourceFaceCoverageCount, entry.metrics.sourcePolygonCount);
  assert.equal(entry.metrics.sourceFaceCoverageExact, true);

  const snapshotPath = join(generatedRoot, entry.snapshotUrl.replace(/^\/cssgears\//u, ""));
  assert.ok(existsSync(snapshotPath), "missing prepared snapshot " + snapshotPath);
  const snapshot = readFileSync(snapshotPath, "utf8");
  assert.match(snapshot, /polycss-scene/u);
  assert.equal((snapshot.match(/class="g"/gu) ?? []).length, 3);
  assert.equal((snapshot.match(/class="d"/gu) ?? []).length, 0);
  assert.equal((snapshot.match(/<b\b/gu) ?? []).length, entry.metrics.preparedLeafCount);
  assert.equal((snapshot.match(/<div\b/gu) ?? []).length, 5);
  assert.doesNotMatch(snapshot, /\sdata-[\w-]+=/u);
  assert.doesNotMatch(snapshot, /polycss-mesh|cssgears-(?:assembly|gear|lighting)/u);
  assert.doesNotMatch(snapshot, /style=""/u);
  assert.doesNotMatch(snapshot, /data:image\//u);
  assert.doesNotMatch(snapshot, /<script/iu);
  assert.match(snapshot, /backface-visibility:hidden/u);
  assert.doesNotMatch(snapshot, /backface-visibility:visible/u);

  const scenePath = join(generatedRoot, entry.sceneUrl.replace(/^\/cssgears\//u, ""));
  const sceneData = JSON.parse(readFileSync(scenePath, "utf8"));
  assert.equal(sceneData.id, entry.id);
  assert.equal(sceneData.sourceProfile.seed, entry.nativeSeed);
  assert.equal(sceneData.sourceProfile.schema, "cssgears-source-profile@3");
  assert.equal(sceneData.sourceProfile.presentation.schema, "cssgears-prepared-camera-framing@1");
  assert.equal(sceneData.sourceProfile.presentation.runtimeCameraCalculation, false);
  const [tiltX, tiltY, roll] = sceneData.sourceProfile.presentation.rotationDegrees;
  assert.ok(tiltX >= 16 && tiltX <= 32);
  assert.ok(tiltY >= 22 && tiltY <= 38);
  assert.equal(roll, sceneData.sourceProfile.sceneRotationDegrees[2]);
  assert.equal(sceneData.metrics.runtimeCameraCalculationCount, 0);
  assert.equal(sceneData.renderer.runtimeCameraCalculation, false);
  assert.equal(sceneData.meshes, undefined);
  assert.equal(sceneData.meshDescriptors.length, 3);
  assert.equal(sceneData.playback.frameRows.length, 720);
  assert.equal(sceneData.playback.transforms.length, 2160);
  assert.equal(sceneData.playback.sourceTheta.length, 2160);
  assert.equal(sceneData.playback.gearThetaPublication, "native-positive-after-polycss-leaf-basis");
  assert.deepEqual(
    sceneData.playback.sourceTheta.slice(0, 3),
    sceneData.assembly.gears.map((gear) => gear.initialTheta),
  );
  assert.equal(sceneData.playback.shapeChanges.length, 4314);
  assert.equal(sceneData.playback.sourceFrameDelayMilliseconds, 30);
  assert.equal(sceneData.playback.sourceScheduler, "xscreensaver-post-draw-delay-no-catch-up");
  assert.equal(sceneData.playback.sourceCatchUp, false);
  assert.equal(sceneData.playback.retainedAssemblyRootCount, 1);
  assert.equal(sceneData.showreel.schema, "cssgears-prepared-showreel@1");
  assert.equal(sceneData.showreel.stateCount, 580);
  assert.equal(sceneData.showreel.phases.spin.stateCount, 500);
  assert.equal(sceneData.showreel.phases.spin.durationMilliseconds, 15_000);
  assert.equal(sceneData.showreel.transforms.length, 580 * 3);
  assert.ok(sceneData.showreel.transforms.every((transform) => /^matrix3d\(/u.test(transform)));
  assert.equal(sceneData.showreel.runtimeInterpolation, false);
  assert.equal(sceneData.showreel.runtimeEasingCalculation, false);
  assert.equal(sceneData.showreel.runtimeEdgeSelection, false);
  assert.equal(sceneData.showreel.responsivePresentation.schema, "cssgears-responsive-presentation@1");
  assert.equal(sceneData.showreel.responsivePresentation.breakpointPixels, 600);
  assert.equal(sceneData.showreel.responsivePresentation.mobile.scaleMode, "cover");
  assert.equal(sceneData.showreel.responsivePresentation.runtimeOrientationCalculation, false);
  assert.equal(sceneData.showreel.edgeSelection.seed, entry.nativeSeed);
  assert.equal(sceneData.showreel.edgeSelection.candidatesEvaluated, 24);
  assert.equal(sceneData.showreel.edgeSelection.crossingPairCount, 0);
  assert.equal(sceneData.showreel.edgeSelection.continuousPathQualification, true);
  assert.equal(sceneData.showreel.edgeSelection.exitRetracesEntry, true);
  assert.equal(sceneData.showreel.edgeSelection.runtimeCalculation, false);
  assert.equal(new Set(sceneData.showreel.entryEdges).size, 3);
  assert.deepEqual(sceneData.showreel.exitEdges, sceneData.showreel.entryEdges);
  assert.deepEqual(sceneData.showreel.exitOffsets, sceneData.showreel.entryOffsets);
  assert.equal(sceneData.metrics.preparedAssemblyRootCount, 1);
  assert.equal(sceneData.metrics.preparedGearThetaSignPreserved, true);
  assert.equal(sceneData.metrics.preparedShowreelStateCount, 580);
  assert.equal(sceneData.metrics.preparedShowreelSpinMilliseconds, 15_000);
  assert.equal(sceneData.metrics.preparedShowreelEdgeCandidateCount, 24);
  assert.equal(sceneData.metrics.preparedShowreelCrossingPairCount, 0);
  assert.equal(sceneData.metrics.preparedShowreelContinuousPathQualified, true);
  assert.equal(sceneData.metrics.runtimeEdgeSelectionCount, 0);

  const lighting = sceneData.lighting;
  assert.equal(lighting.schema, "cssgears-prepared-opengl-static-render-atlas@1");
  assert.equal(lighting.faceCount, sceneData.metrics.sourcePolygonCount);
  assert.equal(lighting.sourceFaceCount, lighting.faceCount);
  assert.equal(lighting.leafCount, sceneData.metrics.preparedLeafCount);
  assert.equal(lighting.polygonLeafCount, sceneData.metrics.preparedPolygonLeafCount);
  assert.equal(lighting.bundleLeafCount, sceneData.metrics.preparedRenderBundleCount);
  assert.equal(lighting.bundledSourceFaceCount, sceneData.metrics.mergedSourceFaceCount);
  assert.equal(lighting.unbundledSourceFaceCount + lighting.bundledSourceFaceCount, lighting.faceCount);
  assert.equal(lighting.sourceFaceCoverageCount, lighting.faceCount);
  assert.equal(lighting.sourceFaceCoverageExact, true);
  assert.match(lighting.sourceFaceCoverageSha256, /^[a-f0-9]{64}$/u);
  assert.equal(lighting.atlasStateCount, 1);
  assert.equal(lighting.sourceStateCount, 720);
  assert.equal(lighting.canonicalSourceStateIndex, 0);
  assert.equal(
    lighting.lightingRotationPolicy,
    "prepared-product-scene-rotation-native-fixed-eye-space-light",
  );
  assert.deepEqual(lighting.lightingRotationDegrees, sceneData.sourceProfile.presentation.rotationDegrees);
  assert.deepEqual(lighting.nativeSceneRotationDegrees, sceneData.sourceProfile.sceneRotationDegrees);
  assert.deepEqual(lighting.presentationRotationDegrees, sceneData.sourceProfile.presentation.rotationDegrees);
  assert.equal(
    sceneData.sourceProfile.presentation.policy,
    "map-native-tilt-to-right-facing-source-lit-three-quarter-variance-preserve-roll",
  );
  assert.ok(lighting.lightingRotationDegrees[0] >= 16 && lighting.lightingRotationDegrees[0] <= 32);
  assert.equal(sceneData.sourceProfile.presentation.sourceRotationAdjusted, true);
  assert.notDeepEqual(lighting.lightingRotationDegrees, lighting.nativeSceneRotationDegrees);
  assert.equal(lighting.sourceTileWidth, 2);
  assert.equal(lighting.sourceTileHeight, 2);
  assert.equal(lighting.animatedFaceCount, 0);
  assert.equal(lighting.staticFaceCount, lighting.faceCount);
  assert.equal(lighting.animatedFaceIndices.length, 0);
  assert.equal(lighting.leafRows.length, lighting.leafCount);
  assert.ok(lighting.leafRows.every((row) =>
    Array.isArray(row) && row.length === 4 && row.every(Number.isSafeInteger) && row.every((value) => value >= 0)));
  assert.equal(lighting.packing, "maxrects-best-short-side-fit-minimum-maximum-dimension@1");
  assert.equal(lighting.gutterPixels, 1);
  assert.ok(lighting.atlasOccupancy > 0.85);
  assert.ok(lighting.leafRows.every(([x, y, width, height]) => x + width <= lighting.width && y + height <= lighting.height));
  assert.equal(lighting.decodedBytes, lighting.width * lighting.height * 4);
  assert.equal(lighting.runtime.lightingCalculations, 0);
  assert.equal(lighting.runtime.perLeafStyleWrites, 0);
  assert.equal(lighting.runtime.stylesheetRuleWritesPerPublishedState, 0);
  assert.equal(lighting.runtime.backgroundPositionWritesPerPublishedState, 0);
  assert.equal(lighting.runtime.rootLightingRowDependentFaceCount, 0);
  assert.equal(sceneData.metrics.runtimeLightingPublicationCount, 0);
  assert.equal(sceneData.metrics.preparedLightingUsesPresentationSceneRotation, true);
  assert.equal(sceneData.renderer.sourceBackfaceCulling, "GL_CULL_FACE");
  assert.equal(sceneData.renderer.sourceFrontFace, "GL_CCW");
  assert.equal(sceneData.renderer.preparedWinding, "flip-y-reflection-reversed-to-ccw");
  assert.match(snapshot, new RegExp(lighting.assetUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(snapshot, /\.g \.d/u);

  const lightingPath = join(generatedRoot, lighting.assetUrl.replace(/^\/cssgears\//u, ""));
  assert.ok(existsSync(lightingPath), "missing prepared lighting " + lightingPath);
  const lightingBytes = readFileSync(lightingPath);
  assert.equal(createHash("sha256").update(lightingBytes).digest("hex"), lighting.assetSha256);
  const lightingImage = PNG.sync.read(lightingBytes);
  assert.equal(lightingImage.width, lighting.width);
  assert.equal(lightingImage.height, lighting.height);

  const privateScenePath = join("build/generated/private/cssgears/scenes", `${entry.id}.prepared.json`);
  assert.ok(existsSync(privateScenePath), "missing private prepared scene " + privateScenePath);
  const privateScene = JSON.parse(readFileSync(privateScenePath, "utf8"));
  const coverage = privateScene.meshes.flatMap((mesh) =>
    mesh.polygons.flatMap((polygon) => polygon.sourceFaceIndices)).sort((left, right) => left - right);
  assert.equal(coverage.length, lighting.faceCount);
  assert.ok(coverage.every((sourceFaceIndex, index) => sourceFaceIndex === index));
}

function assertPreparedShowreelBank(manifest) {
  assert.equal(manifest.showreel.snapshotUrl, "/cssgears/scenes/bank.showreel.polycss.html");
  const snapshotPath = join(generatedRoot, manifest.showreel.snapshotUrl.replace(/^\/cssgears\//u, ""));
  assert.ok(existsSync(snapshotPath), "missing prepared showreel snapshot " + snapshotPath);
  const snapshot = readFileSync(snapshotPath, "utf8");
  assert.equal((snapshot.match(/class="g a"/gu) ?? []).length, 3);
  for (let index = 0; index < manifest.scenes.length; index += 1) {
    const token = manifest.showreel.sceneTokens[index].token;
    assert.equal(
      (snapshot.match(new RegExp(`class="${token}"`, "gu")) ?? []).length,
      manifest.scenes[index].metrics.preparedLeafCount,
    );
  }
  assert.equal((snapshot.match(/<b\b/gu) ?? []).length, manifest.showreel.retainedLeafCount);
  assert.equal((snapshot.match(/<div\b/gu) ?? []).length, 5);
  assert.doesNotMatch(snapshot, /\sdata-[\w-]+=/u);
  assert.doesNotMatch(snapshot, /<script|<canvas|<svg/iu);
  assert.match(snapshot, /\.g>b\{display:none\}/u);
  assert.match(snapshot, /\.g\.a>b\.a,\.g\.b>b\.b,\.g\.c>b\.c/u);
}
