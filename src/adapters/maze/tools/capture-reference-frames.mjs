#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const headless = process.env.CSS_REFERENCE_CAPTURE_HEADLESS ?? "1";
const allowVisible = process.env.CSS_REFERENCE_CAPTURE_ALLOW_VISIBLE ?? "0";
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const startTick = Number.parseInt(args[0] ?? "390", 10);
const count = Number.parseInt(args[1] ?? "61", 10);
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "build/generated/public/cssmaze/manifest.json"), "utf8"));
const defaultEntry = manifest.scenes?.find((entry) => entry.id === manifest.defaultScene?.id);
const seed = Number.parseInt(process.env.CSSMAZE_SEED ?? String(defaultEntry?.nativeSeed), 10);
const sourceRoot = process.env.CSSMAZE_SOURCE_ROOT;
const framesDir = resolve(process.env.CSSMAZE_REFERENCE_FRAME_SEQUENCE_DIR ?? "bench/results/cssmaze/reference-frames/frames");
const framePattern = "frame_%04d.ppm";
if (headless !== "1" || allowVisible === "1") {
  throw new Error("cssMaze reference sequence capture is headless-only; visible-window opt-in is blocked");
}
if (!Number.isSafeInteger(startTick) || startTick < 0 || !Number.isSafeInteger(count) || count < 1 || count > 600 ||
    !Number.isSafeInteger(seed) || seed < 1) {
  throw new RangeError("usage: capture-reference-frames [startTick>=0] [count 1..600]");
}
if (!sourceRoot) throw new Error("CSSMAZE_SOURCE_ROOT is required for pinned native textures");

const source = join(root, "native/maze3d-oracle.c");
const binaryDir = join(root, ".local/build/bin");
const binary = join(binaryDir, "maze3d-oracle");
const pkgConfig = spawnSync("pkg-config", ["--cflags", "--libs", "glfw3", "libpng"], {
  cwd: root,
  encoding: "utf8",
  timeout: 30_000,
});
if (pkgConfig.status !== 0) throw new Error(`Native oracle dependencies are unavailable:\n${pkgConfig.stderr}`);
await mkdir(binaryDir, { recursive: true });
await mkdir(framesDir, { recursive: true });
const compile = spawnSync("cc", [
  "-std=c11", "-O2", "-D_DARWIN_C_SOURCE", "-DGL_SILENCE_DEPRECATION",
  source,
  ...pkgConfig.stdout.trim().split(/\s+/u),
  "-framework", "OpenGL", "-lm", "-o", binary,
], { cwd: root, encoding: "utf8", timeout: 60_000 });
if (compile.status !== 0) throw new Error(`Failed to compile native visual oracle:\n${compile.stderr || compile.stdout}`);

const texture = (name) => join(resolve(sourceRoot), "hacks/images", name);
const capture = spawnSync(binary, [
  String(seed), String(startTick), String(count), framesDir,
  texture("brick1.png"), texture("wood2.png"), texture("brick2.png"),
], { cwd: root, encoding: "utf8", timeout: 120_000 });
if (capture.status !== 0) throw new Error(`Native visual oracle failed:\n${capture.stderr || capture.stdout}`);
console.log(JSON.stringify({
  status: "captured",
  qualification: "shared-first-slice-source-renderer",
  renderer: "hidden native OpenGL 2.1",
  seed,
  startTick,
  count,
  framesDir,
  framePattern,
  native: JSON.parse(capture.stdout),
}, null, 2));
