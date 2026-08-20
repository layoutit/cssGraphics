import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CSSFLOCKS_ADAPTER_ROOT, CSSFLOCKS_REPOSITORY_ROOT } from "./paths.mjs";
import { CSSFLOCKS_SOURCE } from "./sourceModel.mjs";

export async function verifyFlocksSourceIdentity() {
  const lock = JSON.parse(await readFile(join(CSSFLOCKS_ADAPTER_ROOT, "notes/references/source-lock.json"), "utf8"));
  for (const field of ["repository", "revision", "path", "sha256", "license"]) {
    if (lock[field] !== CSSFLOCKS_SOURCE[field]) throw new Error(`Flocks source lock ${field} drifted`);
  }
  const ignoredSource = join(CSSFLOCKS_REPOSITORY_ROOT, ".local/reallyslickscreensavers", lock.path);
  try {
    const bytes = await readFile(ignoredSource);
    if (sha256(bytes) !== lock.sha256) throw new Error("Ignored Flocks source bytes do not match the pinned SHA-256");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return Object.freeze(lock);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
