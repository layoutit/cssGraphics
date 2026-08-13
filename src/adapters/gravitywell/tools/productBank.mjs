import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT } from "../src/cssgravitywell/renderContract.mjs";
import {
  CSSGRAVITYWELL_VIEWPORT_PROFILES,
  CSSGRAVITYWELL_VISIBILITY_ENCODING,
  CSSGRAVITYWELL_VISIBILITY_SCHEMA,
} from "../src/prepare/cssgravitywell/visibilitySchedule.mjs";

export const CSSGRAVITYWELL_PRODUCT_BANK_SCHEMA = "cssgravitywell-product-bank@2";
const RETAINED_LEAF_COUNT = 1_922;
const PREPARED_COLOR_COUNT = 512;
const LEGACY_VISIBILITY_SCHEMA = "cssgravitywell-prepared-viewport-visibility@1";
const LEGACY_VISIBILITY_ENCODING = "gzip-cgwv1-square-profile-sparse-visibility-assignments";
const LEGACY_VISIBILITY_PROFILE_SIZES = Object.freeze([1_024, 1_536, 1_920, 2_560, 3_840]);

export async function inspectCssgravitywellProductBank(root, { verifyDescriptor = true } = {}) {
  const expectedFiles = new Set(["catalog.json", "model/catalog.json"]);
  const catalogBytes = await readFile(join(root, "catalog.json"));
  const catalog = JSON.parse(catalogBytes);
  assert(catalog.schema === "cssgravitywell-prepared-bank-catalog@1" &&
    catalog.bankCount === 24 && catalog.entries?.length === 24 &&
    catalog.selection === "crypto-random-initial-then-shuffle-without-replacement" &&
    catalog.modelPackageRoot === "/cssgravitywell/model/" &&
    catalog.colorPaletteAsset?.distribution === "embedded-prepared-bank-catalog" &&
    catalog.colorPaletteAsset.encoding === "gzip-newline-utf8-prepared-css-colors" &&
    catalog.colorPaletteAsset.entryCount === PREPARED_COLOR_COUNT &&
    catalog.source?.commit === "906693799e4fb7581436590cf84ecb2d3c9186ba",
  "catalog contract");
  verifyEmbeddedAsset(catalog.colorPaletteAsset, "shared color palette");

  const modelCatalogBytes = await readFile(join(root, "model/catalog.json"));
  const modelCatalog = JSON.parse(modelCatalogBytes);
  assert(modelCatalog.schema === "polycss-morph.catalog@1" &&
    modelCatalog.defaultId === "gravitywell" && modelCatalog.packages?.length === 1 &&
    modelCatalog.packages[0]?.id === "gravitywell", "model catalog contract");
  const modelEntry = modelCatalog.packages[0];
  const modelManifestPath = safeRelativePath(`model/${modelEntry.manifestPath}`);
  expectedFiles.add(modelManifestPath);
  const modelManifestBytes = await readFile(join(root, modelManifestPath));
  assert(modelManifestBytes.byteLength > 0 && sha256(modelManifestBytes) === modelEntry.manifestSha256,
    "model manifest identity");
  const modelManifest = JSON.parse(modelManifestBytes);
  assert(modelManifest.schema === "polycss-morph.package@1" &&
    modelManifest.identity?.id === "gravitywell" && modelManifest.resources?.length === 1,
  "model manifest contract");
  const modelResource = modelManifest.resources[0];
  const modelPath = safeRelativePath(`model/gravitywell/${modelResource.path}`);
  expectedFiles.add(modelPath);
  const packedModelBytes = await readFile(join(root, modelPath));
  assert(modelPath.endsWith(".json.br") && packedModelBytes.byteLength > 0, "packed model transport");
  const modelBytes = brotliDecompressSync(packedModelBytes);
  assert(modelBytes.byteLength === modelResource.bytes && sha256(modelBytes) === modelResource.sha256,
    "model resource identity");
  const model = JSON.parse(modelBytes);
  assert(model.schema === "polycss-morph.model@1" && model.identity?.id === "gravitywell" &&
    model.render?.leaves?.length === RETAINED_LEAF_COUNT &&
      model.topology?.polygons?.length === RETAINED_LEAF_COUNT,
  "retained model contract");

  let preparedFrameCount = 0;
  let transformAssetCount = 0;
  let transformEncodedBytes = 0;
  let maximumTransformBlockPreparedCssStringBytes = 0;
  let maximumResidentTransformPreparedCssStringBytes = 0;
  let colorAssetCount = 0;
  let changeAssetCount = 0;
  let visibilityAssetCount = 0;
  let visibilityEncodedBytes = 0;
  const jsonTexts = [catalogBytes, modelCatalogBytes, modelManifestBytes, modelBytes]
    .map((bytes) => bytes.toString("utf8"));

  for (const [bankIndex, entry] of catalog.entries.entries()) {
    assert(entry.index === bankIndex && entry.id === `seed-${String(bankIndex).padStart(2, "0")}` &&
      Number.isSafeInteger(entry.seed) && entry.seed > 0 && entry.flatStateSha256 === catalog.flatStateSha256,
    `bank ${bankIndex} catalog entry`);
    const scenePath = productPath(entry.sceneUrl);
    expectedFiles.add(scenePath);
    const sceneBytes = await readFile(join(root, scenePath));
    assert(sceneBytes.byteLength === entry.sceneByteLength && sha256(sceneBytes) === entry.sceneSha256,
      `bank ${bankIndex} scene identity`);
    const sceneText = sceneBytes.toString("utf8");
    jsonTexts.push(sceneText);
    const scene = JSON.parse(sceneText);
    assert(scene.schema === "cssgravitywell-prepared-bank@1" && scene.bankIndex === bankIndex &&
      scene.bankId === entry.id && scene.seed === entry.seed &&
      scene.source?.commit === catalog.source.commit &&
      scene.playback?.schema === "cssgravitywell-sparse-transform-block-playback@1" &&
      scene.playback.leafCount === RETAINED_LEAF_COUNT &&
      scene.metrics?.preparedLeafCount === RETAINED_LEAF_COUNT &&
      scene.metrics.sourceCoarseGridSegmentCount === 1_922 &&
      scene.playback.blockCount === CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT &&
      scene.playback.blocks?.length === CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT &&
      scene.playback.runtimeLookaheadBlockCount === 1 &&
      scene.metrics.runtimeGeometryConstructionCount === 0 &&
      scene.metrics.runtimeTopologyConstructionCount === 0 &&
      scene.metrics.runtimeColorCalculationCount === 0 &&
      scene.metrics.runtimeAffineEvaluationCount === 0 &&
      scene.metrics.runtimeDomGrowth === false &&
      scene.timeline?.flatStateSha256 === catalog.flatStateSha256 &&
      scene.timeline.firstAndLastGroundFlat === true &&
      scene.timeline.allWellsCompleteBeforeSwitch === true &&
      scene.timeline.terminalFlatFrameIndex === scene.playback.frameCount - 1,
    `bank ${bankIndex} prepared runtime contract`);
    preparedFrameCount += scene.playback.frameCount;
    maximumResidentTransformPreparedCssStringBytes = Math.max(
      maximumResidentTransformPreparedCssStringBytes,
      ...scene.playback.blocks.map((block, index) => block.preparedCssStringByteLength +
        (scene.playback.blocks[index + 1]?.preparedCssStringByteLength ?? 0)),
    );

    for (const [blockIndex, descriptor] of scene.playback.blocks.entries()) {
      const expectedStart = blockIndex * scene.playback.blockFrameCount;
      const expectedFrameCount = Math.min(
        scene.playback.blockFrameCount,
        scene.playback.frameCount - expectedStart,
      );
      assert(descriptor.schema === "cssgravitywell-sparse-transform-block@1" &&
        descriptor.index === blockIndex && descriptor.startFrameIndex === expectedStart &&
        descriptor.frameCount === expectedFrameCount &&
        descriptor.keyframeTransformCount === RETAINED_LEAF_COUNT &&
        descriptor.deltaTransformCount === descriptor.transformChangeEnd - descriptor.transformChangeStart &&
        descriptor.transformCount === descriptor.keyframeTransformCount + descriptor.deltaTransformCount &&
        descriptor.colorChangeStart === scene.playback.changeAsset.colorOffsets[expectedStart] &&
        descriptor.colorChangeEnd === scene.playback.changeAsset.colorOffsets[expectedStart + expectedFrameCount] &&
        descriptor.colorValueCount === RETAINED_LEAF_COUNT +
          descriptor.colorChangeEnd - descriptor.colorChangeStart &&
        descriptor.preparedCssStringByteLength >= descriptor.transformCount &&
        descriptor.matrixDecimalPlaces === 2 &&
        JSON.stringify(descriptor.matrixVariableComponents) === JSON.stringify([0, 1, 2, 4, 5, 8, 9, 10, 12, 13, 14]) &&
        descriptor.encoding === "gzip-field-major-delta-varint-fixed2-matrix-and-bank-schedule@2",
      `bank ${bankIndex} transform descriptor`);
      const path = productPath(descriptor.assetUrl);
      expectedFiles.add(path);
      await verifyAsset(root, path, descriptor.byteLength, descriptor.sha256, `bank ${bankIndex} transform`);
      transformAssetCount += 1;
      transformEncodedBytes += descriptor.byteLength;
      maximumTransformBlockPreparedCssStringBytes = Math.max(
        maximumTransformBlockPreparedCssStringBytes,
        descriptor.preparedCssStringByteLength,
      );
    }
    const color = scene.playback.colorAsset;
    assert(color?.distribution === "prepared-transform-blocks" &&
      color.encoding === "uint16le-block-keyframe-then-frame-major-sparse-fogged-palette-index" &&
      color.paletteSource === "prepared-bank-catalog" && color.decodedByteLength > 0,
    `bank ${bankIndex} colors`);
    colorAssetCount += 1;
    const changes = scene.playback.changeAsset;
    assert(changes?.distribution === "prepared-transform-block-0" &&
      changes.encoding === "frame-major-reset-delta-varint-transform-indices-then-color-indices" &&
      changes.decodedByteLength > 0,
    `bank ${bankIndex} changes`);
    changeAssetCount += 1;
    const visibility = scene.playback.visibilityAsset;
    const legacySquareVisibility = visibility?.schema === LEGACY_VISIBILITY_SCHEMA;
    const preparedVisibilityContract = legacySquareVisibility
      ? visibility.encoding === LEGACY_VISIBILITY_ENCODING &&
        visibility.selection === "smallest-square-profile-covering-maximum-css-viewport-axis-or-disabled" &&
        JSON.stringify(visibility.profileSizes) === JSON.stringify(LEGACY_VISIBILITY_PROFILE_SIZES) &&
        visibility.profiles?.length === visibility.profileSizes.length
      : visibility?.schema === CSSGRAVITYWELL_VISIBILITY_SCHEMA &&
        visibility.encoding === CSSGRAVITYWELL_VISIBILITY_ENCODING &&
        visibility.selection === "smallest-area-rectangular-profile-covering-css-viewport-or-disabled" &&
        JSON.stringify(visibility.profileDimensions) === JSON.stringify(CSSGRAVITYWELL_VIEWPORT_PROFILES) &&
        visibility.profiles?.length === visibility.profileDimensions.length;
    assert(preparedVisibilityContract &&
      visibility.distribution === "embedded-prepared-bank-scene" &&
      visibility.frameCount === scene.playback.frameCount &&
      visibility.leafCount === RETAINED_LEAF_COUNT &&
      visibility.marginPixels === 8 && visibility.dilationFrames === 1,
    `bank ${bankIndex} viewport visibility`);
    verifyEmbeddedAsset(visibility, `bank ${bankIndex} viewport visibility`);
    visibilityAssetCount += 1;
    visibilityEncodedBytes += visibility.byteLength;
  }

  assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/)/u.test(jsonTexts.join("\n")),
    "public paths");
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
    schema: CSSGRAVITYWELL_PRODUCT_BANK_SCHEMA,
    closureSha256: closure.digest("hex"),
    closureBytes,
    fileCount: files.length,
    bankCount: catalog.bankCount,
    retainedShapeRootCount: 1,
    retainedLeafCount: RETAINED_LEAF_COUNT,
    preparedFrameCount,
    transformAssetCount,
    transformEncodedBytes,
    maximumTransformBlockPreparedCssStringBytes,
    maximumResidentTransformPreparedCssStringBytes,
    colorAssetCount,
    changeAssetCount,
    visibilityAssetCount,
    visibilityEncodedBytes,
    flatStateSha256: catalog.flatStateSha256,
  });

  if (verifyDescriptor) {
    const descriptorBytes = await readFile(join(root, "product-bank.json"));
    const descriptor = JSON.parse(descriptorBytes);
    for (const [key, value] of Object.entries(summary)) assert(descriptor[key] === value, `descriptor ${key}`);
    assert(descriptor.nativeAlignment?.stateOracle === "qualified-local-tolerance-0.002" &&
      descriptor.nativeAlignment?.visualParity === "unqualified" &&
      descriptor.publicBoundary?.xscreensaverSourceIncluded === false &&
      descriptor.publicBoundary?.nativeBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false &&
      descriptor.publicBoundary?.oraclePacketIncluded === false,
    "descriptor public boundary");
  }
  return summary;
}

