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
