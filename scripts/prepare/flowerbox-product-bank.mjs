#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { inspectFlowerboxProductBank } from "../../src/adapters/flowerbox/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/flowerbox/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssflower-prepared-bank-lock@3" ||
    lock.retainedTriangleLeafCount !== 1_200 || lock.retainedRotationRootCount !== 1 ||
    lock.timelineStateCount !== 360 || lock.geometryStateCount !== 73 ||
    lock.transformBlockCount !== 5 || lock.lightingAssetCount !== 1 ||
    lock.lightingQuality !== 83 || lock.visibilityMinimumOwnedPixels !== 8) {
  throw new Error("Flower Box prepared-bank lock does not bind the rounded retained Morph product");
}
const generatedRoot = resolve(
  process.env.CSSFLOWER_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssflower");

try {
  const current = await inspectFlowerboxProductBank(targetRoot);
  const descriptorBytes = await readFile(join(targetRoot, "product-bank.json"));
  if (current.closureSha256 === lock.productClosureSha256 &&
      current.closureBytes === lock.productClosureBytes &&
      current.fileCount === lock.productFileCount &&
      descriptorBytes.length === lock.productDescriptorByteLength &&
      sha256(descriptorBytes) === lock.productDescriptorSha256) {
    process.stdout.write(`${JSON.stringify({ status: "ready", source: "existing", ...current }, null, 2)}\n`);
    process.exit(0);
  }
} catch {
  // Missing or stale output is replaced only after the prepared bank verifies.
}

const localArchive = process.env.CSSFLOWER_PRODUCT_BANK_ARCHIVE;
const bundledArchive = join(
  repositoryRoot,
  "src/adapters/flowerbox/prepared",
  lock.asset,
);
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssflower");
let archivePath = localArchive
  ? resolve(localArchive)
  : bundledArchive;
let archiveSource = localArchive ? "local-archive" : "bundled-archive";
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  archivePath = join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
  archiveSource = "release";
  try {
    archiveBytes = await readFile(archivePath);
  } catch (cacheError) {
    if (cacheError?.code !== "ENOENT") throw cacheError;
    archiveBytes = await downloadArchive(lock);
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(archivePath, archiveBytes);
  }
}
if (archiveBytes.length !== lock.archiveByteLength || sha256(archiveBytes) !== lock.archiveSha256) {
  throw new Error("Flower Box product bank archive identity mismatch");
}

const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
if (listing.error) throw listing.error;
if (listing.status !== 0) throw new Error(`Unable to inspect Flower Box product bank:\n${listing.stderr}`);
const entries = listing.stdout.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some((entry) =>
  entry.startsWith("/") || entry.split("/").includes("..") ||
  !(entry === "cssflower" || entry === "cssflower/" || entry.startsWith("cssflower/")))) {
  throw new Error("Flower Box product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.flowerbox-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", stagingRoot], { encoding: "utf8" });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Unable to extract Flower Box product bank:\n${extraction.stderr}`);
try {
  const stagedProduct = join(stagingRoot, "cssflower");
  const summary = await inspectFlowerboxProductBank(stagedProduct);
  const descriptorBytes = await readFile(join(stagedProduct, "product-bank.json"));
  if (summary.closureSha256 !== lock.productClosureSha256 || summary.closureBytes !== lock.productClosureBytes ||
      summary.fileCount !== lock.productFileCount) {
    throw new Error("Flower Box unpacked product bank identity mismatch");
  }
  if (descriptorBytes.length !== lock.productDescriptorByteLength ||
      sha256(descriptorBytes) !== lock.productDescriptorSha256) {
    throw new Error("Flower Box product-bank descriptor identity mismatch");
  }
  await mkdir(publicRoot, { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagedProduct, targetRoot);
  process.stdout.write(`${JSON.stringify({ status: "ready", source: archiveSource, ...summary }, null, 2)}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function downloadArchive(expected) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(expected.url, {
        redirect: "follow",
        headers: { "user-agent": "cssGraphics-prepared-bank/1" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== expected.archiveByteLength ||
          sha256(bytes) !== expected.archiveSha256) {
        throw new Error("downloaded archive identity mismatch");
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(attempt * 1_000);
    }
  }
  throw new Error(
    `Flower Box product bank download failed after 4 verified attempts: ${lastError?.message ?? "unknown error"}`,
  );
}
