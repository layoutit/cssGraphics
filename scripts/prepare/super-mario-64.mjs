#!/usr/bin/env node

import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  package as packageModel,
  prepare,
} from "../../dist/cli/src/adapters/super-mario-64/index.mjs";
import {
  generatedOutputPath,
  localInputPath,
  replaceGeneratedOutput,
} from "../../src/prepare/shared/output.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const options = {
  rom: process.env.SM64_ROM ?? null,
  outputRoot: null,
  preparedRoot: null,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--") continue;
  if (!["--rom", "--output-root", "--prepared-root"].includes(argument)
    || !process.argv[index + 1]) {
    throw new Error(
      "Usage: pnpm prepare:super-mario-64 -- --rom <.local/rom.z64> "
      + "[--output-root <build/generated/path>] "
      + "[--prepared-root <build/generated/path>]",
    );
  }
  const key = argument === "--rom"
    ? "rom"
    : argument === "--output-root"
      ? "outputRoot"
      : "preparedRoot";
  if (options[key]) throw new Error(`${argument} may be supplied once.`);
  options[key] = process.argv[index + 1];
  index += 1;
}
if (!options.rom) throw new Error("Provide a user-owned ROM with --rom or SM64_ROM.");

const romPath = localInputPath(repoRoot, options.rom, "The Super Mario 64 ROM");
const target = generatedOutputPath(
  repoRoot,
  options.outputRoot,
  "build/generated/public/cssgraphics/models/mario",
  "Prepared Super Mario 64 output",
);
const reportRoot = resolve(repoRoot, `build/reports/prepare-super-mario-64-${process.pid}`);
const retainedPreparedRoot = options.preparedRoot
  ? generatedOutputPath(
    repoRoot,
    options.preparedRoot,
    null,
    "Prepared Super Mario 64 closure",
  )
  : null;
const result = await replaceGeneratedOutput({
  target,
  prefix: ".super-mario-64-package-",
  async build(outputRoot) {
    const preparedRoot = retainedPreparedRoot ?? `${outputRoot}.prepared`;
    try {
      const prepared = await prepare({
        repoRoot,
        romPath,
        outputRoot: preparedRoot,
        reportRoot,
      });
      const packaged = await packageModel({
        prepared: prepared.packageInput,
        outputRoot,
      });
      return { prepared, packaged };
    } finally {
      if (!retainedPreparedRoot) {
        rmSync(preparedRoot, { recursive: true, force: true });
      }
      rmSync(reportRoot, { recursive: true, force: true });
    }
  },
});
const manifest = JSON.parse(readFileSync(resolve(target, "manifest.json"), "utf8"));
process.stdout.write(
  `Prepared and packaged Super Mario 64 ${manifest.id} generation ${manifest.generationHash}.\n`,
);
void result;
