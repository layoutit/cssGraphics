#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { buildCssGraphicsCatalog } from "../../dist/cli/src/cli/catalog.mjs";

if (process.argv.length !== 2) {
  throw new Error("Usage: pnpm prepare:catalog");
}
const repoRoot = resolve(import.meta.dirname, "../..");
const cssgraphicsRoot = resolve(repoRoot, "build/generated/public/cssgraphics");
const output = resolve(cssgraphicsRoot, "catalog.json");
const staging = `${output}.next-${process.pid}`;
const modelsRoot = resolve(cssgraphicsRoot, "models");
const modelRoots = existsSync(modelsRoot)
  ? readdirSync(modelsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)
      && existsSync(resolve(modelsRoot, entry.name, "manifest.json")))
    .map((entry) => resolve(modelsRoot, entry.name))
    .sort()
  : [];
if (modelRoots.length === 0) {
  throw new Error("No prepared cssGraphics model packages were found.");
}
const result = await buildCssGraphicsCatalog({ modelRoots });
mkdirSync(dirname(output), { recursive: true });
try {
  writeFileSync(staging, result.bytes);
  renameSync(staging, output);
} finally {
  rmSync(staging, { force: true });
}
process.stdout.write(
  `Prepared ${result.catalog.models.length}-model catalog with ${result.catalog.defaultId} as default.\n`,
);
