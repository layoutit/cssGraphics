#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { qualifyGalaxySeeds } from "../src/prepare/cssgalaxy/seedQualification.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const reportPath = resolve(repositoryRoot, "bench/results/cssgalaxy/seed-curation/report.json");
const report = qualifyGalaxySeeds();
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  selectedSeeds: report.selectedSeeds,
  finalists: report.finalists.map(({ seed, score, qualified, gates, preparedStreamColors, metrics }) =>
    ({ seed, score, qualified, gates, preparedStreamColors, metrics })),
}, null, 2));
