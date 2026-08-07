#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCssgearsProductBank } from "../../src/adapters/gears/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/gears/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssgears-prepared-bank-lock@1" ||
    lock.sceneCount !== 24 || lock.showreelBankCount !== 1 ||
    lock.retainedGearRootCount !== 3 || lock.retainedSceneBankCount !== 24 ||
    lock.timelineStateCount !== 720 || lock.showreelStateCount !== 580 ||
    lock.showreelSpinMilliseconds !== 15_000) {
  throw new Error("cssGears prepared-bank lock does not bind the retained showreel product");
}
const generatedRoot = resolve(
  process.env.CSSGEARS_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssgears");

try {
  const current = await inspectCssgearsProductBank(targetRoot);
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
  // Missing or stale output is replaced only after the downloaded bank verifies.
}

const localArchive = process.env.CSSGEARS_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssgears");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`cssGears product bank download failed: ${response.status}`);
  archiveBytes = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (archiveBytes.length !== lock.archiveByteLength || sha256(archiveBytes) !== lock.archiveSha256) {
  throw new Error("cssGears product bank archive identity mismatch");
}

const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
if (listing.error) throw listing.error;
if (listing.status !== 0) throw new Error(`Unable to inspect cssGears product bank:\n${listing.stderr}`);
const entries = listing.stdout.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some((entry) =>
  entry.startsWith("/") || entry.split("/").includes("..") ||
  !(entry === "cssgears" || entry === "cssgears/" || entry.startsWith("cssgears/")))) {
  throw new Error("cssGears product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.cssgears-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", stagingRoot], { encoding: "utf8" });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Unable to extract cssGears product bank:\n${extraction.stderr}`);
try {
  const stagedProduct = join(stagingRoot, "cssgears");
  const summary = await inspectCssgearsProductBank(stagedProduct);
  const descriptorBytes = await readFile(join(stagedProduct, "product-bank.json"));
  if (summary.closureSha256 !== lock.productClosureSha256 ||
      summary.closureBytes !== lock.productClosureBytes ||
      summary.fileCount !== lock.productFileCount ||
      descriptorBytes.length !== lock.productDescriptorByteLength ||
      sha256(descriptorBytes) !== lock.productDescriptorSha256) {
    throw new Error("cssGears unpacked product bank identity mismatch");
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
