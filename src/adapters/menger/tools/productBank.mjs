import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const CSSMENGER_PRODUCT_BANK_SCHEMA = "cssmenger-product-bank@1";

export async function inspectCssmengerProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schema === "cssmenger-manifest@1" && manifest.status === "ready",
    "manifest contract");
  assert(manifest.defaultScene?.id === "depth-3" && manifest.scenes?.length === 2 &&
    manifest.scenes[0]?.id === "depth-3" && manifest.scenes[1]?.id === "depth-2",
  "prepared scene identity");
  assert(manifest.artifactMode === "prepared-polycss-snapshot" &&
    manifest.runtime?.geometryPayload === false &&
    manifest.runtime?.runtimeDomGrowth === false,
  "manifest runtime boundary");

  const entry = manifest.scenes[0];
  const scenePath = productPath(entry.sceneUrl);
  const snapshotPath = productPath(entry.snapshotUrl);
  const sceneBytes = await readFile(join(root, scenePath));
  const sceneText = sceneBytes.toString("utf8");
  const scene = JSON.parse(sceneText);
  assert(scene.schema === "cssmenger-prepared-scene@1" && scene.id === "depth-3",
    "scene contract");
  assert(scene.source?.sourceRevision === "906693799e4fb7581436590cf84ecb2d3c9186ba" &&
    scene.sourceProfile?.seed === 26080801 && scene.sourceProfile?.depth === 3,
  "source identity");
  assert(scene.meshes === undefined && scene.meshDescriptors?.length === 3 &&
    scene.meshDescriptors.every((mesh) => mesh.polygonCount === 28),
  "prepared retained roots");
  assert(scene.metrics?.sourcePolygonCount === 18_048 &&
    scene.metrics?.sourceFaceCoverageCount === 18_048 &&
    scene.metrics?.sourceFaceCoverageExact === true &&
    scene.metrics?.sourceFaceCoverageSha256 === "5bb98301f900af4b1b15ae73ffbd7338836b67bb0bd48b26da6017b1874b60ea" &&
    scene.metrics?.preparedLeafCount === 84 &&
    scene.metrics?.mergedSourceFaceCount === 17_964 &&
    scene.metrics?.coplanarPartitionOptimal === true &&
    scene.metrics?.preparedPlaneTexturePatternCount === 8,
  "exact prepared coverage and merge");
  assert(scene.playback?.schema === "cssmenger-prepared-playback@1" &&
    scene.playback?.stateCount === 1_536 &&
    scene.playback?.transforms?.length === 1_536 &&
    scene.playback?.colorRows?.length === 1_536 &&
    scene.playback?.preparedRotationDegrees?.length === 1_536 &&
    scene.playback?.nativePrefixStateCount === 995 &&
    scene.playback?.loopMode === "prepared-forward-cyclic-c2-rotation-and-palette" &&
    scene.playback?.cycleClosure?.schema === "cssmenger-prepared-cyclic-rotation-closure@1" &&
    scene.playback?.cycleClosure?.stateCount === 1_536 &&
    scene.playback?.cycleClosure?.cycleDurationMilliseconds === 46_080 &&
    scene.playback?.cycleClosure?.orientationMaximumEquivalentDeltaDegrees === 0 &&
    scene.playback?.cycleClosure?.velocityMaximumDeltaDegreesPerTick < 1e-9 &&
    scene.playback?.cycleClosure?.accelerationMaximumDeltaDegreesPerTickSquared < 1e-9 &&
    scene.playback?.frontFacingSchedule?.schema === "cssmenger-prepared-front-facing-leaf-schedule@1" &&
    scene.playback?.frontFacingSchedule?.offsets?.length === 1_536 * 3 + 1 &&
    scene.playback.frontFacingSchedule.offsets.at(-1) === scene.playback.frontFacingSchedule.leafIndices?.length &&
    scene.playback.frontFacingSchedule.frontFaceDilationTicks === 1 &&
    scene.playback?.sourceFrameDelayMilliseconds === 30 &&
    scene.playback?.loop === true &&
    scene.playback?.adjacentPublicationMode === "all-fields-change" &&
    scene.playback?.runtimeInterpolation === false &&
    scene.playback?.runtimeColorGeneration === false &&
    scene.playback?.runtimeRotationCalculation === false,
  "prepared playback");
  assert(scene.renderer?.stableDom === true &&
    scene.renderer?.preparedPlaneGridSnap === "exact-source-cell-boundary-matrix3d" &&
    scene.renderer?.transformPresentation ===
      "compositor-css-keyframes-through-prepared-30ms-states-on-existing-scene-node" &&
    scene.renderer?.runtimeGeometryConstruction === false &&
    scene.renderer?.runtimeRecursion === false &&
    scene.renderer?.runtimeMerge === false &&
    scene.renderer?.runtimeColorGeneration === false &&
    scene.renderer?.runtimeRotationCalculation === false &&
    scene.renderer?.runtimeCameraCalculation === false &&
    scene.renderer?.runtimeDomGrowth === false &&
    scene.renderer?.alternateRenderer === false &&
    scene.renderer?.runtimeGeometryPayload === false,
  "scene runtime boundary");
  assert(scene.oracle?.nativeStateCapture === "qualified-local-exact-common-prefix-0-45" &&
    scene.oracle?.nativeVisualCapture === "qualified-local-bit-exact-aa-common-prefix-0-45" &&
    scene.oracle?.browserVisualCapture === "qualified-local-bit-exact-aa-common-prefix-0-45" &&
    scene.oracle?.visualComparison === "exact-first-common-prefix-diverged",
  "honest native oracle boundary");
  assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/)/u.test(sceneText), "public paths");

  const atlasPath = productPath(scene.planeAtlas?.assetUrl);
  const atlasBytes = await readFile(join(root, atlasPath));
  assert(atlasBytes.length === scene.planeAtlas?.byteLength &&
    sha256(atlasBytes) === scene.planeAtlas.assetSha256 &&
    scene.planeAtlas?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
    scene.planeAtlas?.profile === "desktop" &&
    /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(scene.planeAtlas?.assetUrl) &&
    scene.planeAtlas?.mimeType === "image/avif" &&
    scene.planeAtlas?.width === 16_362 && scene.planeAtlas?.height === 1_377 &&
    scene.planeAtlas?.leafCount === 84 &&
    scene.planeAtlas?.visibleLeafFieldCount === 65_436 &&
    scene.planeAtlas?.slotCount === 30_744 &&
    scene.planeAtlas?.exactDuplicateTileCount === 34_692 &&
    scene.planeAtlas?.lightingSampleIntervalTicks === 2 &&
    scene.planeAtlas?.lightingSampleDelayMilliseconds === 60 &&
    scene.planeAtlas?.lightingSampleCount === 768 &&
    scene.planeAtlas?.transformPublicationIntervalTicks === 1 &&
    scene.planeAtlas?.transformPublicationDelayMilliseconds === 30 &&
    scene.planeAtlas?.gutterPixels === 0 &&
    scene.planeAtlas?.addressScheduleSchema ===
      "cssmenger-prepared-exact-delta-lighting-address-schedule@1" &&
    scene.planeAtlas?.addressUpdateCount === 32_889 &&
    scene.planeAtlas?.addressStateOffsetByteLength === (1_536 + 1) * 2 &&
    scene.planeAtlas?.addressLeafIndexByteLength === 32_889 &&
    scene.planeAtlas?.addressSlotIndexByteLength === 32_889 * 2 &&
    scene.planeAtlas?.redundantAddressWriteCountRemoved === 32_547 &&
    scene.planeAtlas?.addressWriteCountPerState?.zeroWriteStateCount === 607 &&
    scene.planeAtlas?.sourceFaceCoverageExact === true,
  "prepared atlas identity");

  const mobileAtlasPath = productPath(scene.mobilePlaneAtlas?.assetUrl);
  const mobileAtlasBytes = await readFile(join(root, mobileAtlasPath));
  assert(mobileAtlasBytes.length === scene.mobilePlaneAtlas?.byteLength &&
    sha256(mobileAtlasBytes) === scene.mobilePlaneAtlas.assetSha256 &&
    scene.mobilePlaneAtlas?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
    scene.mobilePlaneAtlas?.profile === "mobile" &&
    /^\/cssmenger\/assets\/lighting-grid-mobile-[a-f0-9]{64}\.avif$/u.test(scene.mobilePlaneAtlas?.assetUrl) &&
    scene.mobilePlaneAtlas?.mimeType === "image/avif" &&
    scene.mobilePlaneAtlas?.width === 2_025 && scene.mobilePlaneAtlas?.height === 27 &&
    scene.mobilePlaneAtlas?.decodedBytes === 218_700 &&
    scene.mobilePlaneAtlas?.byteLength === 15_028 &&
    scene.mobilePlaneAtlas?.leafCount === 84 &&
    scene.mobilePlaneAtlas?.visibleLeafFieldCount === 65_436 &&
    scene.mobilePlaneAtlas?.slotCount === 75 &&
    scene.mobilePlaneAtlas?.lightingSampleIntervalTicks === 1_536 &&
    scene.mobilePlaneAtlas?.lightingSampleDelayMilliseconds === 46_080 &&
    scene.mobilePlaneAtlas?.lightingSampleCount === 1 &&
    scene.mobilePlaneAtlas?.addressUpdateCount === 84 &&
    scene.mobilePlaneAtlas?.addressInitializationWriteCount === 84 &&
    scene.mobilePlaneAtlas?.redundantAddressWriteCountRemoved === 65_352 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.maximum === 0 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.average === 0 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.zeroWriteStateCount === 1_536 &&
    scene.mobilePlaneAtlas?.addressInitialization === "all-leaf-addresses-before-playback" &&
    scene.mobilePlaneAtlas?.sourceFaceCoverageExact === true,
  "prepared mobile atlas identity");
  const cssOpacityAtlasPaths = await inspectCssOpacityAtlasPair(root, scene, 84);

  const snapshot = await readFile(join(root, snapshotPath), "utf8");
  assert(count(snapshot, /<b\b/gu) === 84 &&
    count(snapshot, /<i\b/gu) === 0 &&
    count(snapshot, /<s\b/gu) === 0 &&
    count(snapshot, /<div\b/gu) === 2 &&
    count(snapshot, /style="/gu) === 85 &&
    count(snapshot, /<b style="transform: matrix3d\(/gu) === 84 &&
    /matrix3d\(12\.222222222,/u.test(snapshot) &&
    count(snapshot, /<b><\/b>/gu) === 0 &&
    !/\.polycss-scene>b:nth-child\(\d+\)\{transform:/u.test(snapshot) &&
    /\.polycss-scene>b\{background-image:url\("\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif"\)\}/u.test(snapshot) &&
    /\.polycss-scene\.cssmenger-mobile-atlas.*lighting-grid-mobile-[a-f0-9]{64}\.avif/u.test(snapshot) &&
    snapshot.includes(scene.cssOpacityBaseAtlas.assetUrl) &&
    snapshot.includes(scene.cssOpacityShadowAtlas.assetUrl) &&
    count(snapshot, /%\{transform:rotateX/gu) === 1_537 &&
    /--cssmenger-rotation-duration:46080ms/u.test(snapshot) &&
    !/mask-image|-webkit-mask/u.test(snapshot) &&
    !/cssmenger-(?:model|axis)/u.test(snapshot) &&
    !/var\(--[mxyz]\)|--[mxyz]:|!important/iu.test(snapshot),
  "retained DOM");
  assert(!/\sdata-[\w-]+=/u.test(snapshot) && !/<(?:script|canvas|svg)\b/iu.test(snapshot),
    "lean DOM");

  const reducedEntry = manifest.scenes[1];
  const reducedScenePath = productPath(reducedEntry.sceneUrl);
  const reducedSnapshotPath = productPath(reducedEntry.snapshotUrl);
  const reducedSceneBytes = await readFile(join(root, reducedScenePath));
  const reducedSceneText = reducedSceneBytes.toString("utf8");
  const reducedScene = JSON.parse(reducedSceneText);
  assert(reducedScene.schema === "cssmenger-prepared-scene@1" && reducedScene.id === "depth-2" &&
    reducedScene.source?.sourceRevision === "906693799e4fb7581436590cf84ecb2d3c9186ba" &&
    reducedScene.sourceProfile?.seed === 26080801 && reducedScene.sourceProfile?.depth === 2,
  "reduced scene source identity");
  assert(reducedScene.meshes === undefined && reducedScene.meshDescriptors?.length === 3 &&
    reducedScene.meshDescriptors.every((mesh) => mesh.polygonCount === 10) &&
    reducedScene.metrics?.sourcePolygonCount === 1_056 &&
    reducedScene.metrics?.sourceFaceCoverageCount === 1_056 &&
    reducedScene.metrics?.sourceFaceCoverageExact === true &&
    reducedScene.metrics?.sourceFaceCoverageSha256 ===
      "b802d6c7e24245b5ac377d704c275aa052ee841edb75a94d08931f9e7dd4bc34" &&
    reducedScene.metrics?.preparedLeafCount === 30 &&
    reducedScene.metrics?.mergedSourceFaceCount === 1_026 &&
    reducedScene.metrics?.coplanarPartitionOptimal === true &&
    reducedScene.metrics?.preparedPlaneTexturePatternCount === 4,
  "reduced exact prepared coverage and merge");
  assert(reducedScene.playback?.schema === "cssmenger-prepared-playback@1" &&
    reducedScene.playback?.stateCount === 1_536 && reducedScene.playback?.loop === true &&
    reducedScene.playback?.loopMode === "prepared-forward-cyclic-c2-rotation-and-palette" &&
    reducedScene.playback?.sourceFrameDelayMilliseconds === 30 &&
    reducedScene.playback?.frontFacingSchedule?.offsets?.length === 1_536 * 3 + 1 &&
    reducedScene.playback.frontFacingSchedule.offsets.at(-1) ===
      reducedScene.playback.frontFacingSchedule.leafIndices?.length &&
    reducedScene.renderer?.stableDom === true && reducedScene.renderer?.runtimeGeometryPayload === false &&
    reducedScene.renderer?.preparedPlaneGridSnap === "exact-source-cell-boundary-matrix3d" &&
    reducedScene.renderer?.transformPresentation ===
      "compositor-css-keyframes-through-prepared-30ms-states-on-existing-scene-node" &&
    reducedScene.renderer?.runtimeGeometryConstruction === false &&
    reducedScene.renderer?.runtimeLightingCalculation === false &&
    reducedScene.renderer?.runtimeDomGrowth === false && reducedScene.renderer?.alternateRenderer === false,
  "reduced prepared runtime boundary");
  const reducedAtlasPaths = [];
  for (const [profile, reducedAtlas] of [
    ["desktop", reducedScene.planeAtlas],
    ["mobile", reducedScene.mobilePlaneAtlas],
  ]) {
    const reducedAtlasPath = productPath(reducedAtlas?.assetUrl);
    const reducedAtlasBytes = await readFile(join(root, reducedAtlasPath));
    const suffix = profile === "mobile" ? "-mobile" : "";
    assert(reducedAtlasBytes.length === 447_767 && reducedAtlas?.byteLength === 447_767 &&
      sha256(reducedAtlasBytes) === reducedAtlas.assetSha256 &&
      reducedAtlas?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
      reducedAtlas?.profile === profile &&
      new RegExp(`^/cssmenger/assets/lighting-grid${suffix}-[a-f0-9]{64}\\.avif$`, "u")
        .test(reducedAtlas?.assetUrl) &&
      reducedAtlas?.width === 16_380 && reducedAtlas?.height === 63 &&
      reducedAtlas?.decodedBytes === 4_127_760 && reducedAtlas?.leafCount === 30 &&
      reducedAtlas?.visibleLeafFieldCount === 23_234 && reducedAtlas?.slotCount === 10_962 &&
      reducedAtlas?.lightingSampleIntervalTicks === 2 &&
      reducedAtlas?.lightingSampleDelayMilliseconds === 60 &&
      reducedAtlas?.lightingSampleCount === 768 && reducedAtlas?.addressUpdateCount === 11_680 &&
      reducedAtlas?.addressInitializationWriteCount === 0 &&
      reducedAtlas?.addressWriteCountPerState?.maximum === 18 &&
      reducedAtlas?.addressWriteCountPerState?.zeroWriteStateCount === 690 &&
      reducedAtlas?.sourceFaceCoverageExact === true,
    `reduced ${profile} atlas identity`);
    reducedAtlasPaths.push(reducedAtlasPath);
  }
  const reducedCssOpacityAtlasPaths = await inspectCssOpacityAtlasPair(root, reducedScene, 30);
  const reducedSnapshot = await readFile(join(root, reducedSnapshotPath), "utf8");
  assert(count(reducedSnapshot, /<b\b/gu) === 30 &&
    count(reducedSnapshot, /<i\b/gu) === 0 && count(reducedSnapshot, /<s\b/gu) === 0 &&
    count(reducedSnapshot, /<div\b/gu) === 2 && count(reducedSnapshot, /style="/gu) === 31 &&
    count(reducedSnapshot, /<b style="transform: matrix3d\(/gu) === 30 &&
    /matrix3d\(36\.666666667,/u.test(reducedSnapshot) &&
    /--cssmenger-tile-width:9px;--cssmenger-tile-height:9px/u.test(reducedSnapshot) &&
    reducedSnapshot.includes(reducedScene.cssOpacityBaseAtlas.assetUrl) &&
    reducedSnapshot.includes(reducedScene.cssOpacityShadowAtlas.assetUrl) &&
    count(reducedSnapshot, /%\{transform:rotateX/gu) === 1_537 &&
    !/mask-image|-webkit-mask/u.test(reducedSnapshot) &&
    !/cssmenger-(?:model|axis)|!important|\sdata-[\w-]+=/u.test(reducedSnapshot) &&
    !/<(?:script|canvas|svg)\b/iu.test(reducedSnapshot),
  "reduced retained DOM");
  assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/)/u.test(reducedSceneText),
    "reduced public paths");

  const expectedFiles = new Set([
    "manifest.json", scenePath, snapshotPath, atlasPath, mobileAtlasPath,
    ...cssOpacityAtlasPaths, reducedScenePath, reducedSnapshotPath, ...reducedAtlasPaths,
    ...reducedCssOpacityAtlasPaths,
  ]);
  const files = (await walk(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "product-bank.json")
    .sort();
  assert(files.length === expectedFiles.size && files.every((path) => expectedFiles.has(path)),
    "exact product file closure");

  const closure = createHash("sha256");
  let closureBytes = 0;
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    closure.update(path).update("\0").update(bytes).update("\0");
    closureBytes += bytes.length;
  }

  const summary = Object.freeze({
    schema: CSSMENGER_PRODUCT_BANK_SCHEMA,
    closureSha256: closure.digest("hex"),
    closureBytes,
    fileCount: files.length,
    sceneCount: 2,
    retainedRenderWrapperCount: 2,
    retainedModelRootCount: 0,
    retainedLightingRootCount: 0,
    retainedAxisRootCount: 0,
    preparedLeafCount: 84,
    mobilePreparedLeafCount: 30,
    sourceFaceCount: 18_048,
    mergedSourceFaceCount: 17_964,
    mobileSourceFaceCount: 1_056,
    mobileMergedSourceFaceCount: 1_026,
    timelineStateCount: 1_536,
    playbackLoopMode: "prepared-forward-cyclic-c2-rotation-and-palette",
    paletteStateCount: 128,
    atlasAssetCount: 8,
    lightingAddressUpdateCount: scene.planeAtlas.addressUpdateCount,
    redundantLightingAddressWriteCountRemoved: scene.planeAtlas.redundantAddressWriteCountRemoved,
    mobileLightingAddressUpdateCount: reducedScene.mobilePlaneAtlas.addressUpdateCount,
    mobileRedundantLightingAddressWriteCountRemoved:
      reducedScene.mobilePlaneAtlas.redundantAddressWriteCountRemoved,
  });

  if (verifyDescriptor) {
    const descriptor = JSON.parse(await readFile(join(root, "product-bank.json"), "utf8"));
    for (const [key, value] of Object.entries(summary)) {
      assert(descriptor[key] === value, `product descriptor ${key}`);
    }
    assert(descriptor.nativeAlignment?.sourceSemantics ===
      "aligned-for-fixed-depth-3-desktop-and-depth-2-mobile-slices" &&
      descriptor.nativeAlignment?.visualParity === "unqualified" &&
      descriptor.publicBoundary?.xscreensaverSourceIncluded === false &&
      descriptor.publicBoundary?.nativeBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false &&
      descriptor.publicBoundary?.oraclePacketIncluded === false,
    "product public boundary");
  }
  return summary;
}

async function inspectCssOpacityAtlasPair(root, scene, expectedLeafCount) {
  const base = scene.cssOpacityBaseAtlas;
  const shadow = scene.cssOpacityShadowAtlas;
  const basePath = productPath(base?.assetUrl);
  const shadowPath = productPath(shadow?.assetUrl);
  const [baseBytes, shadowBytes] = await Promise.all([
    readFile(join(root, basePath)),
    readFile(join(root, shadowPath)),
  ]);
  assert(baseBytes.length === base?.byteLength && sha256(baseBytes) === base.assetSha256 &&
    base?.schema === "cssmenger-prepared-coplanar-plane-atlas@1" &&
    base?.paletteRole === "css-opacity-base" &&
    base?.rgbNormalization === "divide-by-maximum-rgb-channel" && base?.rgbScale === 0.75 &&
    base?.rgbCalibration === "native-oracle-common-prefix-display-range-scale" &&
    base?.encoding === "PNG-RGBA8" &&
    base?.paletteStateCount === 128 && base?.leafCount === expectedLeafCount &&
    base?.sourceFaceCoverageExact === true &&
    /^\/cssmenger\/assets\/planes-opacity-base-[a-f0-9]{64}\.png$/u.test(base?.assetUrl),
  "prepared CSS opacity base atlas identity");
  assert(shadowBytes.length === shadow?.byteLength && sha256(shadowBytes) === shadow.assetSha256 &&
    shadow?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
    shadow?.profile === "desktop" && shadow?.presentation === "css-black-alpha" &&
    shadow?.mimeType === "image/avif" && shadow?.leafCount === expectedLeafCount &&
    shadow?.lightingSampleIntervalTicks === 1 && shadow?.lightingSampleCount === 1_536 &&
    shadow?.addressPublicationIntervalTicks === 1 && shadow?.sourceFaceCoverageExact === true &&
    /^\/cssmenger\/assets\/lighting-shadow-grid-[a-f0-9]{64}\.avif$/u.test(shadow?.assetUrl),
  "prepared CSS opacity shadow atlas identity");
  return [basePath, shadowPath];
}

export async function writeCssmengerProductBankDescriptor(root, summary) {
  const descriptor = {
    ...summary,
    source: {
      repository: "https://github.com/Zygo/xscreensaver",
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      preparedSeed: 26080801,
      preparedDepths: [3, 2],
    },
    nativeAlignment: {
      sourceSemantics: "aligned-for-fixed-depth-3-desktop-and-depth-2-mobile-slices",
      visualParity: "unqualified",
    },
    transport: {
      archiveFormat: "tar+gzip",
      runtimeDownloadsArchive: false,
      deployUnpacksStaticFiles: true,
    },
    publicBoundary: {
      xscreensaverSourceIncluded: false,
      nativeBinaryIncluded: false,
      nativeCaptureIncluded: false,
      oraclePacketIncluded: false,
    },
  };
  await writeFile(join(root, "product-bank.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith("/cssmenger/") && !url.includes(".."),
    "safe product asset URL");
  return url.slice("/cssmenger/".length);
}

async function walk(root) {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Unsupported product-bank entry ${path}`);
  }
  return paths;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(text, expression) {
  return (text.match(expression) ?? []).length;
}

function assert(condition, label) {
  if (!condition) throw new Error(`cssMenger product bank failed ${label}`);
}
