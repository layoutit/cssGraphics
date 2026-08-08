#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureBrowserMengerFrames } from "./capture-browser-frames.mjs";
import { CSSMENGER_ORACLE_FRAME_SCHEDULE, resolveCssmengerOracleTicks } from "./cssmenger-frame-schedule.mjs";
import { compareFrameSequences, cssmengerOracleRoot, writeJson } from "./oracle-support.mjs";

export async function runBrowserMengerAa(options = {}) {
  const outputDir = resolve(options.outputDir ?? join(cssmengerOracleRoot, "browser"));
  const ticks = options.ticks ?? resolveCssmengerOracleTicks();
  await rm(outputDir, { recursive: true, force: true });
  const runA = await captureBrowserMengerFrames({ ticks, outputDir: join(outputDir, "run-a") });
  const runB = await captureBrowserMengerFrames({ ticks, outputDir: join(outputDir, "run-b") });
  const runAStatesSha256 = sha256(await readFile(runA.statesPath));
  const runBStatesSha256 = sha256(await readFile(runB.statesPath));
  const visualAa = await compareFrameSequences({
    expected: runA.framesDir,
    actual: runB.framesDir,
    out: join(outputDir, "visual-aa"),
    label: "cssmenger_browser_visual_aa",
    frameCount: ticks.length,
    diffFrames: "worst",
  });
  const report = {
    schema: "cssmenger-browser-aa@1",
    schedule: { ...CSSMENGER_ORACLE_FRAME_SCHEDULE, ticks },
    stateAa: {
      exact: runAStatesSha256 === runBStatesSha256,
      runASha256: runAStatesSha256,
      runBSha256: runBStatesSha256,
    },
    visualAa: {
      exact: visualAa.pass,
      frameCount: visualAa.comparedFrameCount,
      reportPath: visualAa.manifestPath,
      worst: visualAa.worst?.[0] ?? null,
    },
    runA: { framesDir: runA.framesDir, statesPath: runA.statesPath, manifestPath: runA.manifestPath },
    runB: { framesDir: runB.framesDir, statesPath: runB.statesPath, manifestPath: runB.manifestPath },
  };
  report.pass = report.stateAa.exact && report.visualAa.exact;
  const reportPath = join(outputDir, "browser-aa.json");
  await writeJson(reportPath, report);
  if (!report.pass) throw new Error(`cssMenger browser A/A failed: ${JSON.stringify(report)}`);
  return Object.freeze({ ...report, reportPath, runA, runB });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBrowserMengerAa().then((report) => {
    console.log(JSON.stringify({ pass: report.pass, reportPath: report.reportPath, frameCount: report.visualAa.frameCount }, null, 2));
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
