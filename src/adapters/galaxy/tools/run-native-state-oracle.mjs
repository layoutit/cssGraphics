#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  advanceGalaxySource,
  commitGalaxySourceFrame,
  createGalaxySourceUniverse,
} from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT } from "../src/prepare/cssgalaxy/qualification.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const galaxyCount = Number(process.argv[2] ?? 2);
if (galaxyCount !== 2 && galaxyCount !== 3) throw new RangeError("Native Galaxy oracle requires 2 or 3 galaxies");
const outputRoot = resolve(repositoryRoot, `bench/results/cssgalaxy/state-oracle/g${galaxyCount}`);
const executable = resolve(outputRoot, "native-galaxy-oracle");
const nativeStatePath = resolve(outputRoot, "native-state.bin");
const reportPath = resolve(outputRoot, "report.json");
const seed = CSSGALAXY_COMPARISON_SEEDS_BY_GALAXY_COUNT[galaxyCount];
const starCount = galaxyCount === 3 ? 1500 : 1900;
const frameCount = 1200;

await mkdir(outputRoot, { recursive: true });
await run("clang", [
  "-std=c11", "-O2", "-Wall", "-Wextra", "-Wno-misleading-indentation",
  `-DGALAXIES=${galaxyCount}`,
  resolve(import.meta.dirname, "native-galaxy-oracle.c"), "-lm", "-o", executable,
]);
await run(executable, ["state", String(seed), String(starCount), String(frameCount), nativeStatePath]);

const native = await readFile(nativeStatePath);
const view = new DataView(native.buffer, native.byteOffset, native.byteLength);
const magic = native.subarray(0, 8).toString("ascii").replace(/\0+$/u, "");
let offset = 8;
const header = {
  seed: view.getUint32(offset, true),
  starCount: view.getUint32(offset + 4, true),
  recordCount: view.getUint32(offset + 8, true),
  galaxyCount: view.getUint32(offset + 12, true),
  version: view.getUint32(offset + 16, true),
};
offset += 20;
if (magic !== "CSSGAL1" || header.seed !== seed || header.starCount !== starCount ||
    header.recordCount !== frameCount + 1 || header.galaxyCount !== galaxyCount || header.version !== 1) {
  throw new Error(`Native Galaxy state header drifted: ${JSON.stringify({ magic, header })}`);
}

const universe = createGalaxySourceUniverse({ seed, galaxyCount });
let earliestPositionVelocityDivergence = null;
let exactPositionVelocityMatchCount = 0;
let positionVelocityComparisonCount = 0;
let maximumAbsoluteDelta = 0;
let projectedPointMismatchCount = 0;
const comparisonScratch = Buffer.allocUnsafe(8);

