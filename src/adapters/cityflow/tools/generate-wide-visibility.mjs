#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildCityflowPreparedHeightRows,
  buildCityflowSourceFrames,
} from "../src/prepare/csscityflow/model.mjs";
import { ensureCityflowSourceTree } from "../src/prepare/csscityflow/sourceAuthority.mjs";
import {
  CSSCITYFLOW_FACE_IDS,
  CSSCITYFLOW_PRESENTATION_FRAME_COUNT,
  CSSCITYFLOW_SEED,
  buildCityflowSourceState,
} from "../src/prepare/csscityflow/sourceModel.mjs";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const sourceIdentity = await ensureCityflowSourceTree();
const outputPath = resolve(adapterRoot, "notes/references/prepared-visibility-wide.json");
const buildRoot = resolve(repositoryRoot, "build/oracles/cityflow/native-wide-visibility");
const viewport = Object.freeze({ width: 2560, height: 1224 });
const state = buildCityflowSourceState({ bankId: "desktop" });
const sourceFrames = buildCityflowSourceFrames(state);
const presentationHeights = buildCityflowPreparedHeightRows(state, sourceFrames);
const faceCount = state.boxes.length * CSSCITYFLOW_FACE_IDS.length;
const rowBytes = Math.ceil(faceCount / 8);
await mkdir(buildRoot, { recursive: true });
const binary = await compileCapture();
const presentationRows = await captureRows({
  binary,
  label: "presentation",
  heightRows: presentationHeights,
});
const sourceRows = await captureRows({
  binary,
  label: "source",
  heightRows: sourceFrames.map((frame) => frame.boxes.map((box) => box.height)),
});
const transitionDilationFrames = 0;
const rows = presentationRows;
const encoded = encodeRows(rows, faceCount, state.boxes.length);
const sourceEncoded = encodeRows(sourceRows, faceCount, state.boxes.length);
const report = {
  schema: "csscityflow-prepared-wide-visibility-source@1",
  sourceRevision: sourceIdentity.revision,
  seed: CSSCITYFLOW_SEED,
  frameCount: rows.length,
  sourceFrameCount: sourceRows.length,
  faceCount,
  viewport,
  selection: "stage-width-greater-than-two-times-stage-height",
  transitionDilationFrames,
  ...encoded,
  source: {
    schema: "csscityflow-prepared-wide-source-visibility@1",
    frameCount: sourceRows.length,
    transitionDilationFrames: 0,
    ...sourceEncoded,
  },
  provenance: {
    method: "pinned-native-cityflow-depth-and-backface-id-buffer-wide-source-viewport",
    presentation: "schema-18-prepared-height-bank-plus-exact-source-height-rows",
    sourceViewportBranch: "width-greater-than-height-times-two-square-viewport",
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...report, initialVisibleBitsBase64: "[encoded]", transitionOffsetsBase64: "[encoded]", transitionFaceIndicesBase64: "[encoded]" }, null, 2));

async function compileCapture() {
  if (process.platform !== "darwin") throw new Error("Cityflow native visibility generation requires macOS CGL");
  const sourceRoot = sourceIdentity.sourceRoot;
  for (const name of ["colors.c", "colors.h", "hsv.c", "hsv.h"]) {
    await writeFile(join(buildRoot, name), await readFile(join(sourceRoot, "utils", name)));
  }
  const binary = join(buildRoot, "capture-cityflow-visibility");
  const sdk = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).stdout.trim();
  run("clang", [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-isysroot", sdk,
    "-include", join(adapterRoot, "tools/native/headless/include/xlockmore.h"),
    "-I", join(adapterRoot, "tools/native/headless/include"),
    "-I", buildRoot,
    "-I", join(sourceRoot, "hacks/glx"),
    "-I", join(sourceRoot, "utils"),
    join(adapterRoot, "tools/native/headless/capture-cityflow-visibility.c"),
    join(sourceRoot, "hacks/glx/gltrackball.c"),
    join(sourceRoot, "hacks/glx/trackball.c"),
    join(sourceRoot, "hacks/glx/quaternion.c"),
    join(sourceRoot, "utils/yarandom.c"),
    join(buildRoot, "colors.c"),
    join(buildRoot, "hsv.c"),
    "-framework", "OpenGL", "-lm", "-o", binary,
  ]);
  return binary;
}

async function captureRows({ binary, label, heightRows }) {
  const heightPath = join(buildRoot, `${label}-heights-f64le.bin`);
  const visibilityPath = join(buildRoot, `${label}-visibility.bin`);
  const bytes = Buffer.alloc(heightRows.length * state.boxes.length * 8);
  let offset = 0;
  for (const row of heightRows) {
    for (const height of row) {
      bytes.writeDoubleLE(height, offset);
      offset += 8;
    }
  }
  await writeFile(heightPath, bytes);
  run(binary, [
    visibilityPath,
    String(CSSCITYFLOW_SEED),
    String(state.boxes.length),
    String(viewport.width),
    String(viewport.height),
    String(heightRows.length),
    heightPath,
  ]);
  const captured = await readFile(visibilityPath);
  if (captured.length !== heightRows.length * rowBytes) {
    throw new Error(`Cityflow ${label} visibility byte count drifted`);
  }
  return Array.from({ length: heightRows.length }, (_, frameIndex) =>
    Buffer.from(captured.subarray(frameIndex * rowBytes, (frameIndex + 1) * rowBytes)));
}

function encodeRows(rows, count, boxCount) {
  const offsets = [0];
  const indices = [];
  for (let frameIndex = 0; frameIndex < rows.length; frameIndex += 1) {
    const previous = rows[(frameIndex - 1 + rows.length) % rows.length];
    for (let faceIndex = 0; faceIndex < count; faceIndex += 1) {
      if (bit(rows[frameIndex], faceIndex) !== bit(previous, faceIndex)) indices.push(faceIndex);
    }
    offsets.push(indices.length);
  }
  const offsetBytes = Buffer.alloc(offsets.length * 2);
  const indexBytes = Buffer.alloc(indices.length * 2);
  offsets.forEach((value, index) => offsetBytes.writeUInt16LE(value, index * 2));
  indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
  const counts = rows.map((row) => Array.from({ length: count }, (_, index) => bit(row, index))
    .reduce((sum, value) => sum + value, 0));
  const boxCounts = rows.map((row) => Array.from({ length: boxCount }, (_, boxIndex) =>
    Number(CSSCITYFLOW_FACE_IDS.some((_, faceIndex) =>
      bit(row, boxIndex * CSSCITYFLOW_FACE_IDS.length + faceIndex)))).reduce((sum, value) => sum + value, 0));
  return {
    initialVisibleCount: counts[0],
    minimumVisibleFaces: Math.min(...counts),
    maximumVisibleFaces: Math.max(...counts),
    meanVisibleFaces: counts.reduce((sum, value) => sum + value, 0) / counts.length,
    minimumVisibleBoxes: Math.min(...boxCounts),
    maximumVisibleBoxes: Math.max(...boxCounts),
    meanVisibleBoxes: boxCounts.reduce((sum, value) => sum + value, 0) / boxCounts.length,
    transitionCount: indices.length,
    initialVisibleBitsBase64: rows[0].toString("base64"),
    transitionOffsetsBase64: offsetBytes.toString("base64"),
    transitionFaceIndicesBase64: indexBytes.toString("base64"),
  };
}

function bit(row, index) {
  return row[index >> 3] >> (index & 7) & 1;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result;
}
