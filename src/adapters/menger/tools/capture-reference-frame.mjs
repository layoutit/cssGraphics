#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = join("bench", "results", "cssmenger", "reference");
const command = process.env.CSS_REFERENCE_CAPTURE_CMD ?? "";
const allowVisible = process.env.CSS_REFERENCE_CAPTURE_ALLOW_VISIBLE === "1";

if (!command) {
  console.error("Set CSS_REFERENCE_CAPTURE_CMD to the native/source capture command for cssMenger — XScreenSaver Menger. The command must run headless/no-window; keep outputs under " + outDir + ".");
  process.exitCode = 1;
} else if (allowVisible) {
  console.error("Visible reference capture is not oracle-safe. Use a separate exploratory command, then add a headless/no-window oracle route before claiming parity.");
  process.exitCode = 1;
} else {
  await mkdir(outDir, { recursive: true });
  const oracleEnv = {
    ...process.env,
    CSS_REFERENCE_CAPTURE_OUT_DIR: outDir,
    CSS_REFERENCE_CAPTURE_HEADLESS: "1",
    SDL_VIDEODRIVER: process.env.SDL_VIDEODRIVER ?? "dummy",
    QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen",
  };
  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    env: oracleEnv,
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  await writeFile(join(outDir, "capture-command.txt"), command + "\n");
  await writeFile(join(outDir, "headless-env.json"), JSON.stringify({
    CSS_REFERENCE_CAPTURE_HEADLESS: oracleEnv.CSS_REFERENCE_CAPTURE_HEADLESS,
    SDL_VIDEODRIVER: oracleEnv.SDL_VIDEODRIVER,
    QT_QPA_PLATFORM: oracleEnv.QT_QPA_PLATFORM,
  }, null, 2) + "\n");
  process.exitCode = code ?? 1;
}
