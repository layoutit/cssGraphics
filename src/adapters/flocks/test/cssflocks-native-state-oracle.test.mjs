import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceOracleSequence,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import {
  compareNativeStateRows,
  parseNativeStateCsv,
  requireLockedBytes,
  requirePassingNativeStateComparison,
} from "../tools/nativeStateOracle.mjs";

const adapterRoot = resolve(import.meta.dirname, "..");

test("native state harness compiles the pinned upstream source instead of copying its simulation", async () => {
  const source = await readFile(resolve(adapterRoot, "tools/native-state-oracle.cpp"), "utf8");
  assert.match(source, /#include CSSFLOCKS_SOURCE_PATH/u);
  assert.match(source, /rsRandGen\(\)\.seed\(seed\)/u);
  assert.match(source, /kFrameCount = 600/u);
  assert.match(source, /lBugs\[index\]\.update\(lBugs\)/u);
  assert.match(source, /fBugs\[followerIndex\]\.update\(lBugs\)/u);
  assert.doesNotMatch(source, /class\s+Copied|simulateFollower|simulateLeader/u);
});

test("source lock binds the rsMath and Rgbhsl bytes used by the native harness", async () => {
  const lock = JSON.parse(await readFile(resolve(adapterRoot, "notes/references/source-lock.json"), "utf8"));
  assert.match(lock.dependencies.rslibs.revision, /^[0-9a-f]{40}$/u);
  assert.deepEqual(lock.dependencies.rslibs.files.map((entry) => entry.path), [
    "libs/rsMath/rsMath.h",
    "libs/Rgbhsl/Rgbhsl.h",
    "libs/Rgbhsl/Rgbhsl.cpp",
  ]);
  for (const entry of lock.dependencies.rslibs.files) assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
});

test("native CSV parsing and comparison fail closed on corruption or state mismatch", () => {
  assert.throws(() => parseNativeStateCsv("frame,index\n0,0\n"), /header drifted/u);
  assert.throws(() => requireLockedBytes(Buffer.from("wrong"), "0".repeat(64), "fixture"), /sha256 mismatch/u);

  const bank = Object.freeze({ ...CSSFLOCKS_SOURCE_BANK, warmupFrames: 0, frameCount: 1, blockFrameCount: 1 });
  const sourceOracle = buildFlocksSourceOracleSequence({ bank });
  const bug = sourceOracle.frames[0].bugs[0];
  const header = "frame,index,type,leader,hue,x,y,z,xSpeed,ySpeed,zSpeed,directionX,directionY,directionZ,stretch,drawn,translateX,translateY,translateZ,rotateY,rotateX,scaleZ,translationCount,rotationCount,scaleCount,r,g,b";
  const mismatchedRow = [0, 0, 0, -1, bug.hue, bug.position[0] + 1, bug.position[1], bug.position[2], ...bug.velocity, ...bug.direction, bug.stretch, 1, ...bug.position, -45, 35.264389, bug.stretch, 1, 2, 1, 0, 1, 0.5].join(",");
  const rows = parseNativeStateCsv(`${header}\n${mismatchedRow}\n`);
  const comparison = compareNativeStateRows(rows, sourceOracle);
  assert.equal(comparison.status, "failed");
  assert.throws(() => requirePassingNativeStateComparison(comparison), /oracle failed/u);
});
