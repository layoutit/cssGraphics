import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { adapterRoot, localRoot } from "./paths.mjs";
import { CSSMENGER_SEED } from "./sourcePlayback.mjs";
import { SOURCE_COMMIT, SOURCE_TREE } from "./dataSource.mjs";

export const CSSMENGER_NATIVE_VIEWPORT = Object.freeze({ width: 960, height: 600 });

const CAPTURE_SOURCE = join(adapterRoot, "tools/native/headless/capture-menger.c");
const CAPTURE_INCLUDE = join(adapterRoot, "tools/native/headless/include");
const COPIED_UTILITY_FILES = Object.freeze([
  "colors.c",
  "colors.h",
  "hsv.c",
  "hsv.h",
]);

export async function captureNativeMenger(sourceRoot, options = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The cssMenger no-window native oracle currently requires macOS CGL.");
  }
  const root = resolve(sourceRoot);
  const seed = positiveInteger(options.seed, CSSMENGER_SEED, "native seed");
  const width = positiveInteger(options.width, CSSMENGER_NATIVE_VIEWPORT.width, "native width");
  const height = positiveInteger(options.height, CSSMENGER_NATIVE_VIEWPORT.height, "native height");
  const ticks = normalizeTicks(options.ticks ?? [0]);
  const outputDir = resolve(options.outputDir ?? join(localRoot, "native-oracle", `seed-${seed}-${width}x${height}`));
  const framesDir = join(outputDir, "frames");
  const statesPath = join(outputDir, "states.jsonl");
  const bindingPath = join(outputDir, "native-binding.json");
  const compiled = await compileNativeCapture(root);
  await mkdir(framesDir, { recursive: true });

  const result = spawnSync(compiled.binary, [
    framesDir,
    statesPath,
    String(seed),
    String(width),
    String(height),
    ...ticks.map((tick) => String(tick + 1)),
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Headless native menger.c capture failed:\n${result.stderr || result.stdout}`);
  }

  const frameNames = (await readdir(framesDir))
    .filter((name) => /^frame_\d{4}\.ppm$/u.test(name))
    .sort();
  if (frameNames.length !== ticks.length) {
    throw new Error(`Headless native menger.c wrote ${frameNames.length} of ${ticks.length} frames`);
  }
  const statesBytes = await readFile(statesPath);
  const states = parseJsonLines(statesBytes.toString("utf8"));
  validateNativeStates(states, ticks);
  const sequenceIdentity = createHash("sha256");
  for (const name of frameNames) sequenceIdentity.update(name).update(await readFile(join(framesDir, name)));
  const rendererPath = join(framesDir, "native-renderer.json");
  const renderer = JSON.parse(await readFile(rendererPath, "utf8"));
  const binding = Object.freeze({
    schema: "cssmenger-native-binding@1",
    sourceRoot: root,
    sourceRevision: compiled.sourceRevision,
    sourceTree: compiled.sourceTree,
    compiler: compiled.compiler,
    compilerVersion: compiled.compilerVersion,
    sdk: compiled.sdk,
    compileFlags: compiled.compileFlags,
    executableSha256: compiled.executableSha256,
    inputs: compiled.inputs,
    seed,
    ticks,
    viewport: { width, height },
    renderer,
  });
  await writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
  return Object.freeze({
    schema: "cssmenger-native-frame-sequence@1",
    seed,
    width,
    height,
    ticks,
    frameCount: ticks.length,
    outputDir,
    framesDir,
    statesPath,
    bindingPath,
    rendererPath,
    statesSha256: sha256(statesBytes),
    frame0Sha256: sha256(await readFile(join(framesDir, frameNames[0]))),
    sequenceSha256: sequenceIdentity.digest("hex"),
    states: deepFreeze(states),
    binding: deepFreeze(binding),
  });
}

async function compileNativeCapture(sourceRoot) {
  const sdk = await resolveOpenGlSdk();
  const compiler = process.env.CC || "clang";
  const sourceRevision = git(sourceRoot, "rev-parse", "HEAD");
  const sourceTree = git(sourceRoot, "rev-parse", "HEAD^{tree}");
  if (sourceRevision !== SOURCE_COMMIT || sourceTree !== SOURCE_TREE) {
    throw new Error(`Native Menger oracle source identity mismatch: ${sourceRevision}/${sourceTree}`);
  }
  const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
  if (version.error) throw version.error;
  if (version.status !== 0) throw new Error(version.stderr || `Unable to identify compiler ${compiler}`);
  const compilerVersion = version.stdout.split("\n")[0];
  const sourceFiles = [
    CAPTURE_SOURCE,
    join(CAPTURE_INCLUDE, "screenhackI.h"),
    join(CAPTURE_INCLUDE, "xlockmore.h"),
    join(CAPTURE_INCLUDE, "utils.h"),
    join(CAPTURE_INCLUDE, "visual.h"),
    join(sourceRoot, "hacks/glx/menger.c"),
    join(sourceRoot, "hacks/glx/rotator.c"),
    join(sourceRoot, "hacks/glx/rotator.h"),
    join(sourceRoot, "hacks/glx/gltrackball.h"),
    join(sourceRoot, "hacks/glx/quaternion.h"),
    join(sourceRoot, "utils/yarandom.c"),
    join(sourceRoot, "utils/yarandom.h"),
    ...COPIED_UTILITY_FILES.map((name) => join(sourceRoot, "utils", name)),
  ];
  const inputRows = [];
  const identity = createHash("sha256").update(sdk).update(compiler).update(compilerVersion);
  for (const path of sourceFiles) {
    const bytes = await readFile(path);
    const digest = sha256(bytes);
    identity.update(path).update(bytes);
    inputRows.push(Object.freeze({ path, sha256: digest, bytes: bytes.length }));
  }
  const key = identity.digest("hex").slice(0, 20);
  const binaryDir = join(localRoot, "bin");
  const buildDir = join(localRoot, "native-build", key);
  const binary = join(binaryDir, `capture-native-menger-${key}`);
  const compileFlags = [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-isysroot", sdk,
    "-I", CAPTURE_INCLUDE,
    "-I", buildDir,
    "-I", resolve(sourceRoot, "hacks/glx"),
    "-I", resolve(sourceRoot, "utils"),
  ];
  if (!await readable(binary)) {
    await mkdir(binaryDir, { recursive: true });
    await mkdir(buildDir, { recursive: true });
    for (const name of COPIED_UTILITY_FILES) {
      await copyFile(join(sourceRoot, "utils", name), join(buildDir, name));
    }
    const temporary = `${binary}.tmp-${process.pid}`;
    const result = spawnSync(compiler, [
      ...compileFlags,
      CAPTURE_SOURCE,
      resolve(sourceRoot, "hacks/glx/rotator.c"),
      resolve(sourceRoot, "utils/yarandom.c"),
      join(buildDir, "colors.c"),
      join(buildDir, "hsv.c"),
      "-framework", "OpenGL", "-lm", "-o", temporary,
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Unable to compile the headless native menger.c oracle:\n${result.stderr || result.stdout}`);
    }
    await chmod(temporary, 0o755);
    await rename(temporary, binary);
  }
  return Object.freeze({
    binary,
    sdk,
    compiler,
    compilerVersion,
    compileFlags,
    executableSha256: sha256(await readFile(binary)),
    sourceRevision,
    sourceTree,
    inputs: Object.freeze(inputRows),
  });
}

