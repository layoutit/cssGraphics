// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { flocksHueToRgb } from "../src/shared/cssflocks/bugTransform.mjs";

const CSV_FIELDS = Object.freeze([
  "frame", "index", "type", "leader", "hue", "x", "y", "z",
  "xSpeed", "ySpeed", "zSpeed", "directionX", "directionY", "directionZ",
  "stretch", "drawn", "translateX", "translateY", "translateZ", "rotateY",
  "rotateX", "scaleZ", "translationCount", "rotationCount", "scaleCount",
  "r", "g", "b",
]);

export const CSSFLOCKS_NATIVE_STATE_TOLERANCES = Object.freeze({
  initializationPosition: 0.001,
  position: 0.02,
  velocity: 0.002,
  hue: 0.00001,
  direction: 0.00001,
  stretch: 0.00001,
  transform: 0.001,
  rotationDegrees: 0.005,
  rgb: 0.000005,
});

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function requireLockedBytes(bytes, expectedSha256, label) {
  if (!Buffer.isBuffer(bytes) || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new TypeError(`Invalid locked-byte request for ${label}`);
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} sha256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
  return actualSha256;
}

export function parseNativeStateCsv(text) {
  if (typeof text !== "string" || text.trim() === "") throw new TypeError("Native Flocks state CSV is empty");
  const lines = text.trim().split(/\r?\n/u);
  const header = lines.shift()?.split(",");
  if (JSON.stringify(header) !== JSON.stringify(CSV_FIELDS)) {
    throw new Error("Native Flocks state CSV header drifted");
  }
  const seen = new Set();
  const rows = lines.map((line, rowIndex) => {
    const fields = line.split(",");
    if (fields.length !== CSV_FIELDS.length || fields.some((field) => field.trim() === "")) {
      throw new Error(`Malformed native Flocks row ${rowIndex + 2}`);
    }
    const values = fields.map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Non-finite native Flocks row ${rowIndex + 2}`);
    }
    const row = Object.fromEntries(CSV_FIELDS.map((field, index) => [field, values[index]]));
    if (!Number.isSafeInteger(row.frame) || row.frame < -1 ||
        !Number.isSafeInteger(row.index) || row.index < 0 || row.index > 1003 ||
        ![0, 1].includes(row.type) || ![0, 1].includes(row.drawn)) {
      throw new Error(`Invalid native Flocks identity at row ${rowIndex + 2}`);
    }
    const key = `${row.frame}:${row.index}`;
    if (seen.has(key)) throw new Error(`Duplicate native Flocks row ${key}`);
    seen.add(key);
    return Object.freeze(row);
  });
  return Object.freeze(rows);
}

export function compareNativeStateRows(rows, sourceOracle, tolerances = CSSFLOCKS_NATIVE_STATE_TOLERANCES) {
  if (!Array.isArray(rows) || sourceOracle?.schema !== "cssflocks-source-oracle-sequence@1") {
    throw new TypeError("Complete native and JavaScript Flocks oracle inputs are required");
  }
  const maxima = Object.fromEntries(Object.keys(tolerances).map((key) => [key, 0]));
  const failures = [];
  const expectedSampleCount = new Set(rows.filter((row) => row.frame === -1).map((row) => row.index)).size;
  const expectedRows = (sourceOracle.frames.length + 1) * expectedSampleCount;
  if (rows.length !== expectedRows || expectedSampleCount < 10) {
    failures.push(`expected ${(sourceOracle.frames.length + 1)} frames x at least 10 samples, received ${rows.length} rows`);
  }

  const record = (metric, delta, key) => {
    maxima[metric] = Math.max(maxima[metric], delta);
    if (delta > tolerances[metric] && failures.length < 40) {
      failures.push(`${key} ${metric} delta ${delta} exceeds ${tolerances[metric]}`);
    }
  };

  for (const row of rows) {
    const bugs = row.frame === -1 ? sourceOracle.initialBugs : sourceOracle.frames[row.frame]?.bugs;
    const target = bugs?.[row.index];
    if (!target) {
      failures.push(`native row ${row.frame}:${row.index} has no JavaScript target`);
      continue;
    }
    const key = `${row.frame}:${row.index}`;
    const type = row.type === 0 ? "leader" : "follower";
    const leader = target.leader === null ? -1 : target.leader;
    if (target.type !== type || leader !== row.leader) failures.push(`${key} identity/leader mismatch`);
    const positionMetric = row.frame === -1 ? "initializationPosition" : "position";
    [row.x, row.y, row.z].forEach((value, index) => record(positionMetric, Math.abs(value - target.position[index]), `${key}:position[${index}]`));
    [row.xSpeed, row.ySpeed, row.zSpeed].forEach((value, index) => record("velocity", Math.abs(value - target.velocity[index]), `${key}:velocity[${index}]`));
    [row.directionX, row.directionY, row.directionZ].forEach((value, index) => record("direction", Math.abs(value - target.direction[index]), `${key}:direction[${index}]`));
    record("hue", circularDistance(row.hue, target.hue), `${key}:hue`);
    record("stretch", Math.abs(row.stretch - target.stretch), `${key}:stretch`);

    if (row.frame >= 0) {
      if (row.drawn !== 1 || row.translationCount !== 1 || row.rotationCount !== 2 || row.scaleCount !== 1) {
        failures.push(`${key} GL transform call shape mismatch`);
      }
      [row.translateX, row.translateY, row.translateZ].forEach((value, index) => record("transform", Math.abs(value - target.position[index]), `${key}:translate[${index}]`));
      const yaw = Math.atan2(-target.direction[0], -target.direction[2]) * 180 / Math.PI;
      const pitch = Math.asin(clamp(target.direction[1], -1, 1)) * 180 / Math.PI;
      record("rotationDegrees", angularDistance(row.rotateY, yaw), `${key}:rotateY`);
      record("rotationDegrees", angularDistance(row.rotateX, pitch), `${key}:rotateX`);
      record("transform", Math.abs(row.scaleZ - target.stretch), `${key}:scaleZ`);
      const rgb = flocksHueToRgb(target.hue);
      [row.r, row.g, row.b].forEach((value, index) => record("rgb", Math.abs(value - rgb[index]), `${key}:rgb[${index}]`));
    }
  }

  return Object.freeze({
    schema: "cssflocks-native-state-comparison@1",
    status: failures.length === 0 ? "passed" : "failed",
    rowCount: rows.length,
    initializationRows: rows.filter((row) => row.frame === -1).length,
    frameCount: sourceOracle.frames.length,
    sampleIndices: Object.freeze([...new Set(rows.map((row) => row.index))].sort((left, right) => left - right)),
    tolerances,
    maxima: Object.freeze(maxima),
    failures: Object.freeze(failures),
  });
}

export function requirePassingNativeStateComparison(comparison) {
  if (comparison?.schema !== "cssflocks-native-state-comparison@1" || comparison.status !== "passed") {
    const detail = comparison?.failures?.[0] ?? "malformed comparison";
    throw new Error(`Flocks native state oracle failed: ${detail}`);
  }
  return comparison;
}

function circularDistance(left, right) {
  const direct = Math.abs(left - right);
  return Math.min(direct, Math.abs(1 - direct));
}

function angularDistance(left, right) {
  const direct = Math.abs(left - right) % 360;
  return Math.min(direct, 360 - direct);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
