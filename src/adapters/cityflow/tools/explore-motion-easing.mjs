#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const playbackPath = resolve(
  repositoryRoot,
  "build/generated/public/csscityflow/cityflow.playback.json",
);
const playback = JSON.parse(await readFile(playbackPath, "utf8"));
const sourceRows = heightRows(playback);
const exponents = [0, 0.35, 0.5, 0.65, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.15, 1.35];
const variants = Object.fromEntries(exponents.map((exponent) => [
  `sine-power-${exponent}`,
  analyze(refitDirectionRuns(sourceRows, () => sinePowerEase(exponent))),
]));
variants.currentPreparedPlayback = analyze(sourceRows);
variants.smoothstep = analyze(refitDirectionRuns(sourceRows, () => smoothstep));
variants.smootherstep = analyze(refitDirectionRuns(sourceRows, () => smootherstep));
for (const centerReduction of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  variants[`smooth-sine-center-reduction-${centerReduction}`] = analyze(refitDirectionRuns(
    sourceRows,
    () => smoothSineEase(centerReduction),
  ));
}
for (const threshold of [18, 24, 30, 36, 42, 48, 60]) {
  for (const centerReduction of [0.2, 0.3, 0.4, 0.5]) {
    variants[`adaptive-duration-${threshold}-reduction-${centerReduction}`] = analyze(
      refitDirectionRuns(sourceRows, ({ duration }) =>
        duration >= threshold ? smoothSineEase(centerReduction) : cosineEase),
    );
  }
}
for (const startDuration of [18, 24, 30]) {
  for (const fullDuration of [42, 48, 54, 60]) {
    for (const maximumReduction of [0.4, 0.5, 0.6]) {
      variants[
        `adaptive-ramp-${startDuration}-${fullDuration}-reduction-${maximumReduction}`
      ] = analyze(refitDirectionRuns(sourceRows, ({ duration }) => {
        const mix = Math.max(0, Math.min(1,
          (duration - startDuration) / (fullDuration - startDuration)));
        return smoothSineEase(maximumReduction * mix);
      }));
    }
  }
}

process.stdout.write(`${JSON.stringify({
  schema: "csscityflow-motion-easing-experiment@1",
  inputSchema: playback.schema,
  note: "Variants preserve the current prepared extrema frames and heights. Sine power 1 and smooth-sine center reduction 0 model the prior cosine curve. Adaptive variants keep cosine on short runs.",
  variants,
}, null, 2)}\n`);

function heightRows(bank) {
  return Array.from({ length: bank.frameCount }, (_, frameIndex) =>
    Float64Array.from({ length: bank.boxCount }, (_, boxIndex) => {
      const style = bank.presentationShapeStyles[frameIndex * bank.boxCount + boxIndex];
      const matrix = style.slice("transform:matrix3d(".length, style.indexOf(");")).split(",");
      return Number(matrix[10]);
    }));
}

function refitDirectionRuns(rows, easingForRun) {
  const frameCount = rows.length;
  const boxCount = rows[0].length;
  const output = Array.from({ length: frameCount }, () => new Float64Array(boxCount));
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const velocities = Array.from({ length: frameCount }, (_, frameIndex) =>
      rows[frameIndex][boxIndex] - rows[(frameIndex - 1 + frameCount) % frameCount][boxIndex]);
    const movingFrameIndices = velocities
      .map((velocity, frameIndex) => Math.abs(velocity) > 1e-7 ? frameIndex : -1)
      .filter((frameIndex) => frameIndex >= 0);
    const runs = circularDirectionRuns(movingFrameIndices.map((frameIndex) =>
      Math.sign(velocities[frameIndex])));
    const extrema = runs.map((run, runIndex) => {
      const lastMovingFrameIndex = movingFrameIndices[
        (run.start + run.length - 1) % movingFrameIndices.length
      ];
      const nextMovingFrameIndex = movingFrameIndices[runs[(runIndex + 1) % runs.length].start];
      const stationarySpan = (nextMovingFrameIndex - lastMovingFrameIndex + frameCount) % frameCount;
      return {
        frameIndex: (lastMovingFrameIndex + Math.floor(stationarySpan / 2)) % frameCount,
        height: rows[lastMovingFrameIndex][boxIndex],
      };
    }).sort((left, right) => left.frameIndex - right.frameIndex);
    for (let extremaIndex = 0; extremaIndex < extrema.length; extremaIndex += 1) {
      const start = extrema[extremaIndex];
      const end = extrema[(extremaIndex + 1) % extrema.length];
      const duration = (end.frameIndex - start.frameIndex + frameCount) % frameCount;
      const easing = easingForRun({
        amplitude: Math.abs(end.height - start.height),
        boxIndex,
        duration,
        end,
        start,
      });
      for (let offset = 0; offset < duration; offset += 1) {
        const fraction = easing(offset / duration);
        output[(start.frameIndex + offset) % frameCount][boxIndex] =
          start.height + (end.height - start.height) * fraction;
      }
    }
  }
  return output;
}

