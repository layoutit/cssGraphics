#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  inspectFlowerboxProductBank,
  writeFlowerboxProductBankDescriptor,
} from "./productBank.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.source) throw new Error("Usage: package-product-bank.mjs --source <dist/cssflower> [--output <directory>]");
const sourceRoot = resolve(args.source);
const outputRoot = resolve(args.output ?? "build/generated/public/cssflower");
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(dirname(stagingRoot), { recursive: true });
await cp(sourceRoot, stagingRoot, { recursive: true, force: true });

const sourceManifestBytes = await readFile(join(stagingRoot, "manifest.json"));
const sourceSceneEncoded = await readFile(join(stagingRoot, "scenes", "default-cube.json.gz"));
const sourceSnapshotEncoded = await readFile(join(stagingRoot, "scenes", "default-cube.polycss.html.gz"));
const manifest = JSON.parse(sourceManifestBytes.toString("utf8"));
const scene = JSON.parse(gunzipSync(sourceSceneEncoded).toString("utf8"));
const entry = manifest.scenes.find((candidate) => candidate.id === "default-cube");
if (!entry) throw new Error("Source Flower Box manifest is missing default-cube");

scene.label = "Flower Box — default cube";
scene.source = {
  project: "Flower Box — PolyCSS experiment",
  dataKind: "documented-source-behavior",
  behaviorAuthority: "src/adapters/flowerbox/README.md",
  sourceRevision: scene.source?.sourceRevision,
  sourceFiles: scene.source?.sourceFiles,
  nativeAuthorityStatus: "not-packaged",
  legal: "independently-authored-results-only",
  redistributableUpstreamBytes: false,
};
if (scene.sourceProfile) scene.sourceProfile.authority = "src/adapters/flowerbox/README.md";
delete scene.meshes;
delete scene.oracle;
delete scene.playback.stateEvidenceUrl;
delete scene.playback.transformAsset;
scene.warnings = [
  "Independent source-informed PolyCSS experiment; Microsoft source, binaries, captures, and oracle packets are not packaged.",
];

const visualPackSummary = await packageProjectedVisualPacks(
  stagingRoot,
  scene.playback.projectedPixels,
);

const sceneDecoded = Buffer.from(`${JSON.stringify(scene)}\n`);
const sceneEncoded = gzipSync(sceneDecoded, { level: 9, mtime: 0 });
await writeFile(join(stagingRoot, "scenes", "default-cube.json.gz"), sceneEncoded);
await rm(join(stagingRoot, "assets", "flower-box-state-evidence.json.gz"), { force: true });

