#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = resolve(repositoryRoot, "build/generated/public/csscityflow");
const prepareScript = resolve(adapterRoot, "tools/prepare-csscityflow.mjs");

const first = await prepareAndHash();
const second = await prepareAndHash();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error(`Cityflow preparation is nondeterministic:\n${JSON.stringify({ first, second }, null, 2)}`);
}
console.log(JSON.stringify({ status: "deterministic", ...second }, null, 2));

async function prepareAndHash() {
  await run(process.execPath, [prepareScript], {
    cwd: repositoryRoot,
    env: process.env,
    timeout: 300_000,
  });
  const files = await walk(outputRoot);
  const closure = createHash("sha256");
  let bytes = 0;
  for (const path of files) {
    const relativePath = relative(outputRoot, path);
    const contents = await readFile(path);
    closure.update(relativePath).update("\0").update(contents).update("\0");
    bytes += contents.length;
  }
  return Object.freeze({
    sha256: closure.digest("hex"),
    bytes,
    files: Object.freeze(files.map((path) => relative(outputRoot, path))),
  });
}

async function walk(root) {
  const paths = [];
  for (const entry of (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
