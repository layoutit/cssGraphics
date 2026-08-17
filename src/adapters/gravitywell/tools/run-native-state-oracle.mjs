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
const { stdout } = await run(executable, [], { maxBuffer: 8 * 1024 * 1024 });
const nativeRows = stdout.trim().split("\n").map((line) => {
  const fields = line.split(",");
  if (fields.length !== 3 || fields.some((field) => field.trim() === "")) {
    throw new Error(`Malformed native Gravity Well row: ${line}`);
  }
  const [frameIndex, vertexIndex, depth] = fields.map(Number);
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 ||
      !Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || !Number.isFinite(depth)) {
    throw new Error(`Invalid native Gravity Well row: ${line}`);
  }
  return Object.freeze({ frameIndex, vertexIndex, depth });
});
const prepared = buildPreparedGravityWellStates();
const comparisons = nativeRows.map((row) => {
  const frame = prepared.frames[row.frameIndex];
  if (!frame || row.vertexIndex >= frame.depths.length) {
    throw new RangeError(`Native Gravity Well sample is out of range: ${row.frameIndex},${row.vertexIndex}`);
  }
  const browserDepth = frame.depths[row.vertexIndex];
  return Object.freeze({
    ...row,
    browserDepth,
    absoluteDifference: Math.abs(row.depth - browserDepth),
  });
});
const maximumAbsoluteDifference = comparisons.reduce(
  (maximum, row) => Math.max(maximum, row.absoluteDifference),
  0,
);
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
