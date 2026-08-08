#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCssmengerDataSource, SOURCE_COMMIT, SOURCE_TREE } from "../../src/prepare/cssmenger/dataSource.mjs";
import { captureNativeMenger } from "../../src/prepare/cssmenger/nativeOracle.mjs";
import { buildPreparedMengerPlayback, CSSMENGER_SEED } from "../../src/prepare/cssmenger/sourcePlayback.mjs";
import { CSSMENGER_ORACLE_FRAME_SCHEDULE, resolveCssmengerOracleTicks } from "./cssmenger-frame-schedule.mjs";
import { compareFrameSequences, cssmengerOracleRoot, writeJson } from "./oracle-support.mjs";

export async function runNativeMengerOracle(options = {}) {
  const outputDir = resolve(options.outputDir ?? join(cssmengerOracleRoot, "native"));
  const ticks = options.ticks ?? resolveCssmengerOracleTicks();
  const source = await resolveCssmengerDataSource({ dataRoot: options.dataRoot });
  await rm(outputDir, { recursive: true, force: true });
  const runA = await captureNativeMenger(source.root, {
    seed: CSSMENGER_SEED,
    ticks,
    outputDir: join(outputDir, "run-a"),
  });
  const runB = await captureNativeMenger(source.root, {
    seed: CSSMENGER_SEED,
    ticks,
    outputDir: join(outputDir, "run-b"),
  });
  const stateComparison = compareNativePreparedStates(runA.states, ticks);
  const visualAa = await compareFrameSequences({
    expected: runA.framesDir,
    actual: runB.framesDir,
    out: join(outputDir, "visual-aa"),
    label: "cssmenger_native_visual_aa",
    frameCount: ticks.length,
    diffFrames: "worst",
  });
  const report = {
    schema: "cssmenger-native-oracle@1",
    schedule: { ...CSSMENGER_ORACLE_FRAME_SCHEDULE, ticks },
    source: {
      commit: source.sourceCommit,
      tree: source.sourceTree,
      primarySha256: source.primarySha256,
      exact: source.sourceCommit === SOURCE_COMMIT && source.sourceTree === SOURCE_TREE,
    },
    stateAa: {
      exact: runA.statesSha256 === runB.statesSha256,
      runASha256: runA.statesSha256,
      runBSha256: runB.statesSha256,
    },
    sourceSemanticComparison: stateComparison,
    visualAa: {
      exact: visualAa.pass,
      frameCount: visualAa.comparedFrameCount,
      runASequenceSha256: runA.sequenceSha256,
      runBSequenceSha256: runB.sequenceSha256,
      reportPath: visualAa.manifestPath,
      worst: visualAa.worst?.[0] ?? null,
    },
    renderer: runA.binding.renderer,
    bindingPath: runA.bindingPath,
    runA: { framesDir: runA.framesDir, statesPath: runA.statesPath },
    runB: { framesDir: runB.framesDir, statesPath: runB.statesPath },
  };
  report.pass = report.source.exact && report.stateAa.exact &&
    report.sourceSemanticComparison.exact && report.visualAa.exact;
  const reportPath = join(outputDir, "native-oracle.json");
  await writeJson(reportPath, report);
  if (!report.pass) throw new Error(`cssMenger native oracle failed: ${JSON.stringify(report)}`);
  return Object.freeze({ ...report, reportPath, runA, runB });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceIndex = process.argv.indexOf("--source-root");
  const dataRoot = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
  runNativeMengerOracle({ dataRoot }).then((report) => {
    console.log(JSON.stringify({ pass: report.pass, reportPath: report.reportPath, ...report.sourceSemanticComparison }, null, 2));
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

function compareNativePreparedStates(nativeRows, ticks) {
  const playback = buildPreparedMengerPlayback();
  let comparedScalarCount = 0;
  let firstMismatch = null;
  for (let index = 0; index < nativeRows.length && !firstMismatch; index += 1) {
    const native = nativeRows[index];
    const tick = ticks[index];
    const expectedTransform = nativeTransform(native.rotationFractions);
    comparedScalarCount += 3 + 3 + 9 + 2;
    if (native.tick !== tick || native.depth !== 3 || native.polygonCount !== 18_048) {
      firstMismatch = { index, tick, reason: "native-row-contract", native };
    } else if (playback.transforms[tick] !== expectedTransform) {
      firstMismatch = { index, tick, reason: "rotation", native: native.rotationFractions, expectedTransform, preparedTransform: playback.transforms[tick] };
    } else if (!arraysEqual(native.paletteIndices, playback.colorRows[tick])) {
      firstMismatch = { index, tick, reason: "palette-indices", native: native.paletteIndices, prepared: playback.colorRows[tick] };
    } else {
      const preparedSource16 = playback.colorRows[tick].map((paletteIndex) => playback.palette[paletteIndex].source16);
      if (JSON.stringify(native.paletteSource16) !== JSON.stringify(preparedSource16)) {
        firstMismatch = { index, tick, reason: "palette-source16", native: native.paletteSource16, prepared: preparedSource16 };
      }
    }
  }
  return {
    exact: firstMismatch === null,
    comparedFrameCount: nativeRows.length,
    comparedScalarCount,
    firstMismatch,
    note: "Native C rotator fractions are formatted through the same 9-decimal prepared CSS contract; palette indices and 16-bit source colors are integer-exact.",
  };
}

export function nativeTransform([x, y, z]) {
  return `rotateX(${preparedNumber(-x * 360)}deg) rotateY(${preparedNumber(y * 360)}deg) rotateZ(${preparedNumber(-z * 360)}deg)`;
}

function preparedNumber(value) {
  return Number(value.toFixed(9)).toString();
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
