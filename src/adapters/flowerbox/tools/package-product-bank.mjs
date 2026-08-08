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
if (!args.source) {
  throw new Error("Usage: package-product-bank.mjs --source <dist/cssflower> [--output <directory>]");
}
const sourceRoot = resolve(args.source);
const outputRoot = resolve(args.output ?? "build/generated/public/cssflower");
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(dirname(stagingRoot), { recursive: true });
await cp(sourceRoot, stagingRoot, { recursive: true, force: true });

try {
  const sourceManifestBytes = await readFile(join(stagingRoot, "manifest.json"));
  const sourceSceneEncoded = await readFile(join(stagingRoot, "scenes", "default-cube.json.gz"));
  const sourceSnapshotEncoded = await readFile(join(stagingRoot, "scenes", "default-cube.polycss.html.gz"));
  const sourceSnapshotDecoded = gunzipSync(sourceSnapshotEncoded);
  const manifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  const scene = JSON.parse(gunzipSync(sourceSceneEncoded).toString("utf8"));
  const entry = manifest.scenes?.find((candidate) => candidate.id === "default-cube");
  if (!entry) throw new Error("Source Flower Box manifest is missing default-cube");

  scene.label = "Flower Box — default cube";
  scene.source = {
    project: "Flower Box — PolyCSS experiment",
    dataKind: "documented-source-behavior",
    behaviorAuthority: "src/adapters/flowerbox/README.md",
    sourceRevision: scene.source?.sourceRevision,
    sourceFiles: scene.source?.sourceFiles,
    nativeAuthorityStatus: "qualified-locally-not-packaged",
    legal: "independently-authored-results-only",
    redistributableUpstreamBytes: false,
  };
  if (scene.sourceProfile) {
    scene.sourceProfile.authority = "src/adapters/flowerbox/README.md";
    scene.sourceProfile.authorityStatus = "pinned-source-native-state-validated-locally-not-packaged";
  }
  if (scene.lighting?.encoder) delete scene.lighting.encoder.path;
  if (scene.playback?.transformAsset) delete scene.playback.transformAsset.sourceFloat32;
  delete scene.meshes;
  delete scene.oracle;
  delete scene.playback.stateEvidenceUrl;
  scene.warnings = [
    "Independent source-informed PolyCSS experiment; Microsoft source, binaries, captures, and oracle packets are not packaged.",
    ...scene.warnings,
  ];

  const sceneDecoded = Buffer.from(`${JSON.stringify(scene)}\n`);
  const sceneEncoded = gzipSync(sceneDecoded, { level: 9, mtime: 0 });
  await writeFile(join(stagingRoot, "scenes", "default-cube.json.gz"), sceneEncoded);
  await rm(join(stagingRoot, "assets", "flower-box-state-evidence.json.gz"), { force: true });
  await rm(join(stagingRoot, "product-bank.json"), { force: true });

  const transformAssets = await Promise.all(scene.playback.transformAsset.blocks.map(async (block) => {
    const bytes = await readFile(publicAssetPath(stagingRoot, block.assetUrl));
    return identityAsset(`transform:${block.index}`, block.assetUrl, bytes);
  }));
  const lightingBytes = await readFile(publicAssetPath(stagingRoot, scene.lighting.grid.assetUrl));

  manifest.title = "Flower Box — PolyCSS experiment";
  entry.label = scene.label;
  entry.warnings = [...scene.warnings];
  entry.sceneEncoding = "gzip";
  entry.snapshotEncoding = "gzip";
  entry.snapshot = {
    ...entry.snapshot,
    url: entry.snapshotUrl,
    transportEncoding: "gzip",
    transportByteLength: sourceSnapshotEncoded.length,
    transportSha256: sha256(sourceSnapshotEncoded),
  };
  manifest.assets = {
    transforms: {
      distribution: scene.playback.transformAsset.distribution,
      schema: scene.playback.transformAsset.schema,
      blockCount: scene.playback.transformAsset.blockCount,
      byteLength: scene.playback.transformAsset.byteLength,
    },
    lighting: {
      distribution: scene.lighting.distribution,
      schema: scene.lighting.schema,
      assetSha256: scene.lighting.assetSha256,
      byteLength: scene.lighting.grid.byteLength,
      timelineRowCount: scene.lighting.timelineRowCount,
      quality: scene.lighting.grid.quality,
    },
  };
  manifest.productionTransport = {
    schema: "cssflower-product-static-transport@2",
    exactDecodedSceneAndSnapshotBytes: true,
    runtimeGeometryConstruction: false,
    runtimeProjection: false,
    runtimeRasterization: false,
    runtimeLightingCalculation: false,
    assets: [
      gzipAsset("scene:default-cube", entry.sceneUrl, sceneDecoded, sceneEncoded),
      gzipAsset("snapshot:default-cube", entry.snapshotUrl, sourceSnapshotDecoded, sourceSnapshotEncoded),
      ...transformAssets,
      identityAsset("lighting:grid", scene.lighting.grid.assetUrl, lightingBytes),
    ],
  };
  await writeFile(join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const summary = await inspectFlowerboxProductBank(stagingRoot, { verifyDescriptor: false });
  await writeFlowerboxProductBankDescriptor(stagingRoot, summary, {
    sourceManifestSha256: sha256(sourceManifestBytes),
    sourceSceneEncodedSha256: sha256(sourceSceneEncoded),
    sourceSnapshotEncodedSha256: sha256(sourceSnapshotEncoded),
    productPolicy: "rounded-360-state-positive-petals-omitted-negative-cube-retained-polycss-morph-q83-minimum-8-owned-pixels",
    sanitization: [
      "native qualification identities",
      "oracle metadata and state evidence",
      "prepare-only mesh geometry",
      "ignored transform source descriptor",
      "local encoder path",
      "projected visual-pack transport",
    ],
  });
  await inspectFlowerboxProductBank(stagingRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
  process.stdout.write(`${JSON.stringify({ outputRoot, ...summary }, null, 2)}\n`);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

function gzipAsset(id, url, decoded, encoded) {
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

function identityAsset(id, url, bytes) {
  return {
    id,
    url,
    encoding: "identity",
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

function publicAssetPath(root, url) {
  if (typeof url !== "string" || !url.startsWith("/cssflower/") || url.includes("..")) {
    throw new Error(`Unsafe Flower Box product asset URL: ${url}`);
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
