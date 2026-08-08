#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cssmengerOracleRoot, compareFrameSequences, readJson, readJsonLines, writeJson } from "./oracle-support.mjs";
import { nativeTransform } from "./run-native-oracle.mjs";

export async function compareNativeBrowserMenger(options = {}) {
  const root = resolve(options.root ?? cssmengerOracleRoot);
  const nativeReport = await readJson(join(root, "native", "native-oracle.json"));
  const browserReport = await readJson(join(root, "browser", "browser-aa.json"));
  const nativeStates = await readJsonLines(nativeReport.runA.statesPath);
  const browserStates = await readJsonLines(browserReport.runA.statesPath);
  const state = compareStateRows(nativeStates, browserStates);
  const outputDir = join(root, "native-browser");
  const visual = await compareFrameSequences({
    expected: nativeReport.runA.framesDir,
    actual: browserReport.runA.framesDir,
    out: join(outputDir, "exact-pixel"),
    label: "cssmenger_native_browser_exact",
    frameCount: nativeStates.length,
    diffFrames: "all",
  });
  const selectedFrames = unique([
    visual.frames?.find((row) => !row.pass)?.frame,
    visual.worst?.[0]?.frame,
  ].filter(Number.isInteger));
  const triptychs = [];
  for (const frame of selectedFrames) {
    triptychs.push(await publishTriptych({
      frame,
      nativeDir: nativeReport.runA.framesDir,
      browserDir: browserReport.runA.framesDir,
      visual,
      outputDir: join(outputDir, "triptychs", `frame-${String(frame).padStart(4, "0")}`),
    }));
  }
  const report = {
    schema: "cssmenger-native-browser-oracle@1",
    sourceState: state,
    visual: {
      exact: visual.pass,
      qualification: visual.pass ? "exact-pixel-match" : "diverged",
      frameCount: visual.comparedFrameCount,
      firstDivergence: visual.frames?.find((row) => !row.pass) ?? null,
      worst: visual.worst?.[0] ?? null,
      reportPath: visual.manifestPath,
      thresholds: visual.thresholds,
      note: "This is an exact-first comparison. Native fixed-function moving lighting and browser prepared flat axis materials are intentionally not normalized away.",
    },
    triptychs,
    nativeFramesDir: nativeReport.runA.framesDir,
    browserFramesDir: browserReport.runA.framesDir,
  };
  report.completed = report.sourceState.exact;
  report.pass = report.sourceState.exact && report.visual.exact;
  const reportPath = join(outputDir, "native-browser-oracle.json");
  await writeJson(reportPath, report);
  if (!report.completed) throw new Error(`cssMenger native/browser state diverged: ${JSON.stringify(report.sourceState)}`);
  return Object.freeze({ ...report, reportPath });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  compareNativeBrowserMenger().then((report) => {
    console.log(JSON.stringify({ completed: report.completed, pass: report.pass, reportPath: report.reportPath, visual: report.visual }, null, 2));
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

function compareStateRows(nativeRows, browserRows) {
  let comparedScalarCount = 0;
  let firstMismatch = null;
  const count = Math.min(nativeRows.length, browserRows.length);
  for (let index = 0; index < count && !firstMismatch; index += 1) {
    const native = nativeRows[index];
    const browser = browserRows[index];
    comparedScalarCount += 17;
    if (native.tick !== browser.tick) {
      firstMismatch = { index, reason: "tick", native: native.tick, browser: browser.tick };
    } else if (nativeTransform(native.rotationFractions) !== browser.preparedTransform) {
      firstMismatch = { index, reason: "rotation", native: native.rotationFractions, browser: browser.preparedTransform };
    } else if (JSON.stringify(native.paletteIndices) !== JSON.stringify(browser.paletteIndices)) {
      firstMismatch = { index, reason: "palette-indices", native: native.paletteIndices, browser: browser.paletteIndices };
    } else if (JSON.stringify(native.paletteSource16) !== JSON.stringify(browser.paletteSource16)) {
      firstMismatch = { index, reason: "palette-source16", native: native.paletteSource16, browser: browser.paletteSource16 };
    }
  }
  if (!firstMismatch && nativeRows.length !== browserRows.length) {
    firstMismatch = { reason: "frame-count", native: nativeRows.length, browser: browserRows.length };
  }
  return {
    exact: firstMismatch === null,
    comparedFrameCount: count,
    comparedScalarCount,
    firstMismatch,
    depth: 3,
    polygonCount: 18_048,
  };
}

async function publishTriptych({ frame, nativeDir, browserDir, visual, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const suffix = String(frame).padStart(4, "0");
  const nativePpm = join(nativeDir, `frame_${suffix}.ppm`);
  const browserPng = join(browserDir, `frame_${suffix}.png`);
  const diff = visual.diffs.find((entry) => entry.frame === frame);
  const nativePng = join(outputDir, "native.png");
  const browserCopy = join(outputDir, "browser.png");
  const diffCopy = join(outputDir, "absolute-diff.png");
  convertPpmToPng(nativePpm, nativePng);
  await copyFile(browserPng, browserCopy);
  await copyFile(diff.png ?? diff.ppm, diffCopy);
  return Object.freeze({ frame, native: nativePng, browser: browserCopy, absoluteDiff: diffCopy });
}

function convertPpmToPng(source, target) {
  const result = spawnSync("sips", ["-s", "format", "png", source, "--out", target], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Unable to convert ${basename(source)}`);
}

function unique(values) {
  return [...new Set(values)];
}
