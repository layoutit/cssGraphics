import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CSSMAZE_REPO_ROOT, localBuildRoot } from "./paths.mjs";
import { sha256 } from "./dataSource.mjs";

let compiledHelper = null;

export async function captureNativeMazeState({ seed }) {
  const sourcePath = join(CSSMAZE_REPO_ROOT, "native/maze3d-state.c");
  const { binaryPath, helperSha256 } = await compileNativeMazeStateHelper(sourcePath);
  const capture = spawnSync(binaryPath, [String(seed)], {
    cwd: CSSMAZE_REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  if (capture.status !== 0) {
    throw new Error(`Headless cssMaze state dump failed:\n${capture.stderr || capture.stdout}`);
  }
  const state = JSON.parse(capture.stdout);
  validateNativeState(state, seed);
  return Object.freeze({
    state,
    stateSha256: sha256(Buffer.from(capture.stdout)),
    helperSha256,
  });
}

async function compileNativeMazeStateHelper(sourcePath) {
  if (compiledHelper) return compiledHelper;
  const binaryDirectory = join(localBuildRoot(), "bin");
  const binaryPath = join(binaryDirectory, "maze3d-state");
  await mkdir(binaryDirectory, { recursive: true });
  const helperSha256 = sha256(await readFile(sourcePath));
  const compile = spawnSync("cc", [
    "-std=c11",
    "-O2",
    "-D_DARWIN_C_SOURCE",
    sourcePath,
    "-lm",
    "-o",
    binaryPath,
  ], {
    cwd: CSSMAZE_REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (compile.status !== 0) {
    throw new Error(`Failed to compile the headless cssMaze state dump:\n${compile.stderr || compile.stdout}`);
  }
  compiledHelper = Object.freeze({ binaryPath, helperSha256 });
  return compiledHelper;
}

function validateNativeState(state, expectedSeed) {
  if (state?.schema !== "cssmaze-native-state@1" || state.seed !== expectedSeed ||
      state.logicalRows !== 12 || state.logicalColumns !== 12 ||
      state.gridRows !== 25 || state.gridColumns !== 25 ||
      state.frameDelayMicroseconds !== 20_000 || state.speed !== 1 ||
      !Array.isArray(state.grid) || state.grid.length !== 25 ||
      state.grid.some((row) => typeof row !== "string" || row.length !== 25) ||
      !Array.isArray(state.frames) || state.frames.length !== state.frameCount ||
      state.frames.length < 100 || state.completeTraversal !== true) {
    throw new Error("Headless cssMaze state dump failed its exact first-slice contract");
  }
  const starts = state.grid.join("").match(/S/gu)?.length ?? 0;
  const finishes = state.grid.join("").match(/F/gu)?.length ?? 0;
  if (starts !== 1 || finishes !== 1) {
    throw new Error("Headless cssMaze state dump must contain exactly one start and finish");
  }
  for (let index = 0; index < state.frames.length; index++) {
    const row = state.frames[index];
    if (!Array.isArray(row) || row.length !== 6 || row[0] !== index ||
        row.slice(1).some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid native cssMaze frame ${index}`);
    }
  }
}
