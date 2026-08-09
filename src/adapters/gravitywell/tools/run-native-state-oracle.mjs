#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildPreparedGravityWellStates } from "../src/prepare/cssgravitywell/sourceModel.mjs";

const run = promisify(execFile);
const sourceRoot = process.env.CSSGRAVITYWELL_SOURCE_ROOT;
if (!sourceRoot) throw new Error("Set CSSGRAVITYWELL_SOURCE_ROOT for the native Gravity Well oracle");
const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "bench/results/cssgravitywell/native-state");
const executable = join(outputRoot, "capture-gravitywell-state");
await mkdir(outputRoot, { recursive: true });
await run("cc", [
  "-std=c11", "-O2",
  "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
  join(adapterRoot, "tools/native/capture-gravitywell-state.c"),
  join(resolve(sourceRoot), "utils/yarandom.c"),
  "-I", join(resolve(sourceRoot), "utils"),
  "-lm", "-o", executable,
]);
const { stdout } = await run(executable, []);
const nativeRows = stdout.trim().split("\n").map((line) => {
  const [frameIndex, vertexIndex, depth] = line.split(",").map(Number);
  return Object.freeze({ frameIndex, vertexIndex, depth });
});
const prepared = buildPreparedGravityWellStates();
const comparisons = nativeRows.map((row) => {
  const browserDepth = prepared.frames[row.frameIndex].depths[row.vertexIndex];
  return Object.freeze({
    ...row,
    browserDepth,
    absoluteDifference: Math.abs(row.depth - browserDepth),
  });
});
const maximumAbsoluteDifference = Math.max(...comparisons.map((row) => row.absoluteDifference));
const tolerance = 0.002;
const result = Object.freeze({
  schema: "cssgravitywell-native-state-oracle@1",
  status: maximumAbsoluteDifference <= tolerance ? "passed" : "failed",
  sourceRootLabel: "CSSGRAVITYWELL_SOURCE_ROOT",
  sampleCount: comparisons.length,
  tolerance,
  maximumAbsoluteDifference,
  comparisons,
});
await writeFile(join(outputRoot, "comparison.json"), `${JSON.stringify(result, null, 2)}\n`);
if (result.status !== "passed") {
  throw new Error(`Gravity Well native state oracle failed: max |delta| ${maximumAbsoluteDifference}`);
}
console.log(JSON.stringify(result, null, 2));
