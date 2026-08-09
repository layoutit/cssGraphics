import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { localRoot } from "../../src/prepare/cssmenger/paths.mjs";

export const cssmengerOracleRoot = resolve(
  process.env.CSSMENGER_ORACLE_OUT ?? join(localRoot, "oracle"),
);

export async function compareFrameSequences({ expected, actual, out, label, frameCount, diffFrames = "worst" }) {
  const script = resolve(
    process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT ??
    join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", "frame-sequence-oracle", "scripts", "frame-sequence.mjs"),
  );
  await assertReadable(script, "frame-sequence oracle");
  const result = spawnSync(process.execPath, [
    script,
    "compare",
    "--expected", expected,
    "--actual", actual,
    "--out", out,
    "--replace",
    "--label", label,
    "--mean-threshold", "0",
    "--changed-threshold", "0",
    "--channel-threshold", "0",
    "--diff-frames", diffFrames,
    "--diff-amplify", "1",
    "--max-frames", String(frameCount),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `frame comparison exited ${result.status}`);
  return readJson(join(out, `${label}.json`));
}

export async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonLines(path) {
  return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export async function assertReadable(path, label = "file") {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}