async function resolveOpenGlSdk() {
  const configured = process.env.CSSMENGER_MACOS_SDK;
  if (configured) {
    const sdk = resolve(configured);
    if (!await readable(openGlHeader(sdk))) throw new Error(`CSSMENGER_MACOS_SDK is missing OpenGL headers: ${sdk}`);
    return sdk;
  }
  const xcrun = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  if (xcrun.status === 0) {
    const sdk = xcrun.stdout.trim();
    if (await readable(openGlHeader(sdk))) return sdk;
  }
  const roots = [
    "/Library/Developer/CommandLineTools/SDKs",
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs",
  ];
  const candidates = [];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && /^MacOSX.*\.sdk$/u.test(entry.name)) candidates.push(join(root, entry.name));
    }
  }
  candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const sdk of candidates) if (await readable(openGlHeader(sdk))) return sdk;
  throw new Error("No installed macOS SDK contains legacy OpenGL headers. Set CSSMENGER_MACOS_SDK.");
}

function validateNativeStates(states, ticks) {
  if (states.length !== ticks.length) throw new Error("Native Menger state sequence is incomplete");
  for (let index = 0; index < states.length; index += 1) {
    const row = states[index];
    if (row?.tick !== ticks[index] || row.depth !== 3 || row.polygonCount !== 18_048 ||
        !Array.isArray(row.rotationFractions) || row.rotationFractions.length !== 3 ||
        !Array.isArray(row.paletteIndices) || row.paletteIndices.length !== 3 ||
        !Array.isArray(row.paletteSource16) || row.paletteSource16.length !== 3) {
      throw new Error(`Native Menger state contract drifted at sample ${index}`);
    }
  }
}

function normalizeTicks(values) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError("native ticks must be a non-empty array");
  const ticks = values.map(Number);
  if (ticks.some((tick, index) => !Number.isSafeInteger(tick) || tick < 0 || (index > 0 && tick <= ticks[index - 1]))) {
    throw new RangeError("native ticks must be strictly increasing non-negative safe integers");
  }
  return Object.freeze(ticks);
}

function parseJsonLines(text) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function positiveInteger(value, fallback, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function openGlHeader(sdk) {
  return join(sdk, "System/Library/Frameworks/OpenGL.framework/Versions/A/Headers/OpenGL.h");
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
