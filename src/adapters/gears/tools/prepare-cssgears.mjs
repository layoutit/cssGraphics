#!/usr/bin/env node
import { prepareCssgears } from "../src/prepare/cssgears/prepare.mjs";

const options = parseArgs(process.argv.slice(2));

prepareCssgears(options).then((result) => {
  console.log(JSON.stringify({
    manifest: result.manifestPath,
    scenes: result.manifest.scenes,
  }, null, 2));
}).catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return {
    scene: out.scene,
    sourceRoot: out["source-root"],
    seed: out.seed,
    seeds: out.seeds,
  };
}
