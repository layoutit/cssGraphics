#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(projectRoot, "notes/references/source-lock.json");
const flagIndex = process.argv.indexOf("--source-root");
const sourceRoot = resolve(
  flagIndex >= 0 ? process.argv[flagIndex + 1] ?? "" :
    process.env.CSSMENGER_SOURCE_ROOT ?? ""
);

if (!sourceRoot || sourceRoot === resolve("")) {
  throw new Error("Pass --source-root /path/to/xscreensaver or set CSSMENGER_SOURCE_ROOT.");
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock.dependencyClosure.status !== "complete-for-polycss-port-authority") {
  throw new Error(`Source closure is not complete: ${lock.dependencyClosure.status}`);
}

function git(...args) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

const actualCommit = git("rev-parse", "HEAD");
const actualTree = git("rev-parse", "HEAD^{tree}");
if (actualCommit !== lock.repository.commit) {
  throw new Error(`Commit mismatch: expected ${lock.repository.commit}, got ${actualCommit}`);
}
if (actualTree !== lock.repository.tree) {
  throw new Error(`Tree mismatch: expected ${lock.repository.tree}, got ${actualTree}`);
}

const categories = Object.values(lock.authority).flat();
const artifactPaths = Object.keys(lock.artifacts);
if (new Set(categories).size !== categories.length ||
    categories.length !== artifactPaths.length ||
    artifactPaths.some((path) => !categories.includes(path))) {
  throw new Error("Authority categories must cover every locked artifact exactly once.");
}
if (artifactPaths.length !== lock.dependencyClosure.fileCount) {
  throw new Error("dependencyClosure.fileCount does not match the artifact census.");
}

for (const [path, expected] of Object.entries(lock.artifacts)) {
  const absolute = join(sourceRoot, path);
  const info = await stat(absolute);
  const bytes = await readFile(absolute);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const gitBlob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");

  if (info.size !== expected.bytes) {
    throw new Error(`${path}: expected ${expected.bytes} bytes, got ${info.size}`);
  }
  if (sha256 !== expected.sha256) {
    throw new Error(`${path}: SHA-256 mismatch`);
  }
  if (gitBlob !== expected.gitBlob) {
    throw new Error(`${path}: Git blob mismatch`);
  }
}

console.log(
  `cssMenger provenance verified: ${artifactPaths.length} files at ` +
  `${actualCommit.slice(0, 12)} (tree ${actualTree.slice(0, 12)}).`
);
