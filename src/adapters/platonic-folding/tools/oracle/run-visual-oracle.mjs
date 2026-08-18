#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureBrowserPlatonicFrames } from "./capture-browser-frames.mjs";
import { captureNativePlatonicFrames } from "./capture-native-frames.mjs";
import { resolvePlatonicOracleFrames } from "./frame-schedule.mjs";
import { compareFrameSequences, oracleRoot, writeJson } from "./oracle-support.mjs";

const BOUNDED_MEAN_DELTA = 0.7;
const BOUNDED_CHANGED_RATIO = 0.0125;
const BOUNDED_CHANNEL_DELTA = 8;

export async function runPlatonicVisualOracle(options = {}) {
  const outputDir = resolve(options.outputDir ?? oracleRoot);
  const sourceRoot = options.sourceRoot ?? process.env.CSSPLATONICFOLDING_SOURCE_ROOT;
  const frames = options.frames ?? resolvePlatonicOracleFrames();
  await rm(outputDir, { recursive: true, force: true });
  const nativeA = await captureNativePlatonicFrames({ sourceRoot, frames, outputDir: join(outputDir, "native", "run-a") });
  const nativeB = await captureNativePlatonicFrames({ sourceRoot, frames, outputDir: join(outputDir, "native", "run-b") });
  const browserA = await captureBrowserPlatonicFrames({ frames, outputDir: join(outputDir, "browser", "run-a") });
  const browserB = await captureBrowserPlatonicFrames({ frames, outputDir: join(outputDir, "browser", "run-b") });
  const nativeAa = await compareFrameSequences({
    expected: nativeA.framesDir,
    actual: nativeB.framesDir,
    out: join(outputDir, "native", "aa"),
    label: "cssplatonicfolding_native_aa",
    frameCount: frames.length,
  });
  const browserAa = await compareFrameSequences({
    expected: browserA.framesDir,
    actual: browserB.framesDir,
    out: join(outputDir, "browser", "aa"),
    label: "cssplatonicfolding_browser_aa",
    frameCount: frames.length,
  });
  const measurement = await compareFrameSequences({
    expected: nativeA.framesDir,
    actual: browserA.framesDir,
    out: join(outputDir, "native-browser", "measurement"),
    label: "cssplatonicfolding_native_browser_measurement",
    frameCount: frames.length,
    meanThreshold: 255,
    changedThreshold: 1,
    channelThreshold: 0,
    diffFrames: "worst",
  });
  const bounded = await compareFrameSequences({
    expected: nativeA.framesDir,
    actual: browserA.framesDir,
    out: join(outputDir, "native-browser", "bounded"),
    label: "cssplatonicfolding_native_browser_bounded",
    frameCount: frames.length,
    meanThreshold: BOUNDED_MEAN_DELTA,
    changedThreshold: BOUNDED_CHANGED_RATIO,
    channelThreshold: BOUNDED_CHANNEL_DELTA,
    diffFrames: "worst",
  });
  const exact = measurement.frames.every((frame) => frame.meanAbsDelta === 0 && frame.changedPixelRatio === 0);
  const triptych = await publishTriptych({
    frame: measurement.worst[0].frame,
    sourceFrame: frames[measurement.worst[0].frame],
    nativeDir: nativeA.framesDir,
    browserDir: browserA.framesDir,
    comparison: measurement,
    outputDir: join(outputDir, "native-browser", "triptych"),
  });
  const report = {
    schema: "cssplatonicfolding-visual-oracle@1",
    source: nativeA.source,
    renderer: nativeA.renderer,
    frames,
    frameCount: frames.length,
    nativeAa: { exact: nativeAa.pass, reportPath: nativeAa.manifestPath },
    browserAa: { exact: browserAa.pass, reportPath: browserAa.manifestPath },
    visual: {
      exact,
      boundedMatch: bounded.pass,
      qualification: exact ? "exact-pixel-match" : bounded.pass ? "source-faithful-bounded-approximation" : "diverged",
      measurement: { reportPath: measurement.manifestPath, worst: measurement.worst[0] },
      bounded: { reportPath: bounded.manifestPath, thresholds: bounded.thresholds, worst: bounded.worst[0] },
      note: "The bounded gate preserves full-frame structure and source colors while allowing only measured OpenGL-versus-raster-atlas edge filtering and 64-state per-face palette quantization. It does not qualify visual parity.",
    },
    triptych,
  };
  report.pass = report.nativeAa.exact && report.browserAa.exact && report.visual.boundedMatch;
  const reportPath = join(outputDir, "visual-oracle.json");
  await writeJson(reportPath, report);
  if (!report.pass) throw new Error(`Platonic Folding visual oracle failed: ${JSON.stringify(report)}`);
  return Object.freeze({ ...report, reportPath });
}

async function publishTriptych({ frame, sourceFrame, nativeDir, browserDir, comparison, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const suffix = String(frame).padStart(4, "0");
  const native = join(outputDir, "native.png");
  const browser = join(outputDir, "browser.png");
  const absoluteDiff = join(outputDir, "absolute-diff.png");
  convertPpmToPng(join(nativeDir, `frame_${suffix}.ppm`), native);
  await copyFile(join(browserDir, `frame_${suffix}.png`), browser);
  const diff = comparison.diffs.find((entry) => entry.frame === frame);
  await copyFile(diff.png, absoluteDiff);
  return Object.freeze({ frame, sourceFrame, native, browser, absoluteDiff });
}

function convertPpmToPng(source, target) {
  const result = spawnSync("sips", ["-s", "format", "png", source, "--out", target], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Unable to convert native frame");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPlatonicVisualOracle().then((report) => console.log(JSON.stringify({
    pass: report.pass,
    reportPath: report.reportPath,
    visual: report.visual,
    triptych: report.triptych,
  }, null, 2))).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
