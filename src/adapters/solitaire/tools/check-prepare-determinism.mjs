#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { prepareCsssolitaire } from "../src/prepare/csssolitaire/prepare.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "csssolitaire-determinism-"));
try {
  const firstRoot = join(temporaryRoot, "first");
  const secondRoot = join(temporaryRoot, "second");
  await prepareCsssolitaire({ outputRoot: firstRoot });
  await prepareCsssolitaire({ outputRoot: secondRoot });
  const [first, second] = await Promise.all([closure(firstRoot), closure(secondRoot)]);
  if (first.sha256 !== second.sha256 || first.bytes !== second.bytes ||
      JSON.stringify(first.files) !== JSON.stringify(second.files)) {
    throw new Error("cssSolitaire preparation is nondeterministic");
  }
  process.stdout.write(`${JSON.stringify({ status: "deterministic", ...first }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function closure(root) {
  const files = (await walk(root)).map((path) => relative(root, path)).sort();
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of files) {
    const contents = await readFile(join(root, path));
    hash.update(path).update("\0").update(contents).update("\0");
    bytes += contents.length;
  }
  return Object.freeze({ sha256: hash.digest("hex"), bytes, files });
}

async function walk(root) {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
