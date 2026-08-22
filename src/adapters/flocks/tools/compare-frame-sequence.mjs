#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { CSSFLOCKS_FRAME_SEQUENCE_COUNT, CSSFLOCKS_FRAME_SEQUENCE_PLAN } from "./frameSequencePlan.mjs";
import { compareFlocksFrameSequence } from "./frameSequenceArtifacts.mjs";
import { mapReallySlickHueToPreparedHex } from "../../shared/reallyslickPalette.mjs";
import { shadeFlocksPreparedHex } from "../src/shared/cssflocks/bugLighting.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const referenceRoot = resolve(repositoryRoot, "bench/results/cssflocks/reference-frames");
const browserRoot = resolve(repositoryRoot, "bench/results/cssflocks/browser-frames");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/frame-comparison");
const paletteVariantId = "rotate-120";

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const reference = JSON.parse(await readFile(resolve(referenceRoot, "states.json"), "utf8"));
const referenceReport = JSON.parse(await readFile(resolve(referenceRoot, "report.json"), "utf8"));
const browser = JSON.parse(await readFile(resolve(browserRoot, "states.json"), "utf8"));
if (reference.frames?.length !== CSSFLOCKS_FRAME_SEQUENCE_COUNT || browser.frames?.length !== CSSFLOCKS_FRAME_SEQUENCE_COUNT) {
  throw new Error("Flocks comparison requires both complete 45-frame sequences");
}

const diagnostic = await compareFlocksFrameSequence({
  expected: resolve(referenceRoot, "raw"),
  actual: resolve(browserRoot, "raw"),
  output: resolve(outputRoot, "native-browser-rgb-diagnostic"),
  label: "cssflocks_native_browser_rgb",
  expectedFrames: CSSFLOCKS_FRAME_SEQUENCE_COUNT,
  meanThreshold: 0,
  changedThreshold: 0,
  channelThreshold: 2,
});

let maximumMatrixElementDelta = 0;
let transformMismatchCount = 0;
let colorMismatchCount = 0;
const colorByRoot = new Array(reference.rootCount).fill(null);
const stateFrames = [];
for (let ordinal = 0; ordinal < reference.frames.length; ordinal += 1) {
  const expected = reference.frames[ordinal];
  const actual = browser.frames[ordinal];
  if (expected.ordinal !== ordinal || actual.ordinal !== ordinal || expected.segmentId !== actual.segmentId ||
      expected.streamFrameIndex !== actual.streamFrameIndex || actual.rootCount !== reference.rootCount ||
      actual.leafCount !== reference.leafCount) {
    throw new Error(`Flocks frame identity drifted at ordinal ${ordinal}`);
  }
  const firstInSegment = expected.segmentOrdinal === 0;
  const localFrameIndex = expected.streamFrameIndex % 60;
  let frameTransformMismatches = 0;
  let frameColorMismatches = 0;
  for (let rootIndex = 0; rootIndex < reference.rootCount; rootIndex += 1) {
    const expectedRoot = expected.decodedRoots[rootIndex];
    const actualRoot = actual.roots[rootIndex];
    const actualMatrix = parseMatrix(actualRoot.transform);
    const matrixDelta = Math.max(...actualMatrix.map((value, index) => Math.abs(value - expectedRoot.matrix[index])));
    maximumMatrixElementDelta = Math.max(maximumMatrixElementDelta, matrixDelta);
    if (matrixDelta > 0.001) { transformMismatchCount += 1; frameTransformMismatches += 1; }
    if (firstInSegment || (localFrameIndex + rootIndex) % 5 === 0) {
      colorByRoot[rootIndex] = shadeFlocksPreparedHex(
        mapReallySlickHueToPreparedHex(expectedRoot.hue, paletteVariantId),
        expectedRoot.matrix,
      );
    }
    if (normalizeColor(actualRoot.color) !== normalizeColor(colorByRoot[rootIndex])) {
      colorMismatchCount += 1;
      frameColorMismatches += 1;
    }
  }
  stateFrames.push(Object.freeze({
    ordinal,
    segmentId: expected.segmentId,
    streamFrameIndex: expected.streamFrameIndex,
    frameTransformMismatches,
    frameColorMismatches,
  }));
}

