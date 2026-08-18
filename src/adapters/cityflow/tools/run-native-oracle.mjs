#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildCityflowSourceState, cityflowFrameAt } from "../src/prepare/csscityflow/sourceModel.mjs";

const run = promisify(execFile);
const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const sourceRoot = resolveRequiredSourceRoot();
const outputRoot = join(repositoryRoot, "build/oracles/cityflow/native-state");
const binary = join(outputRoot, "capture-cityflow-state");
await mkdir(outputRoot, { recursive: true });
await run("cc", [
  "-std=c11", "-O2",
  "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
  `-I${join(sourceRoot, "utils")}`,
  join(adapterRoot, "tools/native/capture-cityflow-state.c"),
  join(sourceRoot, "utils/yarandom.c"),
  "-lm", "-o", binary,
]);

const checks = [];
for (const bankId of ["desktop"]) {
  for (const tick of [0, 73, 251]) {
    const state = buildCityflowSourceState({ bankId });
    const frame = cityflowFrameAt(state, tick);
    const { stdout } = await run(binary, [String(state.seed), String(state.source.boxCount), String(tick)]);
    const native = JSON.parse(stdout);
    compareState(state, frame, native);
    checks.push({ bankId, tick, boxCount: state.boxes.length, status: "exact-with-float-tolerance" });
    await writeFile(join(outputRoot, `${bankId}-tick-${tick}.json`), `${JSON.stringify(native, null, 2)}\n`);
  }
}
const report = { schema: "csscityflow-native-state-oracle@1", sourceRoot, checks };
await writeFile(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function resolveRequiredSourceRoot() {
  const configured = process.env.CSSCITYFLOW_SOURCE_ROOT;
  if (!configured) throw new Error("Set CSSCITYFLOW_SOURCE_ROOT for the native Cityflow oracle");
  return resolve(configured);
}

function compareState(state, frame, native) {
  const indices = [0, 1, 64, 128, 192, 255];
  for (const [sampleIndex, paletteIndex] of indices.entries()) {
    for (let channel = 0; channel < 3; channel += 1) {
      equal(native.palette[sampleIndex][channel], state.palette[paletteIndex][channel], `palette ${paletteIndex}:${channel}`);
    }
  }
  for (let index = 0; index < 6; index += 1) {
    close(native.waves[index][0], frame.wavePositions[index].xTheta, 1e-12, `wave ${index} x theta`);
    close(native.waves[index][1], frame.wavePositions[index].yTheta, 1e-12, `wave ${index} y theta`);
    equal(native.waves[index][2], frame.wavePositions[index].x, `wave ${index} x`);
    equal(native.waves[index][3], frame.wavePositions[index].y, `wave ${index} y`);
  }
  for (let index = 0; index < native.boxes.length; index += 1) {
    const actual = native.boxes[index];
    const box = state.boxes[index];
    const rendered = frame.boxes[index];
    equal(actual[0], box.sourceIndex, `box ${index} source index`);
    for (const [offset, key] of [[1, "x"], [2, "y"], [3, "z"], [4, "cth"], [5, "sth"], [6, "width"], [7, "depth"]]) {
      close(actual[offset], box[key], 2e-7, `box ${index} ${key}`);
    }
    equal(actual[8], box.sampleX, `box ${index} sample x`);
    equal(actual[9], box.sampleY, `box ${index} sample y`);
    close(actual[10], rendered.height, 2e-7, `box ${index} height`);
    equal(actual[11], rendered.colorIndex, `box ${index} color`);
  }
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: native ${actual}, prepared ${expected}`);
}

function close(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: native ${actual}, prepared ${expected}, tolerance ${tolerance}`);
  }
}
