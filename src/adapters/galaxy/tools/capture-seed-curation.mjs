#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { qualifyGalaxySeeds } from "../src/prepare/cssgalaxy/seedQualification.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssgalaxy/seed-curation");
const executable = resolve(resultRoot, "native-galaxy-oracle");
const report = qualifyGalaxySeeds();
const seeds = Object.freeze([...new Set([
  ...report.selectedSeeds,
  ...report.finalists.filter((candidate) => candidate.seed === 191).map(({ seed }) => seed),
])]);
const sourceFrameCount = 1001;
const sourceFrameStride = 100;
const frameWidth = 800;
const frameHeight = 600;

await mkdir(resultRoot, { recursive: true });
await run("clang", [
  "-std=c11", "-O2", "-Wall", "-Wextra", "-Wno-misleading-indentation",
  resolve(import.meta.dirname, "native-galaxy-oracle.c"), "-lm", "-o", executable,
]);

const rows = [];
for (const seed of seeds) {
  const seedRoot = resolve(resultRoot, `seed-${seed}`);
  await rm(seedRoot, { recursive: true, force: true });
  await mkdir(seedRoot, { recursive: true });
  await run(executable, ["capture", String(seed), "1900", String(sourceFrameCount),
    String(sourceFrameStride), seedRoot]);
  const ppms = (await readdir(seedRoot)).filter((name) => name.endsWith(".ppm")).sort();
  const frames = [];
  for (const name of ppms) {
    const source = resolve(seedRoot, name);
    const bytes = await readFile(source);
    const match = /^P6\n(\d+) (\d+)\n255\n/u.exec(bytes.subarray(0, 64).toString("ascii"));
    if (!match) throw new Error(`Native Galaxy PPM header drifted: ${source}`);
    const pixels = bytes.subarray(Buffer.byteLength(match[0], "ascii"));
    frames.push(await sharp(pixels, { raw: { width: frameWidth, height: frameHeight, channels: 3 } })
      .resize(400, 300, { kernel: "nearest" }).png().toBuffer());
  }
  const candidate = report.finalists.find((entry) => entry.seed === seed);
  const colors = candidate.preparedStreamColors.generations[0].colors.join(" / ");
  const label = await sharp(Buffer.from(
    `<svg width="1200" height="40" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="1200" height="40" fill="#000"/>` +
    `<text x="12" y="27" fill="#fff" font-family="monospace" font-size="18">` +
    `seed ${seed}  score ${candidate.score.toFixed(3)}  ${colors}` +
    `</text></svg>`)).png().toBuffer();
  const row = await sharp({
    create: { width: 1200, height: 1240, channels: 3, background: "#000" },
  }).composite([
    { input: label, left: 0, top: 0 },
    ...frames.map((input, index) => ({
      input,
      left: (index % 3) * 400,
      top: 40 + Math.floor(index / 3) * 300,
    })),
  ]).png().toBuffer();
  rows.push(row);
}

const contactSheetPath = resolve(resultRoot, "native-seed-candidates-contact-sheet.png");
await sharp({
  create: { width: 1200, height: rows.length * 1240, channels: 3, background: "#000" },
}).composite(rows.map((input, index) => ({ input, left: 0, top: index * 1240 })))
  .png({ compressionLevel: 9 }).toFile(contactSheetPath);
const evidence = Object.freeze({
  schema: "cssgalaxy-native-seed-curation-evidence@1",
  sourceRenderer: "native-galaxy-oracle.c",
  renderedPrefixStarCount: 1900,
  sourceFrameCount,
  sourceFrameStride,
  capturedFrameCount: Math.ceil(sourceFrameCount / sourceFrameStride),
  seeds,
  contactSheetPath,
});
await writeFile(resolve(resultRoot, "native-contact-sheet-report.json"),
  `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));

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