function sinePowerEase(exponent) {
  const cdf = normalizedCdf((fraction) => Math.sin(Math.PI * fraction) ** exponent);
  return (fraction) => sampleCdf(cdf, fraction);
}

function smoothSineEase(centerReduction) {
  const cdf = normalizedCdf((fraction) => {
    const sine = Math.sin(Math.PI * fraction);
    return sine * (1 - centerReduction * sine * sine);
  });
  return (fraction) => sampleCdf(cdf, fraction);
}

function normalizedCdf(weightAt) {
  const resolution = 65_536;
  const values = new Float64Array(resolution + 1);
  let integral = 0;
  let previous = 0;
  for (let index = 1; index <= resolution; index += 1) {
    const x = index / resolution;
    const current = weightAt(x);
    integral += (previous + current) / (2 * resolution);
    values[index] = integral;
    previous = current;
  }
  for (let index = 1; index <= resolution; index += 1) values[index] /= integral;
  return values;
}

function cosineEase(fraction) {
  return (1 - Math.cos(Math.PI * fraction)) / 2;
}

function smoothstep(fraction) {
  return fraction * fraction * (3 - 2 * fraction);
}

function smootherstep(fraction) {
  return fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
}

function sampleCdf(cdf, fraction) {
  const position = fraction * (cdf.length - 1);
  const index = Math.floor(position);
  const remainder = position - index;
  return cdf[index] + (cdf[Math.min(index + 1, cdf.length - 1)] - cdf[index]) * remainder;
}

function circularDirectionRuns(directions) {
  const runs = [];
  let direction = directions[0];
  let start = 0;
  for (let index = 1; index < directions.length; index += 1) {
    if (directions[index] === direction) continue;
    runs.push({ direction, start, length: index - start });
    direction = directions[index];
    start = index;
  }
  runs.push({ direction, start, length: directions.length - start });
  if (runs.length > 1 && runs[0].direction === runs.at(-1).direction) {
    runs[0] = {
      direction: runs[0].direction,
      start: runs.at(-1).start,
      length: runs[0].length + runs.at(-1).length,
    };
    runs.pop();
  }
  return runs;
}

function analyze(rows) {
  const velocities = circularDifference(rows);
  const accelerations = circularDifference(velocities);
  const jerks = circularDifference(accelerations);
  const velocityRms = rms(velocities);
  const absoluteVelocities = Array.from({ length: rows[0].length }, () => []);
  for (const row of velocities) {
    row.forEach((value, boxIndex) => absoluteVelocities[boxIndex].push(Math.abs(value)));
  }
  let belowTenth = 0;
  let belowQuarter = 0;
  let stationary = 0;
  for (const values of absoluteVelocities) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    belowTenth += values.filter((value) => value < mean * 0.1).length;
    belowQuarter += values.filter((value) => value < mean * 0.25).length;
    stationary += values.filter((value) => value <= 1e-9).length;
  }
  const motionEnergy = velocities.map((row) =>
    row.reduce((sum, value) => sum + Math.abs(value), 0) / row.length);
  const motionMean = motionEnergy.reduce((sum, value) => sum + value, 0) / motionEnergy.length;
  const motionDeviation = Math.sqrt(motionEnergy.reduce(
    (sum, value) => sum + (value - motionMean) ** 2,
    0,
  ) / motionEnergy.length);
  const transitionCount = rows.length * rows[0].length;
  return {
    normalizedAccelerationRms: rms(accelerations) / velocityRms,
    normalizedJerkRms: rms(jerks) / velocityRms,
    stationaryTransitionRatio: stationary / transitionCount,
    belowTenthMeanMovementRatio: belowTenth / transitionCount,
    belowQuarterMeanMovementRatio: belowQuarter / transitionCount,
    motionEnergyCoefficientOfVariation: motionDeviation / motionMean,
    motionEnergyMinimum: Math.min(...motionEnergy),
    motionEnergyMaximum: Math.max(...motionEnergy),
  };
}

function circularDifference(rows) {
  return rows.map((row, frameIndex) => {
    const previous = rows[(frameIndex - 1 + rows.length) % rows.length];
    return Float64Array.from(row, (value, boxIndex) => value - previous[boxIndex]);
  });
}

function rms(rows) {
  let sum = 0;
  let count = 0;
  for (const row of rows) for (const value of row) {
    sum += value * value;
    count += 1;
  }
  return Math.sqrt(sum / count);
}
