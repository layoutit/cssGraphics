#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import sourceLock from "../notes/references/source-lock.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const sourceRoot = resolve(process.env.CSSCHAOS_SOURCE_ROOT ??
  resolve(repositoryRoot, ".local/upstreams/dysts"));
const venvRoot = resolve(process.env.CSSCHAOS_VENV_ROOT ??
  resolve(repositoryRoot, ".local/venvs/dysts"));
const pythonPath = process.env.CSSCHAOS_PYTHON || resolve(venvRoot, "bin/python");
const pythonEnvironment = Object.freeze({
  ...process.env,
  PYTHONPATH: sourceRoot,
  CSSCHAOS_SOURCE_ROOT: sourceRoot,
});

await ensurePinnedSource();
await ensurePythonEnvironment();
await runPython("rank-dysts-candidates.py");
await runPython("prepare-chaos-assets.py");

async function ensurePinnedSource() {
  let cloned = false;
  if (!await exists(resolve(sourceRoot, ".git"))) {
    await mkdir(resolve(sourceRoot, ".."), { recursive: true });
    await execFileAsync("git", ["clone", "--filter=blob:none", "--no-checkout",
      sourceLock.upstream.repository, sourceRoot]);
    cloned = true;
  }
  let { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (stdout.trim() !== sourceLock.upstream.commit) {
    await execFileAsync("git", ["-C", sourceRoot, "fetch", "--depth=1", "origin",
      sourceLock.upstream.commit]);
  }
  if (cloned || stdout.trim() !== sourceLock.upstream.commit) {
    await execFileAsync("git", ["-C", sourceRoot, "checkout", "--detach",
      sourceLock.upstream.commit]);
    ({ stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]));
  }
  if (stdout.trim() !== sourceLock.upstream.commit) {
    throw new Error("Chaos source commit drifted");
  }
  for (const source of sourceLock.sources) {
    const bytes = await readFile(resolve(sourceRoot, source.path));
    if (sha256(bytes) !== source.sha256) {
      throw new Error(`Chaos source hash drifted: ${source.path}`);
    }
  }
}

async function ensurePythonEnvironment() {
  if (!process.env.CSSCHAOS_PYTHON && !await exists(pythonPath)) {
    await mkdir(resolve(venvRoot, ".."), { recursive: true });
    await execFileAsync("python3", ["-m", "venv", venvRoot]);
  }
  const dependencyAssertions = Object.entries(sourceLock.pythonDependencies)
    .map(([module, version]) =>
      `assert importlib.metadata.version(${JSON.stringify(module)})==${JSON.stringify(version)}`)
    .join(";");
  try {
    await execFileAsync(pythonPath, ["-c", `import importlib.metadata;${dependencyAssertions}`], {
      env: pythonEnvironment,
    });
  } catch {
    const requirements = resolve(import.meta.dirname, "requirements.prepare.txt");
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--disable-pip-version-check",
      "--requirement", requirements], { env: pythonEnvironment, maxBuffer: 20_000_000 });
  }
}

async function runPython(script) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, [resolve(import.meta.dirname, script)], {
      cwd: repositoryRoot,
      env: pythonEnvironment,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() :
      rejectPromise(new Error(`Chaos preparation failed: ${script} code=${code} signal=${signal}`)));
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
