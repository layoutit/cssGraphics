import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CSSFLOCKS_ADAPTER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CSSFLOCKS_REPOSITORY_ROOT = resolve(CSSFLOCKS_ADAPTER_ROOT, "..", "..", "..");

export function resolveFlocksGeneratedPublicRoot(env = process.env) {
  return resolve(env.CSSFLOCKS_GENERATED_PUBLIC_DIR ?? join(CSSFLOCKS_REPOSITORY_ROOT, "build/generated/public"));
}

export function resolveFlocksOutputRoot(env = process.env) {
  return join(resolveFlocksGeneratedPublicRoot(env), "cssflocks");
}
