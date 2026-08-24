#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const LOCK_SCHEMA = "cssgraphics-prepared-product-lock@1";
const ARCHIVE_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");
const repositoryRoot = resolve(import.meta.dirname, "..");
const [command, ...argv] = process.argv.slice(2);
const args = parseArgs(argv);

if (command === "pack") await pack(args);
else if (command === "restore") await restore(args);
else throw new Error("Usage: prepared-product.mjs <pack|restore> [options]");

async function pack(options) {
  if (!options.source || !options.archive) {
    throw new Error("Usage: prepared-product.mjs pack --source <directory> --archive <file.tar.gz>");
  }
  const sourceRoot = resolve(options.source);
  const directory = basename(sourceRoot);
  const archivePath = resolve(options.archive);
  const stagingRoot = `${archivePath}.staging-${process.pid}`;
  const stagedProduct = join(stagingRoot, directory);
  const temporaryTar = `${archivePath}.staging-${process.pid}.tar`;
  const temporaryArchive = `${temporaryTar}.gz`;

  await rm(stagingRoot, { recursive: true, force: true });
  await rm(temporaryTar, { force: true });
  await rm(temporaryArchive, { force: true });
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(dirname(archivePath), { recursive: true });
  try {
    await cp(sourceRoot, stagedProduct, { recursive: true, force: true });
    const product = await inspectTree(stagedProduct);
    await normalizeTree(stagedProduct);
    run("tar", [
      "--no-xattrs",
      "--uid", "0",
      "--gid", "0",
      "--uname", "root",
      "--gname", "wheel",
      "-cf", temporaryTar,
      "-C", stagingRoot,
      directory,
    ], { COPYFILE_DISABLE: "1" });
    run("gzip", ["-n", "-9", "-f", temporaryTar]);
    const archiveBytes = await readFile(temporaryArchive);
    await rm(archivePath, { force: true });
    await rename(temporaryArchive, archivePath);
    process.stdout.write(`${JSON.stringify({
      schema: LOCK_SCHEMA,
      directory,
      archiveByteLength: archiveBytes.length,
      archiveSha256: sha256(archiveBytes),
      ...product,
    }, null, 2)}\n`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(temporaryTar, { force: true });
    await rm(temporaryArchive, { force: true });
  }
}

async function restore(options) {
  if (!options.lock || !options.target) {
    throw new Error("Usage: prepared-product.mjs restore --lock <lock.json> --target <directory>");
  }
  const lockPath = resolve(options.lock);
  const targetRoot = resolve(options.target);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  validateLock(lock, targetRoot);

  try {
    const current = await inspectTree(targetRoot);
    if (matchesProduct(current, lock)) {
      printReady("existing", lock, current);
      return;
    }
  } catch {
    // A missing or stale product is replaced only after its archive verifies.
  }

  const localArchive = options.archive && resolve(options.archive);
  const cacheRoot = join(repositoryRoot, ".local", "downloads", lock.directory);
  const archivePath = localArchive ?? join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
  let archiveBytes;
  try {
    archiveBytes = await readFile(archivePath);
  } catch (error) {
    if (localArchive || error?.code !== "ENOENT") throw error;
    archiveBytes = await download(lock.url);
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(archivePath, archiveBytes);
  }
  if (!matchesArchive(archiveBytes, lock) && !localArchive) {
    archiveBytes = await download(lock.url);
    await writeFile(archivePath, archiveBytes);
  }
  if (!matchesArchive(archiveBytes, lock)) {
    throw new Error(`${lock.directory} prepared-product archive identity mismatch`);
  }

  const entries = run("tar", ["-tzf", archivePath]).trim().split("\n").filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => isUnsafeEntry(entry, lock.directory))) {
    throw new Error(`${lock.directory} prepared-product archive contains an unsafe path`);
  }

  const stagingRoot = join(dirname(targetRoot), `.${lock.directory}-product-${process.pid}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  try {
    run("tar", ["-xzf", archivePath, "-C", stagingRoot]);
    const stagedProduct = join(stagingRoot, lock.directory);
    const product = await inspectTree(stagedProduct);
    if (!matchesProduct(product, lock)) {
      throw new Error(`${lock.directory} unpacked prepared-product identity mismatch`);
    }
    await mkdir(dirname(targetRoot), { recursive: true });
    await rm(targetRoot, { recursive: true, force: true });
    await rename(stagedProduct, targetRoot);
    printReady(localArchive ? "local-archive" : "release", lock, product);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function inspectTree(root) {
  const files = [];
  await collectFiles(root, root, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const closure = createHash("sha256");
  let productByteLength = 0;
  for (const file of files) {
    const bytes = await readFile(file.absolutePath);
    productByteLength += bytes.length;
    closure.update(file.path).update("\0").update(String(bytes.length)).update("\0");
    closure.update(bytes).update("\0");
  }
  return {
    productFileCount: files.length,
    productByteLength,
    productSha256: closure.digest("hex"),
  };
}

async function collectFiles(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(root, absolutePath, files);
    else if (entry.isFile()) {
      files.push({ absolutePath, path: relative(root, absolutePath).split(sep).join("/") });
    } else {
      throw new Error(`Prepared products may contain only regular files: ${absolutePath}`);
    }
  }
}

async function normalizeTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await normalizeTree(path);
    await utimes(path, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
  }
  await utimes(root, ARCHIVE_TIMESTAMP, ARCHIVE_TIMESTAMP);
}

function validateLock(lock, targetRoot) {
  if (lock.schema !== LOCK_SCHEMA || !/^[a-z0-9-]+$/u.test(lock.adapter) ||
      !/^css[a-z0-9-]+$/u.test(lock.directory) || basename(targetRoot) !== lock.directory ||
      typeof lock.url !== "string" || !lock.url.startsWith("https://github.com/layoutit/cssGraphics/releases/download/") ||
      !Number.isSafeInteger(lock.archiveByteLength) || lock.archiveByteLength <= 0 ||
      !Number.isSafeInteger(lock.productByteLength) || lock.productByteLength <= 0 ||
      !Number.isSafeInteger(lock.productFileCount) || lock.productFileCount <= 0 ||
      !/^[a-f0-9]{64}$/u.test(lock.archiveSha256) || !/^[a-f0-9]{64}$/u.test(lock.productSha256)) {
    throw new Error(`Invalid prepared-product lock: ${lockPathLabel(lock)}`);
  }
}

function lockPathLabel(lock) {
  return typeof lock?.directory === "string" ? lock.directory : "unknown product";
}

function matchesArchive(bytes, lock) {
  return bytes.length === lock.archiveByteLength && sha256(bytes) === lock.archiveSha256;
}

function matchesProduct(product, lock) {
  return product.productFileCount === lock.productFileCount &&
    product.productByteLength === lock.productByteLength &&
    product.productSha256 === lock.productSha256;
}

function isUnsafeEntry(entry, directory) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") ||
    parts.some((part) => part.startsWith("._")) ||
    !(entry === directory || entry === `${directory}/` || entry.startsWith(`${directory}/`));
}

async function download(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`Prepared-product download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function printReady(source, lock, product) {
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    source,
    adapter: lock.adapter,
    directory: lock.directory,
    ...product,
  }, null, 2)}\n`);
}

function run(executable, executableArgs, extraEnvironment = {}) {
  const result = spawnSync(executable, executableArgs, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) continue;
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) parsed[argument.slice(2)] = true;
    else {
      parsed[argument.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}
