// SPDX-License-Identifier: GPL-2.0-or-later
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "sharp";

export async function packageFlocksFrameSequence({ frames, output, label, expectedFrames }) {
  const sourceFrames = await numberedFrames(frames, expectedFrames);
  const framesOutput = resolve(output, "frames");
  const keyframesOutput = resolve(output, "keyframes");
  await rm(output, { recursive: true, force: true });
  await mkdir(framesOutput, { recursive: true });
  await mkdir(keyframesOutput, { recursive: true });
  for (const frame of sourceFrames) await copyFile(frame.path, resolve(framesOutput, frame.name));
  const keyframeIndices = [...new Set([
    0,
    Math.floor((expectedFrames - 1) * 0.05),
    Math.floor((expectedFrames - 1) * 0.125),
    Math.floor((expectedFrames - 1) * 0.9),
    expectedFrames - 1,
  ])].sort((left, right) => left - right);
  const exported = [];
  for (const index of keyframeIndices) {
    const image = await readRgb(sourceFrames[index].path);
    const path = resolve(keyframesOutput, `frame_${String(index).padStart(4, "0")}.png`);
    await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).png().toFile(path);
    exported.push(path);
  }
  const report = Object.freeze({
    schema: "cssflocks-frame-sequence-package@1",
    label,
    sourceDir: frames,
    outputDir: output,
    framesDir: framesOutput,
    frameCount: sourceFrames.length,
    keyframes: Object.freeze({ keyframesDir: keyframesOutput, exported: Object.freeze(exported) }),
  });
  await writeFile(resolve(output, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function compareFlocksFrameSequence({
  expected,
  actual,
  output,
  label,
  expectedFrames,
  meanThreshold = 0,
  changedThreshold = 0,
  channelThreshold = 2,
  diffCount = 10,
}) {
  const expectedSequence = await numberedFrames(expected);
  const actualSequence = await numberedFrames(actual);
  const expectedByIndex = new Map(expectedSequence.map((frame) => [frame.index, frame]));
  const actualByIndex = new Map(actualSequence.map((frame) => [frame.index, frame]));
  const missingActual = [...expectedByIndex.keys()].filter((index) => !actualByIndex.has(index));
  const missingExpected = [...actualByIndex.keys()].filter((index) => !expectedByIndex.has(index));
  const sharedIndices = [...expectedByIndex.keys()].filter((index) => actualByIndex.has(index)).sort((left, right) => left - right);
  if (expectedFrames != null && (expectedSequence.length !== expectedFrames || actualSequence.length !== expectedFrames)) {
    throw new Error(`Flocks comparison expected ${expectedFrames} frames, received ${expectedSequence.length}/${actualSequence.length}`);
  }
  const frames = [];
  for (const index of sharedIndices) {
    const left = await readRgb(expectedByIndex.get(index).path);
    const right = await readRgb(actualByIndex.get(index).path);
    const metrics = imageMetrics(left, right, channelThreshold);
    frames.push(Object.freeze({
      frame: index,
      expected: expectedByIndex.get(index).name,
      actual: actualByIndex.get(index).name,
      ...metrics,
      pass: metrics.compatible && metrics.meanAbsDelta <= meanThreshold && metrics.changedPixelRatio <= changedThreshold,
    }));
  }
  const worst = [...frames].sort((left, right) =>
    right.meanAbsDelta - left.meanAbsDelta || right.changedPixelRatio - left.changedPixelRatio || left.frame - right.frame);
  await rm(output, { recursive: true, force: true });
  const diffsRoot = resolve(output, "diffs");
  await mkdir(diffsRoot, { recursive: true });
  const diffs = [];
  for (const frame of worst.slice(0, diffCount)) {
    const left = await readRgb(expectedByIndex.get(frame.frame).path);
    const right = await readRgb(actualByIndex.get(frame.frame).path);
    if (left.width !== right.width || left.height !== right.height) continue;
    const data = Buffer.alloc(left.data.length);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.min(255, Math.abs(left.data[index] - right.data[index]) * 4);
    const path = resolve(diffsRoot, `frame_${String(frame.frame).padStart(4, "0")}_diff.png`);
    await sharp(data, { raw: { width: left.width, height: left.height, channels: 3 } }).png().toFile(path);
    diffs.push(Object.freeze({ frame: frame.frame, png: path }));
  }
  const report = Object.freeze({
    schema: "cssflocks-frame-sequence-compare@1",
    label,
    expectedDir: expected,
    actualDir: actual,
    outputDir: output,
    expectedFrameCount: expectedSequence.length,
    actualFrameCount: actualSequence.length,
    comparedFrameCount: frames.length,
    missingActual: Object.freeze(missingActual),
    missingExpected: Object.freeze(missingExpected),
    thresholds: Object.freeze({ meanAbsDelta: meanThreshold, changedPixelRatio: changedThreshold, channelDelta: channelThreshold }),
    pass: missingActual.length === 0 && missingExpected.length === 0 && frames.every((frame) => frame.pass),
    worst: Object.freeze(worst),
    diffs: Object.freeze(diffs),
    frames: Object.freeze(frames),
  });
  await writeFile(resolve(output, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(output, `${label}.csv`), `${[
    "frame,mean_abs_delta,rms_delta,max_abs_delta,changed_pixel_ratio,pass",
    ...frames.map((frame) => [frame.frame, frame.meanAbsDelta, frame.rmsDelta, frame.maxAbsDelta, frame.changedPixelRatio, frame.pass].join(",")),
  ].join("\n")}\n`);
  return report;
}

async function numberedFrames(root, expectedCount = null) {
  const frames = (await readdir(root, { withFileTypes: true })).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const match = /^frame_(\d+)\.(?:png|ppm)$/u.exec(entry.name);
    return match ? [{ index: Number(match[1]), name: entry.name, path: resolve(root, entry.name) }] : [];
  }).sort((left, right) => left.index - right.index);
  if (expectedCount != null && frames.length !== expectedCount) {
    throw new Error(`Flocks frame package expected ${expectedCount} files in ${root}, received ${frames.length}`);
  }
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].index !== index) throw new Error(`Flocks frame sequence is not contiguous at ${basename(frames[index].path)}`);
  }
  return frames;
}

