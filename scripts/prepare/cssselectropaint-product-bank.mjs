#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lock = JSON.parse(await readFile(
  join(repositoryRoot, "src/adapters/electropaint/prepared-bank.lock.json"),
  "utf8",
));
if (lock.schema !== "cssselectropaint-prepared-bank-lock@1" ||
    lock.variantCount !== 8 || lock.timelineStateCountPerVariant !== 64_000 ||
    lock.timelineChunkCountPerVariant !== 128 || lock.retainedQuadCount !== 40 ||
    !Number.isSafeInteger(lock.archiveByteLength) || lock.archiveByteLength <= 0 ||
    !/^[a-f0-9]{64}$/u.test(lock.archiveSha256)) {
  throw new Error("ElectroPaint prepared-bank lock is incomplete or invalid");
}

const generatedRoot = resolve(
  process.env.CSSSELECTROPAINT_GENERATED_ROOT ?? join(repositoryRoot, "build", "generated"),
);
const publicRoot = join(generatedRoot, "public");
const targetRoot = join(publicRoot, "cssselectropaint");
if (verifyBank(publicRoot)) {
  process.stdout.write(`${JSON.stringify({ status: "ready", source: "existing" }, null, 2)}\n`);
  process.exit(0);
}

const localArchive = process.env.CSSSELECTROPAINT_PRODUCT_BANK_ARCHIVE;
const cacheRoot = join(repositoryRoot, ".local", "downloads", "cssselectropaint");
const archivePath = localArchive
  ? resolve(localArchive)
  : join(cacheRoot, `${lock.archiveSha256}.tar.gz`);
let archiveBytes;
try {
  archiveBytes = await readFile(archivePath);
} catch (error) {
  if (localArchive || error?.code !== "ENOENT") throw error;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`ElectroPaint product bank download failed: ${response.status}`);
  archiveBytes = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(archivePath, archiveBytes);
}
if (archiveBytes.length !== lock.archiveByteLength || sha256(archiveBytes) !== lock.archiveSha256) {
  throw new Error("ElectroPaint product bank archive identity mismatch");
}

const listing = run("tar", ["-tzf", archivePath]);
const entries = listing.trim().split("\n").filter(Boolean);
if (entries.length === 0 || entries.some(isUnsafeEntry)) {
  throw new Error("ElectroPaint product bank archive contains an unsafe path");
}

const stagingRoot = join(generatedRoot, `.cssselectropaint-product-${process.pid}`);
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
try {
  run("tar", ["-xzf", archivePath, "-C", stagingRoot]);
  if (!verifyBank(stagingRoot)) {
    throw new Error("ElectroPaint unpacked product bank failed its prepared-asset contract");
  }
  await mkdir(publicRoot, { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await rename(join(stagingRoot, "cssselectropaint"), targetRoot);
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    source: localArchive ? "local-archive" : "release",
    archiveByteLength: archiveBytes.length,
    archiveSha256: lock.archiveSha256,
  }, null, 2)}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

function verifyBank(generatedPublicRoot) {
  const testPath = join(
    repositoryRoot,
    "src/adapters/electropaint/test/cssselectropaint-assets.test.mjs",
  );
  const result = spawnSync(process.execPath, ["--test", testPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CSSSELECTROPAINT_GENERATED_PUBLIC_ROOT: generatedPublicRoot,
    },
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function isUnsafeEntry(entry) {
  const parts = entry.split("/");
  return entry.startsWith("/") || parts.includes("..") ||
    parts.some((part) => part.startsWith("._")) ||
    !(entry === "cssselectropaint" || entry === "cssselectropaint/" ||
      entry.startsWith("cssselectropaint/"));
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
