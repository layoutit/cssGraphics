#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCssmazeDataSource } from "../src/prepare/cssmaze/dataSource.mjs";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmaze/paths.mjs";

const dataSource = await resolveCssmazeDataSource();
const temporary = await mkdtemp(join(tmpdir(), "cssmaze-determinism-"));
const first = join(temporary, "first");
const second = join(temporary, "second");
try {
  runPrepare(first, dataSource.root);
  runPrepare(second, dataSource.root);
  const firstHashes = await directoryHashes(first);
  const secondHashes = await directoryHashes(second);
  if (JSON.stringify(firstHashes) !== JSON.stringify(secondHashes)) {
    throw new Error(`cssMaze preparation is not deterministic:\n${JSON.stringify({ firstHashes, secondHashes }, null, 2)}`);
  }
  console.log(JSON.stringify({ status: "deterministic", files: firstHashes }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function runPrepare(output, sourceRoot) {
  const result = spawnSync(process.execPath, [
    join(adapterRoot, "tools/prepare-cssmaze.mjs"),
    "--source-root",
    sourceRoot,
    "--output",
    output,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "cssMaze prepare failed");
}

async function directoryHashes(root) {
  const files = await walk(root);
  const rows = [];
  for (const path of files) {
    const bytes = await readFile(join(root, path));
    rows.push([path, createHash("sha256").update(bytes).digest("hex")]);
  }
  return rows;
}

async function walk(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
