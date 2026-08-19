#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CSSCYCLONE_BANK,
  buildCycloneSourceSequence,
} from "../src/prepare/csscyclone/sourceModel.mjs";

const output = resolve(process.argv[2] ?? "output/cyclone/native/frame-state.bin");
const frameIndex = Number(process.argv[3] ?? 100);
const seed = Number(process.argv[4] ?? CSSCYCLONE_BANK.seed);
const warmupFrames = Number(process.argv[5] ?? CSSCYCLONE_BANK.warmupFrames);
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(warmupFrames) || warmupFrames < 0) {
  throw new RangeError("Cyclone native seed and warmup must be non-negative integers");
}
const bank = {
  ...CSSCYCLONE_BANK,
  seed,
  warmupFrames,
  frameCount: frameIndex + 1,
};
const source = buildCycloneSourceSequence({ bank });
if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= source.frames.length) {
  throw new RangeError("Cyclone native frame index is out of range");
}
const particles = source.frames[frameIndex].particles;
const stride = 16 * 4 + 3 * 4;
const bytes = Buffer.allocUnsafe(8 + particles.length * stride);
bytes.write("CYC2", 0, "ascii");
bytes.writeUInt32LE(particles.length, 4);
for (let particleIndex = 0; particleIndex < particles.length; particleIndex += 1) {
  const particle = particles[particleIndex];
  const offset = 8 + particleIndex * stride;
  for (let value = 0; value < 16; value += 1) bytes.writeFloatLE(particle.matrix[value], offset + value * 4);
  for (let channel = 0; channel < 3; channel += 1) {
    bytes.writeFloatLE(particle.colorRgb[channel], offset + 64 + channel * 4);
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(JSON.stringify({ output, seed, warmupFrames, frameIndex, particleCount: particles.length, bytes: bytes.byteLength }));
