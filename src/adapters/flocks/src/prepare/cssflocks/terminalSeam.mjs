// SPDX-License-Identifier: GPL-2.0-or-later
import { CSSFLOCKS_SOURCE } from "./sourceModel.mjs";

export function buildFlocksTerminalBridge({
  finalFrame,
  initialFrame,
  correspondence,
  frameCount,
  framesPerSecond,
}) {
  if (!Array.isArray(finalFrame?.bugs) || !Array.isArray(initialFrame?.bugs) ||
      finalFrame.bugs.length !== initialFrame.bugs.length ||
      !Array.isArray(correspondence) || correspondence.length !== finalFrame.bugs.length ||
      new Set(correspondence).size !== correspondence.length ||
      correspondence.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= correspondence.length) ||
      !Number.isSafeInteger(frameCount) || frameCount < 1 ||
      !Number.isSafeInteger(framesPerSecond) || framesPerSecond < 1) {
    throw new TypeError("Complete Flocks terminal bridge inputs are required");
  }
  const durationSeconds = (frameCount + 1) / framesPerSecond;
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
    const time = (frameIndex + 1) / (frameCount + 1);
    return Object.freeze({
      index: frameIndex,
      timeMs: (frameIndex + 1) / framesPerSecond * 1_000,
      bugs: Object.freeze(finalFrame.bugs.map((bug, bugIndex) => {
        const target = initialFrame.bugs[correspondence[bugIndex]];
        const position = [0, 1, 2].map((axis) => hermitePosition(
          bug.position[axis], bug.velocity[axis], target.position[axis], target.velocity[axis], time, durationSeconds,
        ));
        const velocity = [0, 1, 2].map((axis) => hermiteVelocity(
          bug.position[axis], bug.velocity[axis], target.position[axis], target.velocity[axis], time, durationSeconds,
        ));
        const hueDelta = signedCircularHueDelta(target.hue, bug.hue);
        return Object.freeze({
          index: bug.index,
          type: bug.type,
          position: Object.freeze(position.map(rounded)),
          velocity: Object.freeze(velocity.map(rounded)),
          hue: rounded(wrapHue(bug.hue + hueDelta * smoothstep(time))),
        });
      })),
    });
  });
  return Object.freeze({
    schema: "cssflocks-prepare-only-terminal-bridge@1",
    strategy: "cubic-hermite-correspondence",
    sourceBehaviorDeviation: true,
    frameCount,
    durationMilliseconds: frameCount / framesPerSecond * 1_000,
    interpolationDurationMilliseconds: durationSeconds * 1_000,
    correspondence: Object.freeze([...correspondence]),
    frames: Object.freeze(frames),
  });
}

export function buildFlocksTerminalCorrespondence(finalBugs, initialBugs, viewport, leaderCount) {
  if (finalBugs.length !== initialBugs.length) throw new Error("Terminal correspondence cardinality drifted");
  const permutation = new Array(finalBugs.length);
  assignRange(0, leaderCount);
  assignRange(leaderCount, finalBugs.length);
  const distances = [];
  const hueDistances = [];
  let visibilityMismatchCount = 0;
  let visiblePairCount = 0;
  for (let finalIndex = 0; finalIndex < finalBugs.length; finalIndex += 1) {
    const initialIndex = permutation[finalIndex];
    const left = flocksVisualFeature(finalBugs[finalIndex], viewport);
    const right = flocksVisualFeature(initialBugs[initialIndex], viewport);
    if (left.visible !== right.visible) visibilityMismatchCount += 1;
    if (left.visible && right.visible) {
      visiblePairCount += 1;
      distances.push(Math.hypot(left.x - right.x, left.y - right.y));
    }
    hueDistances.push(flocksCircularHueDistance(finalBugs[finalIndex].hue, initialBugs[initialIndex].hue));
  }
  distances.sort((left, right) => left - right);
  hueDistances.sort((left, right) => left - right);
  return Object.freeze({
    permutation: Object.freeze(permutation),
    metrics: Object.freeze({
      bugCount: finalBugs.length,
      visiblePairCount,
      visibilityMismatchCount,
      projectedCenterDistanceMean: mean(distances),
      projectedCenterDistanceP95: percentile(distances, 0.95),
      projectedCenterDistanceMax: distances.at(-1) ?? 0,
      circularHueDistanceP95: percentile(hueDistances, 0.95),
      circularHueDistanceMax: hueDistances.at(-1) ?? 0,
    }),
  });

  function assignRange(start, end) {
    const left = finalBugs.slice(start, end).map((bug) => flocksVisualFeature(bug, viewport));
    const right = initialBugs.slice(start, end).map((bug) => flocksVisualFeature(bug, viewport));
    const assignment = hungarian(left.map((feature, leftIndex) => right.map((candidate, rightIndex) =>
      correspondenceCost(feature, candidate, finalBugs[start + leftIndex], initialBugs[start + rightIndex], viewport))));
    assignment.forEach((rightIndex, leftIndex) => { permutation[start + leftIndex] = start + rightIndex; });
  }
}

