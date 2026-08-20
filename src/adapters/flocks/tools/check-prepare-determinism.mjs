#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "cssflocks-determinism-"));
try {
  const leftRoot = join(root, "left");
  const rightRoot = join(root, "right");
  await runPrepare(leftRoot);
  await runPrepare(rightRoot);
  const left = await digestTree(join(leftRoot, "cssflocks"));
  const right = await digestTree(join(rightRoot, "cssflocks"));
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Flocks prepare output is not deterministic\nleft=${JSON.stringify(left)}\nright=${JSON.stringify(right)}`);
  }
  console.log(JSON.stringify({ deterministic: true, fileCount: left.length, digest: treeDigest(left) }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}

function runPrepare(outputRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("prepare-cssflocks.mjs", import.meta.url).pathname], {
      cwd: process.cwd(),
      env: { ...process.env, CSSFLOCKS_GENERATED_PUBLIC_DIR: outputRoot },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`Flocks prepare determinism child failed: code=${code} signal=${signal}`)));
  });
}

async function digestTree(rootPath) {
  const entries = [];
  for (const path of await walk(rootPath)) {
    const bytes = await readFile(path);
    const text = /\.(?:json|html|css|mjs)$/u.test(path) ? bytes.toString("utf8") : "";
    if (text.includes(rootPath) || text.includes(process.cwd())) {
      throw new Error(`Flocks generated file leaks an absolute path: ${path}`);
    }
    entries.push([relative(rootPath, path), bytes.byteLength, createHash("sha256").update(bytes).digest("hex")]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

async function walk(rootPath) {
  const output = [];
  for (const entry of await readdir(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function treeDigest(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
