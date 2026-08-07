#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCssgearsDataSource, SOURCE_COMMIT } from "../src/prepare/cssgears/dataSource.mjs";
import {
  captureNativeGearsFrameSequence,
  CSSGEARS_NATIVE_SEED,
} from "../src/prepare/cssgears/nativeOracle.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frameCount = positiveInteger(process.env.CSSGEARS_ORACLE_FRAME_COUNT, 120, "frame count");
const runId = new Date().toISOString().replace(/[:.]/gu, "-");
const outDir = join(repoRoot, "bench", "results", "cssgears", "frame-oracle", runId);
const nativeDir = join(outDir, "native");
const browserDir = join(outDir, "browser");
const comparisonDir = join(outDir, "comparison");
const videoPath = join(outDir, "native-browser-diff.mp4");
const oracleScript = resolve(
  process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT ??
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "frame-sequence-oracle", "scripts", "frame-sequence.mjs"),
);

await mkdir(outDir, { recursive: true });
const dataSource = await resolveCssgearsDataSource();
const native = await captureNativeGearsFrameSequence(dataSource.root, {
  seed: Number(process.env.CSSGEARS_NATIVE_SEED ?? CSSGEARS_NATIVE_SEED),
  frameCount,
  outputDir: nativeDir,
});
await writeFile(join(nativeDir, "capture.json"), JSON.stringify({
  schema: native.schema,
  renderer: "pinned gears.c through a no-window macOS CGL framebuffer",
  headless: true,
  sourceRevision: SOURCE_COMMIT,
  seed: native.seed,
  width: native.width,
  height: native.height,
  frameCount: native.frameCount,
  framesDir: native.framesDir,
  statePath: native.statePath,
  ticksPath: native.ticksPath,
  stateSha256: native.stateSha256,
  frame0Sha256: native.frame0Sha256,
  sequenceSha256: native.sequenceSha256,
}, null, 2) + "\n");

run(process.execPath, [join(repoRoot, "tools", "capture-browser-frames.mjs")], {
  ...process.env,
  CSS_BROWSER_FRAME_SEQUENCE_OUT_DIR: browserDir,
  CSS_FRAME_SEQUENCE_FRAMES: String(frameCount),
  CSS_BROWSER_FRAME_SEQUENCE_SETTLE_FRAMES: "2",
});

const browserManifest = JSON.parse(await readFile(join(browserDir, "frame-sequence.json"), "utf8"));
const browserTicks = await readJsonLines(join(browserDir, "ticks.jsonl"));
const stateComparison = compareStateRows(native.ticks, browserTicks);
const publicationComparison = comparePublishedRows(native.ticks, browserTicks);
const provenanceExact = browserManifest.initialState?.oracle?.nativeStateSha256 === native.stateSha256;
await writeFile(join(outDir, "state-comparison.json"), JSON.stringify({
  schema: "cssgears-native-browser-state-sequence-compare@1",
  frameCount,
  provenanceExact,
  nativeStateSha256: native.stateSha256,
  browserNativeStateSha256: browserManifest.initialState?.oracle?.nativeStateSha256 ?? null,
  ...stateComparison,
  physicalCssomPublication: publicationComparison,
}, null, 2) + "\n");

run(process.execPath, [
  oracleScript,
  "compare",
  "--expected", native.framesDir,
  "--actual", join(browserDir, "frames"),
  "--out", comparisonDir,
  "--label", "cssgears_native_browser_sequence",
  "--mean-threshold", "0",
  "--changed-threshold", "0",
  "--channel-threshold", "0",
  "--diff-frames", "all",
  "--diff-amplify", "4",
], process.env);

const visualReportPath = join(comparisonDir, "cssgears_native_browser_sequence.json");
const visual = JSON.parse(await readFile(visualReportPath, "utf8"));
encodeTriptych({
  frameCount,
  nativePattern: join(native.framesDir, "frame_%04d.ppm"),
  browserPattern: join(browserDir, "frames", "frame_%04d.png"),
  diffPattern: join(comparisonDir, "diffs", "frame_%04d_diff.ppm"),
  videoPath,
});

