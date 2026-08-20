#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { requireLockedBytes } from "./nativeStateOracle.mjs";

const run = promisify(execFile);
const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const sourceRoot = resolve(repositoryRoot, ".local/reallyslickscreensavers");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/geometry");
const nativeFrames = resolve(outputRoot, "native-frames");
const lock = JSON.parse(await readFile(resolve(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const sourcePath = resolve(sourceRoot, lock.path);
requireLockedBytes(await readFile(sourcePath), lock.sha256, lock.path);
await mkdir(nativeFrames, { recursive: true });
const executable = resolve(outputRoot, "cssflocks-native-geometry-oracle");
await run("clang++", [
  "-std=c++17", "-O2", "-Wno-deprecated-declarations", "-DRS_XSCREENSAVER=1",
  `-DCSSFLOCKS_SOURCE_PATH=\"${sourcePath}\"`,
  `-I${resolve(adapterRoot, "tools/oracle/native-platform")}`,
  `-I${resolve(adapterRoot, "tools/oracle/stubs")}`,
  `-I${resolve(sourceRoot, "libs")}`,
  resolve(adapterRoot, "tools/native-geometry-oracle.cpp"),
  resolve(sourceRoot, "libs/Rgbhsl/Rgbhsl.cpp"),
  "-framework", "OpenGL", "-o", executable,
]);
const { stdout } = await run(executable, [nativeFrames], { maxBuffer: 4 * 1024 * 1024 });
const oracle = JSON.parse(stdout);
if (oracle.schema !== "cssflocks-native-geometry-oracle@1" || oracle.triangleCount !== 6 ||
    oracle.frontFace !== 2305 || oracle.cullFaceMode !== 1029 || !oracle.cullEnabled || !oracle.lightingEnabled) {
  throw new Error(`Native Flocks geometry contract failed: ${stdout}`);
}
await writeFile(resolve(outputRoot, "native-geometry.json"), `${JSON.stringify({
  ...oracle,
  sourceRevision: lock.revision,
  sourcePath: lock.path,
  nativeFrames,
}, null, 2)}\n`);
console.log(JSON.stringify({ outputRoot, triangleCount: oracle.triangleCount, renderer: oracle.renderer }, null, 2));
