#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, rename, utimes } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  inspectCssmengerProductBank,
  writeCssmengerProductBankDescriptor,
} from "./productBank.mjs";

const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");

const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  throw new Error("Usage: package-product-bank.mjs --source <public/cssmenger> [--output <directory>] [--archive <tar.gz>]");
}
const sourceRoot = resolve(args.source);
const outputRoot = resolve(args.output ?? "build/generated/public/cssmenger");
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(dirname(stagingRoot), { recursive: true });
await copyProductClosure(sourceRoot, stagingRoot);

try {
  const summary = await inspectCssmengerProductBank(stagingRoot, { verifyDescriptor: false });
  await writeCssmengerProductBankDescriptor(stagingRoot, summary);
  await inspectCssmengerProductBank(stagingRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
  const archive = args.archive ? await writePortableArchive(outputRoot, args.archive) : null;
  process.stdout.write(`${JSON.stringify({ outputRoot, archive, ...summary }, null, 2)}\n`);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function copyProductClosure(source, target) {
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  const entry = manifest.scenes?.[0];
  const scenePath = productPath(entry?.sceneUrl);
  const snapshotPath = productPath(entry?.snapshotUrl);
  const scene = JSON.parse(await readFile(join(source, scenePath), "utf8"));
  const paths = new Set([
    "manifest.json",
    scenePath,
    snapshotPath,
    productPath(scene.planeAtlas?.assetUrl),
  ]);
  for (const path of paths) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(source, path), join(target, path));
  }
}

function productPath(url) {
  if (typeof url !== "string" || !url.startsWith("/cssmenger/") || url.includes("..")) {
    throw new Error(`Unsafe cssMenger product URL ${url}`);
  }
  return url.slice("/cssmenger/".length);
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

async function writePortableArchive(productRoot, requestedArchivePath) {
  if (basename(productRoot) !== "cssmenger") {
    throw new Error("Portable cssMenger archives require an output directory named cssmenger");
  }
  const archivePath = resolve(requestedArchivePath);
  const temporaryTar = `${archivePath}.staging-${process.pid}.tar`;
  const temporaryArchive = `${temporaryTar}.gz`;
  await mkdir(dirname(archivePath), { recursive: true });
  await rm(temporaryTar, { force: true });
  await rm(temporaryArchive, { force: true });
  try {
    await normalizeArchiveTree(productRoot);
    runArchiveTool("tar", [
      "--no-xattrs",
      "--uid", "0",
      "--gid", "0",
      "--uname", "root",
      "--gname", "wheel",
      "-cf",
      temporaryTar,
      "-C",
      dirname(productRoot),
      "cssmenger",
    ], { COPYFILE_DISABLE: "1" });
    runArchiveTool("gzip", ["-n", "-9", "-f", temporaryTar]);
    const listing = runArchiveTool("tar", ["-tzf", temporaryArchive]);
    const entries = listing.trim().split("\n").filter(Boolean);
    if (entries.length === 0 || entries.some(isUnsafeArchiveEntry)) {
      throw new Error("Portable cssMenger archive contains an unsafe or metadata entry");
    }
    const bytes = await readFile(temporaryArchive);
    await rm(archivePath, { force: true });
    await rename(temporaryArchive, archivePath);
    return Object.freeze({
      path: archivePath,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } finally {
    await rm(temporaryTar, { force: true });
    await rm(temporaryArchive, { force: true });
  }
}

async function normalizeArchiveTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await normalizeArchiveTree(path);
    else await utimes(path, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
  await utimes(root, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
}

function isUnsafeArchiveEntry(entry) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") ||
    parts.some((part) => part.startsWith("._")) ||
    !(entry === "cssmenger" || entry === "cssmenger/" || entry.startsWith("cssmenger/"));
}

function runArchiveTool(command, args, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}
