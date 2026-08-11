import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const CSSMENGER_PRODUCT_BANK_SCHEMA = "cssmenger-product-bank@1";

export async function inspectCssmengerProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schema === "cssmenger-manifest@1" && manifest.status === "ready",
    "manifest contract");
  assert(manifest.defaultScene?.id === "depth-3" && manifest.scenes?.length === 1 &&
    manifest.scenes[0]?.id === "depth-3", "prepared scene identity");
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
    scene.playback?.stateCount === 1_440 &&
    scene.playback?.transforms?.length === 1_440 &&
    scene.playback?.colorRows?.length === 1_440 &&
    scene.playback?.frontFacingSchedule?.schema === "cssmenger-prepared-front-facing-leaf-schedule@1" &&
    scene.playback?.frontFacingSchedule?.offsets?.length === 1_440 * 3 + 1 &&
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
    scene.planeAtlas?.width === 16_362 && scene.planeAtlas?.height === 1_323 &&
    scene.planeAtlas?.leafCount === 84 &&
    scene.planeAtlas?.visibleLeafFieldCount === 61_524 &&
    scene.planeAtlas?.slotCount === 29_406 &&
    scene.planeAtlas?.exactDuplicateTileCount === 32_118 &&
    scene.planeAtlas?.lightingSampleIntervalTicks === 2 &&
    scene.planeAtlas?.lightingSampleDelayMilliseconds === 60 &&
    scene.planeAtlas?.lightingSampleCount === 720 &&
    scene.planeAtlas?.transformPublicationIntervalTicks === 1 &&
    scene.planeAtlas?.transformPublicationDelayMilliseconds === 30 &&
    scene.planeAtlas?.gutterPixels === 0 &&
    scene.planeAtlas?.addressScheduleSchema ===
      "cssmenger-prepared-exact-delta-lighting-address-schedule@1" &&
    scene.planeAtlas?.addressUpdateCount === 30_989 &&
    scene.planeAtlas?.addressStateOffsetByteLength === (1_440 + 1) * 2 &&
    scene.planeAtlas?.addressLeafIndexByteLength === 30_989 &&
    scene.planeAtlas?.addressSlotIndexByteLength === 30_989 * 2 &&
    scene.planeAtlas?.redundantAddressWriteCountRemoved === 30_535 &&
    scene.planeAtlas?.addressWriteCountPerState?.zeroWriteStateCount === 546 &&
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
    scene.mobilePlaneAtlas?.visibleLeafFieldCount === 61_524 &&
    scene.mobilePlaneAtlas?.slotCount === 75 &&
    scene.mobilePlaneAtlas?.lightingSampleIntervalTicks === 1_440 &&
    scene.mobilePlaneAtlas?.lightingSampleDelayMilliseconds === 43_200 &&
    scene.mobilePlaneAtlas?.lightingSampleCount === 1 &&
    scene.mobilePlaneAtlas?.addressUpdateCount === 84 &&
    scene.mobilePlaneAtlas?.addressInitializationWriteCount === 84 &&
    scene.mobilePlaneAtlas?.redundantAddressWriteCountRemoved === 61_440 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.maximum === 0 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.average === 0 &&
    scene.mobilePlaneAtlas?.addressWriteCountPerState?.zeroWriteStateCount === 1_440 &&
    scene.mobilePlaneAtlas?.addressInitialization === "all-leaf-addresses-before-playback" &&
    scene.mobilePlaneAtlas?.sourceFaceCoverageExact === true,
  "prepared mobile atlas identity");

  const snapshot = await readFile(join(root, snapshotPath), "utf8");
  assert(count(snapshot, /<b\b/gu) === 84 &&
    count(snapshot, /<i\b/gu) === 0 &&
    count(snapshot, /<s\b/gu) === 0 &&
    count(snapshot, /<div\b/gu) === 2 &&
    count(snapshot, /style="/gu) === 85 &&
    count(snapshot, /<b style="transform: matrix3d\(/gu) === 84 &&
    count(snapshot, /<b><\/b>/gu) === 0 &&
    !/\.polycss-scene>b:nth-child\(\d+\)\{transform:/u.test(snapshot) &&
    /body>\.polycss-camera>\.polycss-scene>b\{background-image:url\("\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif"\)\}/u.test(snapshot) &&
    /\.polycss-scene\.cssmenger-mobile-atlas.*lighting-grid-mobile-[a-f0-9]{64}\.avif/u.test(snapshot) &&
    !/cssmenger-(?:model|axis)/u.test(snapshot) &&
    !/var\(--[mxyz]\)|--[mxyz]:|!important/iu.test(snapshot),
  "retained DOM");
  assert(!/\sdata-[\w-]+=/u.test(snapshot) && !/<(?:script|canvas|svg)\b/iu.test(snapshot),
    "lean DOM");

  const expectedFiles = new Set(["manifest.json", scenePath, snapshotPath, atlasPath, mobileAtlasPath]);
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
    sceneCount: 1,
    retainedRenderWrapperCount: 2,
    retainedModelRootCount: 0,
    retainedAxisRootCount: 0,
    preparedLeafCount: 84,
    sourceFaceCount: 18_048,
    mergedSourceFaceCount: 17_964,
    timelineStateCount: 1_440,
    paletteStateCount: 128,
    atlasAssetCount: 2,
    lightingAddressUpdateCount: scene.planeAtlas.addressUpdateCount,
    redundantLightingAddressWriteCountRemoved: scene.planeAtlas.redundantAddressWriteCountRemoved,
    mobileLightingAddressUpdateCount: scene.mobilePlaneAtlas.addressUpdateCount,
    mobileRedundantLightingAddressWriteCountRemoved:
      scene.mobilePlaneAtlas.redundantAddressWriteCountRemoved,
  });

  if (verifyDescriptor) {
    const descriptor = JSON.parse(await readFile(join(root, "product-bank.json"), "utf8"));
    for (const [key, value] of Object.entries(summary)) {
      assert(descriptor[key] === value, `product descriptor ${key}`);
    }
    assert(descriptor.nativeAlignment?.sourceSemantics === "aligned-for-fixed-depth-3-slice" &&
      descriptor.nativeAlignment?.visualParity === "unqualified" &&
      descriptor.publicBoundary?.xscreensaverSourceIncluded === false &&
      descriptor.publicBoundary?.nativeBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false &&
      descriptor.publicBoundary?.oraclePacketIncluded === false,
    "product public boundary");
  }
  return summary;
}

export async function writeCssmengerProductBankDescriptor(root, summary) {
  const descriptor = {
    ...summary,
    source: {
      repository: "https://github.com/Zygo/xscreensaver",
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      preparedSeed: 26080801,
      preparedDepth: 3,
    },
    nativeAlignment: {
      sourceSemantics: "aligned-for-fixed-depth-3-slice",
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
