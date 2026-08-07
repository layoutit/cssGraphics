#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  inspectCssgearsProductBank,
  writeCssgearsProductBankDescriptor,
} from "./productBank.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  throw new Error("Usage: package-product-bank.mjs --source <public/cssgears> [--output <directory>]");
}
const sourceRoot = resolve(args.source);
const outputRoot = resolve(args.output ?? "build/generated/public/cssgears");
const stagingRoot = `${outputRoot}.staging-${process.pid}`;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(dirname(stagingRoot), { recursive: true });
await copyProductClosure(sourceRoot, stagingRoot);

try {
  await rm(resolve(stagingRoot, "product-bank.json"), { force: true });
  const summary = await inspectCssgearsProductBank(stagingRoot, { verifyDescriptor: false });
  await writeCssgearsProductBankDescriptor(stagingRoot, summary);
  await inspectCssgearsProductBank(stagingRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
  process.stdout.write(`${JSON.stringify({ outputRoot, ...summary }, null, 2)}\n`);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function copyProductClosure(source, target) {
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  const paths = new Set(["manifest.json", productPath(manifest.showreel?.snapshotUrl)]);
  for (const scene of manifest.scenes ?? []) {
    paths.add(productPath(scene.sceneUrl));
    paths.add(productPath(scene.snapshotUrl));
    const payload = JSON.parse(gunzipSync(
      await readFile(join(source, productPath(scene.sceneUrl))),
    ).toString("utf8"));
    paths.add(productPath(payload.lighting?.assetUrl));
  }
  for (const path of paths) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(source, path), join(target, path));
  }
}

function productPath(url) {
  if (typeof url !== "string" || !url.startsWith("/cssgears/") || url.includes("..")) {
    throw new Error(`Unsafe cssGears product URL ${url}`);
  }
  return url.slice("/cssgears/".length);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed[argument.slice(2)] = true;
    else {
      parsed[argument.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}