export function buildFlocksVisualSignature(bugs, viewport, { columns = 12, rows = 8, hueBins = 6 } = {}) {
  const bins = new Uint16Array(columns * rows * hueBins);
  let visibleCount = 0;
  for (const bug of bugs) {
    const feature = flocksVisualFeature(bug, viewport);
    if (!feature.visible) continue;
    visibleCount += 1;
    const column = Math.min(columns - 1, Math.max(0, Math.floor(feature.x / viewport[0] * columns)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(feature.y / viewport[1] * rows)));
    const hue = ((bug.hue % 1) + 1) % 1;
    const hueBin = Math.min(hueBins - 1, Math.floor(hue * hueBins));
    bins[(row * columns + column) * hueBins + hueBin] += 1;
  }
  return Object.freeze({ bins, visibleCount });
}

export function compareFlocksVisualSignatures(left, right) {
  if (left.bins.length !== right.bins.length) throw new Error("Flocks seam signature dimensions drifted");
  let difference = 0;
  for (let index = 0; index < left.bins.length; index += 1) difference += Math.abs(left.bins[index] - right.bins[index]);
  return difference / Math.max(1, left.visibleCount + right.visibleCount);
}

export function flocksVisualFeature(bug, [width, height]) {
  const depth = 568 - bug.position[2];
  if (depth <= 0.1) return { x: width * 0.5, y: height * 0.5, visible: false };
  const scale = height / (2 * Math.tan(CSSFLOCKS_SOURCE.fieldOfViewDegrees * Math.PI / 360)) / depth;
  const x = width / 2 + bug.position[0] * scale;
  const y = height / 2 - bug.position[1] * scale;
  return { x, y, visible: x >= -12 && x <= width + 12 && y >= -12 && y <= height + 12 };
}

export function flocksCircularHueDistance(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 1 - distance);
}

function hermitePosition(start, startVelocity, end, endVelocity, time, durationSeconds) {
  const time2 = time * time;
  const time3 = time2 * time;
  return (2 * time3 - 3 * time2 + 1) * start +
    (time3 - 2 * time2 + time) * durationSeconds * startVelocity +
    (-2 * time3 + 3 * time2) * end +
    (time3 - time2) * durationSeconds * endVelocity;
}

function hermiteVelocity(start, startVelocity, end, endVelocity, time, durationSeconds) {
  const time2 = time * time;
  return ((6 * time2 - 6 * time) * start +
    (3 * time2 - 4 * time + 1) * durationSeconds * startVelocity +
    (-6 * time2 + 6 * time) * end +
    (3 * time2 - 2 * time) * durationSeconds * endVelocity) / durationSeconds;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function signedCircularHueDelta(target, start) {
  let delta = target - start;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function wrapHue(value) {
  let result = value;
  while (result > 1) result -= 1;
  while (result < 0) result += 1;
  return result;
}

function rounded(value) {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}

function correspondenceCost(left, right, leftBug, rightBug, [width, height]) {
  const huePixels = flocksCircularHueDistance(leftBug.hue, rightBug.hue) * Math.min(width, height) * 1.5;
  const speedDelta = Math.abs(Math.hypot(...leftBug.velocity) - Math.hypot(...rightBug.velocity)) * 0.2;
  if (left.visible && right.visible) return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + huePixels ** 2 + speedDelta ** 2;
  if (left.visible !== right.visible) return (width ** 2 + height ** 2) * 4 + huePixels ** 2;
  const positionDelta = Math.hypot(...leftBug.position.map((value, axis) => value - rightBug.position[axis]));
  return huePixels ** 2 + positionDelta ** 2 * 0.01 + speedDelta ** 2;
}

function hungarian(cost) {
  const count = cost.length;
  if (count === 0 || cost.some((row) => row.length !== count)) throw new Error("Square terminal cost matrix required");
  const u = new Float64Array(count + 1);
  const v = new Float64Array(count + 1);
  const p = new Int32Array(count + 1);
  const way = new Int32Array(count + 1);
  for (let row = 1; row <= count; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minimum = new Float64Array(count + 1).fill(Infinity);
    const used = new Uint8Array(count + 1);
    do {
      used[column0] = 1;
      const row0 = p[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= count; column += 1) {
        if (used[column]) continue;
        const current = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minimum[column]) { minimum[column] = current; way[column] = column0; }
        if (minimum[column] < delta) { delta = minimum[column]; column1 = column; }
      }
      for (let column = 0; column <= count; column += 1) {
        if (used[column]) { u[p[column]] += delta; v[column] -= delta; }
        else minimum[column] -= delta;
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = new Array(count);
  for (let column = 1; column <= count; column += 1) assignment[p[column] - 1] = column - 1;
  return assignment;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}
