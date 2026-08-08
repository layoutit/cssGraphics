#!/usr/bin/env node
import { prepareCssmenger } from "../src/prepare/cssmenger/prepare.mjs";

const options = parseArgs(process.argv.slice(2));

prepareCssmenger(options).then((result) => {
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
    dataRoot: out["data-root"],
    dataUrl: out["data-url"],
    dataSha256: out["data-sha256"],
  };
}
