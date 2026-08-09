#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { inspectCssgravitywellProductBank } from "../../src/adapters/gravitywell/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/gravitywell/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssgravitywell-prepared-bank-lock@1" || lock.bankCount !== 24 ||
    lock.retainedShapeRootCount !== 1 || lock.retainedLeafCount !== 1_922 ||
    lock.preparedFrameCount !== 7_665 || lock.transformAssetCount !== 72 ||
    lock.productFileCount !== 100 || lock.colorAssetCount !== 24 || lock.changeAssetCount !== 24 ||
    lock.visibilityAssetCount !== 24 || lock.visibilityEncodedBytes !== 109_999) {
  throw new Error("cssGravityWell prepared-bank lock does not bind the retained 24-bank product");
}
const generatedRoot = resolve(
  process.env.CSSGRAVITYWELL_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssgravitywell");

try {
  const current = await inspectCssgravitywellProductBank(targetRoot);
  const descriptorBytes = await readFile(join(targetRoot, "product-bank.json"));
  if (matchesLock(current, descriptorBytes)) {
    process.stdout.write(`${JSON.stringify({ status: "ready", source: "existing", ...current }, null, 2)}\n`);
    process.exit(0);
  }
} catch {
  // Missing or stale output is replaced only after the archive verifies.
}

const localArchive = process.env.CSSGRAVITYWELL_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssgravitywell");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
try {
  await stat(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`cssGravityWell product bank download failed: ${response.status}`);
  await mkdir(cacheRoot, { recursive: true });
  const temporary = `${archivePath}.download-${process.pid}`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, archivePath);
  } catch (downloadError) {
    await rm(temporary, { force: true });
    throw downloadError;
  }
}
const archiveIdentity = await fileIdentity(archivePath);
if (archiveIdentity.byteLength !== lock.archiveByteLength || archiveIdentity.sha256 !== lock.archiveSha256) {
  throw new Error("cssGravityWell product bank archive identity mismatch");
}

const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
if (listing.error) throw listing.error;
if (listing.status !== 0) throw new Error(`Unable to inspect cssGravityWell product bank:\n${listing.stderr}`);
const entries = listing.stdout.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some((entry) =>
  entry.startsWith("/") || entry.split("/").includes("..") ||
  !(entry === "cssgravitywell" || entry === "cssgravitywell/" || entry.startsWith("cssgravitywell/")))) {
  throw new Error("cssGravityWell product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.cssgravitywell-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", stagingRoot], { encoding: "utf8" });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(`Unable to extract cssGravityWell product bank:\n${extraction.stderr}`);
try {
  const stagedProduct = join(stagingRoot, "cssgravitywell");
  const summary = await inspectCssgravitywellProductBank(stagedProduct);
  const descriptorBytes = await readFile(join(stagedProduct, "product-bank.json"));
  if (!matchesLock(summary, descriptorBytes)) throw new Error("cssGravityWell unpacked product bank identity mismatch");
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

function matchesLock(summary, descriptorBytes) {
  return summary.closureSha256 === lock.productClosureSha256 &&
    summary.closureBytes === lock.productClosureBytes &&
    summary.fileCount === lock.productFileCount &&
    descriptorBytes.length === lock.productDescriptorByteLength &&
    sha256(descriptorBytes) === lock.productDescriptorSha256;
}

async function fileIdentity(path) {
  const details = await stat(path);
  return { byteLength: details.size, sha256: await hashFile(path) };
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
