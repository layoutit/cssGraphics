#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCssclothProductBank } from "../../src/adapters/cloth/tools/productBank.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/cloth/prepared-bank.lock.json"),
  "utf8",
));
validateLock(lock);

const generatedRoot = resolve(
  process.env.CSSCLOTH_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "csscloth");
if (await matchesLock(targetRoot, lock)) {
  process.stdout.write(`${JSON.stringify({ status: "ready", source: "existing" }, null, 2)}\n`);
  process.exit(0);
}

const localArchive = process.env.CSSCLOTH_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "csscloth");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Cloth product bank download failed: ${response.status}`);
  archiveBytes = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (archiveBytes.length !== lock.archiveByteLength || sha256(archiveBytes) !== lock.archiveSha256) {
  throw new Error("Cloth product bank archive identity mismatch");
}

const entries = run("tar", ["-tzf", archivePath]).trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some(isUnsafeEntry)) {
  throw new Error("Cloth product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.csscloth-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
try {
  run("tar", ["-xzf", archivePath, "-C", stagingRoot]);
  const stagedProduct = join(stagingRoot, "csscloth");
  if (!await matchesLock(stagedProduct, lock)) {
    throw new Error("Cloth unpacked product bank failed its prepared-asset contract");
  }
  await mkdir(publicRoot, { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagedProduct, targetRoot);
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    source: localArchive ? "local-archive" : "release",
    archiveByteLength: archiveBytes.length,
    archiveSha256: lock.archiveSha256,
  }, null, 2)}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

function validateLock(value) {
  if (value.schema !== "csscloth-prepared-bank-lock@2" || value.bankCount !== 8 ||
      value.bankFrameCount !== 1440 || value.durationMilliseconds !== 192_000 ||
      value.retainedLeafCount !== 312 || value.mobileRetainedLeafCount !== 158 ||
      value.mobileClothTriangleCount !== 72 || value.fileCount !== 32 ||
      !Number.isSafeInteger(value.archiveByteLength) || value.archiveByteLength <= 0 ||
      !/^[a-f0-9]{64}$/u.test(value.archiveSha256) ||
      !Number.isSafeInteger(value.closureBytes) || value.closureBytes <= 0 ||
      !/^[a-f0-9]{64}$/u.test(value.closureSha256)) {
    throw new Error("Cloth prepared-bank lock is incomplete or invalid");
  }
}

async function matchesLock(root, value) {
  try {
    const summary = await inspectCssclothProductBank(root);
    return summary.bankCount === value.bankCount &&
      summary.bankFrameCount === value.bankFrameCount &&
      summary.durationMilliseconds === value.durationMilliseconds &&
      summary.retainedLeafCount === value.retainedLeafCount &&
      summary.mobileRetainedLeafCount === value.mobileRetainedLeafCount &&
      summary.mobileClothTriangleCount === value.mobileClothTriangleCount &&
      summary.fileCount === value.fileCount &&
      summary.closureBytes === value.closureBytes &&
      summary.closureSha256 === value.closureSha256;
  } catch {
    return false;
  }
}

function isUnsafeEntry(entry) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") ||
    parts.some((part) => part.startsWith("._")) ||
    !(entry === "csscloth" || entry === "csscloth/" || entry.startsWith("csscloth/"));
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
