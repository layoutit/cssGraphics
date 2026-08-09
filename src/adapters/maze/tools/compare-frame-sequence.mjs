#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const oracleScript = process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT;
if (!oracleScript) {
  console.error("cssMaze frame-sequence comparison is UNQUALIFIED until native frames exist. Set CSS_FRAME_SEQUENCE_ORACLE_SCRIPT to the frame-sequence-oracle script after capture qualification.");
  process.exitCode = 2;
} else {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const expected = resolve(args[0] ?? "bench/results/cssmaze/reference-frames/frames");
  const actual = resolve(args[1] ?? "bench/results/cssmaze/browser-frames/frames");
  const output = resolve(args[2] ?? "bench/results/cssmaze/reference-vs-browser");
  const child = spawn(process.execPath, [
    resolve(oracleScript),
    "compare",
    "--expected", expected,
    "--actual", actual,
    "--out", output,
    "--label", "cssmaze-native-vs-browser-unqualified",
    "--mean-threshold", "0",
    "--changed-threshold", "0",
    "--channel-threshold", "0",
    "--diff-frames", "worst,0",
  ], { stdio: "inherit" });
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}
