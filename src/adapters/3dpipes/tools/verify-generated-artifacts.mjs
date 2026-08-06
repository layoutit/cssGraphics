#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  selectDefaultScene,
  validateCssPipesManifest,
} from "../src/csspipes/manifestClient.mjs";
import {
  CSSPIPES_GENERATED_PUBLIC_ROOT,
  CSSPIPES_MANIFEST_PATH,
} from "../src/prepare/csspipes/paths.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

function generatedPath(url) {
  return resolve(CSSPIPES_GENERATED_PUBLIC_ROOT, `.${url.slice("/csspipes".length)}`);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertHash(path, expected, label) {
  if (!SHA256.test(expected)) throw new Error(`${label} has no valid SHA-256`);
  const actual = await hashFile(path);
  if (actual !== expected) {
    throw new Error(`${label} hash mismatch: expected ${expected}, received ${actual}`);
  }
  return actual;
}

export async function verifyGeneratedCssPipesArtifacts() {
  const manifest = validateCssPipesManifest(
    JSON.parse(await readFile(CSSPIPES_MANIFEST_PATH, "utf8")),
  );
  const descriptor = selectDefaultScene(manifest);
  const scenePath = generatedPath(descriptor.sceneUrl);
  const snapshotPath = generatedPath(descriptor.snapshotUrl);
  const atlasPath = resolve(
    CSSPIPES_GENERATED_PUBLIC_ROOT,
    "assets/pipe-space-texels.png",
  );
  const [sceneSha256, snapshotSha256, atlasSha256, sceneBytes] = await Promise.all([
    assertHash(scenePath, descriptor.sceneSha256, "prepared scene"),
    assertHash(snapshotPath, descriptor.snapshotSha256, "prepared snapshot"),
    hashFile(atlasPath),
    readFile(scenePath),
  ]);
  const sceneText = gunzipSync(sceneBytes).toString("utf8");
  const scene = JSON.parse(sceneText);
  if (scene.schema !== "csspipes-prebaked-scene@12" ||
      scene.playback?.schema !== "csspipes-prebaked-playback@13" ||
      scene.id !== descriptor.id || Object.hasOwn(scene, "pipeMeshes")) {
    throw new Error("Prepared scene header does not match its manifest descriptor");
  }
  const chunks = scene.playback.clipChunks;
  if (chunks?.schema !== "csspipes-prepared-clip-chunks@1" ||
      chunks.count !== scene.playback.clipCount ||
      chunks.descriptors?.length !== chunks.count) {
    throw new Error("Prepared scene clip storage contract is incomplete");
  }
  await Promise.all(chunks.descriptors.map(async (chunk, index) => {
    if (chunk.clipIndex !== index) {
      throw new Error(`Prepared clip descriptor ${index} is out of order`);
    }
    await assertHash(generatedPath(chunk.url), chunk.sha256, `prepared clip ${index}`);
  }));
  const atlasHashToken = `\"assetSha256\":\"${atlasSha256}\"`;
  const atlasUrlToken = "\"assetUrl\":\"/csspipes/assets/pipe-space-texels.png\"";
  const atlasHashBindings = sceneText.split(atlasHashToken).length - 1;
  const atlasUrlBindings = sceneText.split(atlasUrlToken).length - 1;
  if (atlasHashBindings !== 1 || atlasUrlBindings !== 1) {
    throw new Error(
      `Prepared scene lighting binding drifted (${atlasHashBindings} hashes, ${atlasUrlBindings} URLs)`,
    );
  }
  return Object.freeze({
    sceneSha256,
    snapshotSha256,
    atlasSha256,
    clipCount: chunks.count,
    clipBytes: chunks.totalBytes,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const verified = await verifyGeneratedCssPipesArtifacts();
  console.log(
    `Verified generated cssPipes scene ${verified.sceneSha256.slice(0, 12)}, ${verified.clipCount} clips, snapshot ${verified.snapshotSha256.slice(0, 12)}, atlas ${verified.atlasSha256.slice(0, 12)}`,
  );
}
