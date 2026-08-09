#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCssmazeProductBank } from "../../src/adapters/maze/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/maze/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssmaze-prepared-bank-lock@1" ||
    lock.sceneCount !== 24 || lock.retainedWorldRootCount !== 1 ||
    lock.retainedWallRootCount !== 1 || lock.retainedSurfaceRootCount !== 1 ||
    lock.preparedLeavesPerScene !== 171 || lock.totalPreparedLeaves !== 4_104 ||
    lock.textureCount !== 3 || lock.snapshotAtlasCount !== 2 ||
    lock.snapshotAtlasBytes !== 233_713) {
  throw new Error("cssMaze prepared-bank lock does not bind the retained 24-maze product");
}
const generatedRoot = resolve(
  process.env.CSSMAZE_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssmaze");

try {
  const current = await inspectCssmazeProductBank(targetRoot);
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
  // Missing or stale output is replaced only after the archive verifies.
}

const localArchive = process.env.CSSMAZE_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssmaze");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  archiveBytes = await downloadReleaseArchive();
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (!matchesArchiveLock(archiveBytes) && !localArchive) {
  archiveBytes = await downloadReleaseArchive();
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (!matchesArchiveLock(archiveBytes)) {
  throw new Error("cssMaze product bank archive identity mismatch");
}

const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
if (listing.error) throw listing.error;
if (listing.status !== 0) throw new Error(`Unable to inspect cssMaze product bank:\n${listing.stderr}`);
const entries = listing.stdout.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some((entry) =>
  entry.startsWith("/") || entry.split("/").includes("..") ||
  !(entry === "cssmaze" || entry === "cssmaze/" || entry.startsWith("cssmaze/")))) {
  throw new Error("cssMaze product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.cssmaze-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", stagingRoot], { encoding: "utf8" });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Unable to extract cssMaze product bank:\n${extraction.stderr}`);
try {
  const stagedProduct = join(stagingRoot, "cssmaze");
  const summary = await inspectCssmazeProductBank(stagedProduct);
  const descriptorBytes = await readFile(join(stagedProduct, "product-bank.json"));
  if (summary.closureSha256 !== lock.productClosureSha256 ||
      summary.closureBytes !== lock.productClosureBytes ||
      summary.fileCount !== lock.productFileCount ||
      descriptorBytes.length !== lock.productDescriptorByteLength ||
      sha256(descriptorBytes) !== lock.productDescriptorSha256) {
    throw new Error("cssMaze unpacked product bank identity mismatch");
  }
  await mkdir(publicRoot, { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagedProduct, targetRoot);
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    source: localArchive ? "local-archive" : "release",
    ...summary,
  }, null, 2)}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function matchesArchiveLock(bytes) {
  return bytes.length === lock.archiveByteLength && sha256(bytes) === lock.archiveSha256;
}

async function downloadReleaseArchive() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(lock.url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`cssMaze product bank download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
