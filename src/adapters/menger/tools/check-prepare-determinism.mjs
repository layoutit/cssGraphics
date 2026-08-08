#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prepareCssmenger } from "../src/prepare/cssmenger/prepare.mjs";
import {
  adapterRoot,
  generatedPublicRoot,
  repositoryRoot,
} from "../src/prepare/cssmenger/paths.mjs";

const snapshotA = await snapshotPreparedOutput();
const snapshotB = await snapshotPreparedOutput();

if (JSON.stringify(snapshotA) !== JSON.stringify(snapshotB)) {
  throw new Error("prepare:cssmenger is not deterministic.");
}
const serialized = JSON.stringify(snapshotB);
if (/\/Users\/|\\\\Users\\\\|file:\/\//.test(serialized)) {
  throw new Error("Generated cssMenger — XScreenSaver Menger assets leaked a local path.");
}

async function snapshotPreparedOutput() {
  await rm(generatedPublicRoot, { recursive: true, force: true });
  await prepareCssmenger();
  runSnapshotPrepareIfNeeded();
  if (!existsSync(generatedPublicRoot)) {
    throw new Error("prepare:cssmenger did not write " + generatedPublicRoot);
  }
  return snapshotTree(generatedPublicRoot);
}

function runSnapshotPrepareIfNeeded() {
  if ("prepared-polycss-snapshot" !== "prepared-polycss-snapshot") return;
  const result = spawnSync(process.execPath, [join(adapterRoot, "tools/prepare-polycss-snapshot.mjs")], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error("prepare:cssmenger:snapshot failed during determinism check:\n" + (result.stderr || result.stdout));
  }
}

async function snapshotTree(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const out = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const key = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      Object.assign(out, await snapshotTree(root, key));
    } else {
      out[key] = await readFile(join(root, key), "utf8");
    }
  }
  return out;
}
