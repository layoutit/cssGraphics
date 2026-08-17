#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, rename, stat, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import {
  inspectCssgravitywellProductBank,
  writeCssgravitywellProductBankDescriptor,
} from "./productBank.mjs";

const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  throw new Error("Usage: package-product-bank.mjs --source <public/cssgravitywell> [--output <directory>] [--archive <tar.gz>]");
}
const sourceRoot = resolve(args.source);
const outputRoot = resolve(args.output ?? "build/generated/public/cssgravitywell");
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(dirname(stagingRoot), { recursive: true });
await cp(sourceRoot, stagingRoot, { recursive: true, force: true });
await rm(resolve(stagingRoot, "product-bank.json"), { force: true });
try {
  const summary = await inspectCssgravitywellProductBank(stagingRoot, { verifyDescriptor: false });
  await writeCssgravitywellProductBankDescriptor(stagingRoot, summary);
  await inspectCssgravitywellProductBank(stagingRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
  const archive = args.archive ? await writePortableArchive(outputRoot, args.archive) : null;
  process.stdout.write(`${JSON.stringify({ outputRoot, archive, ...summary }, null, 2)}\n`);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function writePortableArchive(productRoot, requestedArchivePath) {
  if (basename(productRoot) !== "cssgravitywell") {
    throw new Error("Portable cssGravityWell archives require an output directory named cssgravitywell");
  }
  const archivePath = resolve(requestedArchivePath);
  const temporaryTar = `${archivePath}.staging-${process.pid}.tar`;
  const temporaryArchive = `${temporaryTar}.gz`;
  const temporaryFileList = `${temporaryTar}.files`;
  await mkdir(dirname(archivePath), { recursive: true });
  await rm(temporaryTar, { force: true });
  await rm(temporaryArchive, { force: true });
  await rm(temporaryFileList, { force: true });
  try {
    await normalizeArchiveTree(productRoot);
    const archiveMembers = await archiveEntries(productRoot);
    await writeFile(temporaryFileList, `${archiveMembers.join("\n")}\n`);
    const tarVersion = runArchiveTool("tar", ["--version"]);
    const ownerArguments = /GNU tar/u.test(tarVersion)
      ? ["--owner=0", "--group=0", "--numeric-owner"]
      : ["--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root"];
    runArchiveTool("tar", [
      "--no-xattrs", "--no-recursion", "--format", "ustar", ...ownerArguments,
      "-cf", temporaryTar, "-C", dirname(productRoot), "-T", temporaryFileList,
    ], { COPYFILE_DISABLE: "1" });
    runArchiveTool("gzip", ["-n", "-6", "-f", temporaryTar]);
    const listing = runArchiveTool("tar", ["-tzf", temporaryArchive]);
    const listedEntries = listing.trim().split("\n").filter(Boolean);
    if (listedEntries.length === 0 || listedEntries.some(isUnsafeArchiveEntry)) {
      throw new Error("Portable cssGravityWell archive contains an unsafe or metadata entry");
    }
    await rm(archivePath, { force: true });
    await rename(temporaryArchive, archivePath);
    const archiveStat = await stat(archivePath);
    return Object.freeze({ path: archivePath, byteLength: archiveStat.size, sha256: await hashFile(archivePath) });
  } finally {
    await rm(temporaryTar, { force: true });
    await rm(temporaryArchive, { force: true });
    await rm(temporaryFileList, { force: true });
  }
}

async function archiveEntries(root, directory = root) {
  const rows = directory === root ? [basename(root)] : [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    rows.push(`${basename(root)}/${relative(root, path)}`);
    if (entry.isDirectory()) rows.push(...await archiveEntries(root, path));
  }
  return rows;
}

async function normalizeArchiveTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) await normalizeArchiveTree(path);
    else await utimes(path, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
  await utimes(root, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
}

function isUnsafeArchiveEntry(entry) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") || parts.some((part) => part.startsWith("._")) ||
    !(entry === "cssgravitywell" || entry === "cssgravitywell/" || entry.startsWith("cssgravitywell/"));
}

function runArchiveTool(command, commandArgs, extraEnvironment = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  return result.stdout;
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject)
      .on("end", () => resolveHash(hash.digest("hex")));
  });
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