const browserImages = [];
const referenceImages = [];
for (let ordinal = 0; ordinal < CSSFLOCKS_FRAME_SEQUENCE_COUNT; ordinal += 1) {
  referenceImages.push(await imageInfo(resolve(referenceRoot, "raw", `frame_${String(ordinal).padStart(4, "0")}.ppm`)));
  browserImages.push(await imageInfo(resolve(browserRoot, "raw", `frame_${String(ordinal).padStart(4, "0")}.png`)));
}
const browserMotion = [];
const referenceMotion = [];
for (const segment of CSSFLOCKS_FRAME_SEQUENCE_PLAN) {
  const segmentFrames = reference.frames.filter((frame) => frame.segmentId === segment.id);
  for (let index = 1; index < segmentFrames.length; index += 1) {
    const previousOrdinal = segmentFrames[index - 1].ordinal;
    const ordinal = segmentFrames[index].ordinal;
    browserMotion.push({ segmentId: segment.id, from: previousOrdinal, to: ordinal, ...imageDelta(browserImages[previousOrdinal], browserImages[ordinal]) });
    referenceMotion.push({ segmentId: segment.id, from: previousOrdinal, to: ordinal, ...imageDelta(referenceImages[previousOrdinal], referenceImages[ordinal]) });
  }
}
const terminalFrames = reference.frames.filter((frame) => frame.segmentId === "terminal-seam");
const terminalBefore = terminalFrames[3];
const terminalAfter = terminalFrames[4];
const terminalProjection = projectedCenterSteps(terminalBefore.decodedRoots, terminalAfter.decodedRoots);
const cssomMatrixSerializationTolerance = 0.001;
const terminalProjectedStepBound = 6.66 + referenceReport.transportTolerances.projectedPixel * 2;

const contactSheet = resolve(outputRoot, "native-browser-contact-sheet.png");
await makeContactSheet(referenceRoot, browserRoot, contactSheet);
const visiblePixelFloor = Math.min(...browserImages.map((frame) => frame.visiblePixelCount));
const minimumBrowserMotion = Math.min(...browserMotion.map((frame) => frame.meanAbsDelta));
const gates = Object.freeze({
  completeFrameSets: diagnostic.expectedFrameCount === CSSFLOCKS_FRAME_SEQUENCE_COUNT &&
    diagnostic.actualFrameCount === CSSFLOCKS_FRAME_SEQUENCE_COUNT && diagnostic.missingActual.length === 0 && diagnostic.missingExpected.length === 0,
  preparedTransformPublicationWithinCssomSerialization: transformMismatchCount === 0 && maximumMatrixElementDelta <= cssomMatrixSerializationTolerance,
  exactStaggeredColorPublication: colorMismatchCount === 0,
  sourceTransportWithinTolerance: Object.entries(referenceReport.transportTolerances)
    .every(([key, limit]) => referenceReport.transportMaxima[key] <= limit),
  noFrozenBrowserFrame: minimumBrowserMotion > 0.001,
  noEmptyOrBackFaceOnlyFrame: visiblePixelFloor > 1_000,
  terminalProjectedStepWithinQualifiedAndTransportBound: terminalProjection.p95Pixels <= terminalProjectedStepBound,
  stableRetainedDom: browser.frames.every((frame) => frame.sameRootIdentity && frame.sameLeafIdentity &&
    frame.rootCount === 324 && frame.leafCount === 1_944 && frame.stats.retainedDomStable === true && frame.stats.runtimeDomGrowth === false),
  noBrowserErrors: browser.browserErrors.length === 0 && browser.frames.every((frame) => frame.bodyClass === "ready" && frame.debugErrors.length === 0),
});
const report = Object.freeze({
  schema: "cssflocks-frame-sequence-comparison@1",
  status: Object.values(gates).every(Boolean) ? "passed" : "failed",
  gates,
  plan: CSSFLOCKS_FRAME_SEQUENCE_PLAN,
  paletteVariantId,
  counts: Object.freeze({ frames: CSSFLOCKS_FRAME_SEQUENCE_COUNT, rootsPerFrame: reference.rootCount, leavesPerFrame: reference.leafCount }),
  state: Object.freeze({ cssomMatrixSerializationTolerance, maximumMatrixElementDelta, transformMismatchCount, colorMismatchCount, frames: stateFrames }),
  transport: Object.freeze({ tolerances: referenceReport.transportTolerances, maxima: referenceReport.transportMaxima }),
  continuity: Object.freeze({
    browserMotion,
    referenceMotion,
    minimumBrowserMotion,
    visiblePixelFloor,
    terminalProjection,
    terminalProjectedStepBound,
  }),
  rgbDiagnostic: Object.freeze({
    ...diagnostic,
    authority: "diagnostic-only",
    reason: referenceReport.lightingBoundary,
  }),
  visualReview: Object.freeze({
    contactSheet,
    requiredReview: "Inspect all five rows and the worst diagnostic frames; RGB pass is not a parity gate because lighting systems intentionally differ.",
  }),
});
await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "passed") throw new Error(`Flocks frame sequence failed: ${JSON.stringify(gates)}`);
console.log(JSON.stringify({
  report: resolve(outputRoot, "report.json"),
  status: report.status,
  gates,
  state: report.state,
  continuity: {
    minimumBrowserMotion,
    visiblePixelFloor,
    terminalProjection,
  },
  rgbWorst: diagnostic.worst.slice(0, 5),
  contactSheet,
}, null, 2));

