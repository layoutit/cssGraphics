import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const DATA_ENV = "CSSMENGER_SOURCE_ROOT";
export const SOURCE_COMMIT = "906693799e4fb7581436590cf84ecb2d3c9186ba";
export const SOURCE_TREE = "0505073ed2b1d5d51ef373da1b3801b7daca772e";
export const MENGER_SHA256 = "eb7687dd6f7e946f4d45af647b0c0eb081a0011bf55c0c74261b5ad6a16d21c0";

export async function resolveCssmengerDataSource(options = {}) {
  const root = resolve(String(options.dataRoot ?? process.env[DATA_ENV] ?? ".local/xscreensaver"));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${DATA_ENV} does not point to a pinned XScreenSaver checkout: ${root}`);
  }
  const commit = git(root, "rev-parse", "HEAD");
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  if (commit !== SOURCE_COMMIT || tree !== SOURCE_TREE) {
    throw new Error(`cssMenger source identity mismatch: expected ${SOURCE_COMMIT}/${SOURCE_TREE}, got ${commit}/${tree}`);
  }
  const primaryPath = join(root, "hacks/glx/menger.c");
  const primarySha256 = createHash("sha256").update(await readFile(primaryPath)).digest("hex");
  if (primarySha256 !== MENGER_SHA256) {
    throw new Error(`cssMenger primary source hash mismatch: ${primarySha256}`);
  }
  return Object.freeze({
    kind: "pinned-xscreensaver-source-checkout",
    root,
    publicLabel: DATA_ENV,
    sourceCommit: commit,
    sourceTree: tree,
    primaryPath: "hacks/glx/menger.c",
    primarySha256,
  });
}

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}
