import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const prepareCodeRoot = resolve(import.meta.dirname, "../..");
export const sourceCheckout = existsSync(resolve(prepareCodeRoot, "../package.json"));

function normalizedSourcePath(path) {
  const normalized = String(path).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized.startsWith("src/") || normalized.split("/").includes("..")) {
    throw new Error(`Preparation code path must be normalized under src/: ${path}`);
  }
  return normalized;
}

export function resolvePreparationCode(path) {
  const normalized = normalizedSourcePath(path);
  const relativePath = normalized.slice(4);
  const emittedPath = sourceCheckout
    ? relativePath
    : relativePath.replace(/\.ts$/u, ".js");
  return resolve(prepareCodeRoot, emittedPath);
}

export function preparationRuntimeCodeUrl(path) {
  const normalized = normalizedSourcePath(path);
  const relativePath = normalized.slice(4).replace(/\.ts$/u, ".js");
  const absolute = sourceCheckout
    ? resolve(prepareCodeRoot, "../dist/cli/src", relativePath)
    : resolve(prepareCodeRoot, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(
      `Prepared runtime code is absent; run pnpm build:lib first: ${absolute}`,
    );
  }
  return pathToFileURL(absolute).href;
}
