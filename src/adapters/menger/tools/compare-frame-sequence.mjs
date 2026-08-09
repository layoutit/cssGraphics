#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const referenceFrames = join("bench", "results", "cssmenger", "reference-frames", "frames");
const browserFrames = join("bench", "results", "cssmenger", "browser-frames", "frames");
const reportDir = join("bench", "results", "cssmenger", "frame-sequence-compare");
const defaultOracle = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "frame-sequence-oracle", "scripts", "frame-sequence.mjs");
const oracleScript = process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT ?? (existsSync(defaultOracle) ? defaultOracle : "");
await mkdir(reportDir, { recursive: true });

const report = {
  schema: "polycss-frame-sequence-compare@1",
  title: "cssMenger — XScreenSaver Menger",
  referenceFrames,
  browserFrames,
  referenceExists: existsSync(referenceFrames),
  browserExists: existsSync(browserFrames),
  referenceFrameCount: await countFrames(referenceFrames),
  browserFrameCount: await countFrames(browserFrames),
  oracleScript: oracleScript || null,
  status: "pending-frame-sequence-oracle",
  note: "Use frame-sequence-oracle for real per-frame image comparison; GIFs/keyframes are preview artifacts only.",
};

if (!report.referenceExists || !report.browserExists) {
  await writeReport(report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else if (oracleScript) {
  const result = spawnSync(process.execPath, [
    oracleScript,
    "compare",
    "--expected",
    referenceFrames,
    "--actual",
    browserFrames,
    "--out",
    reportDir,
    "--label",
    "cssmenger-frame-sequence",
    "--mean-threshold",
    process.env.CSS_FRAME_SEQUENCE_MEAN_THRESHOLD ?? "1.0",
    "--diff-frames",
    process.env.CSS_FRAME_SEQUENCE_DIFF_FRAMES ?? "worst",
  ], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} else {
  await writeReport(report);
  console.error(JSON.stringify({
    ...report,
    command: "node <frame-sequence-oracle>/scripts/frame-sequence.mjs compare --expected " + referenceFrames + " --actual " + browserFrames + " --out " + reportDir + " --label cssmenger-frame-sequence --mean-threshold 1.0 --diff-frames worst",
  }, null, 2));
  process.exitCode = 1;
}

async function countFrames(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  const entries = await readdir(dir);
  return entries.filter((name) => /^frame_\d+\.(png|ppm)$/i.test(name)).length;
}

async function writeReport(report) {
  await writeFile(join(reportDir, "frame-sequence-compare.json"), JSON.stringify(report, null, 2) + "\n");
}
