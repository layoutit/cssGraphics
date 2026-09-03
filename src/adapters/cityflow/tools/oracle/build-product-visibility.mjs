#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const normalPath = resolve(process.env.CSSCITYFLOW_PRODUCT_VISIBILITY_NORMAL ??
  "bench/results/csscityflow/static-visibility/current/normal-2472x1236.json");
const widePath = resolve(process.env.CSSCITYFLOW_PRODUCT_VISIBILITY_WIDE ??
  "bench/results/csscityflow/static-visibility/current/wide-threshold-2473x1236.json");
const ultrawidePath = resolve(process.env.CSSCITYFLOW_PRODUCT_VISIBILITY_ULTRAWIDE ??
  "bench/results/csscityflow/static-visibility/current/ultrawide-3086x1440.json");
const outputPath = resolve(process.env.CSSCITYFLOW_PRODUCT_VISIBILITY_OUT ??
  "src/adapters/cityflow/notes/references/prepared-static-visibility.json");
const [normal, wide, ultrawide] = await Promise.all([normalPath, widePath, ultrawidePath].map(async (path) =>
  JSON.parse(await readFile(path, "utf8"))));
const frameCount = 301;
const boxCount = 200;
const facesPerBox = 3;
const faceCount = boxCount * facesPerBox;
const transitionDilationFrames = Number.parseInt(
  process.env.CSSCITYFLOW_PRODUCT_VISIBILITY_DILATION_FRAMES ?? "12",
  10,
);
if (!Number.isSafeInteger(transitionDilationFrames) || transitionDilationFrames < 0 ||
    transitionDilationFrames > 12) {
  throw new Error("Cityflow product visibility dilation must be an integer from 0 through 12");
}
if (normal.frameCount !== frameCount || wide.frameCount !== frameCount ||
    ultrawide.frameCount !== frameCount || normal.faceCount !== faceCount ||
    wide.faceCount !== faceCount || ultrawide.faceCount !== faceCount ||
    normal.viewport.width !== 2472 || normal.viewport.height !== 1236 ||
    wide.viewport.width !== 2473 || wide.viewport.height !== 1236 ||
    ultrawide.viewport.width !== 3086 || ultrawide.viewport.height !== 1440) {
  throw new Error("Cityflow product visibility inputs drifted");
}
const sourceRows = unionRows([normal, wide, ultrawide].map(decodeRows));
const sourceBoxRows = sourceRows.map((row) => Uint8Array.from(
  { length: boxCount },
  (_, boxIndex) => Number(Array.from({ length: facesPerBox }, (_, faceIndex) =>
    row[boxIndex * facesPerBox + faceIndex]).some(Boolean)),
));
const sortingDependencyBoxIndices = Object.freeze([155, 156, 165, 171, 172, 179, 185, 196]);
const hiddenBoxIndices = Object.freeze([68, 69, 176, 190, 199]);
const hiddenFaceIndices = Object.freeze(hiddenBoxIndices.flatMap((boxIndex) =>
  Array.from({ length: facesPerBox }, (_, faceIndex) => boxIndex * facesPerBox + faceIndex)));
if (hiddenFaceIndices.some((faceIndex) => sourceRows.some((row) => row[faceIndex] !== 0))) {
  throw new Error("Cityflow static hidden face became visible in a supported projection sample");
}
const presentationRows = dilateBoxVisibility(sourceBoxRows, transitionDilationFrames);
for (const row of presentationRows) {
  for (const boxIndex of sortingDependencyBoxIndices) row[boxIndex] = 1;
}
const presentation = buildBoxPresentation(presentationRows);
const report = {
  schema: "csscityflow-prepared-static-visibility@3",
  sourceRevision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
  seed: 26081702,
  frameCount,
  boxCount,
  facesPerBox,
  faceCount,
  visibleFaceCount: faceCount - hiddenFaceIndices.length,
  hiddenFaceCount: hiddenFaceIndices.length,
  visibleBoxCount: boxCount - hiddenBoxIndices.length,
  hiddenBoxCount: hiddenBoxIndices.length,
  hiddenFaceIndices,
  hiddenBoxIndices,
  sortingDependencyBoxIndices,
  presentation,
  coverage: {
    browser: "Google Chrome 152.0.7977.65 headless DPR 1",
    captureMethod: "solid-face-id-exact-interior-pixel-census-plus-full-frame-raster-diff",
    projectionViewports: [
      { width: 2472, height: 1236, branch: "normal-maximum-aspect" },
      { width: 2473, height: 1236, branch: "wide-maximum-stage-height" },
      { width: 3086, height: 1440, branch: "ultrawide-supported-stage" },
    ],
    policy:
      "whole-box-visibility-union-plus-full-frame-css-3d-sorting-dependencies",
  },
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, presentation: report.presentation }, null, 2));

