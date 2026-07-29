#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(repoRoot, "dist/cli");
rmSync(outputRoot, { recursive: true, force: true });
execFileSync(process.execPath, [
  fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
  "--project",
  resolve(repoRoot, "tsconfig.cli.json"),
], {
  cwd: repoRoot,
  stdio: "inherit",
});
chmodSync(resolve(outputRoot, "src/cli/cssgraphics.mjs"), 0o755);
execFileSync(process.execPath, [
  fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
  resolve(repoRoot, "src/index.ts"),
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir", resolve(repoRoot, "dist/runtime"),
  "--rootDir", resolve(repoRoot, "src"),
  "--target", "ES2022",
  "--module", "ESNext",
  "--moduleResolution", "Bundler",
  "--lib", "ES2022,DOM,DOM.Iterable",
  "--strict",
  "--skipLibCheck",
], {
  cwd: repoRoot,
  stdio: "inherit",
});
for (const directory of ["adapters", "model-package", "runtime"]) {
  rmSync(resolve(repoRoot, "dist/runtime", directory), {
    recursive: true,
    force: true,
  });
}

const auditOutput = resolve(
  outputRoot,
  "src/adapters/super-mario-64/audit/index.html",
);
mkdirSync(dirname(auditOutput), { recursive: true });
writeFileSync(
  auditOutput,
  readFileSync(
    resolve(repoRoot, "src/adapters/super-mario-64/audit/index.html"),
    "utf8",
  ).replace("./client.ts", "./client.js"),
);
copyFileSync(
  resolve(repoRoot, "src/adapters/super-mario-64/audit/audit.css"),
  resolve(outputRoot, "src/adapters/super-mario-64/audit/audit.css"),
);
