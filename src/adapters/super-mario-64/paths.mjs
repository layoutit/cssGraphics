import { isAbsolute, relative, resolve, sep } from "node:path";

export const PREPARE_PATH_SCHEMA = 1;

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function normalizedRelative(value, name) {
  const configured = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!configured || isAbsolute(configured) || configured === ".." || configured.startsWith("../")) {
    throw new Error(`${name} must be a normalized repository-relative path.`);
  }
  if (configured.split("/").includes("..")) {
    throw new Error(`${name} must not traverse outside its declared root.`);
  }
  return configured.replace(/\/+$/, "");
}

function resolveOwnedRoot(repoRoot, configured, requiredParent, name) {
  const relativePath = normalizedRelative(configured, name);
  const absolute = resolve(repoRoot, relativePath);
  const parent = resolve(repoRoot, requiredParent);
  if (!isInside(parent, absolute)) {
    throw new Error(`${name} must remain under ignored ${requiredParent}/.`);
  }
  return Object.freeze({ relative: relativePath, absolute });
}

export function createPreparePaths({ cwd = process.cwd(), env = process.env } = {}) {
  const repoRoot = resolve(cwd);
  const upstream = resolveOwnedRoot(
    repoRoot,
    env.SM64_UPSTREAM_ROOT || ".local/upstreams",
    ".local",
    "SM64_UPSTREAM_ROOT",
  );
  const generated = resolveOwnedRoot(
    repoRoot,
    env.SM64_GENERATED_ROOT || "build/generated/public/cssgraphics/models/mario",
    "build/generated",
    "SM64_GENERATED_ROOT",
  );
  const reports = resolveOwnedRoot(
    repoRoot,
    env.SM64_REPORT_ROOT || "build/reports",
    "build/reports",
    "SM64_REPORT_ROOT",
  );

  return Object.freeze({
    schema: PREPARE_PATH_SCHEMA,
    repoRoot,
    upstream,
    generated,
    generatedPublicRoot: Object.freeze({
      relative: "build/generated/public",
      absolute: resolve(repoRoot, "build/generated/public"),
    }),
    generatedRuntime: Object.freeze({
      relative: "build/generated/prepare/title-head-source",
      absolute: resolve(repoRoot, "build/generated/prepare/title-head-source"),
    }),
    reports,
    reference: Object.freeze({
      relative: ".local/reference/title-head",
      absolute: resolve(repoRoot, ".local/reference/title-head"),
    }),
    evidence: Object.freeze({
      relative: "bench/results/title-head",
      absolute: resolve(repoRoot, "bench/results/title-head"),
    }),
    manifestUrl: "/cssgraphics/models/mario/manifest.json",
  });
}

export function repoRelativePath(repoRoot, candidate, label = "path") {
  const root = resolve(repoRoot);
  const absolute = resolve(candidate);
  if (!isInside(root, absolute)) throw new Error(`${label} must stay inside the repository.`);
  return relative(root, absolute).split(sep).join("/") || ".";
}
