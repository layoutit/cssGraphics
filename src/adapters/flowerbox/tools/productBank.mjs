import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const FLOWERBOX_PRODUCT_BANK_SCHEMA = "cssflower-product-bank@4";

export async function inspectFlowerboxProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const entry = manifest.scenes?.find((candidate) => candidate.id === "default-cube");
  assert(manifest.schema === "cssflower-manifest@1" && manifest.status === "ready", "manifest contract");
  assert(entry?.sceneUrl === "/cssflower/scenes/default-cube.json.gz", "scene URL");
  assert(entry?.snapshotUrl === "/cssflower/scenes/default-cube.polycss.html.gz", "snapshot URL");

  const sceneEncoded = await readFile(join(root, "scenes", "default-cube.json.gz"));
  const snapshotEncoded = await readFile(join(root, "scenes", "default-cube.polycss.html.gz"));
  const sceneDecoded = gunzipSync(sceneEncoded);
  const snapshotDecoded = gunzipSync(snapshotEncoded);
  const scene = JSON.parse(sceneDecoded.toString("utf8"));
  const playback = scene.playback;
  const transforms = playback?.transformAsset;
  const lighting = scene.lighting;
  const visibility = playback?.frontFacingSchedule;

  assert(scene.schema === "cssflower-prepared-scene@1", "scene schema");
  assert(scene.metrics?.preparedLeafCount === 1_200 && scene.metrics?.preparedRootCount === 1,
    "retained counts");
  assert(scene.metrics?.preparedTimelineStateCount === 360 &&
    scene.metrics?.preparedGeometryStateCount === 73 &&
    scene.metrics?.retainedSourceOracleTimelineStateCount === 9_331,
  "prepared cycle counts");
  assert(scene.renderer?.morphTarget === "createPolyMorphPreparedDomTarget" &&
    scene.renderer?.stableDom === true && scene.renderer?.merge === false,
  "retained Morph target");
  assert(scene.metrics?.mergedCellCount === 0 && scene.metrics?.mergeEligibleCellCount === 0,
    "triangle topology");
  assert(scene.metrics?.runtimePolygonConstructionCount === 0 &&
    scene.metrics?.runtimeRadialProjectionCount === 0 &&
    scene.metrics?.runtimeNormalCalculationCount === 0 &&
    scene.metrics?.runtimeLightingCalculationCount === 0 &&
    scene.metrics?.runtimeDomGrowth === false,
  "zero runtime construction");
  assert(playback?.schema === "cssflower-prepared-playback@1" &&
    playback.scope === "rounded-product-cycle-positive-petals-omitted-negative-cube-lobe-retained" &&
    playback.cycle?.schema === "cssflower-prepared-rounded-product-cycle@2" &&
    playback.cycle?.stateCount === 360 && playback.cycle?.geometryStateCount === 73 &&
    playback.cycle?.bloomCycleLength === 180 &&
    playback.cycle?.bloomPeakSfHex === "401cccc8" &&
    playback.cycle?.bloomMinimumSfHex === "bf933332" &&
    playback.cycle?.states?.length === 360 && playback.cycle?.rootTransforms?.length === 360,
  "rounded prepared cycle");
  assert(!Object.hasOwn(playback, "projectedPixels"), "projected product removed");
  assert(visibility?.schema === "cssflower-prepared-front-face-transform-schedule@2" &&
    visibility.encoding === "base64-u16le-sparse-state-ranges" &&
    visibility.minimumOwnedPixels === 8 && visibility.stateCount === 360 &&
    visibility.faceCount === 1_200 && visibility.selectedFaceCount === 166_886 &&
    visibility.visibilityChangeCount === 8_310 &&
    visibility.initialVisibilitySelectionCount === 1_200 &&
    validOffsets(visibility.selectedFaceOffsets, 361, visibility.selectedFaceCount) &&
    validPreparedPayload(
      visibility.selectedFaceIndicesBase64,
      visibility.selectedFaceIndicesByteLength,
      visibility.selectedFaceIndicesSha256,
      visibility.selectedFaceCount * 2,
    ) &&
    validOffsets(visibility.visibilityChangeOffsets, 361, visibility.visibilityChangeCount) &&
    validPreparedPayload(
      visibility.visibilityChangeAssignmentsBase64,
      visibility.visibilityChangeAssignmentsByteLength,
      visibility.visibilityChangeAssignmentsSha256,
      visibility.visibilityChangeCount * 2,
    ) &&
    validPreparedPayload(
      visibility.initialVisibilityAssignmentsBase64,
      visibility.initialVisibilityAssignmentsByteLength,
      visibility.initialVisibilityAssignmentsSha256,
      visibility.faceCount * 2,
    ) &&
    visibility.runtimeSelection ===
      "prepared-sparse-state-ranges-only-no-face-wide-tests-or-geometry-projection-normal-lighting-calculation",
  "prepared visibility schedule");
  assert(transforms?.schema === "cssflower-prepared-matrix3d-blocks@1" &&
    transforms.blockCount === 5 && transforms.blocks?.length === 5 &&
    transforms.geometryStateCount === 73 && transforms.triangleCount === 1_200,
  "prepared transform blocks");
  assert(lighting?.schema === "cssflower-prepared-space-texel-lighting@6" &&
    lighting.boundaryClipMaximumSf === 1.0000001192092896 &&
    lighting.boundaryClipMaximumSfHex === "3f800001" &&
    lighting.timelineRowCount === 360 && lighting.faceCount === 1_200 &&
    lighting.grid?.schema === "cssflower-prepared-leaf-lighting-grid@1" &&
    lighting.grid?.encoding === "avif-flat-12x1-lossy-q83-alpha-lossless-speed4-yuv444" &&
    lighting.grid?.quality === 83 && lighting.grid?.alphaQuality === 100 &&
    lighting.grid?.alphaCoverage ===
      "mario-rounded-triangle-4x4-supersampled-nearest-shared-edge-conjoined-through-sf-3f800001-side-boundary-half-plane-clipped-all-shared-vertex-half-texel-inset-one-texel-guarded-max-pool" &&
    lighting.grid?.columns === 12 && lighting.grid?.rows === 1 &&
    lighting.pages?.every((page) => page.sourceEncoding === "PNG-RGBA8") &&
    lighting.assetCount === 1 && lighting.faces?.length === 1_200,
  "prepared q83 lighting grid");
  assert(!scene.meshes && !scene.oracle && !playback.stateEvidenceUrl && !transforms.sourceFloat32,
    "product-only scene");
  assert(!manifest.assets?.stateEvidence && !manifest.productionTransport?.assets?.some((asset) =>
    asset.id === "state-evidence"), "state evidence excluded");

  const publicText = `${manifestBytes}\n${sceneDecoded}`;
  assert(!/(?:\/Users\/|\\Users\\|file:\/\/|\.local\/|\/opt\/homebrew\/|nativeQualification|executableSha256|compilerSha256|stateEvidenceUrl)/u.test(publicText),
    "private oracle metadata excluded");

  const snapshot = snapshotDecoded.toString("utf8");
  assert(count(snapshot, /\sdata-[a-z0-9-]+=/giu) === 0, "snapshot data attributes");
  assert(count(snapshot, /<u class="[a-zA-Z]{1,2}"><\/u>/gu) === 1_200, "snapshot leaves");
  assert(count(snapshot, /\.polycss-mesh>u\.[a-zA-Z]{1,2} \{/gu) === 1_200,
    "snapshot leaf rules");
  assert(count(snapshot, /class="polycss-camera"/gu) === 1 &&
    count(snapshot, /class="polycss-scene"/gu) === 1 &&
    count(snapshot, /class="polycss-mesh"/gu) === 1,
  "snapshot retained hierarchy");
  assert(count(snapshot, /<(?:script|canvas|svg)\b/giu) === 0, "snapshot forbidden elements");
  assert(sha256(snapshotDecoded) === entry.snapshot.sha256, "snapshot decoded identity");
  assert(snapshotDecoded.length === entry.snapshot.byteLength, "snapshot decoded length");

  const expectedAssetPaths = new Set([
    "manifest.json",
    "scenes/default-cube.json.gz",
    "scenes/default-cube.polycss.html.gz",
  ]);
  let transformBytes = 0;
  for (const block of transforms.blocks) {
    const path = productPath(block.assetUrl);
    const bytes = await readFile(join(root, path));
    assert(bytes.length === block.byteLength && sha256(bytes) === block.sha256,
      `transform block ${block.index} identity`);
    const decoded = gunzipSync(bytes);
    assert(decoded.length === block.decodedByteLength && sha256(decoded) === block.decodedSha256,
      `transform block ${block.index} decoded identity`);
    expectedAssetPaths.add(path);
    transformBytes += bytes.length;
  }
  assert(transformBytes === transforms.byteLength, "transform aggregate bytes");

  const lightingPath = productPath(lighting.grid.assetUrl);
  const lightingBytes = await readFile(join(root, lightingPath));
  assert(lightingBytes.length === lighting.grid.byteLength &&
    sha256(lightingBytes) === lighting.grid.sha256 &&
    lighting.grid.sha256 === lighting.assetSha256,
  "lighting grid identity");
  assert(lightingBytes.subarray(4, 12).toString("ascii").startsWith("ftypavi"), "lighting AVIF signature");
  expectedAssetPaths.add(lightingPath);

  const files = (await walk(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "product-bank.json")
    .sort();
  assert(files.length === expectedAssetPaths.size && files.every((path) => expectedAssetPaths.has(path)),
    "exact product file closure");
  const closure = createHash("sha256");
  let closureBytes = 0;
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    closure.update(path).update("\0").update(bytes).update("\0");
    closureBytes += bytes.length;
  }

  const summary = Object.freeze({
    schema: FLOWERBOX_PRODUCT_BANK_SCHEMA,
    closureSha256: closure.digest("hex"),
    closureBytes,
    fileCount: files.length,
    retainedTriangleLeafCount: 1_200,
    retainedRotationRootCount: 1,
    timelineStateCount: 360,
    geometryStateCount: 73,
    retainedSourceOracleTimelineStateCount: 9_331,
    transformBlockCount: transforms.blockCount,
    transformAssetBytes: transformBytes,
    lightingAssetCount: 1,
    lightingAssetBytes: lightingBytes.length,
    lightingQuality: lighting.grid.quality,
    visibilityMinimumOwnedPixels: visibility.minimumOwnedPixels,
    frontFacingScheduleSchema: visibility.schema,
    frontFacingSelectedFaceCount: visibility.selectedFaceCount,
    frontFacingVisibilityChangeCount: visibility.visibilityChangeCount,
    frontFacingSparsePayloadBytes: visibility.selectedFaceIndicesByteLength +
      visibility.visibilityChangeAssignmentsByteLength +
      visibility.initialVisibilityAssignmentsByteLength,
    sceneEncodedSha256: sha256(sceneEncoded),
    sceneDecodedSha256: sha256(sceneDecoded),
    snapshotEncodedSha256: sha256(snapshotEncoded),
    snapshotDecodedSha256: sha256(snapshotDecoded),
  });
  if (verifyDescriptor) {
    const descriptor = JSON.parse(await readFile(join(root, "product-bank.json"), "utf8"));
    for (const [key, value] of Object.entries(summary)) {
      assert(descriptor[key] === value, `product descriptor ${key}`);
    }
    assert(descriptor.publicBoundary?.microsoftSourceIncluded === false &&
      descriptor.publicBoundary?.microsoftBinaryIncluded === false &&
      descriptor.publicBoundary?.nativeCaptureIncluded === false &&
      descriptor.publicBoundary?.oraclePacketIncluded === false,
    "product public boundary");
  }
  return summary;
}

