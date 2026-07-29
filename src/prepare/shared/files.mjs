import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

function normalizePreparedPath(value, path = "path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")
    || normalized.split("/").includes("..") || normalized.endsWith("/")) {
    throw new Error(`${path} must be a normalized relative prepared path.`);
  }
  return normalized;
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

export function assertEmptyOutputRoot(outputRoot) {
  const root = resolve(outputRoot);
  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) throw new Error("Prepared output root must be a directory.");
    if (readdirSync(root).length !== 0) throw new Error("Prepared output root must be empty; refusing to overwrite it.");
  } else {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

export function writePreparedFile(outputRoot, path, bytes, writeOrder, role) {
  const normalized = normalizePreparedPath(path);
  const root = resolve(outputRoot);
  const target = resolve(root, normalized);
  if (!isInside(root, target) || target === root) throw new Error(`Prepared file escapes output root: ${path}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  const actual = readFileSync(target);
  const descriptor = Object.freeze({
    path: normalized,
    role,
    bytes: actual.length,
    sha256: createHash("sha256").update(actual).digest("hex"),
  });
  writeOrder.push(normalized);
  return descriptor;
}
