#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, utimes } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { inspectCssclothProductBank } from "./productBank.mjs";

const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.archive) {
  throw new Error("Usage: package-product-bank.mjs --source <public/csscloth> --archive <tar.gz>");
}

const productRoot = resolve(args.source);
if (basename(productRoot) !== "csscloth") {
  throw new Error("Cloth product archives require a directory named csscloth");
}
const summary = await inspectCssclothProductBank(productRoot);
const archivePath = resolve(args.archive);
const temporaryTar = `${archivePath}.staging-${process.pid}.tar`;
const temporaryArchive = `${temporaryTar}.gz`;
await mkdir(dirname(archivePath), { recursive: true });
await rm(temporaryTar, { force: true });
await rm(temporaryArchive, { force: true });

try {
  await normalizeArchiveTree(productRoot);
  run("tar", [
    "--no-xattrs",
    "--uid", "0",
    "--gid", "0",
    "--uname", "root",
    "--gname", "wheel",
    "-cf",
    temporaryTar,
    "-C",
    dirname(productRoot),
    "csscloth",
  ], { COPYFILE_DISABLE: "1" });
  run("gzip", ["-n", "-9", "-f", temporaryTar]);
  const entries = run("tar", ["-tzf", temporaryArchive]).trim().split("\n").filter(Boolean);
  if (entries.length === 0 || entries.some(isUnsafeEntry)) {
    throw new Error("Cloth product archive contains an unsafe or metadata entry");
  }
  const bytes = await readFile(temporaryArchive);
  await rm(archivePath, { force: true });
  await rename(temporaryArchive, archivePath);
  process.stdout.write(`${JSON.stringify({
    path: archivePath,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    fileCount: entries.filter((entry) => !entry.endsWith("/")).length,
    product: summary,
  }, null, 2)}\n`);
} finally {
  await rm(temporaryTar, { force: true });
  await rm(temporaryArchive, { force: true });
}

async function normalizeArchiveTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) await normalizeArchiveTree(path);
    else if (!entry.isFile()) throw new Error(`Unsupported Cloth product entry: ${path}`);
    else await utimes(path, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
  await utimes(root, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
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

function isUnsafeEntry(entry) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") ||
    parts.some((part) => part.startsWith("._")) ||
    !(entry === "csscloth" || entry === "csscloth/" || entry.startsWith("csscloth/"));
}

function run(command, commandArgs, extraEnvironment = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}
