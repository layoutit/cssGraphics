import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const adapterRoot = resolve(import.meta.dirname, "..", "..");
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const oracleRoot = resolve(
  process.env.CSSPLATONIC_ORACLE_OUT ??
  join(repositoryRoot, "bench", "results", "cssplatonicfolding", "oracle"),
);

export async function compareFrameSequences({
  expected,
  actual,
  out,
  label,
  frameCount,
  meanThreshold = 0,
  changedThreshold = 0,
  channelThreshold = 0,
  diffFrames = "worst",
}) {
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
    "--expected-frames", String(frameCount),
    "--mean-threshold", String(meanThreshold),
    "--changed-threshold", String(changedThreshold),
    "--channel-threshold", String(channelThreshold),
    "--diff-frames", diffFrames,
    "--diff-amplify", "1",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Frame comparison exited ${result.status}`);
  const manifestPath = join(out, `${label}.json`);
  return Object.freeze({ ...(await readJson(manifestPath)), manifestPath });
}

export async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function assertReadable(path, label = "file") {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}
