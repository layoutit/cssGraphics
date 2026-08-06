import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const FLOWERBOX_PRODUCT_BANK_SCHEMA = "cssflower-product-bank@2";

export async function inspectFlowerboxProductBank(root, { verifyDescriptor = true } = {}) {
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const entry = manifest.scenes?.find((candidate) => candidate.id === "default-cube");
  assert(manifest.schema === "cssflower-manifest@1" && manifest.status === "ready", "manifest contract");
  assert(entry?.sceneUrl === "/cssflower/scenes/default-cube.json.gz", "scene URL");
  assert(entry?.snapshotUrl === "/cssflower/scenes/default-cube.polycss.html.gz", "snapshot URL");

  const scenePath = join(root, "scenes", "default-cube.json.gz");
  const snapshotPath = join(root, "scenes", "default-cube.polycss.html.gz");
  const sceneEncoded = await readFile(scenePath);
  const snapshotEncoded = await readFile(snapshotPath);
  const sceneDecoded = gunzipSync(sceneEncoded);
  const snapshotDecoded = gunzipSync(snapshotEncoded);
  const scene = JSON.parse(sceneDecoded.toString("utf8"));
  const projected = scene.playback?.projectedPixels;

  assert(scene.schema === "cssflower-prepared-scene@1", "scene schema");
  assert(scene.metrics?.preparedLeafCount === 1_200 && scene.metrics?.preparedRootCount === 1, "retained counts");
  assert(scene.renderer?.morphTarget === "createPolyMorphPreparedDomTarget" && scene.renderer?.stableDom === true, "retained Morph target");
  assert(scene.renderer?.merge === false && scene.metrics?.mergedCellCount === 0, "triangle topology");
  assert(scene.metrics?.runtimePolygonConstructionCount === 0 && scene.metrics?.runtimeRadialProjectionCount === 0 &&
    scene.metrics?.runtimeNormalCalculationCount === 0 && scene.metrics?.runtimeLightingCalculationCount === 0 &&
    scene.metrics?.runtimeDomGrowth === false, "zero runtime construction");
  assert(projected?.schema === "cssflower-prepared-projected-pixel-playback@1" && projected.pageCount === 2_333 &&
    projected.pages?.length === 2_333 && projected.layoutBlocks?.length === 37 && projected.retainedLeafCount === 1_200,
  "prepared visual bank");
  assert(projected.visualEncoding?.codec === "AVIF" && projected.visualEncoding?.quality === 40 &&
    projected.visualEncoding?.chromaSubsampling === "4:4:4", "q40 AVIF binding");
  assert(projected.runtimeProjection === false && projected.runtimeRasterization === false &&
    projected.runtimeGeometryConstruction === false && projected.runtimeNormalCalculation === false &&
    projected.runtimeLightingCalculation === false && projected.runtimeDomGrowth === false, "projected runtime boundary");
  assert(!scene.meshes && !scene.oracle && !scene.playback.stateEvidenceUrl && !scene.playback.transformAsset,
    "product-only scene");
  assert(!manifest.assets?.stateEvidence && !manifest.productionTransport?.assets?.some((asset) => asset.id === "state-evidence"),
    "state evidence excluded");
  const publicText = `${manifestBytes}\n${sceneDecoded}`;
  assert(!/(?:\.local\/|nativeQualification|executableSha256|compilerSha256|stateEvidenceUrl)/u.test(publicText),
    "private oracle metadata excluded");
  const snapshot = snapshotDecoded.toString("utf8");
  assert(count(snapshot, /data-cssflower-retained-leaf="true"/gu) === 1_200, "snapshot leaves");
  assert(count(snapshot, /data-cssflower-rotation-root="true"/gu) === 1, "snapshot root");
  assert(count(snapshot, /<(?:script|canvas|svg)\b/giu) === 0, "snapshot forbidden elements");
  assert(sha256(snapshotDecoded) === entry.snapshot.sha256, "snapshot decoded identity");

  const visualPacks = await inspectVisualPacks(root, projected);

  const files = (await walk(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "product-bank.json")
    .sort();
  const projectedAssetFiles = files.filter((path) => path.startsWith("assets/projected/"));
  assert(projectedAssetFiles.length === visualPacks.assetCount && projectedAssetFiles.every((path) =>
    /^assets\/projected\/visual-pack-[a-f0-9]{64}\.bin$/u.test(path)),
  "pack-only projected transport");
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
    timelineStateCount: 9_331,
    projectedPageCount: projected.pageCount,
    projectedAtlasAssetCount: new Set(projected.pages.map((page) => page.atlas.assetUrl)).size,
    projectedLayoutBlockCount: projected.layoutBlocks.length,
    projectedVisualPackCount: visualPacks.packCount,
    projectedVisualPackAssetCount: visualPacks.assetCount,
    projectedVisualPackBytes: visualPacks.totalPackBytes,
    projectedLogicalVisualBankBytes: projected.contentAddressedAtlasBytes + projected.compressedLayoutBytes,
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
  }
  return summary;
}

