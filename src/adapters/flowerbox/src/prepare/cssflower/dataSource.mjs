import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const NATIVE_ROOT_ENV = "CSSFLOWER_NATIVE_ROOT";

export async function resolveCssflowerDataSource(options = {}) {
  const rawRoot = options.nativeRoot ?? process.env[NATIVE_ROOT_ENV] ?? "";
  if (rawRoot) {
    const root = resolve(String(rawRoot));
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(NATIVE_ROOT_ENV + " does not point to a readable directory: " + root);
    }
    return {
      kind: "user-supplied-native-authority",
      env: NATIVE_ROOT_ENV,
      root,
      publicLabel: NATIVE_ROOT_ENV,
      legalLabel: "owned-local-authority-not-redistributed",
      nativeAuthorityStatus: "local-input-not-packaged",
      nativeQualification: null,
    };
  }

  return {
    kind: "documented-source-behavior",
    env: null,
    root: null,
    publicLabel: "src/adapters/flowerbox/README.md",
    legalLabel: "independently-authored-results-only",
    nativeAuthorityStatus: "not-packaged",
    nativeQualification: null,
  };
}
