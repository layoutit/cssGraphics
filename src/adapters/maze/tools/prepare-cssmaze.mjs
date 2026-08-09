#!/usr/bin/env node
import { prepareCssmaze } from "../src/prepare/cssmaze/prepare.mjs";

const options = parseArgs(process.argv.slice(2));

prepareCssmaze(options).then((result) => {
  console.log(JSON.stringify({
    manifest: result.manifestPath,
    defaultScene: result.manifest.defaultScene,
    preparedBank: {
      sceneCount: result.manifest.preparedBank.sceneIds.length,
      seeds: result.manifest.preparedBank.seeds,
      rotationScores: result.manifest.preparedBank.rotationScores,
    },
    metrics: result.manifest.metrics,
  }, null, 2));
}).catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  if (parsed.output) process.env.CSSMAZE_GENERATED_PUBLIC_DIR = parsed.output;
  return {
    sourceRoot: parsed["source-root"],
    seed: parsed.seed,
  };
}