const report = {
  schema: "cssgears-synchronized-native-browser-oracle@1",
  runId,
  capturedAt: new Date().toISOString(),
  sourceRevision: SOURCE_COMMIT,
  seed: native.seed,
  viewport: { width: native.width, height: native.height },
  frameCount,
  sourceFrameDelayMilliseconds: 30,
  videoFrameRate: "100/3",
  captureSemantics: "numbered source draw N on native and browser; video is a synchronized preview, not a natural wall-clock recording",
  native: {
    framesDir: native.framesDir,
    ticksPath: native.ticksPath,
    stateSha256: native.stateSha256,
    sequenceSha256: native.sequenceSha256,
  },
  browser: {
    framesDir: join(browserDir, "frames"),
    ticksPath: join(browserDir, "ticks.jsonl"),
    browser: browserManifest.finalState?.stats ? "Google Chrome headless" : null,
  },
  state: {
    provenanceExact,
    exact: stateComparison.exact,
    comparedFrameCount: stateComparison.comparedFrameCount,
    comparedThetaCount: stateComparison.comparedThetaCount,
    firstMismatch: stateComparison.firstMismatch,
    physicalCssomPublication: publicationComparison,
  },
  visual: {
    qualified: false,
    strictPixelPass: visual.pass,
    reportPath: visualReportPath,
    worst: visual.worst?.[0] ?? null,
    note: "Motion/state correspondence is evaluated separately. Source fixed-function lighting and color transport are prepared; remaining strict pixel differences keep visual parity unqualified.",
  },
  previewVideo: videoPath,
};
const reportPath = join(outDir, "report.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
const latestPath = join(repoRoot, "bench", "results", "cssgears", "frame-oracle", "latest.json");
await writeFile(latestPath, JSON.stringify({
  schema: "cssgears-frame-oracle-latest@1",
  runId,
  reportPath,
  videoPath,
}, null, 2) + "\n");

if (!provenanceExact || !stateComparison.exact) {
  throw new Error(`Native/browser source-state sequence diverged: ${JSON.stringify(report.state)}`);
}
console.log(JSON.stringify(report, null, 2));

function encodeTriptych({ frameCount: count, nativePattern, browserPattern, diffPattern, videoPath: output }) {
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-framerate", "100/3", "-i", nativePattern,
    "-framerate", "100/3", "-i", browserPattern,
    "-framerate", "100/3", "-i", diffPattern,
    "-filter_complex",
    "[0:v][1:v][2:v]hstack=inputs=3,scale=1920:-2:flags=lanczos[out]",
    "-map", "[out]", "-frames:v", String(count), "-r", "100/3",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", output,
  ], process.env);
}

function compareStateRows(nativeRows, browserRows) {
  const frameCount = Math.min(nativeRows.length, browserRows.length);
  let comparedThetaCount = 0;
  let firstMismatch = null;
  for (let frame = 0; frame < frameCount && !firstMismatch; frame += 1) {
    const expected = nativeRows[frame];
    const actual = browserRows[frame];
    if (expected.tick !== frame || actual.tick !== frame || expected.theta.length !== actual.theta.length) {
      firstMismatch = { frame, expected, actual, reason: "row-contract" };
      break;
    }
    for (let gear = 0; gear < expected.theta.length; gear += 1) {
      comparedThetaCount += 1;
      if (expected.theta[gear] !== actual.theta[gear]) {
        firstMismatch = {
          frame,
          gear,
          expectedTheta: expected.theta[gear],
          actualTheta: actual.theta[gear],
          absoluteDelta: Math.abs(expected.theta[gear] - actual.theta[gear]),
          reason: "theta",
        };
        break;
      }
    }
  }
  if (!firstMismatch && nativeRows.length !== browserRows.length) {
    firstMismatch = { reason: "frame-count", native: nativeRows.length, browser: browserRows.length };
  }
  return {
    exact: firstMismatch === null,
    comparedFrameCount: frameCount,
    comparedThetaCount,
    firstMismatch,
  };
}

function comparePublishedRows(nativeRows, browserRows) {
  let comparedTransformCount = 0;
  let comparedComponentCount = 0;
  let maxAbsoluteDelta = 0;
  let worst = null;
  for (let frame = 0; frame < Math.min(nativeRows.length, browserRows.length); frame += 1) {
    const expected = browserRows[frame]?.logicalTransforms ?? [];
    const actual = browserRows[frame]?.transforms ?? [];
    for (let gear = 0; gear < Math.min(expected.length, actual.length); gear += 1) {
      comparedTransformCount += 1;
      const expectedComponents = matrixComponents(expected[gear]);
      const actualComponents = matrixComponents(actual[gear]);
      for (let component = 0; component < expectedComponents.length; component += 1) {
        comparedComponentCount += 1;
        const absoluteDelta = Math.abs(expectedComponents[component] - actualComponents[component]);
        if (absoluteDelta > maxAbsoluteDelta) {
          maxAbsoluteDelta = absoluteDelta;
          worst = { frame, gear, component, expected: expectedComponents[component], published: actualComponents[component], absoluteDelta };
        }
      }
    }
  }
  return {
    exact: maxAbsoluteDelta === 0,
    comparedTransformCount,
    comparedComponentCount,
    maxAbsoluteDelta,
    worst,
    note: "CSSOM matrix serialization is recorded separately from exact prepared source state; no tolerance is used to qualify it.",
  };
}

function matrixComponents(transform) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) throw new Error(`Prepared CSSOM transform is not matrix3d: ${transform}`);
  const values = match[1].split(",").map((value) => Number(value.trim()));
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Prepared CSSOM matrix is invalid: ${transform}`);
  }
  return values;
}

async function readJsonLines(path) {
  return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function positiveInteger(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new RangeError(`${label} must be a positive integer`);
  return parsed;
}
