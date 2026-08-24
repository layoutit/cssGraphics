#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { CSSGALAXY_VARIANT_COUNTS } from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { CSSGALAXY_FRAME_SEQUENCE_PLAN as plan } from "./frameSequencePlan.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssgalaxy/comparison");
const executable = resolve(resultRoot, "native-galaxy-oracle");
const frameOracle = "/Users/ekrof/.codex/skills/frame-sequence-oracle/scripts/frame-sequence.mjs";
const captureTargets = Object.freeze([
  ...CSSGALAXY_VARIANT_COUNTS.map((count) => Object.freeze({ count, key: String(count),
    label: `cssgalaxy_${count}_native`, completeSourceState: false })),
  Object.freeze({ count: 0, key: "full-native", label: "cssgalaxy_full_source_native",
    completeSourceState: true }),
]);

await mkdir(resultRoot, { recursive: true });
await run("clang", [
  "-std=c11", "-O2", "-Wall", "-Wextra", "-Wno-misleading-indentation",
  resolve(import.meta.dirname, "native-galaxy-oracle.c"), "-lm", "-o", executable,
]);
const reports = [];
for (const target of captureTargets) {
  const root = resolve(resultRoot, target.key, "native");
  const raw = resolve(root, "raw");
  const packaged = resolve(root, "packaged");
  await rm(root, { recursive: true, force: true });
  await mkdir(raw, { recursive: true });
  const capture = await run(executable, [
    "capture", String(plan.seed), String(target.count), String(plan.sourceFrameCount),
    String(plan.sourceFrameStride), raw,
  ]);
  const ppms = (await readdir(raw)).filter((name) => name.endsWith(".ppm")).sort();
  if (ppms.length !== plan.capturedFrameCount) throw new Error(`Native Galaxy ${target.key} frame count drifted`);
  for (let offset = 0; offset < ppms.length; offset += 8) {
    await Promise.all(ppms.slice(offset, offset + 8).map(async (name) => {
      const source = resolve(raw, name);
      const destination = resolve(raw, name.replace(/\.ppm$/u, ".png"));
      const bytes = await readFile(source);
      const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(bytes.subarray(0, 64).toString("ascii"));
      if (!match) throw new Error(`Native Galaxy PPM header drifted: ${source}`);
      const width = Number(match[1]);
      const height = Number(match[2]);
      const pixels = bytes.subarray(Buffer.byteLength(match[0], "ascii"));
      await sharp(pixels, { raw: { width, height, channels: 3 } })
        .png({ compressionLevel: 9 }).toFile(destination);
      await rm(source);
    }));
  }
  await run(process.execPath, [frameOracle, "package", "--frames", raw, "--out", packaged,
    "--label", target.label, "--expected-frames", String(plan.capturedFrameCount),
    "--lead-frames", "20", "--replace"]);
  const report = Object.freeze({
    schema: "cssgalaxy-native-frame-sequence@1",
    renderedPrefixStarCount: target.completeSourceState ? null : target.count,
    renderedCompleteSourceState: target.completeSourceState,
    plan,
    source: Object.freeze({
      revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
      path: "hacks/galaxy.c",
      sha256: "801b7a7ff3749b032974b8dfe9021c2e3998645f138f9beec7e09037e36d66d9",
    }),
    capture: JSON.parse(capture.stdout),
    raw,
    packaged,
  });
  await writeFile(resolve(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  reports.push(report);
  process.stdout.write(`native Galaxy ${target.key}: ${raw}\n`);
}
console.log(JSON.stringify({ resultRoot, reports }, null, 2));

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
