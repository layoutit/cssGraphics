import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, relative, resolve, sep } from "node:path";

export const SM64_US_ROM = Object.freeze({
  region: "us",
  byteOrder: "z64-big-endian",
  size: 8 * 1024 * 1024,
  headerHex: "80371240",
  sha1: "9bef1128717f958171a4afac3ed78ee2bb4e86ce",
});

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export function resolveRomPath(env = process.env, cwd = process.cwd()) {
  const configured = String(env.SM64_ROM || "").trim();
  if (!configured) {
    throw new TypeError("SM64_ROM is required and must point to a user-owned US big-endian .z64 ROM.");
  }

  const candidate = resolve(cwd, configured);
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new TypeError(`SM64_ROM does not exist: ${configured}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new TypeError("SM64_ROM must be a regular file, not a symbolic link.");
  }
  if (!stat.isFile()) {
    throw new TypeError("SM64_ROM must resolve to a regular file.");
  }

  const real = realpathSync(candidate);
  const realCwd = realpathSync(cwd);
  const configuredLocalRoot = resolve(cwd, ".local");
  const localRoot = existsSync(configuredLocalRoot)
    ? realpathSync(configuredLocalRoot)
    : resolve(realCwd, ".local");
  if (isInside(realCwd, real) && !isInside(localRoot, real)) {
    throw new TypeError("A ROM inside this repository must live under ignored .local/; move it there or point SM64_ROM outside the repository.");
  }
  return { configured, absolute: real, location: isInside(localRoot, real) ? "ignored-local" : "external" };
}

export function qualifyRom({
  env = process.env,
  cwd = process.cwd(),
  expected = SM64_US_ROM,
} = {}) {
  const source = resolveRomPath(env, cwd);
  let descriptor;
  try {
    descriptor = openSync(source.absolute, fsConstants.O_RDONLY);
  } catch (error) {
    throw new TypeError(`SM64_ROM cannot be opened read-only: ${error.message}`);
  }

  let header;
  try {
    header = Buffer.alloc(4);
    const count = readSync(descriptor, header, 0, 4, 0);
    if (count !== 4) throw new TypeError("SM64_ROM ended before its 4-byte header.");
  } finally {
    closeSync(descriptor);
  }

  const stat = lstatSync(source.absolute);
  if (stat.size !== expected.size) {
    throw new TypeError(`SM64_ROM has ${stat.size} bytes; expected ${expected.size} bytes for the qualified US ROM.`,
    );
  }
  if (header.toString("hex") !== expected.headerHex) {
    throw new TypeError(`SM64_ROM header is ${header.toString("hex")}; expected ${expected.headerHex} big-endian Z64.`,
    );
  }

  const sha1 = createHash("sha1").update(readFileSync(source.absolute)).digest("hex");
  if (sha1 !== expected.sha1) {
    throw new TypeError(`SM64_ROM SHA-1 is ${sha1}; expected the qualified US revision ${expected.sha1}.`,
    );
  }

  return Object.freeze({
    schema: 1,
    qualified: true,
    source: "SM64_ROM",
    location: source.location,
    fileName: basename(source.absolute),
    region: expected.region,
    byteOrder: expected.byteOrder,
    size: stat.size,
    sha1,
    copied: false,
    romBytesRetained: false,
  });
}
