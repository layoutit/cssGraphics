#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const referenceFrame = join("bench", "results", "cssmenger", "reference", "frame.png");
const browserFrame = join("bench", "results", "cssmenger", "browser", "frame.png");
const reportDir = join("bench", "results", "cssmenger", "compare");
await mkdir(reportDir, { recursive: true });

const report = {
  schema: "polycss-reference-compare@1",
  title: "cssMenger — XScreenSaver Menger",
  referenceFrame,
  browserFrame,
  referenceExists: existsSync(referenceFrame),
  browserExists: existsSync(browserFrame),
  referenceBytes: existsSync(referenceFrame) ? statSync(referenceFrame).size : 0,
  browserBytes: existsSync(browserFrame) ? statSync(browserFrame).size : 0,
  status: "pending-real-comparator",
  note: "Replace this starter with a source-appropriate visual/state comparator before claiming parity.",
};

await writeFile(join(reportDir, "visual-compare.json"), JSON.stringify(report, null, 2) + "\n");
if (!report.referenceExists || !report.browserExists) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report, null, 2));
}
