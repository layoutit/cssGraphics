#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { CSSGALAXY_VARIANT_COUNTS } from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { CSSGALAXY_FRAME_SEQUENCE_PLAN as plan } from "./frameSequencePlan.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssgalaxy/comparison");
const frameOracle = "/Users/ekrof/.codex/skills/frame-sequence-oracle/scripts/frame-sequence.mjs";
const keyframes = Object.freeze([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1199]);
const summaries = [];

for (const count of CSSGALAXY_VARIANT_COUNTS) {
  const root = resolve(resultRoot, String(count));
  const nativeFrames = resolve(root, "native/raw");
  const browserFrames = resolve(root, "browser/raw");
  const compareRoot = resolve(root, "native-browser-compare");
  await run(process.execPath, [frameOracle, "compare", "--expected", nativeFrames,
    "--actual", browserFrames, "--out", compareRoot, "--label", `cssgalaxy_${count}_native_browser`,
    "--expected-frames", String(plan.capturedFrameCount), "--mean-threshold", "0",
    "--changed-threshold", "0", "--channel-threshold", "0",
    "--diff-frames", "worst,0,400,800,1199", "--replace"]);
  const manifestPath = resolve(compareRoot, `cssgalaxy_${count}_native_browser.json`);
  const comparison = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!comparison.pass || comparison.comparedFrameCount !== plan.capturedFrameCount ||
      comparison.worst.some((frame) => frame.meanAbsDelta !== 0 || frame.changedPixelRatio !== 0)) {
    throw new Error(`Galaxy ${count} native/browser sequence did not match exactly`);
  }
  const contactSheet = resolve(root, `galaxy-${count}-native-browser-contact-sheet.png`);
  await makeContactSheet(nativeFrames, browserFrames, contactSheet);
  const video = resolve(root, `galaxy-${count}-native-left-browser-right.mp4`);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(plan.capturedFramesPerSecond), "-i", resolve(nativeFrames, "frame_%04d.png"),
    "-framerate", String(plan.capturedFramesPerSecond), "-i", resolve(browserFrames, "frame_%04d.png"),
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-r", String(plan.capturedFramesPerSecond),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", video]);
  const fullNativeFrames = resolve(resultRoot, "full-native/native/raw");
  const fullNativeContactSheet = resolve(root, `galaxy-${count}-full-native-browser-prefix-contact-sheet.png`);
  await makeContactSheet(fullNativeFrames, browserFrames, fullNativeContactSheet,
    "FULL NATIVE", "BROWSER PREFIX");
  const fullNativeVideo = resolve(root, `galaxy-${count}-full-native-left-browser-prefix-right.mp4`);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(plan.capturedFramesPerSecond), "-i", resolve(fullNativeFrames, "frame_%04d.png"),
    "-framerate", String(plan.capturedFramesPerSecond), "-i", resolve(browserFrames, "frame_%04d.png"),
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-r", String(plan.capturedFramesPerSecond),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", fullNativeVideo]);
  const summary = Object.freeze({
    starCount: count,
    completeSequence: true,
    frameCount: comparison.comparedFrameCount,
    exactPixelMatch: true,
    maximumMeanAbsoluteDelta: 0,
    maximumChangedPixelRatio: 0,
    manifestPath,
    contactSheet,
    video,
    fullNativeContactSheet,
    fullNativeVideo,
  });
  summaries.push(summary);
  process.stdout.write(`Galaxy ${count} exact sequence + contact sheet + video\n`);
}

const report = Object.freeze({
  schema: "cssgalaxy-native-browser-frame-comparison@1",
  capturedAt: new Date().toISOString(),
  plan,
  comparisonAuthority: "raw numbered native-prefix and headless Google Chrome frame sequences",
  fullNativeReferenceAuthority: "raw numbered native frames rendering every source-initialized star",
  fullNativePrefixComparisonsAreExpectedToDiffer: true,
  summaries: Object.freeze(summaries),
  status: "exact-all-variants",
});
await writeFile(resolve(resultRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ report: resolve(resultRoot, "report.json"), ...report }, null, 2));

async function makeContactSheet(nativeFrames, browserFrames, output,
  leftLabel = "NATIVE PREFIX", rightLabel = "BROWSER PREFIX") {
  const cellWidth = 400;
  const cellHeight = 300;
  const columns = 4;
  const composites = [];
  for (let index = 0; index < keyframes.length; index += 1) {
    const ordinal = keyframes[index];
    const column = index % columns;
    const group = Math.floor(index / columns);
    for (let side = 0; side < 2; side += 1) {
      const sourceRoot = side === 0 ? nativeFrames : browserFrames;
      const label = side === 0 ? leftLabel : rightLabel;
      const image = await sharp(resolve(sourceRoot, `frame_${String(ordinal).padStart(4, "0")}.png`))
        .resize(cellWidth, cellHeight, { fit: "fill" })
        .composite([{ input: Buffer.from(`<svg width="${cellWidth}" height="28" xmlns="http://www.w3.org/2000/svg"><rect width="${cellWidth}" height="28" fill="#000" fill-opacity=".72"/><text x="10" y="19" fill="#fff" font-family="monospace" font-size="13">${label}  frame ${String(ordinal).padStart(4, "0")}  t=${(ordinal / plan.capturedFramesPerSecond).toFixed(1)}s</text></svg>`), left: 0, top: 0 }])
        .png().toBuffer();
      composites.push({ input: image, left: column * cellWidth, top: (group * 2 + side) * cellHeight });
    }
  }
  await mkdir(resolve(output, ".."), { recursive: true });
  await sharp({
    create: { width: columns * cellWidth, height: 6 * cellHeight, channels: 3, background: "#000" },
  }).composite(composites).png({ compressionLevel: 9 }).toFile(output);
}

async function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise({ stdout, stderr }) :
      reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}
