#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { CSSFLOCKS_BUG_VERTICES } from "../src/prepare/cssflocks/modelBuilder.mjs";
import {
  CSSFLOCKS_SOURCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceBlocks,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { decodeFlocksPreparedSourceValues } from "../src/shared/cssflocks/preparedBlockTransport.mjs";
import { buildFlocksBugMatrix, flocksHueToHex } from "../src/shared/cssflocks/bugTransform.mjs";
import { requireLockedBytes } from "./nativeStateOracle.mjs";
import { packageFlocksFrameSequence } from "./frameSequenceArtifacts.mjs";
import {
  CSSFLOCKS_FRAME_SEQUENCE_COUNT,
  CSSFLOCKS_FRAME_SEQUENCE_PLAN,
  flattenFlocksFrameSequencePlan,
} from "./frameSequencePlan.mjs";

const run = promisify(execFile);
const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/cssflocks");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/reference-frames");
const rawFrames = resolve(outputRoot, "raw");
const packagedFrames = resolve(outputRoot, "packaged");
const stateCsv = resolve(outputRoot, "states.csv");
const sourceRoot = resolve(repositoryRoot, ".local/reallyslickscreensavers");
const lock = JSON.parse(await readFile(resolve(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const sourcePath = resolve(sourceRoot, lock.path);

requireLockedBytes(await readFile(sourcePath), lock.sha256, lock.path);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(rawFrames, { recursive: true });

const catalog = JSON.parse(await readFile(resolve(generatedRoot, "desktop/catalog.json"), "utf8"));
if (catalog?.schema !== "cssflocks-prepared-stream-catalog@1" || catalog.bugCount !== 324 ||
    catalog.leafCount !== 1_944 || catalog.streamFrameCount !== 13_440 ||
    catalog.terminalSeam?.correspondence?.length !== 324) {
  throw new Error("Prepared Flocks desktop catalog is not the qualified sequence source");
}

const flattenedPlan = flattenFlocksFrameSequencePlan();
if (flattenedPlan.length !== CSSFLOCKS_FRAME_SEQUENCE_COUNT) throw new Error("Flocks frame-sequence plan count drifted");
const exactFrameIndices = new Set(flattenedPlan.filter((entry) => entry.authority === "exact-source").map((entry) => entry.streamFrameIndex));
const exactSourceFrames = collectExactSourceFrames(exactFrameIndices);
const decodedBlocks = new Map();
const stateFrames = [];
const transportMaxima = { position: 0, velocity: 0, hue: 0, projectedPixel: 0 };
const terminalSegment = CSSFLOCKS_FRAME_SEQUENCE_PLAN.find((segment) => segment.id === "terminal-seam");

for (const entry of flattenedPlan) {
  const decoded = await decodedFrame(entry.streamFrameIndex);
  const afterTerminalWrap = entry.segmentId === terminalSegment.id && entry.segmentOrdinal > terminalSegment.wrapsAfterOrdinal;
  const sourceIndexByRoot = afterTerminalWrap ? catalog.terminalSeam.correspondence : Array.from({ length: catalog.bugCount }, (_, index) => index);
  const decodedRoots = sourceIndexByRoot.map((sourceIndex) => decoded[sourceIndex]);
  const sourceFrame = exactSourceFrames.get(entry.streamFrameIndex);
  const referenceRoots = sourceFrame
    ? sourceIndexByRoot.map((sourceIndex) => sourceFrame.bugs[sourceIndex])
    : decodedRoots;
  if (sourceFrame) compareTransport(referenceRoots, decodedRoots, transportMaxima);
  stateFrames.push(Object.freeze({
    ...entry,
    sourceIndexByRoot: Object.freeze([...sourceIndexByRoot]),
    referenceRoots: Object.freeze(referenceRoots.map(serializeRoot)),
    decodedRoots: Object.freeze(decodedRoots.map(serializeRoot)),
  }));
}

const csvRows = ["ordinal,root,x,y,z,vx,vy,vz,hue"];
for (const frame of stateFrames) {
  frame.referenceRoots.forEach((root, rootIndex) => {
    csvRows.push([
      frame.ordinal,
      rootIndex,
      ...[...root.position, ...root.velocity, root.hue].map((value) => Number(value).toPrecision(10)),
    ].join(","));
  });
}
await writeFile(stateCsv, `${csvRows.join("\n")}\n`);
const statesPath = resolve(outputRoot, "states.json");
await writeFile(statesPath, `${JSON.stringify({
  schema: "cssflocks-frame-sequence-reference-state@1",
  profile: "desktop",
  rootCount: catalog.bugCount,
  leafCount: catalog.leafCount,
  plan: CSSFLOCKS_FRAME_SEQUENCE_PLAN,
  frames: stateFrames,
  transportMaxima,
}, null, 2)}\n`);

const executable = resolve(outputRoot, "cssflocks-native-sequence-oracle");
await run("clang++", [
  "-std=c++17", "-O2", "-Wno-deprecated-declarations", "-DRS_XSCREENSAVER=1",
  `-DCSSFLOCKS_SOURCE_PATH=\"${sourcePath}\"`,
  `-I${resolve(adapterRoot, "tools/oracle/native-platform")}`,
  `-I${resolve(adapterRoot, "tools/oracle/stubs")}`,
  `-I${resolve(sourceRoot, "libs")}`,
  resolve(adapterRoot, "tools/native-sequence-oracle.cpp"),
  resolve(sourceRoot, "libs/Rgbhsl/Rgbhsl.cpp"),
  "-framework", "OpenGL", "-o", executable,
]);
const { stdout: nativeStdout } = await run(executable, [stateCsv, rawFrames], { maxBuffer: 4 * 1024 * 1024 });
const native = JSON.parse(nativeStdout);
if (native.frameCount !== CSSFLOCKS_FRAME_SEQUENCE_COUNT || native.rootCount !== catalog.bugCount) {
  throw new Error(`Native Flocks sequence cardinality drifted: ${nativeStdout}`);
}
const packaged = await packageFlocksFrameSequence({
  frames: rawFrames,
  output: packagedFrames,
  label: "cssflocks_reference",
  expectedFrames: CSSFLOCKS_FRAME_SEQUENCE_COUNT,
});
const report = Object.freeze({
  schema: "cssflocks-source-native-frame-sequence@1",
  source: Object.freeze({ revision: lock.revision, path: lock.path, sha256: lock.sha256 }),
  profile: Object.freeze({ id: "desktop", rootCount: catalog.bugCount, leafCount: catalog.leafCount }),
  plan: CSSFLOCKS_FRAME_SEQUENCE_PLAN,
  frameCount: stateFrames.length,
  transportTolerances: Object.freeze({ position: 0.02, velocity: 1 / 256, hue: 1 / 65_535, projectedPixel: 0.25 }),
  transportMaxima,
  native,
  rawFrames,
  packaged,
  states: statesPath,
  lightingBoundary: "Native reference uses the pinned source OpenGL light; browser uses the accepted fixed flat face factors, so RGB image diffs are diagnostic while state and projection gates are strict.",
});
requireTransportWithinTolerance(report);
await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function collectExactSourceFrames(wanted) {
  const selected = new Map();
  const maximum = Math.max(...wanted);
  outer: for (const block of buildFlocksSourceBlocks({ bank: CSSFLOCKS_SOURCE_BANK })) {
    for (const frame of block.frames) {
      if (wanted.has(frame.index)) selected.set(frame.index, frame);
      if (frame.index >= maximum) break outer;
    }
  }
  if (selected.size !== wanted.size) throw new Error(`Expected ${wanted.size} exact source frames, received ${selected.size}`);
  return selected;
}

async function decodedFrame(streamFrameIndex) {
  const blockIndex = Math.floor(streamFrameIndex / catalog.blockFrameCount);
  const localFrameIndex = streamFrameIndex % catalog.blockFrameCount;
  let values = decodedBlocks.get(blockIndex);
  if (!values) {
    const descriptor = catalog.entries[blockIndex];
    const encoded = await readFile(resolve(generatedRoot, descriptor.assetUrl.replace(/^\/cssflocks\//u, "")));
    values = decodeFlocksPreparedSourceValues(gunzipSync(encoded), descriptor, catalog);
    decodedBlocks.set(blockIndex, values);
  }
  return Object.freeze(Array.from({ length: catalog.bugCount }, (_, bugIndex) => {
    const offset = (localFrameIndex * catalog.bugCount + bugIndex) * 7;
    return Object.freeze({
      position: Object.freeze(Array.from(values.subarray(offset, offset + 3))),
      velocity: Object.freeze(Array.from(values.subarray(offset + 3, offset + 6))),
      hue: values[offset + 6],
    });
  }));
}

function serializeRoot(root) {
  const transform = buildFlocksBugMatrix([...root.position], [...root.velocity]);
  return Object.freeze({
    position: Object.freeze([...root.position]),
    velocity: Object.freeze([...root.velocity]),
    hue: root.hue,
    matrix: transform.matrix,
    color: flocksHueToHex(root.hue),
  });
}

function compareTransport(sourceRoots, decodedRoots, maxima) {
  for (let rootIndex = 0; rootIndex < sourceRoots.length; rootIndex += 1) {
    const source = sourceRoots[rootIndex];
    const decoded = decodedRoots[rootIndex];
    maxima.position = Math.max(maxima.position, ...source.position.map((value, axis) => Math.abs(value - decoded.position[axis])));
    maxima.velocity = Math.max(maxima.velocity, ...source.velocity.map((value, axis) => Math.abs(value - decoded.velocity[axis])));
    const hueDelta = Math.abs(source.hue - decoded.hue);
    maxima.hue = Math.max(maxima.hue, Math.min(hueDelta, 1 - hueDelta));
    const sourceMatrix = buildFlocksBugMatrix([...source.position], [...source.velocity]).matrix;
    const decodedMatrix = buildFlocksBugMatrix([...decoded.position], [...decoded.velocity]).matrix;
    for (const vertex of CSSFLOCKS_BUG_VERTICES) {
      const sourcePixel = projectVisible(vertex, sourceMatrix, 1280, 800);
      if (!sourcePixel) continue;
      const decodedPixel = projectVisible(vertex, decodedMatrix, 1280, 800, false);
      if (!decodedPixel) throw new Error("Visible exact-source vertex crossed the camera plane after transport decoding");
      maxima.projectedPixel = Math.max(maxima.projectedPixel,
        Math.abs(sourcePixel[0] - decodedPixel[0]), Math.abs(sourcePixel[1] - decodedPixel[1]));
    }
  }
}

function projectVisible(vertex, matrix, width, height, requireInsideViewport = true) {
  const world = applyMatrix(matrix, [...vertex, 1]);
  const depth = 568 - world[2];
  if (depth <= 0.1) return null;
  const scale = height / (2 * Math.tan(CSSFLOCKS_SOURCE.fieldOfViewDegrees * Math.PI / 360)) / depth;
  const pixel = [width / 2 + world[0] * scale, height / 2 - world[1] * scale];
  if (requireInsideViewport && (pixel[0] < 0 || pixel[0] > width || pixel[1] < 0 || pixel[1] > height)) return null;
  return pixel;
}

function applyMatrix(matrix, vector) {
  return [0, 1, 2, 3].map((row) => vector.reduce((sum, value, column) => sum + matrix[column * 4 + row] * value, 0));
}

function requireTransportWithinTolerance(report) {
  const { transportMaxima: maxima, transportTolerances: tolerances } = report;
  for (const key of Object.keys(tolerances)) {
    if (maxima[key] > tolerances[key]) throw new Error(`Flocks sequence ${key} error ${maxima[key]} exceeds ${tolerances[key]}`);
  }
}