function unionRows(rowSets) {
  return Array.from({ length: frameCount }, (_, frameIndex) => Uint8Array.from(
    { length: faceCount },
    (_, faceIndex) => rowSets.some((rows) => rows[frameIndex][faceIndex] !== 0) ? 1 : 0,
  ));
}

function dilateBoxVisibility(rows, radius) {
  return rows.map((_, frameIndex) => Uint8Array.from(
    { length: boxCount },
    (_, boxIndex) => Number(Array.from({ length: radius * 2 + 1 }, (_, offset) =>
      rows[(frameIndex - radius + offset + frameCount) % frameCount][boxIndex]).some(Boolean)),
  ));
}

function buildBoxPresentation(rows) {
  const alwaysVisibleBoxIndices = Object.freeze(
    Array.from({ length: boxCount }, (_, boxIndex) => boxIndex)
      .filter((boxIndex) => rows.every((row) => row[boxIndex] !== 0)),
  );
  const initial = Buffer.alloc(Math.ceil(boxCount / 8));
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    if (rows[0][boxIndex] !== 0) initial[boxIndex >> 3] |= 1 << (boxIndex & 7);
  }
  const transitionOffsets = [0];
  const transitionBoxIndices = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const previousFrameIndex = (frameIndex - 1 + frameCount) % frameCount;
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      if (rows[frameIndex][boxIndex] !== rows[previousFrameIndex][boxIndex]) {
        transitionBoxIndices.push(boxIndex);
      }
    }
    transitionOffsets.push(transitionBoxIndices.length);
  }
  const offsetBytes = Buffer.alloc(transitionOffsets.length * Uint16Array.BYTES_PER_ELEMENT);
  const indexBytes = Buffer.alloc(transitionBoxIndices.length * Uint16Array.BYTES_PER_ELEMENT);
  transitionOffsets.forEach((value, index) => offsetBytes.writeUInt16LE(value, index * 2));
  transitionBoxIndices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
  const visibleBoxCounts = rows.map((row) => row.reduce((sum, value) => sum + value, 0));
  const visibleFaceCounts = visibleBoxCounts.map((count) => count * facesPerBox);
  return {
    schema: "csscityflow-prepared-presentation-box-visibility@1",
    encoding: "initial-box-bitset-plus-u16le-per-target-frame-toggle-offsets-and-box-indices",
    frameCount,
    boxCount,
    faceCount,
    transitionDilationFrames,
    alwaysVisibleBoxIndices,
    initialVisibleCount: visibleFaceCounts[0],
    initialVisibleBoxes: visibleBoxCounts[0],
    minimumVisibleFaces: Math.min(...visibleFaceCounts),
    maximumVisibleFaces: Math.max(...visibleFaceCounts),
    meanVisibleFaces: visibleFaceCounts.reduce((sum, value) => sum + value, 0) / frameCount,
    minimumVisibleBoxes: Math.min(...visibleBoxCounts),
    maximumVisibleBoxes: Math.max(...visibleBoxCounts),
    meanVisibleBoxes: visibleBoxCounts.reduce((sum, value) => sum + value, 0) / frameCount,
    transitionCount: transitionBoxIndices.length,
    maximumTransitionWritesPerFrame: Math.max(...transitionOffsets.slice(1)
      .map((offset, index) => offset - transitionOffsets[index])),
    initialVisibleBoxBitsBase64: initial.toString("base64"),
    transitionOffsetsBase64: offsetBytes.toString("base64"),
    transitionBoxIndicesBase64: indexBytes.toString("base64"),
    policy: `viewport-independent-whole-box-only-three-projection-union-with-${transitionDilationFrames}-frame-dilation-plus-full-frame-sorting-dependencies`,
  };
}

function decodeRows(report) {
  const initial = Buffer.from(report.initialVisibleBitsBase64, "base64");
  const offsets = decodeUint16(report.transitionOffsetsBase64);
  const indices = decodeUint16(report.transitionFaceIndicesBase64);
  const visible = Uint8Array.from({ length: report.faceCount }, (_, faceIndex) =>
    initial[faceIndex >> 3] >> (faceIndex & 7) & 1);
  const rows = [visible.slice()];
  for (let frameIndex = 1; frameIndex < report.frameCount; frameIndex += 1) {
    for (let cursor = offsets[frameIndex]; cursor < offsets[frameIndex + 1]; cursor += 1) {
      visible[indices[cursor]] ^= 1;
    }
    rows.push(visible.slice());
  }
  return rows;
}

function decodeUint16(base64) {
  const bytes = Buffer.from(base64, "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
    view.getUint16(index * 2, true));
}
