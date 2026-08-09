import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { repositoryRoot } from "./paths.mjs";

export const PINNED_XSCREENSAVER_COMMIT = "906693799e4fb7581436590cf84ecb2d3c9186ba";

export const CSSMAZE_SOURCE_FILES = Object.freeze([
  Object.freeze({
    path: "debian/copyright",
    sha256: "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9",
    role: "repository-wide-copyright-and-redistribution-notice",
  }),
  Object.freeze({
    path: "hacks/glx/maze3d.c",
    sha256: "10d143873dcb7172c61111db329955613b46de208d10a315f117d8256eba3bcb",
    role: "generation-camera-geometry-source",
  }),
  Object.freeze({
    path: "hacks/config/maze3d.xml",
    sha256: "35d6b3c3fa80b0154fe37219788035b11ca9a686eef86fb15cbcda7fbbf6226a",
    role: "configuration-defaults",
  }),
  Object.freeze({
    path: "hacks/glx/maze3d.man",
    sha256: "483fd95a04af0e95be31c8ac06e002a88a3c13bbd7498c27f7c52fa47d0a07e6",
    role: "manual",
  }),
]);

export const CSSMAZE_TEXTURE_FILES = Object.freeze([
  Object.freeze({
    id: "wall",
    path: "hacks/images/brick1.png",
    output: "brick1.png",
    sha256: "60190f318c521e43160cd8780a70e08117f4cc6d8bd839c304bcc30f312c300d",
  }),
  Object.freeze({
    id: "ceiling",
    path: "hacks/images/brick2.png",
    output: "brick2.png",
    sha256: "8829d69a3eb036ac97fbf5a3bf9ecdbc90fe9fe1a36775bd96fa57a46d481ef9",
  }),
  Object.freeze({
    id: "floor",
    path: "hacks/images/wood2.png",
    output: "wood2.png",
    sha256: "22e6111a207b6e1463641c583ea08a17cc6f89bc62276a3e14ad37ff3350f0a6",
  }),
]);

export async function resolveCssmazeDataSource({ sourceRoot } = {}) {
  const candidate = sourceRoot ?? process.env.CSSMAZE_SOURCE_ROOT ??
    join(repositoryRoot, ".local/xscreensaver");
  const root = resolve(candidate);
  if (!isAbsolute(root)) throw new Error("CSSMAZE_SOURCE_ROOT must resolve to an absolute path");
  try {
    await access(root);
  } catch {
    throw new Error(
      `Missing pinned XScreenSaver checkout at ${root}. Set CSSMAZE_SOURCE_ROOT and run pnpm prepare:cssmaze.`,
    );
  }

  const verifiedFiles = [];
  for (const entry of [...CSSMAZE_SOURCE_FILES, ...CSSMAZE_TEXTURE_FILES]) {
    const path = join(root, entry.path);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error(`Pinned cssMaze input is missing: ${entry.path}`);
    }
    const actual = sha256(bytes);
    if (actual !== entry.sha256) {
      throw new Error(`Pinned cssMaze input hash mismatch for ${entry.path}: ${actual}`);
    }
    verifiedFiles.push(Object.freeze({ ...entry, byteLength: bytes.length }));
  }

  let checkoutCommit = null;
  try {
    checkoutCommit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    checkoutCommit = null;
  }
  if (checkoutCommit && checkoutCommit !== PINNED_XSCREENSAVER_COMMIT) {
    throw new Error(`XScreenSaver checkout revision mismatch: ${checkoutCommit}`);
  }

  return Object.freeze({
    root,
    checkoutCommit,
    pinnedCommit: PINNED_XSCREENSAVER_COMMIT,
    verifiedFiles: Object.freeze(verifiedFiles),
  });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