async function inspectVisualPacks(root, projected) {
  const transport = projected.transport;
  assert(transport?.schema === "cssflower-prepared-visual-pack-transport@1" &&
    transport.representation === "layout-block-aligned-exact-byte-slices" &&
    transport.packCount === projected.layoutBlocks.length && transport.packCount === 37 &&
    transport.blockPageCount === projected.layoutBlockPageCount &&
    transport.compressedResidentPackBudget === 2 && transport.earlyPrefetchPageOffset === 16 &&
    transport.logicalContentAddressedAtlasBytes === projected.contentAddressedAtlasBytes &&
    transport.logicalCompressedLayoutBytes === projected.compressedLayoutBytes &&
    transport.runtimeGeometryConstruction === false && transport.runtimeProjection === false &&
    transport.runtimeRasterization === false && transport.runtimeLightingCalculation === false &&
    transport.packs?.length === transport.packCount,
  "visual pack transport");

  const expectedAssets = new Map();
  let totalPackBytes = 0;
  let maximumPackBytes = 0;
  for (let packIndex = 0; packIndex < transport.packs.length; packIndex += 1) {
    const pack = transport.packs[packIndex];
    const block = projected.layoutBlocks[packIndex];
    assert(pack?.schema === "cssflower-prepared-visual-pack@1" && pack.index === packIndex &&
      pack.startPageIndex === block.startPageIndex && pack.pageCount === block.pageCount &&
      Number.isSafeInteger(pack.byteLength) && pack.byteLength > 0 &&
      /^[a-f0-9]{64}$/u.test(pack.sha256 ?? "") &&
      pack.layout?.byteOffset === 0 && pack.layout.byteLength === block.byteLength &&
      pack.layout.sha256 === block.sha256 && pack.layout.decodedByteLength === block.decodedByteLength &&
      pack.layout.decodedSha256 === block.decodedSha256 &&
      pack.atlasSlices?.length === pack.pageCount,
    `visual pack ${packIndex} descriptor`);
    addExpected(expectedAssets, pack.assetUrl, pack.byteLength, pack.sha256);
    let expectedOffset = pack.layout.byteLength;
    for (let localPageIndex = 0; localPageIndex < pack.pageCount; localPageIndex += 1) {
      const pageIndex = pack.startPageIndex + localPageIndex;
      const page = projected.pages[pageIndex];
      const slice = pack.atlasSlices[localPageIndex];
      assert(slice?.pageIndex === pageIndex && slice.byteOffset === expectedOffset &&
        slice.byteLength === page.atlas.byteLength && slice.sha256 === page.atlas.sha256 &&
        slice.mimeType === page.atlas.mimeType,
      `visual pack ${packIndex} page ${pageIndex} descriptor`);
      expectedOffset += slice.byteLength;
    }
    assert(expectedOffset === pack.byteLength, `visual pack ${packIndex} byte coverage`);
    totalPackBytes += pack.byteLength;
    maximumPackBytes = Math.max(maximumPackBytes, pack.byteLength);
  }
  assert(totalPackBytes === transport.totalPackBytes && maximumPackBytes === transport.maximumPackBytes,
    "visual pack aggregate bytes");

  await parallel(transport.packs, 8, async (pack) => {
    const bytes = await readFile(publicPath(root, pack.assetUrl));
    assert(bytes.length === pack.byteLength && sha256(bytes) === pack.sha256,
      `visual pack ${pack.index} identity`);
    const block = projected.layoutBlocks[pack.index];
    const layoutCompressed = bytes.subarray(
      pack.layout.byteOffset,
      pack.layout.byteOffset + pack.layout.byteLength,
    );
    assert(layoutCompressed.length === block.byteLength && sha256(layoutCompressed) === block.sha256,
      `visual pack ${pack.index} layout slice`);
    const layoutDecoded = gunzipSync(layoutCompressed);
    assert(layoutDecoded.length === block.decodedByteLength && sha256(layoutDecoded) === block.decodedSha256,
      `visual pack ${pack.index} decoded layout`);
    for (const slice of pack.atlasSlices) {
      const page = projected.pages[slice.pageIndex];
      const atlasBytes = bytes.subarray(slice.byteOffset, slice.byteOffset + slice.byteLength);
      assert(atlasBytes.length === page.atlas.byteLength && sha256(atlasBytes) === page.atlas.sha256,
        `visual pack ${pack.index} atlas slice ${slice.pageIndex}`);
    }
  });

  return Object.freeze({
    packCount: transport.packCount,
    assetCount: expectedAssets.size,
    totalPackBytes,
    maximumPackBytes,
  });
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

function addExpected(map, url, byteLength, hash) {
  assert(typeof url === "string" && url.startsWith("/cssflower/") && !url.includes(".."), "asset URL");
  assert(Number.isSafeInteger(byteLength) && byteLength > 0 && /^[a-f0-9]{64}$/u.test(hash), "asset descriptor");
  const previous = map.get(url);
  if (previous) assert(previous.byteLength === byteLength && previous.sha256 === hash, `alias ${url}`);
  else map.set(url, { byteLength, sha256: hash });
}

function publicPath(root, url) {
  return join(root, url.slice("/cssflower/".length));
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

async function parallel(values, concurrency, task) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      await task(values[index]);
    }
  }));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(text, expression) {
  return (text.match(expression) ?? []).length;
}

function assert(condition, label) {
  if (!condition) throw new Error(`Flower Box product bank failed ${label}`);
}
