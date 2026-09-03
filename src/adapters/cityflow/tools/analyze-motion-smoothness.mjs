#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expandCityflowPreparedTransforms } from
  "../src/csscityflow/preparedTransformTable.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const playbackPath = resolveArgument(
  "--playback",
  "build/generated/public/csscityflow/cityflow.playback.json",
);
const framesRoot = optionalResolvedArgument("--frames");
const outputPath = optionalResolvedArgument("--output");
const label = argumentValue("--label") ?? "cityflow";
const playbackBytes = await readFile(playbackPath);
const playback = JSON.parse(playbackBytes);
const geometry = analyzePreparedGeometry(playback);
const frameDomain = framesRoot ? await analyzeRawFrameSequence(framesRoot) : null;
const report = {
  schema: "csscityflow-motion-smoothness-audit@4",
  generatedAt: new Date().toISOString(),
  label,
  inputs: {
    playbackPath,
    playbackSha256: createHash("sha256").update(playbackBytes).digest("hex"),
    framesRoot,
    frameSequence: framesRoot ? "frame_%04d.png at 60 fps" : null,
  },
  geometry,
  frameDomain,
  interpretation: {
    scope: "Prepared box-height trajectories and captured raw browser pixels.",
    lowerIsSmoother: [
      "geometry.normalizedAccelerationRms",
      "geometry.normalizedJerkRms",
      "geometry.stationaryTransitionRatio",
      "geometry.directionRuns.upToThreeFrameRatio",
      "geometry.directionRuns.upToThreeFrameDistanceRatio",
      "geometry.directionRuns.upToSixFrameRatio",
      "geometry.directionRuns.upToSixFrameDistanceRatio",
      "geometry.directionRuns.upToTwelveFrameRatio",
      "geometry.directionRuns.upToTwelveFrameDistanceRatio",
      "frameDomain.normalizedMotionEnergyFirstDifferenceRms",
      "frameDomain.normalizedMotionEnergySecondDifferenceRms",
    ],
    qualification: "These metrics detect holds and uneven motion. They do not prove perceptual smoothness by themselves.",
    relativeMovementQualification:
      "Below-mean movement ratios describe the velocity distribution; minimizing them alone would erase physically expected easing at extrema.",
  },
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
process.stdout.write(serialized);

function analyzePreparedGeometry(bank) {
  const transformIndices = preparedPresentationTransformIndices(bank);
  const transforms = expandCityflowPreparedTransforms(
    bank.transformTable,
    bank.transformIndices.transformOffsets,
  );
  const heights = Array.from({ length: bank.frameCount }, () => new Float64Array(bank.boxCount));
  for (let frameIndex = 0; frameIndex < bank.frameCount; frameIndex += 1) {
    for (let boxIndex = 0; boxIndex < bank.boxCount; boxIndex += 1) {
      const transformIndex = transformIndices[frameIndex * bank.boxCount + boxIndex];
      const transform = transforms[bank.transformIndices.transformOffsets[boxIndex] + transformIndex];
      heights[frameIndex][boxIndex] = preparedHeightScale(transform);
    }
  }
  const velocities = circularDifference(heights);
  const accelerations = circularDifference(velocities);
  const jerks = circularDifference(accelerations);
  const velocityRms = matrixRms(velocities);
  const accelerationRms = matrixRms(accelerations);
  const jerkRms = matrixRms(jerks);
  const stationaryTransitionCount = velocities.reduce(
    (count, row) => count + row.reduce(
      (rowCount, value) => rowCount + Number(Math.abs(value) <= 1e-9),
      0,
    ),
    0,
  );
  const motionEnergy = velocities.map((row) =>
    row.reduce((sum, value) => sum + Math.abs(value), 0) / bank.boxCount);
  const motionEnergyStats = statistics(motionEnergy);
  const directionRuns = analyzeDirectionRuns(velocities);
  const relativeMovement = analyzeRelativeMovement(velocities);
  return {
    metric: "circular-finite-differences-of-prepared-matrix-z-scale",
    frameCount: bank.frameCount,
    boxCount: bank.boxCount,
    transitionCount: bank.frameCount * bank.boxCount,
    velocityRms,
    accelerationRms,
    jerkRms,
    normalizedAccelerationRms: divideOrNull(accelerationRms, velocityRms),
    normalizedJerkRms: divideOrNull(jerkRms, velocityRms),
    stationaryTransitionCount,
    stationaryTransitionRatio: stationaryTransitionCount / (bank.frameCount * bank.boxCount),
    directionRuns,
    relativeMovement,
    motionEnergy: motionEnergyStats,
  };
}

function analyzeRelativeMovement(velocities) {
  let belowTenthMeanCount = 0;
  let belowQuarterMeanCount = 0;
  for (let boxIndex = 0; boxIndex < velocities[0].length; boxIndex += 1) {
    const movements = velocities.map((row) => Math.abs(row[boxIndex]));
    const mean = movements.reduce((sum, value) => sum + value, 0) / movements.length;
    belowTenthMeanCount += movements.filter((value) => value < mean * 0.1).length;
    belowQuarterMeanCount += movements.filter((value) => value < mean * 0.25).length;
  }
  const transitionCount = velocities.length * velocities[0].length;
  return {
    metric: "absolute-transition-distance-relative-to-each-box-cycle-mean",
    belowTenthMeanCount,
    belowTenthMeanRatio: belowTenthMeanCount / transitionCount,
    belowQuarterMeanCount,
    belowQuarterMeanRatio: belowQuarterMeanCount / transitionCount,
  };
}

function analyzeDirectionRuns(velocities) {
  const runLengths = [];
  const runDistances = [];
  for (let boxIndex = 0; boxIndex < velocities[0].length; boxIndex += 1) {
    const moving = velocities.map((row) => row[boxIndex])
      .filter((value) => Math.abs(value) > 1e-7);
    if (moving.length === 0) continue;
    const lengths = [];
    const distances = [];
    let direction = Math.sign(moving[0]);
    let length = 0;
    let distance = 0;
    for (const velocity of moving) {
      const nextDirection = Math.sign(velocity);
      if (nextDirection !== direction) {
        lengths.push(length);
        distances.push(distance);
        direction = nextDirection;
        length = 0;
        distance = 0;
      }
      length += 1;
      distance += Math.abs(velocity);
    }
    if (lengths.length > 0 && direction === Math.sign(moving[0])) {
      lengths[0] += length;
      distances[0] += distance;
    } else {
      lengths.push(length);
      distances.push(distance);
    }
    runLengths.push(...lengths);
    runDistances.push(...distances);
  }
  const totalDistance = runDistances.reduce((sum, value) => sum + value, 0);
  const shortRunCount = runLengths.filter((length) => length <= 3).length;
  const shortRunDistance = runDistances.reduce(
    (sum, distance, index) => sum + (runLengths[index] <= 3 ? distance : 0),
    0,
  );
  const upToSixFrameCount = runLengths.filter((length) => length <= 6).length;
  const upToSixFrameDistance = runDistances.reduce(
    (sum, distance, index) => sum + (runLengths[index] <= 6 ? distance : 0),
    0,
  );
  const upToTwelveFrameCount = runLengths.filter((length) => length <= 12).length;
  const upToTwelveFrameDistance = runDistances.reduce(
    (sum, distance, index) => sum + (runLengths[index] <= 12 ? distance : 0),
    0,
  );
  const sortedLengths = [...runLengths].sort((left, right) => left - right);
  return {
    metric: "circular-nonstationary-same-direction-runs",
    stationaryEpsilon: 1e-7,
    count: runLengths.length,
    oneFrameCount: runLengths.filter((length) => length === 1).length,
    upToTwoFrameCount: runLengths.filter((length) => length <= 2).length,
    upToThreeFrameCount: shortRunCount,
    upToThreeFrameRatio: shortRunCount / runLengths.length,
    upToThreeFrameDistanceRatio: divideOrNull(shortRunDistance, totalDistance),
    upToSixFrameCount,
    upToSixFrameRatio: upToSixFrameCount / runLengths.length,
    upToSixFrameDistanceRatio: divideOrNull(upToSixFrameDistance, totalDistance),
    upToTwelveFrameCount,
    upToTwelveFrameRatio: upToTwelveFrameCount / runLengths.length,
    upToTwelveFrameDistanceRatio: divideOrNull(upToTwelveFrameDistance, totalDistance),
    medianFrames: percentile(sortedLengths, 0.5),
    p95Frames: percentile(sortedLengths, 0.95),
  };
}

async function analyzeRawFrameSequence(root) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "csscityflow-vmafmotion-"));
  const statsPath = join(temporaryRoot, "motion.log");
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-framerate", "60",
      "-i", join(root, "frame_%04d.png"),
      "-vf", `vmafmotion=stats_file=${statsPath}`,
      "-f", "null",
      "-",
    ], { maxBuffer: 16 * 1024 * 1024 });
    const rows = (await readFile(statsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^n:(\d+)\s+motion:([\d.]+)$/);
        if (!match) throw new Error(`Unexpected vmafmotion row: ${line}`);
        return { frame: Number.parseInt(match[1], 10), motion: Number.parseFloat(match[2]) };
      });
    if (rows.length < 2) throw new Error("Frame sequence produced fewer than two VMAF Motion rows");
    // Frame zero has no predecessor. Exclude its synthetic zero and retain every
    // measured transition, including the duplicated loop-closing capture.
    const motionEnergy = rows.slice(1).map(({ motion }) => motion);
    const firstDifferences = linearDifference(motionEnergy);
    const secondDifferences = linearDifference(firstDifferences);
    const motionEnergyStats = statistics(motionEnergy);
    return {
      metric: "ffmpeg-vmafmotion-on-raw-numbered-png-sequence",
      sourceFrameCount: rows.length,
      measuredTransitionCount: motionEnergy.length,
      motionEnergy: motionEnergyStats,
      motionEnergyFirstDifferenceRms: vectorRms(firstDifferences),
      motionEnergySecondDifferenceRms: vectorRms(secondDifferences),
      normalizedMotionEnergyFirstDifferenceRms: divideOrNull(
        vectorRms(firstDifferences),
        motionEnergyStats.mean,
      ),
      normalizedMotionEnergySecondDifferenceRms: divideOrNull(
        vectorRms(secondDifferences),
        motionEnergyStats.mean,
      ),
      note: "VMAF Motion is a frame-domain motion-energy signal, not optical-flow tracking.",
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function preparedPresentationTransformIndices(bank) {
  const stateCount = bank.frameCount * bank.boxCount;
  if (!Number.isInteger(bank.frameCount) || !Number.isInteger(bank.boxCount) ||
      bank.transformTable?.schema !== "csscityflow-prepared-transform-table@1" ||
      !Array.isArray(bank.transformIndices?.transformOffsets) ||
      bank.transformIndices.transformOffsets.length !== bank.boxCount + 1 ||
      typeof bank.transformIndices.presentationBase64 !== "string") {
    throw new Error("Cityflow playback does not contain a complete prepared transform bank");
  }
  const bytes = Buffer.from(bank.transformIndices.presentationBase64, "base64");
  if (bytes.byteLength !== stateCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Cityflow prepared presentation transform indices are incomplete");
  }
  const indices = new Uint16Array(stateCount);
  for (let index = 0; index < stateCount; index += 1) {
    const transformIndex = bytes.readUInt16LE(index * Uint16Array.BYTES_PER_ELEMENT);
    const start = bank.transformIndices.transformOffsets[index % bank.boxCount];
    const end = bank.transformIndices.transformOffsets[index % bank.boxCount + 1];
    if (start + transformIndex >= end || end > bank.transformTable.count) {
      throw new Error(`Cityflow prepared transform index ${index} is out of range`);
    }
    indices[index] = transformIndex;
  }
  return indices;
}

function preparedHeightScale(transform) {
  const match = transform.match(/^matrix3d\(([^)]+)\)$/u);
  if (!match) throw new Error(`Prepared Cityflow transform is not matrix3d: ${transform}`);
  const values = match[1].split(",").map(Number);
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Prepared Cityflow matrix3d is malformed: ${match[1]}`);
  }
  return values[10];
}

function circularDifference(rows) {
  return rows.map((row, frameIndex) => {
    const previous = rows[(frameIndex - 1 + rows.length) % rows.length];
    return Float64Array.from(row, (value, boxIndex) => value - previous[boxIndex]);
  });
}

function linearDifference(values) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function matrixRms(rows) {
  let squaredSum = 0;
  let count = 0;
  for (const row of rows) {
    for (const value of row) {
      squaredSum += value * value;
      count += 1;
    }
  }
  return Math.sqrt(squaredSum / count);
}

function vectorRms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
  return {
    minimum: sorted[0],
    p05: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1),
    mean,
    standardDeviation,
    coefficientOfVariation: divideOrNull(standardDeviation, mean),
  };
}

function percentile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const blend = index - lower;
  return sorted[lower] * (1 - blend) + sorted[upper] * blend;
}

function divideOrNull(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function resolveArgument(name, fallback) {
  return resolve(repositoryRoot, argumentValue(name) ?? fallback);
}

function optionalResolvedArgument(name) {
  const value = argumentValue(name);
  return value ? resolve(repositoryRoot, value) : null;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}
