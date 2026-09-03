#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const generatedPublicRoot = resolve(repositoryRoot, "build/generated/public");
const deployRoot = resolve(repositoryRoot, "dist/site");
const products = [
  [resolve(generatedPublicRoot, "csspipes"), "csspipes"],
  [resolve(generatedPublicRoot, "csscloth"), "csscloth"],
  [resolve(generatedPublicRoot, "cssgears"), "cssgears"],
  [resolve(generatedPublicRoot, "csscyclone"), "csscyclone"],
  [resolve(repositoryRoot, "build/generated/cssgalaxy-product-public/cssgalaxy"), "cssgalaxy"],
  [resolve(generatedPublicRoot, "csschaos"), "csschaos"],
  [resolve(generatedPublicRoot, "cssblackhole"), "cssblackhole"],
  [resolve(generatedPublicRoot, "cssmenger"), "cssmenger"],
  [resolve(generatedPublicRoot, "cssmaze"), "cssmaze"],
  [resolve(generatedPublicRoot, "cssselectropaint"), "cssselectropaint"],
  [resolve(generatedPublicRoot, "csssolitaire"), "csssolitaire"],
  [resolve(generatedPublicRoot, "csscityflow"), "csscityflow"],
];

await rm(deployRoot, { recursive: true, force: true });
await mkdir(deployRoot, { recursive: true });
for (const [source, directory] of products) {
  await cp(source, resolve(deployRoot, directory), { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  status: "ready",
  deployRoot,
  products: products.map(([, directory]) => directory),
}, null, 2)}\n`);