export async function writeCssgravitywellProductBankDescriptor(root, summary) {
  const descriptor = {
    ...summary,
    source: {
      repository: "https://github.com/Zygo/xscreensaver",
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      preparedSeedCount: 24,
      nativeAuthorityStatus: "qualified-locally-not-packaged",
    },
    nativeAlignment: {
      stateOracle: "qualified-local-tolerance-0.002",
      visualParity: "unqualified",
    },
    transport: {
      archiveFormat: "tar+gzip",
      runtimeDownloadsArchive: false,
      deployUnpacksStaticFiles: true,
      preparedTransformEncoding: "content-addressed-gzip-field-major-delta-varint-fixed2-matrix-color-and-index-schedules",
      preparedScheduleEncoding: "selected-bank-transform-block-zero-shared-gzip-container",
      preparedVisibilityEncoding: "embedded-gzip-cgwv2-rectangular-profile-sparse-visibility-assignments",
      preparedModelEncoding: "content-addressed-brotli-json-expanded-by-http-content-encoding",
      startupFetch: "selected-bank-first-next-bank-prefetch",
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

async function verifyAsset(root, path, expectedLength, expectedSha256, label) {
  const bytes = await readFile(join(root, path));
  assert(bytes.byteLength === expectedLength && sha256(bytes) === expectedSha256, `${label} identity`);
}

function verifyEmbeddedAsset(descriptor, label) {
  assert(["embedded-prepared-bank-scene", "embedded-prepared-bank-catalog"].includes(descriptor?.distribution) &&
    typeof descriptor.encodedBase64 === "string" && descriptor.encodedBase64.length > 0,
  `${label} embedded descriptor`);
  const bytes = Buffer.from(descriptor.encodedBase64, "base64");
  assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
    `${label} identity`);
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith("/cssgravitywell/") && !url.includes(".."),
    "safe product asset URL");
  return safeRelativePath(url.slice("/cssgravitywell/".length));
}

function safeRelativePath(path) {
  assert(typeof path === "string" && path.length > 0 && !path.startsWith("/") &&
    !path.split("/").includes(".."), "safe relative path");
  return path;
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

function assert(condition, label) {
  if (!condition) throw new Error(`cssGravityWell product bank failed ${label}`);
}
