#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = join("bench", "results", "cssgears", "reference-frames");
const framesDir = join(outDir, "frames");
const framePattern = join(framesDir, "frame_%04d.ppm");
const command = process.env.CSS_REFERENCE_FRAME_SEQUENCE_CMD ?? "";
const expectedFrames = process.env.CSS_FRAME_SEQUENCE_EXPECTED_FRAMES ?? "120";
const allowVisible = process.env.CSS_REFERENCE_CAPTURE_ALLOW_VISIBLE === "1";

if (!command) {
  console.error("Set CSS_REFERENCE_FRAME_SEQUENCE_CMD to a headless native/source command that writes numbered frames. Placeholders: {frames}, {pattern}, {out}.");
  process.exitCode = 1;
} else if (allowVisible) {
  console.error("Visible frame-sequence capture is not oracle-safe. Add a headless/no-window frame dump route before claiming gameplay evidence.");
  process.exitCode = 1;
} else {
  await mkdir(framesDir, { recursive: true });
  const commandLine = command
    .replaceAll("{frames}", framesDir)
    .replaceAll("{pattern}", framePattern)
    .replaceAll("{out}", outDir);
  const oracleEnv = {
    ...process.env,
    CSS_REFERENCE_CAPTURE_OUT_DIR: outDir,
    CSS_REFERENCE_FRAME_SEQUENCE_DIR: framesDir,
    CSS_REFERENCE_FRAME_SEQUENCE_PATTERN: framePattern,
    CSS_REFERENCE_CAPTURE_HEADLESS: "1",
    CSS_FRAME_SEQUENCE_EXPECTED_FRAMES: expectedFrames,
    SDL_VIDEODRIVER: process.env.SDL_VIDEODRIVER ?? "dummy",
    QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen",
  };
  const child = spawn(commandLine, {
    shell: true,
    stdio: "inherit",
    env: oracleEnv,
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  await writeFile(join(outDir, "frame-sequence-command.txt"), commandLine + "\n");
  await writeFile(join(outDir, "frame-sequence-env.json"), JSON.stringify({
    CSS_REFERENCE_CAPTURE_HEADLESS: oracleEnv.CSS_REFERENCE_CAPTURE_HEADLESS,
    CSS_FRAME_SEQUENCE_EXPECTED_FRAMES: oracleEnv.CSS_FRAME_SEQUENCE_EXPECTED_FRAMES,
    SDL_VIDEODRIVER: oracleEnv.SDL_VIDEODRIVER,
    QT_QPA_PLATFORM: oracleEnv.QT_QPA_PLATFORM,
  }, null, 2) + "\n");
  process.exitCode = code ?? 1;
}
