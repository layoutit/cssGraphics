#!/usr/bin/env node
import { join } from "node:path";
import { compareNativeBrowserMenger } from "./compare-native-browser.mjs";
import { runBrowserMengerAa } from "./run-browser-aa.mjs";
import { runNativeMengerOracle } from "./run-native-oracle.mjs";
import { cssmengerOracleRoot, writeJson } from "./oracle-support.mjs";

const sourceIndex = process.argv.indexOf("--source-root");
const dataRoot = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;

try {
  const native = await runNativeMengerOracle({ dataRoot });
  const browser = await runBrowserMengerAa();
  const comparison = await compareNativeBrowserMenger();
  const completed = native.pass && browser.pass && comparison.completed;
  const report = {
    schema: "cssmenger-oracle@1",
    status: comparison.visual.exact ? "completed-exact-pixel-match" : "completed-pixel-divergence",
    completed,
    pass: completed && comparison.visual.exact,
    exactNativeAa: native.visualAa.exact,
    exactBrowserAa: browser.visualAa.exact,
    exactNativeBrowserState: comparison.sourceState.exact,
    exactNativeBrowserPixels: comparison.visual.exact,
    visualQualification: comparison.visual.qualification,
    nativeReport: native.reportPath,
    browserReport: browser.reportPath,
    nativeBrowserReport: comparison.reportPath,
    triptychs: comparison.triptychs,
  };
  const reportPath = join(cssmengerOracleRoot, "report.json");
  await writeJson(reportPath, report);
  if (!report.completed) throw new Error(`cssMenger oracle failed to complete: ${JSON.stringify(report)}`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}
