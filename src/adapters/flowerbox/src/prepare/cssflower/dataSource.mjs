import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const NATIVE_ROOT_ENV = "CSSFLOWER_NATIVE_ROOT";
const EXPECTED_SOURCE_COMMIT = "9478d25a677f70dbe4fc0ed317cc5a5e5050ef8b";
const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");
const RETAINED_NATIVE_COMPARISON = resolve(
  REPO_ROOT,
  ".local/oracle/cssflower/native/state/native-cssflower-compare.json",
);

export async function resolveCssflowerDataSource(options = {}) {
  const rawRoot = options.nativeRoot ?? process.env[NATIVE_ROOT_ENV] ?? "";
  const qualification = retainedNativeQualification();
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
      nativeAuthorityStatus: qualification ? "available-qualified" : "unqualified",
      nativeQualification: qualification,
    };
  }

  if (qualification) {
    return {
      kind: "identity-bound-local-native-authority",
      env: null,
      root: null,
      publicLabel: "ignored local identity-bound native oracle",
      legalLabel: "local-oracle-evidence-not-redistributed",
      nativeAuthorityStatus: "available-qualified",
      nativeQualification: qualification,
    };
  }

  return {
    kind: "documented-source-behavior",
    env: null,
    root: null,
    publicLabel: "src/adapters/flowerbox/README.md",
    legalLabel: "independently-authored-results-only",
    nativeAuthorityStatus: "missing",
    nativeQualification: null,
  };
}

function retainedNativeQualification() {
  if (!existsSync(RETAINED_NATIVE_COMPARISON)) return null;
  try {
    const report = JSON.parse(readFileSync(RETAINED_NATIVE_COMPARISON, "utf8"));
    if (report?.status !== "pass" ||
        report?.nativeBinding?.sourceCommit !== EXPECTED_SOURCE_COMMIT ||
        report?.nativeStateWasNotUsedAsCandidateInput !== true ||
        report?.firstDivergence !== null ||
        report?.comparedTickCount !== 9_331) {
      return null;
    }
    return Object.freeze({
      schema: report.schema,
      status: report.status,
      sourceCommit: report.nativeBinding.sourceCommit,
      executableSha256: report.nativeBinding.executable.sha256,
      compilerSha256: report.nativeBinding.compiler.sha256,
      comparedTickCount: report.comparedTickCount,
      firstDivergence: report.firstDivergence,
      candidateIndependence: report.engineIndependence.status,
    });
  } catch {
    return null;
  }
}
