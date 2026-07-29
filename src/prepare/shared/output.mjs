import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export function pathIsInside(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

export function generatedOutputPath(repoRoot, value, fallback, label = "Prepared output") {
  const generatedRoot = resolve(repoRoot, "build/generated");
  const output = resolve(repoRoot, value ?? fallback);
  if (!pathIsInside(generatedRoot, output) || output === generatedRoot) {
    throw new Error(`${label} must be an isolated directory under ignored build/generated/.`);
  }
  return output;
}

export function localInputPath(repoRoot, value, label) {
  const localRoot = resolve(repoRoot, ".local");
  const input = resolve(repoRoot, value);
  if (!pathIsInside(localRoot, input) || !existsSync(input)) {
    throw new Error(`${label} must already exist under ignored .local/.`);
  }
  return input;
}

export async function replaceGeneratedOutput({
  target,
  prefix,
  build,
}) {
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(resolve(dirname(target), prefix));
  const backup = `${target}.previous-${process.pid}`;
  let built = false;
  let movedPrevious = false;
  try {
    const result = await build(staging);
    built = true;
    if (existsSync(backup)) {
      throw new Error(`Refusing to overwrite existing output backup ${backup}.`);
    }
    if (existsSync(target)) {
      renameSync(target, backup);
      movedPrevious = true;
    }
    renameSync(staging, target);
    if (movedPrevious) rmSync(backup, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (movedPrevious && !existsSync(target) && existsSync(backup)) {
      renameSync(backup, target);
    }
    throw error;
  } finally {
    if (!built || existsSync(staging)) {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