for (let recordIndex = 0; recordIndex < header.recordCount; recordIndex += 1) {
  const frame = recordIndex === 0 ? null : advanceGalaxySource(universe);
  const expectedFrame = recordIndex - 1;
  const nativeFrame = view.getInt32(offset, true);
  const nativeGeneration = view.getInt32(offset + 4, true);
  const nativeStep = view.getInt32(offset + 8, true);
  const nativeRotX = view.getFloat64(offset + 12, true);
  const nativeRotY = view.getFloat64(offset + 20, true);
  offset += 28;
  const expectedGeneration = frame?.generation ?? universe.generation;
  const expectedStep = frame?.generationFrameIndex ?? universe.step;
  const expectedRotX = frame?.rotX ?? universe.rotX;
  const expectedRotY = frame?.rotY ?? universe.rotY;
  if (nativeFrame !== expectedFrame || nativeGeneration !== expectedGeneration || nativeStep !== expectedStep ||
      nativeRotX !== expectedRotX || nativeRotY !== expectedRotY) {
    throw new Error(`Native Galaxy record identity drifted at ${recordIndex}`);
  }
  for (let galaxyIndex = 0; galaxyIndex < header.galaxyCount; galaxyIndex += 1) {
    const galaxy = universe.galaxies[galaxyIndex];
    const nativeMass = view.getInt32(offset, true);
    const nativeStarCount = view.getInt32(offset + 4, true);
    const nativeGalcol = view.getInt32(offset + 8, true);
    offset += 12;
    if (nativeMass !== galaxy.mass || nativeStarCount !== galaxy.nstars || nativeGalcol !== galaxy.galcol) {
      throw new Error(`Native Galaxy initialization scalar drifted at record ${recordIndex}, galaxy ${galaxyIndex}`);
    }
    for (let axis = 0; axis < 3; axis += 1) compareDouble(galaxy.pos[axis], `galaxy[${galaxyIndex}].pos[${axis}]`);
    for (let axis = 0; axis < 3; axis += 1) compareDouble(galaxy.vel[axis], `galaxy[${galaxyIndex}].vel[${axis}]`);
    for (let starIndex = 0; starIndex < starCount / header.galaxyCount; starIndex += 1) {
      const star = galaxy.stars[starIndex];
      for (let axis = 0; axis < 3; axis += 1) compareDouble(star.pos[axis], `galaxy[${galaxyIndex}].star[${starIndex}].pos[${axis}]`);
      for (let axis = 0; axis < 3; axis += 1) compareDouble(star.vel[axis], `galaxy[${galaxyIndex}].star[${starIndex}].vel[${axis}]`);
      const nativeX = view.getInt16(offset, true);
      const nativeY = view.getInt16(offset + 2, true);
      offset += 4;
      if (nativeX !== star.x || nativeY !== star.y) projectedPointMismatchCount += 1;
    }
  }
  if (frame) commitGalaxySourceFrame(universe);

  function compareDouble(actual, field) {
    const nativeValue = view.getFloat64(offset, true);
    const nativeBits = view.getBigUint64(offset, true);
    comparisonScratch.writeDoubleLE(actual, 0);
    const actualBits = comparisonScratch.readBigUInt64LE(0);
    const absoluteDelta = Math.abs(nativeValue - actual);
    maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, absoluteDelta);
    positionVelocityComparisonCount += 1;
    if (nativeBits === actualBits) {
      exactPositionVelocityMatchCount += 1;
    } else if (earliestPositionVelocityDivergence === null) {
      earliestPositionVelocityDivergence = Object.freeze({
        recordIndex,
        sourceFrameIndex: expectedFrame,
        generation: expectedGeneration,
        generationFrameIndex: expectedStep,
        field,
        nativeValue,
        javascriptDiagnosticModelValue: actual,
        absoluteDelta,
        nativeBits: `0x${nativeBits.toString(16).padStart(16, "0")}`,
        javascriptDiagnosticModelBits: `0x${actualBits.toString(16).padStart(16, "0")}`,
      });
    }
    offset += 8;
  }
}
if (offset !== native.byteLength) throw new Error(`Native Galaxy state byte tail drifted: ${offset}/${native.byteLength}`);

const report = Object.freeze({
  schema: "cssgalaxy-native-headless-state-oracle@1",
  capturedAt: new Date().toISOString(),
  source: Object.freeze({
    revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
    path: "hacks/galaxy.c",
    sha256: "801b7a7ff3749b032974b8dfe9021c2e3998645f138f9beec7e09037e36d66d9",
  }),
  compiler: "Apple clang, C11, -O2",
  seed,
  galaxyCount,
  starCount,
  completeSourceState: true,
  frameCount,
  recordCount: header.recordCount,
  comparisonBoundary: Object.freeze({
    authoritativePreparedStateGenerator: "native C11 source-equation oracle",
    comparedModel: "independent JavaScript source-equation diagnostic",
    browserPreparedAssetsUseAuthoritativeNativeProjection: true,
  }),
  positionVelocityComparisonCount,
  exactPositionVelocityMatchCount,
  exactPositionVelocityMatchRatio: exactPositionVelocityMatchCount / positionVelocityComparisonCount,
  earliestPositionVelocityDivergence,
  maximumAbsoluteDelta,
  projectedPointMismatchCount,
  nativeStatePath,
  status: projectedPointMismatchCount === 0
    ? "diagnostic-model-projection-exact"
    : "diagnostic-divergence-found-authoritative-preparation-uses-native",
});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, ...report }, null, 2));

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}
