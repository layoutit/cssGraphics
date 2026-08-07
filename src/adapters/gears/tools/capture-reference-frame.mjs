#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCssgearsDataSource, SOURCE_COMMIT } from "../src/prepare/cssgears/dataSource.mjs";
import { captureNativeGears, CSSGEARS_NATIVE_SEED } from "../src/prepare/cssgears/nativeOracle.mjs";

const outDir = join("bench", "results", "cssgears", "reference");
const framesDir = join(outDir, "frames");
const seed = Number(process.env.CSSGEARS_NATIVE_SEED ?? CSSGEARS_NATIVE_SEED);
const dataSource = await resolveCssgearsDataSource();
const capture = await captureNativeGears(dataSource.root, { seed });
await mkdir(framesDir, { recursive: true });

const framePath = join(framesDir, "frame_0000.ppm");
const previewPath = join(outDir, "frame.png");
const statePath = join(outDir, "state.json");
await copyFile(capture.framePath, framePath);
await copyFile(capture.statePath, statePath);
const preview = spawnSync("sips", ["-s", "format", "png", framePath, "--out", previewPath], { encoding: "utf8" });
if (preview.status !== 0) throw new Error(`Unable to generate native PNG preview:\n${preview.stderr || preview.stdout}`);

const manifest = {
  schema: "cssgears-native-reference-capture@1",
  qualification: "native-source-frame",
  headless: true,
  renderer: "macOS CGL legacy fixed-function OpenGL framebuffer",
  sourceRevision: SOURCE_COMMIT,
  seed: capture.seed,
  viewport: { width: capture.width, height: capture.height },
  stateSha256: capture.stateSha256,
  frameSha256: capture.frameSha256,
  gearCount: capture.state.gearCount,
  polygonCount: capture.state.polygonCount,
  framePath,
  previewPath,
  statePath,
};
await writeFile(join(outDir, "capture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
