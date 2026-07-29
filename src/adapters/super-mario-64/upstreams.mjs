import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const SM64_UPSTREAMS = Object.freeze([
  Object.freeze({
    id: "sm64js",
    directory: "sm64js",
    remote: "https://github.com/sm64js/sm64js.git",
    revision: "04c1a984117ebb8d0e7b0d5d2e3424367f69b92d",
    role: "bounded-prepare-dynlist-reference",
  }),
  Object.freeze({
    id: "n64decomp-sm64",
    directory: "sm64",
    remote: "https://github.com/n64decomp/sm64.git",
    revision: "9921382a68bb0c865e5e45eb594d9c64db59b1af",
    role: "authoritative-source-reference",
  }),
]);

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function resolveCheckout(root, spec) {
  return resolve(root, spec.directory);
}

export function inspectUpstreamCheckout(spec, root = resolve(".local/upstreams")) {
  const checkout = resolveCheckout(root, spec);
  if (!existsSync(checkout)) {
    return { id: spec.id, ok: false, state: "missing", expectedRevision: spec.revision };
  }

  const isRepo = git(checkout, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (isRepo.status !== 0 || isRepo.stdout.trim() !== "true") {
    return { id: spec.id, ok: false, state: "not-git", expectedRevision: spec.revision };
  }

  const remote = git(checkout, ["remote", "get-url", "origin"], { allowFailure: true });
  const head = git(checkout, ["rev-parse", "HEAD"], { allowFailure: true });
  const dirty = git(checkout, ["status", "--porcelain", "--untracked-files=normal"]);
  const actualRemote = remote.status === 0 ? remote.stdout.trim() : null;
  const actualRevision = head.status === 0 ? head.stdout.trim() : null;
  const issues = [];

  if (actualRemote !== spec.remote) issues.push("origin-url-mismatch");
  if (actualRevision !== spec.revision) issues.push("revision-mismatch");
  if (dirty.stdout.trim()) issues.push("dirty-checkout");

  return {
    id: spec.id,
    ok: issues.length === 0,
    state: issues.length === 0 ? "qualified" : "drifted",
    expectedRevision: spec.revision,
    actualRevision,
    expectedRemote: spec.remote,
    actualRemote,
    dirty: Boolean(dirty.stdout.trim()),
    issues,
  };
}

function initializeCheckout(spec, root) {
  mkdirSync(root, { recursive: true });
  const checkout = resolveCheckout(root, spec);
  mkdirSync(checkout, { recursive: true });
  git(checkout, ["init", "-q"]);
  git(checkout, ["remote", "add", "origin", spec.remote]);
  git(checkout, ["fetch", "--no-tags", "--depth", "1", "origin", spec.revision]);
  git(checkout, ["checkout", "--quiet", "--detach", spec.revision]);
}

function restoreRevision(spec, root) {
  const checkout = resolveCheckout(root, spec);
  const hasCommit = git(checkout, ["cat-file", "-e", `${spec.revision}^{commit}`], { allowFailure: true });
  if (hasCommit.status !== 0) {
    git(checkout, ["fetch", "--no-tags", "--depth", "1", "origin", spec.revision]);
  }
  git(checkout, ["checkout", "--quiet", "--detach", spec.revision]);
}

export function synchronizeUpstream(spec, {
  root = resolve(".local/upstreams"),
  offline = false,
  check = false,
} = {}) {
  const before = inspectUpstreamCheckout(spec, root);
  if (before.ok) return { ...before, changed: false };

  if (check || offline) {
    throw new Error(`${spec.id} is ${before.state}: ${before.issues?.join(", ") || "checkout missing"}`);
  }
  if (before.dirty) {
    throw new Error(`${spec.id} is dirty; refusing to overwrite local upstream work.`);
  }
  if (before.state === "not-git") {
    throw new Error(`${spec.id} exists but is not a Git checkout; refusing to replace it.`);
  }
  if (before.issues?.includes("origin-url-mismatch")) {
    throw new Error(`${spec.id} has an unexpected origin; refusing to retarget it.`);
  }

  if (before.state === "missing") initializeCheckout(spec, root);
  else restoreRevision(spec, root);

  const after = inspectUpstreamCheckout(spec, root);
  if (!after.ok) {
    throw new Error(`${spec.id} did not reach its qualified revision.`);
  }
  return { ...after, changed: true };
}

export function synchronizeAllUpstreams(options = {}) {
  return SM64_UPSTREAMS.map((spec) => synchronizeUpstream(spec, options));
}