export async function writeFlowerboxProductBankDescriptor(root, summary, source) {
  const descriptor = {
    ...summary,
    source,
    transport: {
      archiveFormat: "tar+gzip",
      runtimeDownloadsArchive: false,
      deployUnpacksStaticFiles: true,
    },
    publicBoundary: {
      microsoftSourceIncluded: false,
      microsoftBinaryIncluded: false,
      nativeCaptureIncluded: false,
      oraclePacketIncluded: false,
    },
  };
  await writeFile(join(root, "product-bank.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  return descriptor;
}

function productPath(url) {
  assert(typeof url === "string" && url.startsWith("/cssflower/") && !url.includes(".."),
    "safe product asset URL");
  return url.slice("/cssflower/".length);
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

function validOffsets(offsets, expectedLength, expectedLast) {
  return offsets?.length === expectedLength && offsets[0] === 0 && offsets.at(-1) === expectedLast &&
    offsets.every((value, index) => Number.isSafeInteger(value) && value >= 0 &&
      (index === 0 || value >= offsets[index - 1]));
}

function validPreparedPayload(base64, byteLength, digest, expectedByteLength) {
  if (typeof base64 !== "string" || byteLength !== expectedByteLength ||
      !/^[a-f0-9]{64}$/u.test(digest ?? "")) return false;
  const bytes = Buffer.from(base64, "base64");
  return bytes.length === byteLength && sha256(bytes) === digest;
}

function count(text, expression) {
  return (text.match(expression) ?? []).length;
}

function assert(condition, label) {
  if (!condition) throw new Error(`Flower Box product bank failed ${label}`);
}
