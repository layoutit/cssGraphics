#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceOracleSequence,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import {
  compareNativeStateRows,
  parseNativeStateCsv,
  requireLockedBytes,
  requirePassingNativeStateComparison,
} from "./nativeStateOracle.mjs";

const run = promisify(execFile);
const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const sourceRoot = resolve(repositoryRoot, ".local/reallyslickscreensavers");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/native-state");
const lock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));

const sourcePath = join(sourceRoot, lock.path);
requireLockedBytes(await readFile(sourcePath), lock.sha256, lock.path);
for (const dependency of lock.dependencies?.rslibs?.files ?? []) {
  requireLockedBytes(await readFile(join(sourceRoot, dependency.path)), dependency.sha256, dependency.path);
}
const { stdout: sourceRevision } = await run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
const { stdout: rslibsRevision } = await run("git", ["-C", join(sourceRoot, "libs"), "rev-parse", "HEAD"]);
if (sourceRevision.trim() !== lock.revision || rslibsRevision.trim() !== lock.dependencies?.rslibs?.revision) {
  throw new Error("Flocks source or rslibs revision does not match source-lock.json");
}

await mkdir(outputRoot, { recursive: true });
const executable = join(outputRoot, "cssflocks-native-state-oracle");
await run("clang++", [
  "-std=c++17", "-O2", "-DRS_XSCREENSAVER=1",
  `-DCSSFLOCKS_SOURCE_PATH=\"${sourcePath}\"`,
  `-I${join(adapterRoot, "tools/oracle/stubs")}`,
  `-I${join(sourceRoot, "libs")}`,
  join(adapterRoot, "tools/native-state-oracle.cpp"),
  join(sourceRoot, "libs/Rgbhsl/Rgbhsl.cpp"),
  "-o", executable,
]);
const { stdout } = await run(executable, ["1"], { maxBuffer: 16 * 1024 * 1024 });
await writeFile(join(outputRoot, "native-state.csv"), stdout);
const rows = parseNativeStateCsv(stdout);
const bank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  seed: 1,
  warmupFrames: 0,
  frameCount: 600,
  blockFrameCount: 60,
});
const sourceOracle = buildFlocksSourceOracleSequence({ bank });
const comparison = compareNativeStateRows(rows, sourceOracle);
await writeFile(join(outputRoot, "comparison.json"), `${JSON.stringify({
  ...comparison,
  sourceRevision: lock.revision,
  rslibsRevision: lock.dependencies.rslibs.revision,
}, null, 2)}\n`);
requirePassingNativeStateComparison(comparison);
console.log(JSON.stringify(comparison, null, 2));