async function readRgb(path) {
  if (path.endsWith(".ppm")) {
    const bytes = await readFile(path);
    const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(bytes.subarray(0, 64).toString("ascii"));
    if (!match) throw new Error(`Unsupported PPM header in ${path}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    const data = bytes.subarray(Buffer.byteLength(match[0], "ascii"));
    if (data.byteLength !== width * height * 3) throw new Error(`PPM byte length drifted in ${path}`);
    return Object.freeze({ data, width, height });
  }
  const image = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return Object.freeze({ data: image.data, width: image.info.width, height: image.info.height });
}

function imageMetrics(left, right, channelThreshold) {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) {
    return Object.freeze({ compatible: false, meanAbsDelta: Infinity, rmsDelta: Infinity, maxAbsDelta: Infinity, changedPixelRatio: 1 });
  }
  let absoluteTotal = 0;
  let squaredTotal = 0;
  let maximum = 0;
  let changedPixels = 0;
  for (let index = 0; index < left.data.length; index += 3) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left.data[index + channel] - right.data[index + channel]);
      absoluteTotal += delta;
      squaredTotal += delta * delta;
      maximum = Math.max(maximum, delta);
      if (delta > channelThreshold) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  return Object.freeze({
    compatible: true,
    meanAbsDelta: Number((absoluteTotal / left.data.length).toFixed(6)),
    rmsDelta: Number(Math.sqrt(squaredTotal / left.data.length).toFixed(6)),
    maxAbsDelta: maximum,
    changedPixelRatio: Number((changedPixels / (left.width * left.height)).toFixed(6)),
  });
}