function parseMatrix(text) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(text);
  const values = match?.[1].split(",").map(Number);
  if (!values || values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid browser Flocks matrix: ${text}`);
  }
  return values;
}

function normalizeColor(value) {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value);
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16)).join(",");
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(value);
  if (rgb) return `${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])}`;
  throw new Error(`Invalid browser Flocks color: ${value}`);
}

async function imageInfo(path) {
  const { data, info } = await readImage(path);
  let visiblePixelCount = 0;
  for (let index = 0; index < data.length; index += 3) {
    if (Math.max(data[index], data[index + 1], data[index + 2]) > 8) visiblePixelCount += 1;
  }
  return Object.freeze({ path, data, width: info.width, height: info.height, visiblePixelCount });
}

async function readImage(path) {
  if (path.endsWith(".ppm")) {
    const bytes = await readFile(path);
    const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(bytes.subarray(0, 64).toString("ascii"));
    if (!match) throw new Error(`Unsupported PPM header in ${path}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    const data = bytes.subarray(Buffer.byteLength(match[0], "ascii"));
    if (data.byteLength !== width * height * 3) throw new Error(`PPM byte length drifted in ${path}`);
    return { data, info: { width, height, channels: 3 } };
  }
  return sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function imagePipeline(path) {
  if (!path.endsWith(".ppm")) return sharp(path);
  const { data, info } = await readImage(path);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
}

function imageDelta(left, right) {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) {
    throw new Error("Flocks sequence image dimensions drifted");
  }
  let sum = 0;
  let changedPixels = 0;
  for (let index = 0; index < left.data.length; index += 3) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left.data[index + channel] - right.data[index + channel]);
      sum += delta;
      if (delta > 2) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  return Object.freeze({
    meanAbsDelta: Number((sum / left.data.length).toFixed(6)),
    changedPixelRatio: Number((changedPixels / (left.width * left.height)).toFixed(6)),
  });
}

function projectedCenterSteps(before, after) {
  const values = before.map((root, index) => {
    const left = projectCenter(root.position);
    const right = projectCenter(after[index].position);
    return left && right ? Math.hypot(right[0] - left[0], right[1] - left[1]) : 0;
  }).sort((left, right) => left - right);
  return Object.freeze({
    p50Pixels: percentile(values, 0.5),
    p95Pixels: percentile(values, 0.95),
    maximumPixels: values.at(-1) ?? 0,
  });
}

function projectCenter(position) {
  const depth = 568 - position[2];
  if (depth <= 0.1) return null;
  const scale = 800 / (2 * Math.tan(50 * Math.PI / 360)) / depth;
  return [640 + position[0] * scale, 400 - position[1] * scale];
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function makeContactSheet(nativeRoot, actualRoot, output) {
  const cellWidth = 256;
  const cellHeight = 320;
  const cells = [];
  for (let ordinal = 0; ordinal < CSSFLOCKS_FRAME_SEQUENCE_COUNT; ordinal += 1) {
    const left = ordinal % 9 * cellWidth;
    const top = Math.floor(ordinal / 9) * cellHeight;
    const native = await (await imagePipeline(resolve(nativeRoot, "raw", `frame_${String(ordinal).padStart(4, "0")}.ppm`)))
      .resize(cellWidth, cellHeight / 2, { fit: "fill" }).png().toBuffer();
    const browser = await sharp(resolve(actualRoot, "raw", `frame_${String(ordinal).padStart(4, "0")}.png`))
      .resize(cellWidth, cellHeight / 2, { fit: "fill" }).png().toBuffer();
    cells.push({ input: native, left, top }, { input: browser, left, top: top + cellHeight / 2 });
  }
  await sharp({ create: { width: cellWidth * 9, height: cellHeight * 5, channels: 3, background: "#000" } })
    .composite(cells).png().toFile(output);
}
