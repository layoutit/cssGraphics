// SPDX-License-Identifier: HPND
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function ensureGalaxySourceFile({ sourceRoot, source, fetchImpl = fetch }) {
  const sourceUrl = createPinnedGalaxySourceUrl(source);
  const sourcePath = resolve(sourceRoot, source.path);
  const existing = await readFile(sourcePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    assertDigest(existing, source.sha256);
    return sourcePath;
  }

  const response = await fetchImpl(sourceUrl, {
    headers: { Accept: "text/plain, application/octet-stream;q=0.9" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Pinned Galaxy source download failed: ${response.status} ${sourceUrl}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  assertDigest(bytes, source.sha256);
  await mkdir(dirname(sourcePath), { recursive: true });
  const temporaryPath = `${sourcePath}.${process.pid}.tmp`;
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, sourcePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return sourcePath;
}

export function createPinnedGalaxySourceUrl(source) {
  const repository = new URL(source.repository);
  const segments = repository.pathname.replace(/^\/+|\/+$/gu, "").split("/");
  if (repository.protocol !== "https:" || repository.hostname !== "github.com" ||
      segments.length !== 2 || !/^[a-f0-9]{40}$/u.test(source.revision) ||
      !/^[A-Za-z0-9._/-]+$/u.test(source.path) || source.path.startsWith("/") ||
      source.path.endsWith("/") || source.path.includes("..")) {
    throw new Error("Galaxy pinned source URL contract drifted");
  }
  return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/` +
    `${source.revision}/${source.path}`;
}

function assertDigest(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error("Pinned Galaxy source bytes drifted");
}
