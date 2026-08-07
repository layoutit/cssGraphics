#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const expectedDir = join("bench", "results", "cssgears", "reference", "frames");
const actualDir = join("bench", "results", "cssgears", "browser", "frames");
const reportDir = join("bench", "results", "cssgears", "compare");
const oracleScript = process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT ??
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "frame-sequence-oracle", "scripts", "frame-sequence.mjs");
if (!existsSync(oracleScript)) throw new Error(`Missing frame-sequence oracle: ${oracleScript}`);

const result = spawnSync(process.execPath, [
  oracleScript,
  "compare",
  "--expected", expectedDir,
  "--actual", actualDir,
  "--out", reportDir,
  "--replace",
  "--label", "cssgears-native-vs-polycss",
  "--mean-threshold", "0",
  "--changed-threshold", "0",
  "--channel-threshold", "0",
  "--diff-frames", "0",
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const reportPath = join(reportDir, "cssgears_native_vs_polycss.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const qualification = {
  schema: "cssgears-visual-qualification@1",
  status: report.pass ? "QUALIFIED" : "INVALID",
  nativeBrowserFrameParity: report.pass,
  visualParityClaim: report.pass,
  reason: report.pass
    ? "The strict single-frame native and browser comparison is exact."
    : "The strict native/browser frame comparison has residual pixels; inspect the absolute diff before setting tolerances.",
  comparisonReport: reportPath,
  worst: report.worst[0] ?? null,
  diffs: report.diffs,
};
await writeFile(join(reportDir, "qualification.json"), `${JSON.stringify(qualification, null, 2)}\n`);
console.log(JSON.stringify({ report, qualification }, null, 2));
