#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCssmengerProductBank } from "../../src/adapters/menger/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/menger/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssmenger-prepared-bank-lock@1" ||
    lock.sceneCount !== 1 || lock.retainedModelRootCount !== 1 ||
    lock.retainedAxisRootCount !== 3 || lock.preparedLeafCount !== 84 ||
    lock.sourceFaceCount !== 18_048 || lock.mergedSourceFaceCount !== 17_964 ||
    lock.timelineStateCount !== 1_440 || lock.paletteStateCount !== 128) {
  throw new Error("cssMenger prepared-bank lock does not bind the retained depth-3 product");
}
const generatedRoot = resolve(
  process.env.CSSMENGER_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssmenger");

try {
  const current = await inspectCssmengerProductBank(targetRoot);
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

const localArchive = process.env.CSSMENGER_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssmenger");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`cssMenger product bank download failed: ${response.status}`);
  archiveBytes = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (archiveBytes.length !== lock.archiveByteLength || sha256(archiveBytes) !== lock.archiveSha256) {
  throw new Error("cssMenger product bank archive identity mismatch");
}

const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
if (listing.error) throw listing.error;
if (listing.status !== 0) throw new Error(`Unable to inspect cssMenger product bank:\n${listing.stderr}`);
const entries = listing.stdout.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some((entry) =>
  entry.startsWith("/") || entry.split("/").includes("..") ||
  !(entry === "cssmenger" || entry === "cssmenger/" || entry.startsWith("cssmenger/")))) {
  throw new Error("cssMenger product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.cssmenger-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", stagingRoot], { encoding: "utf8" });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Unable to extract cssMenger product bank:\n${extraction.stderr}`);
try {
  const stagedProduct = join(stagingRoot, "cssmenger");
  const summary = await inspectCssmengerProductBank(stagedProduct);
  const descriptorBytes = await readFile(join(stagedProduct, "product-bank.json"));
  if (summary.closureSha256 !== lock.productClosureSha256 ||
      summary.closureBytes !== lock.productClosureBytes ||
      summary.fileCount !== lock.productFileCount ||
      descriptorBytes.length !== lock.productDescriptorByteLength ||
      sha256(descriptorBytes) !== lock.productDescriptorSha256) {
    throw new Error("cssMenger unpacked product bank identity mismatch");
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
