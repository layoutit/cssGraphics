#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CSSPIPES_ADAPTER_ROOT,
  CSSPIPES_GENERATED_PUBLIC_ROOT,
  CSSPIPES_REPO_ROOT,
} from "../src/prepare/csspipes/paths.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PREPARE_CHILD = "CSSPIPES_PREPARE_IN_PLACE";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: CSSPIPES_REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
    ...options,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function prepareInPlace() {
  const { prepareCssPipesScene } = await import(
    "../src/prepare/csspipes/prepare.mjs"
  );
  const prepared = await prepareCssPipesScene();
  console.log(
    `Prepared ${prepared.scene.id}: ${prepared.scene.metrics.clipCount} clips, ${prepared.scene.metrics.preparedLeafCount} retained leaves`,
  );
  run(process.execPath, [resolve(CSSPIPES_ADAPTER_ROOT, "tools/prepare-polycss-snapshot.mjs")]);
  run(process.execPath, [resolve(CSSPIPES_ADAPTER_ROOT, "tools/verify-generated-artifacts.mjs")], {
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function publishPreparedDirectory() {
  const generatedRoot = resolve(CSSPIPES_REPO_ROOT, "build/generated");
  await mkdir(generatedRoot, { recursive: true });
  const stagingRoot = await mkdtemp(resolve(generatedRoot, ".csspipes-prepare-"));
  const stagingPublicDir = resolve(stagingRoot, "public");
  const stagedProductRoot = resolve(stagingPublicDir, "csspipes");
  const backupRoot = `${CSSPIPES_GENERATED_PUBLIC_ROOT}.backup-${process.pid}`;
  try {
    run(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        [PREPARE_CHILD]: "1",
        CSSPIPES_GENERATED_PUBLIC_DIR: stagingPublicDir,
      },
    });
    await mkdir(dirname(CSSPIPES_GENERATED_PUBLIC_ROOT), { recursive: true });
    const hadPrevious = await exists(CSSPIPES_GENERATED_PUBLIC_ROOT);
    if (hadPrevious) await rename(CSSPIPES_GENERATED_PUBLIC_ROOT, backupRoot);
    try {
      await rename(stagedProductRoot, CSSPIPES_GENERATED_PUBLIC_ROOT);
    } catch (error) {
      if (hadPrevious) await rename(backupRoot, CSSPIPES_GENERATED_PUBLIC_ROOT);
      throw error;
    }
    if (hadPrevious) await rm(backupRoot, { recursive: true, force: true });
    console.log("Published verified cssPipes artifacts atomically");
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

if (process.env[PREPARE_CHILD] === "1") {
  await prepareInPlace();
} else {
  await publishPreparedDirectory();
}