manifest.title = "Flower Box — PolyCSS experiment";
entry.label = scene.label;
entry.warnings = [...scene.warnings];
manifest.assets = {
  projected: {
    pageCount: scene.playback.projectedPixels.pageCount,
    atlasAssetCount: scene.metrics.preparedProjectedPixelAtlasAssetCount,
    layoutBlockCount: scene.playback.projectedPixels.layoutBlocks.length,
    visualPackCount: visualPackSummary.packCount,
    visualPackBytes: visualPackSummary.totalPackBytes,
    visualEncoding: scene.playback.projectedPixels.visualEncoding,
  },
};
manifest.productionTransport = {
  schema: "cssflower-product-static-transport@1",
  exactDecodedSceneAndSnapshotBytes: true,
  runtimeGeometryConstruction: false,
  runtimeRasterization: false,
  runtimeLightingCalculation: false,
  assets: [
    transportAsset("scene:default-cube", entry.sceneUrl, sceneDecoded, sceneEncoded),
    transportAsset(
      "snapshot:default-cube",
      entry.snapshotUrl,
      gunzipSync(sourceSnapshotEncoded),
      sourceSnapshotEncoded,
    ),
  ],
};
await writeFile(join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await rm(join(stagingRoot, "product-bank.json"), { force: true });

const summary = await inspectFlowerboxProductBank(stagingRoot, { verifyDescriptor: false });
await writeFlowerboxProductBankDescriptor(stagingRoot, summary, {
  sourceManifestSha256: sha256(sourceManifestBytes),
  sourceSceneEncodedSha256: sha256(sourceSceneEncoded),
  sourceSnapshotEncodedSha256: sha256(sourceSnapshotEncoded),
  sanitization: [
    "native qualification metadata",
    "oracle metadata and state evidence",
    "prepare-only mesh geometry",
    "ignored transform-asset descriptor",
    "individual projected atlas and layout transport files",
  ],
});
await inspectFlowerboxProductBank(stagingRoot);
await rm(outputRoot, { recursive: true, force: true });
await rename(stagingRoot, outputRoot);
process.stdout.write(`${JSON.stringify({ outputRoot, ...summary }, null, 2)}\n`);

function transportAsset(id, url, decoded, encoded) {
  return {
    id,
    url,
    encoding: "gzip",
    decodedByteLength: decoded.length,
    decodedSha256: sha256(decoded),
    encodedByteLength: encoded.length,
    encodedSha256: sha256(encoded),
  };
}

async function packageProjectedVisualPacks(root, projected) {
  const pageCount = projected?.pageCount;
  const blockPageCount = projected?.layoutBlockPageCount;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || blockPageCount !== 64 ||
      projected.pages?.length !== pageCount || !Array.isArray(projected.layoutBlocks) ||
      projected.layoutBlocks.length !== Math.ceil(pageCount / blockPageCount)) {
    throw new Error("Source Flower Box projected bank cannot be packed");
  }

  const sourceAssets = new Set();
  const assetCache = new Map();
  const packs = [];
  let totalPackBytes = 0;
  let maximumPackBytes = 0;
  for (const block of projected.layoutBlocks) {
    if (block.index !== packs.length || block.startPageIndex !== block.index * blockPageCount) {
      throw new Error(`Source Flower Box layout block ${block.index} is out of order`);
    }
    const layoutBytes = await readSourceAsset(block.assetUrl, block.byteLength, block.sha256);
    const chunks = [layoutBytes];
    const layout = {
      byteOffset: 0,
      byteLength: layoutBytes.length,
      sha256: block.sha256,
      decodedByteLength: block.decodedByteLength,
      decodedSha256: block.decodedSha256,
    };
    const atlasSlices = [];
    let byteOffset = layoutBytes.length;
    for (let localPageIndex = 0; localPageIndex < block.pageCount; localPageIndex += 1) {
      const pageIndex = block.startPageIndex + localPageIndex;
      const page = projected.pages[pageIndex];
      if (page?.index !== pageIndex || page.layout?.blockIndex !== block.index) {
        throw new Error(`Source Flower Box projected page ${pageIndex} is not aligned to its layout block`);
      }
      const atlasBytes = await readSourceAsset(
        page.atlas.assetUrl,
        page.atlas.byteLength,
        page.atlas.sha256,
      );
      chunks.push(atlasBytes);
      atlasSlices.push({
        pageIndex,
        byteOffset,
        byteLength: atlasBytes.length,
        sha256: page.atlas.sha256,
        mimeType: page.atlas.mimeType,
      });
      byteOffset += atlasBytes.length;
    }
    const packBytes = Buffer.concat(chunks);
    const packSha256 = sha256(packBytes);
    const assetUrl = `/cssflower/assets/projected/visual-pack-${packSha256}.bin`;
    await writeFile(publicAssetPath(root, assetUrl), packBytes);
    packs.push({
      schema: "cssflower-prepared-visual-pack@1",
      index: block.index,
      startPageIndex: block.startPageIndex,
      pageCount: block.pageCount,
      assetUrl,
      byteLength: packBytes.length,
      sha256: packSha256,
      layout,
      atlasSlices,
    });
    totalPackBytes += packBytes.length;
    maximumPackBytes = Math.max(maximumPackBytes, packBytes.length);
  }

  for (const url of sourceAssets) await rm(publicAssetPath(root, url), { force: true });
  projected.transport = {
    schema: "cssflower-prepared-visual-pack-transport@1",
    representation: "layout-block-aligned-exact-byte-slices",
    packCount: packs.length,
    blockPageCount,
    compressedResidentPackBudget: 2,
    earlyPrefetchPageOffset: 16,
    totalPackBytes,
    maximumPackBytes,
    logicalContentAddressedAtlasBytes: projected.contentAddressedAtlasBytes,
    logicalCompressedLayoutBytes: projected.compressedLayoutBytes,
    runtimeGeometryConstruction: false,
    runtimeProjection: false,
    runtimeRasterization: false,
    runtimeLightingCalculation: false,
    packs,
  };
  return { packCount: packs.length, totalPackBytes, maximumPackBytes };

  async function readSourceAsset(url, expectedByteLength, expectedSha256) {
    sourceAssets.add(url);
    let bytes = assetCache.get(url);
    if (!bytes) {
      bytes = await readFile(publicAssetPath(root, url));
      assetCache.set(url, bytes);
    }
    if (bytes.length !== expectedByteLength || sha256(bytes) !== expectedSha256) {
      throw new Error(`Source Flower Box projected asset identity mismatch: ${url}`);
    }
    return bytes;
  }
}

function publicAssetPath(root, url) {
  if (typeof url !== "string" || !url.startsWith("/cssflower/") || url.includes("..")) {
    throw new Error(`Unsafe Flower Box projected asset URL: ${url}`);
  }
  return join(root, url.slice("/cssflower/".length));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed[argument.slice(2)] = true;
    else {
      parsed[argument.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
