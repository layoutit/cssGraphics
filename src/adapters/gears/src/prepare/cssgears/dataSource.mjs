import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { repositoryRoot } from "./paths.mjs";

export const SOURCE_ENV = "CSSGEARS_SOURCE_ROOT";
export const SOURCE_COMMIT = "906693799e4fb7581436590cf84ecb2d3c9186ba";
export const SOURCE_FILES = Object.freeze([
  Object.freeze({ path: "hacks/glx/gears.c", sha256: "4e8b8b1c14e99e81a517ffa2f1f3b1d7cec81d030bd0d90da9310f809af892ea" }),
  Object.freeze({ path: "hacks/glx/involute.c", sha256: "e222834bb9f8d39f798431f7fdae78f0d8b5518c68ec829aea23381f6f077681" }),
  Object.freeze({ path: "hacks/glx/involute.h", sha256: "05887f7a056bb826f8ec5b556f7aad8c0a385beb3327fe6eee722e53617a71a8" }),
  Object.freeze({ path: "hacks/glx/normals.c", sha256: "41eed1f27325f188c59a495d2205ac71ccccd3d9c0202ad5b22b73319348c5ee" }),
  Object.freeze({ path: "hacks/glx/normals.h", sha256: "97c977957733602936627fcf9a22407b40d5a45b239fe469ce03439d1f88d1a6" }),
  Object.freeze({ path: "hacks/glx/rotator.c", sha256: "0e63d9a6fedcdef751c07c081dfe1141600fff1631c3fcf1eac45d2b52084abc" }),
  Object.freeze({ path: "hacks/glx/rotator.h", sha256: "0df63fa719e76abfd73fb314012edde19a0ec92700b7f83b6ffef547d89f8006" }),
  Object.freeze({ path: "utils/yarandom.c", sha256: "32967bcf84b46a60968723d6d3d86d1d69d9f30a52b36dddfdedaa3ee3e4c931" }),
  Object.freeze({ path: "utils/yarandom.h", sha256: "958707f757cd273579290830a0546215b61db5e11110cf46656333c51002269b" }),
  Object.freeze({ path: "hacks/glx/tube.h", sha256: "dd70f0b9669d75890595255a64bd51e97fc264d1c1af5f099c18eb0733eb0317" }),
  Object.freeze({ path: "hacks/glx/gltrackball.h", sha256: "6d74d4e6d5eb831de0a7531b87aeaf2e2d052b819ef782b99cd201751514dc4b" }),
  Object.freeze({ path: "hacks/glx/quaternion.h", sha256: "bcd01e64dbc58a47bfc3214e55b095a5915fe249a8d71ffde5e09bbf52647522" }),
]);

export async function resolveCssgearsDataSource(options = {}) {
  const rawRoot = options.sourceRoot ?? process.env[SOURCE_ENV] ?? join(repositoryRoot, ".local/xscreensaver");
  const root = resolve(String(rawRoot));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${SOURCE_ENV} does not point to the pinned XScreenSaver checkout: ${root}`);
  }
  const verifiedFiles = [];
  for (const entry of SOURCE_FILES) {
    const bytes = await readFile(join(root, entry.path)).catch(() => null);
    if (!bytes) throw new Error(`Pinned cssGears source file is missing: ${entry.path}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`Pinned cssGears source identity mismatch for ${entry.path}: ${sha256}`);
    }
    verifiedFiles.push(Object.freeze({ ...entry, byteLength: bytes.length }));
  }
  return Object.freeze({
    kind: "pinned-open-source-checkout",
    env: SOURCE_ENV,
    root,
    publicLabel: SOURCE_ENV,
    sourceCommit: SOURCE_COMMIT,
    verifiedFiles: Object.freeze(verifiedFiles),
    legalLabel: "per-file-permissive-notices-qualified-for-seeded-native-first-slice",
    redistribution: "upstream-source-not-bundled-generated-browser-results-only",
  });
}
