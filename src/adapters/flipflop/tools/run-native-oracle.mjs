#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  buildFlipFlopSourceFrames,
  CSSFLIPFLOP_SEED,
  FLIPFLOP_BANKS,
  FLIPFLOP_SOURCE,
} from "../src/prepare/cssflipflop/sourceModel.mjs";

const TILE_ANGLE_TOLERANCE = 0.000002;
const BOARD_THETA_TOLERANCE = 0.00001;
const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const sourceRoot = resolveRequiredSourceRoot();
const outputRoot = resolve(process.env.CSSFLIPFLOP_NATIVE_ORACLE_OUT ??
  join(repositoryRoot, "build/oracle/cssflipflop/native"));
const ticks = Object.freeze([0, 180, 599]);
const bankRuns = Object.freeze([
  Object.freeze({ bank: FLIPFLOP_BANKS.desktop, viewport: Object.freeze({ width: 960, height: 600 }) }),
  Object.freeze({ bank: FLIPFLOP_BANKS.mobile, viewport: Object.freeze({ width: 390, height: 844 }) }),
]);

await assertSourceBytes();
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const binary = await compileCapture();
const banks = [];
for (const bankRun of bankRuns) banks.push(await captureBank(binary, bankRun));
const report = Object.freeze({
  schema: "cssflipflop-native-oracle@2",
  status: "source-state-aligned",
  source: {
    revision: FLIPFLOP_SOURCE.commit,
    path: FLIPFLOP_SOURCE.primaryPath,
    sha256: FLIPFLOP_SOURCE.primarySha256,
  },
  seed: CSSFLIPFLOP_SEED,
  ticks,
  banks,
  renderer: "headless-macos-cgl-opengl-legacy",
  binarySha256: sha256(await readFile(binary)),
  visualParity: "unqualified",
});
await writeFile(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, outputRoot }, null, 2));

async function captureBank(binary, { bank, viewport }) {
  const bankRoot = join(outputRoot, bank.id);
  const framesRoot = join(bankRoot, "frames");
  const statesPath = join(bankRoot, "states.jsonl");
  await mkdir(framesRoot, { recursive: true });
  const capture = spawnSync(binary, [
    framesRoot,
    statesPath,
    String(CSSFLIPFLOP_SEED),
    String(viewport.width),
    String(viewport.height),
    String(bank.boardWidth),
    String(bank.boardDepth),
    ...ticks.map((tick) => String(tick + 1)),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (capture.error) throw capture.error;
  if (capture.status !== 0) {
    throw new Error(`Native Flip Flop ${bank.id} capture failed:\n${capture.stderr || capture.stdout}`);
  }
  const nativeStates = (await readFile(statesPath, "utf8")).trim().split("\n").map(JSON.parse);
  const prepared = buildFlipFlopSourceFrames({ bankId: bank.id });
  const comparisons = nativeStates.map((native) => compareState(native, prepared.frames[native.tick]));
  if (comparisons.some((comparison) => !comparison.exact)) {
    throw new Error(`Flip Flop ${bank.id} native state comparison diverged: ${JSON.stringify(comparisons)}`);
  }
  for (const name of (await readdir(framesRoot)).filter((value) => value.endsWith(".ppm"))) {
    const png = ppmToPng(await readFile(join(framesRoot, name)));
    await writeFile(join(framesRoot, name.replace(/\.ppm$/u, ".png")), png);
  }
  return Object.freeze({
    id: bank.id,
    board: Object.freeze({ width: bank.boardWidth, depth: bank.boardDepth }),
    tileCount: bank.tileCount,
    viewport,
    comparisons,
  });
}

async function compileCapture() {
  const binary = join(outputRoot, "capture-flipflop");
  const include = join(adapterRoot, "tools/native/headless/include");
  const glx = join(sourceRoot, "hacks/glx");
  const utils = join(sourceRoot, "utils");
  const result = spawnSync(process.env.CC || "clang", [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations", "-DSTANDALONE",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-include", join(include, "xlockmore.h"),
    "-I", include, "-I", glx, "-I", utils,
    join(adapterRoot, "tools/native/headless/capture-flipflop.c"),
    join(glx, "gltrackball.c"), join(glx, "trackball.c"), join(glx, "quaternion.c"),
    join(utils, "yarandom.c"),
    "-framework", "OpenGL", "-lm", "-o", binary,
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to compile native flipflop.c capture:\n${result.stderr || result.stdout}`);
  await chmod(binary, 0o755);
  return binary;
}

function compareState(native, preparedFrame) {
  const mismatches = [];
  for (const tile of native.tiles) {
    const prepared = preparedFrame.tiles[tile.index];
    if (!prepared) {
      mismatches.push(tile.index);
      continue;
    }
    if (prepared.x !== tile.x || prepared.z !== tile.z || prepared.direction !== tile.direction ||
        Math.abs(prepared.angle - tile.angle) > TILE_ANGLE_TOLERANCE) mismatches.push(tile.index);
  }
  return Object.freeze({
    tick: native.tick,
    exact: native.tiles.length === preparedFrame.tiles.length && mismatches.length === 0 &&
      Math.abs(preparedFrame.theta - native.theta) < BOARD_THETA_TOLERANCE,
    mismatches,
    thetaError: Math.abs(preparedFrame.theta - native.theta),
  });
}

async function assertSourceBytes() {
  const bytes = await readFile(join(sourceRoot, FLIPFLOP_SOURCE.primaryPath));
  if (sha256(bytes) !== FLIPFLOP_SOURCE.primarySha256) throw new Error("Flip Flop oracle source bytes drifted");
}

function resolveRequiredSourceRoot() {
  const value = process.env.CSSFLIPFLOP_SOURCE_ROOT;
  if (!value) throw new Error("Set CSSFLIPFLOP_SOURCE_ROOT to the pinned XScreenSaver checkout");
  return resolve(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ppmToPng(bytes) {
  const header = bytes.subarray(0, 64).toString("ascii").match(/^P6\s+(\d+)\s+(\d+)\s+255\s/u);
  if (!header) throw new Error("Flip Flop native capture emitted an invalid PPM header");
  const width = Number(header[1]);
  const height = Number(header[2]);
  const rgb = bytes.subarray(Buffer.byteLength(header[0]));
  if (rgb.length !== width * height * 3) throw new Error("Flip Flop native capture emitted invalid PPM pixels");
  const png = new PNG({ width, height });
  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    png.data[target] = rgb[source];
    png.data[target + 1] = rgb[source + 1];
    png.data[target + 2] = rgb[source + 2];
    png.data[target + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 6, filterType: 4, deflateLevel: 9, deflateStrategy: 3 });
}
