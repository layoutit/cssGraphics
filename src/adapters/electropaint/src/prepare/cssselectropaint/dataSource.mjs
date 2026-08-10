// SPDX-License-Identifier: GPL-2.0-only
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { localSourceRoot } from "./paths.mjs";
import sourceLock from "../../../notes/electropaint-source-lock.json" with { type: "json" };

const execute = promisify(execFile);
if (sourceLock?.schema !== "cssselectropaint-source-lock@2" ||
    sourceLock.authorities?.length !== 3) {
  throw new Error("ElectroPaint checked-in source lock is invalid");
}
const kentLock = sourceLock.authorities.find((authority) => authority.name === "kent-reference");
const ralphLock = sourceLock.authorities.find((authority) => authority.name === "ralph-reference");
const browserLock = sourceLock.authorities.find((authority) => authority.name === "browser-reference");
if (!kentLock || !ralphLock || !browserLock ||
    kentLock.license !== "GPL-2.0-or-later" ||
    ralphLock.license !== "GPL-2.0-or-later" ||
    browserLock.license !== "GPL-2.0-only") {
  throw new Error("ElectroPaint checked-in source authorities are invalid");
}
export const KENT_REFERENCE_COMMIT = kentLock.commit;
export const RALPH_REFERENCE_COMMIT = ralphLock.commit;
export const BROWSER_REFERENCE_COMMIT = browserLock.commit;
const FILES = Object.freeze(sourceLock.authorities.flatMap((authority) => authority.files.map((file) =>
  Object.freeze([authority.name, file.path, file.sha256]))));

const LOCKED_AUTHORITIES = Object.freeze({
  kentReference: Object.freeze({
    repository: kentLock.repository,
    commit: KENT_REFERENCE_COMMIT,
  }),
  ralphReference: Object.freeze({
    repository: ralphLock.repository,
    commit: RALPH_REFERENCE_COMMIT,
  }),
  browserReference: Object.freeze({
    repository: browserLock.repository,
    commit: BROWSER_REFERENCE_COMMIT,
  }),
  sha256: Object.freeze(Object.fromEntries(FILES.map(([repository, relativePath, hash]) => [
    `${repository}/${relativePath}`,
    hash,
  ]))),
});

export function lockedElectropaintAuthorities() {
  return LOCKED_AUTHORITIES;
}

export async function verifyElectropaintAuthorities(root = localSourceRoot) {
  const repositories = sourceLock.authorities.map((authority) =>
    [authority.name, authority.commit]);
  for (const [name, expected] of repositories) {
    const cwd = resolve(root, name);
    let actual;
    try {
      ({ stdout: actual } = await execute("git", ["rev-parse", "HEAD"], { cwd }));
    } catch {
      throw new Error(`Missing ignored ElectroPaint authority checkout at ${cwd}`);
    }
    if (actual.trim() !== expected) {
      throw new Error(`${name} authority drifted: expected ${expected}, received ${actual.trim()}`);
    }
  }
  const hashes = {};
  for (const [repository, relativePath, expected] of FILES) {
    const bytes = await readFile(resolve(root, repository, relativePath));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`${repository}/${relativePath} source bytes drifted`);
    hashes[`${repository}/${relativePath}`] = actual;
  }
  if (Object.entries(hashes).some(([path, hash]) => LOCKED_AUTHORITIES.sha256[path] !== hash)) {
    throw new Error("Verified ElectroPaint authorities drifted from the checked-in source lock");
  }
  return LOCKED_AUTHORITIES;
}
