import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { adapterRoot, localRoot } from "./paths.mjs";

export const CSSGEARS_NATIVE_SEED = 26080601;
export const CSSGEARS_NATIVE_VIEWPORT = Object.freeze({ width: 720, height: 720 });

const CAPTURE_SOURCE = join(adapterRoot, "tools/native/headless/capture-gears.c");
const CAPTURE_INCLUDE = join(adapterRoot, "tools/native/headless/include");

export async function captureNativeGears(sourceRoot, options = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The cssGears no-window native oracle currently requires macOS CGL.");
  }
  const seed = positiveInteger(options.seed, CSSGEARS_NATIVE_SEED, "native seed");
  const width = positiveInteger(options.width, CSSGEARS_NATIVE_VIEWPORT.width, "native width");
  const height = positiveInteger(options.height, CSSGEARS_NATIVE_VIEWPORT.height, "native height");
  const viewRotationDegrees = optionalRotationDegrees(options.viewRotationDegrees);
  const viewKey = viewRotationDegrees ? `-view-${sha256(JSON.stringify(viewRotationDegrees)).slice(0, 12)}` : "";
  const outputDir = resolve(options.outputDir ?? join(localRoot, "native-oracle", `seed-${seed}-${width}x${height}${viewKey}`));
  const framePath = join(outputDir, "frame.ppm");
  const statePath = join(outputDir, "state.json");
  const binary = await compileNativeCapture(sourceRoot);
  await mkdir(outputDir, { recursive: true });

  const args = [String(seed), String(width), String(height), framePath, statePath];
  if (viewRotationDegrees) args.push(...viewRotationDegrees.map(String));
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Headless native gears.c capture failed:\n${result.stderr || result.stdout}`);
  }

  const stateBytes = await readFile(statePath);
  const frameBytes = await readFile(framePath);
  const state = JSON.parse(stateBytes);
  validateNativeState(state, { seed, width, height });
  return Object.freeze({
    schema: "cssgears-native-capture@1",
    seed,
    width,
    height,
    outputDir,
    framePath,
    statePath,
    frameSha256: sha256(frameBytes),
    stateSha256: sha256(stateBytes),
    viewRotationDegrees,
    state: deepFreeze(state),
  });
}

export async function captureNativeGearsFrameSequence(sourceRoot, options = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The cssGears no-window native frame oracle currently requires macOS CGL.");
  }
  const seed = positiveInteger(options.seed, CSSGEARS_NATIVE_SEED, "native seed");
  const width = positiveInteger(options.width, CSSGEARS_NATIVE_VIEWPORT.width, "native width");
  const height = positiveInteger(options.height, CSSGEARS_NATIVE_VIEWPORT.height, "native height");
  const frameCount = positiveInteger(options.frameCount, 120, "native frame count");
  const viewRotationDegrees = optionalRotationDegrees(options.viewRotationDegrees);
  const viewKey = viewRotationDegrees ? `-view-${sha256(JSON.stringify(viewRotationDegrees)).slice(0, 12)}` : "";
  const outputDir = resolve(options.outputDir ?? join(localRoot, "native-oracle", `sequence-${seed}-${width}x${height}-${frameCount}${viewKey}`));
  const framesDir = join(outputDir, "frames");
  const framePattern = join(framesDir, "frame_%04d.ppm");
  const statePath = join(outputDir, "state.json");
  const ticksPath = join(outputDir, "ticks.jsonl");
  const binary = await compileNativeCapture(sourceRoot);
  await mkdir(framesDir, { recursive: true });

  const args = [
    String(seed), String(width), String(height), framePattern, statePath,
    String(frameCount), ticksPath,
  ];
  if (viewRotationDegrees) args.push(...viewRotationDegrees.map(String));
  const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Headless native gears.c frame capture failed:\n${result.stderr || result.stdout}`);
  }

  const frameNames = (await readdir(framesDir)).filter((name) => /^frame_\d{4}\.ppm$/u.test(name)).sort();
  if (frameNames.length !== frameCount) {
    throw new Error(`Headless native gears.c wrote ${frameNames.length} of ${frameCount} frames`);
  }
  const stateBytes = await readFile(statePath);
  const state = JSON.parse(stateBytes);
  validateNativeState(state, { seed, width, height });
  const ticks = (await readFile(ticksPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (ticks.length !== frameCount || ticks.some((row, index) => row.tick !== index || row.theta?.length !== state.gearCount)) {
    throw new Error("Headless native gears.c tick sequence is incomplete");
  }
  const sequenceIdentity = createHash("sha256");
  for (const name of frameNames) sequenceIdentity.update(name).update(await readFile(join(framesDir, name)));
  return Object.freeze({
    schema: "cssgears-native-frame-sequence@1",
    seed,
    width,
    height,
    frameCount,
    outputDir,
    framesDir,
    framePattern,
    statePath,
    ticksPath,
    stateSha256: sha256(stateBytes),
    frame0Sha256: sha256(await readFile(join(framesDir, frameNames[0]))),
    sequenceSha256: sequenceIdentity.digest("hex"),
    viewRotationDegrees,
    state: deepFreeze(state),
    ticks: deepFreeze(ticks),
  });
}

export async function publishNativeCapture(capture, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const framePath = join(outputDir, "frame.ppm");
  const statePath = join(outputDir, "state.json");
  await copyFile(capture.framePath, framePath);
  await copyFile(capture.statePath, statePath);
  return Object.freeze({ ...capture, outputDir, framePath, statePath });
}

async function compileNativeCapture(sourceRoot) {
  const sdk = await resolveOpenGlSdk();
  const sourceFiles = [
    CAPTURE_SOURCE,
    join(CAPTURE_INCLUDE, "screenhackI.h"),
    join(CAPTURE_INCLUDE, "xlockmore.h"),
    join(sourceRoot, "hacks/glx/gears.c"),
    join(sourceRoot, "hacks/glx/involute.c"),
    join(sourceRoot, "hacks/glx/involute.h"),
    join(sourceRoot, "hacks/glx/normals.c"),
    join(sourceRoot, "hacks/glx/normals.h"),
    join(sourceRoot, "hacks/glx/rotator.c"),
    join(sourceRoot, "hacks/glx/rotator.h"),
    join(sourceRoot, "hacks/glx/tube.h"),
    join(sourceRoot, "hacks/glx/gltrackball.h"),
    join(sourceRoot, "hacks/glx/quaternion.h"),
    join(sourceRoot, "utils/yarandom.c"),
    join(sourceRoot, "utils/yarandom.h"),
  ];
  const identity = createHash("sha256").update(sdk);
  for (const path of sourceFiles) identity.update(await readFile(path));
  const key = identity.digest("hex").slice(0, 20);
  const binaryDir = join(localRoot, "bin");
  const binary = join(binaryDir, `capture-native-gears-${key}`);
  if (await readable(binary)) return binary;

  await mkdir(binaryDir, { recursive: true });
  const temporary = `${binary}.tmp-${process.pid}`;
  const compiler = process.env.CC || "clang";
  const result = spawnSync(compiler, [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-isysroot", sdk,
    "-I", CAPTURE_INCLUDE,
    "-I", resolve(sourceRoot, "hacks/glx"),
    "-I", resolve(sourceRoot, "utils"),
    CAPTURE_SOURCE,
    resolve(sourceRoot, "hacks/glx/involute.c"),
    resolve(sourceRoot, "hacks/glx/normals.c"),
    resolve(sourceRoot, "hacks/glx/rotator.c"),
    resolve(sourceRoot, "utils/yarandom.c"),
    "-framework", "OpenGL", "-lm", "-o", temporary,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to compile the headless native gears.c oracle:\n${result.stderr || result.stdout}`);
  }
  await chmod(temporary, 0o755);
  await rename(temporary, binary);
  return binary;
}

async function resolveOpenGlSdk() {
  const configured = process.env.CSSGEARS_MACOS_SDK;
  if (configured) {
    const sdk = resolve(configured);
    await assertOpenGlHeaders(sdk);
    return sdk;
  }
  const roots = [
    "/Library/Developer/CommandLineTools/SDKs",
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs",
  ];
  const candidates = [];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && /^MacOSX.*\.sdk$/.test(entry.name)) candidates.push(join(root, entry.name));
    }
  }
  candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const sdk of candidates) {
    if (await readable(openGlHeader(sdk))) return sdk;
  }
  throw new Error("No installed macOS SDK contains legacy OpenGL headers. Set CSSGEARS_MACOS_SDK to an SDK with OpenGL.framework headers.");
}

async function assertOpenGlHeaders(sdk) {
  if (!await readable(openGlHeader(sdk))) {
    throw new Error(`CSSGEARS_MACOS_SDK is missing OpenGL.framework headers: ${sdk}`);
  }
}

function openGlHeader(sdk) {
  return join(sdk, "System/Library/Frameworks/OpenGL.framework/Versions/A/Headers/OpenGL.h");
}

function validateNativeState(state, expected) {
  const polygonCount = state?.gears?.reduce((sum, gear) => sum + gear.polygons, 0);
  if (state?.schema !== "cssgears-native-state@1" ||
      state.seed !== expected.seed ||
      state.viewport?.width !== expected.width || state.viewport?.height !== expected.height ||
      state.planetary !== false || !Array.isArray(state.gears) || state.gears.length < 3 ||
      state.gearCount !== state.gears.length || state.polygonCount !== polygonCount ||
      state.scene?.trackball !== "identity" || state.sourceConfig?.spin !== false ||
      state.sourceConfig?.wander !== false) {
    throw new Error("Headless native gears.c state contract drifted.");
  }
}

function positiveInteger(value, fallback, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

function optionalRotationDegrees(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length !== 3 || value.some((component) => !Number.isFinite(component))) {
    throw new TypeError("Native view rotation must contain three finite degree values");
  }
  return Object.freeze([...value]);
}

async function readable(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
