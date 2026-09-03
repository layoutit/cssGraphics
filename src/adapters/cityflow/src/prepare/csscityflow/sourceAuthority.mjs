// SPDX-License-Identifier: HPND
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import sourceLock from "../../../notes/references/source-lock.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../../../..");

export async function ensureCityflowSourceTree({
  configuredRoot = process.env.CSSCITYFLOW_SOURCE_ROOT,
  fetchImpl = fetch,
} = {}) {
  const managed = !configuredRoot;
  const sourceRoot = resolve(configuredRoot ?? resolve(
    repositoryRoot,
    `.local/upstreams/xscreensaver-cityflow-${sourceLock.revision.slice(0, 7)}`,
  ));
  if (configuredRoot) await assertConfiguredRevision(sourceRoot);
  const files = [];
  for (const source of sourceLock.sources) {
    const path = resolve(sourceRoot, source.path);
    let bytes = await readFile(path).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (bytes === null) {
      if (!managed) throw new Error(`Missing pinned Cityflow source input: ${source.path}`);
      bytes = await downloadPinnedSource(source, fetchImpl);
      await writeAtomically(path, bytes);
    }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== source.sha256) {
      throw new Error(`Cityflow source bytes drifted: ${source.path}`);
    }
    files.push(Object.freeze({ path: source.path, sha256: actualSha256 }));
  }
  return Object.freeze({
    sourceRoot,
    repository: sourceLock.repository,
    revision: sourceLock.revision,
    identityKind: configuredRoot ? "git-checkout-and-bytes" : "pinned-byte-tree",
    files: Object.freeze(files),
  });
}

export function createPinnedCityflowSourceUrl(source) {
  const repository = new URL(sourceLock.repository);
  const segments = repository.pathname.replace(/^\/+|\/+$/gu, "").split("/");
  if (repository.protocol !== "https:" || repository.hostname !== "github.com" ||
      segments.length !== 2 || !/^[a-f0-9]{40}$/u.test(sourceLock.revision) ||
      !/^[A-Za-z0-9._/-]+$/u.test(source.path) || source.path.startsWith("/") ||
      source.path.endsWith("/") || source.path.includes("..")) {
    throw new Error("Cityflow pinned source URL contract drifted");
  }
  return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/` +
    `${sourceLock.revision}/${source.path}`;
}

async function assertConfiguredRevision(sourceRoot) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]));
  } catch (error) {
    throw new Error(`CSSCITYFLOW_SOURCE_ROOT is not the pinned XScreenSaver checkout: ${error.message}`);
  }
  if (stdout.trim() !== sourceLock.revision) {
    throw new Error(`Cityflow source commit drifted: ${stdout.trim()}`);
  }
}

async function downloadPinnedSource(source, fetchImpl) {
  const url = createPinnedCityflowSourceUrl(source);
  const response = await fetchImpl(url, {
    headers: { Accept: "text/plain, application/octet-stream;q=0.9" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Pinned Cityflow source download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) {
    throw new Error(`Pinned Cityflow source download drifted: ${source.path}`);
  }
  return bytes;
}

async function writeAtomically(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
