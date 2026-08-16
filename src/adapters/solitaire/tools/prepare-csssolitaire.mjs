#!/usr/bin/env node
import { prepareCsssolitaire } from "../src/prepare/csssolitaire/prepare.mjs";

prepareCsssolitaire().then(({ outputRoot, manifest }) => {
  process.stdout.write(`${JSON.stringify({
    status: manifest.status,
    outputRoot,
    metrics: manifest.metrics,
  }, null, 2)}\n`);
}).catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
