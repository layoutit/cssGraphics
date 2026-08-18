#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CSSPLATONIC_SEED, PLATONIC_SOURCE } from "../../src/prepare/cssplatonicfolding/sourceModel.mjs";
import { adapterRoot, assertReadable, oracleRoot, writeJson } from "./oracle-support.mjs";
import { resolvePlatonicOracleFrames } from "./frame-schedule.mjs";

export async function captureNativePlatonicFrames(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? requiredSourceRoot());
  const frames = options.frames ?? resolvePlatonicOracleFrames();
  const width = positiveInteger(options.width, 960, "native width");
  const height = positiveInteger(options.height, 600, "native height");
  const outputDir = resolve(options.outputDir ?? join(oracleRoot, "native", "capture"));
  const framesDir = join(outputDir, "frames");
  const executable = join(outputDir, "capture-platonicfolding");
  const primaryPath = join(sourceRoot, PLATONIC_SOURCE.primaryPath);
  await assertReadable(primaryPath, "pinned platonicfolding.c");
  const sourceCommit = run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]).stdout.trim();
  const primarySha256 = sha256(await readFile(primaryPath));
  if (sourceCommit !== PLATONIC_SOURCE.commit || primarySha256 !== PLATONIC_SOURCE.primarySha256) {
    throw new Error(`Platonic Folding source identity mismatch: ${JSON.stringify({ sourceCommit, primarySha256 })}`);
  }
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  compileCapture({ sourceRoot, executable });
  run(executable, [framesDir, String(CSSPLATONIC_SEED), String(width), String(height), ...frames.map(String)]);
  const manifest = {
    schema: "cssplatonicfolding-native-frame-sequence@1",
    source: { root: sourceRoot, commit: sourceCommit, primaryPath: PLATONIC_SOURCE.primaryPath, primarySha256 },
    renderer: "pinned polygon_folding_pf GLSL path in a CGL legacy offscreen framebuffer",
    seed: CSSPLATONIC_SEED,
    frames,
    frameCount: frames.length,
    viewport: { width, height },
    framesDir,
  };
  const manifestPath = join(outputDir, "native-capture.json");
  await writeJson(manifestPath, manifest);
  return Object.freeze({ ...manifest, manifestPath });
}

function compileCapture({ sourceRoot, executable }) {
  const includeRoot = join(adapterRoot, "tools", "native", "headless", "include");
  const source = join(adapterRoot, "tools", "native", "headless", "capture-platonicfolding.c");
  const glx = join(sourceRoot, "hacks", "glx");
  const utils = join(sourceRoot, "utils");
  run("clang", [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DSTANDALONE", "-DUSE_GL", "-DHAVE_GLSL", "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-include", join(includeRoot, "xlockmore.h"),
    "-I", includeRoot, "-I", glx, "-I", utils,
    source,
    join(glx, "glsl-utils.c"),
    join(glx, "gltrackball.c"),
    join(glx, "trackball.c"),
    join(glx, "quaternion.c"),
    join(utils, "yarandom.c"),
    "-framework", "OpenGL", "-lm", "-o", executable,
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} exited ${result.status}`);
  return result;
}

function requiredSourceRoot() {
  if (!process.env.CSSPLATONICFOLDING_SOURCE_ROOT) {
    throw new Error("Set CSSPLATONICFOLDING_SOURCE_ROOT to the pinned XScreenSaver checkout");
  }
  return process.env.CSSPLATONICFOLDING_SOURCE_ROOT;
}

function positiveInteger(value, fallback, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureNativePlatonicFrames().then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
