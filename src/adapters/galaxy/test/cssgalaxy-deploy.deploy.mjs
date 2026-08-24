// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/cssgalaxy-product-public/cssgalaxy");
const deployedAssetsRoot = resolve(repositoryRoot, "dist/site/cssgalaxy");
const deployedRouteRoot = resolve(repositoryRoot, "dist/site/galaxy");

test("deploy build contains the exact prepared Galaxy tree and scoped route bundles", async () => {
  const [generated, deployed, routeFiles, html] = await Promise.all([
    digestTree(generatedRoot),
    digestTree(deployedAssetsRoot),
    listFiles(deployedRouteRoot),
    readFile(resolve(deployedRouteRoot, "index.html"), "utf8"),
  ]);
  assert.equal(generated.size, 15);
  assert.deepEqual(deployed, generated);
  assert.ok(routeFiles.includes("index.html"));
  assert.ok(routeFiles.filter((path) => path !== "index.html").every((path) =>
    /^assets\/[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u.test(path)),
  `unexpected Galaxy route output: ${routeFiles.join(", ")}`);
  assert.equal(routeFiles.some((path) => path.startsWith("cssgalaxy/")), false);
  assert.match(html, /(?:src|href)="\/galaxy\/assets\//u);
  assert.doesNotMatch(html, /noindex|nofollow/u);
});

test("public Galaxy attribution, preview, source acquisition, and cache contracts are complete", async () => {
  const [manifestText, netlify, packageJson, notice, sourceAuthority, preview] = await Promise.all([
    readFile(resolve(repositoryRoot, "site/public/projects.json"), "utf8"),
    readFile(resolve(repositoryRoot, "netlify.toml"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "src/adapters/galaxy/NOTICE.md"), "utf8"),
    readFile(resolve(repositoryRoot,
      "src/adapters/galaxy/src/prepare/cssgalaxy/sourceAuthority.mjs"), "utf8"),
    sharp(resolve(repositoryRoot, "site/public/landing/galaxy.webp")).metadata(),
  ]);
  const manifest = JSON.parse(manifestText);
  const project = manifest.projects.find(({ id }) => id === "galaxy");
  assert.equal(project?.number, 9);
  assert.equal(project?.route, "/galaxy/");
  assert.equal(project?.preview, "/landing/galaxy.webp");
  assert.match(project?.credits?.[0]?.url ?? "",
    /906693799e4fb7581436590cf84ecb2d3c9186ba\/hacks\/galaxy\.c$/u);
  assert.equal(preview.width, 960);
  assert.equal(preview.height, 540);
  assert.match(packageJson, /"build:galaxy:deploy": "CSSGALAXY_DEPLOY_BUILD=1 pnpm build:galaxy"/u);
  assert.match(packageJson,
    /pnpm prepare:galaxy[^\n]+CSSGALAXY_DEPLOY_BUILD=1 pnpm build:galaxy/u);
  assert.match(netlify,
    /for = "\/cssgalaxy\/g3\/1500\/seed-2298\/\*\.bin\.br"[\s\S]*?Content-Encoding = "br"/u);
  assert.match(netlify,
    /for = "\/cssgalaxy\/g2\/1000\/seed-4947\/\*\.bin\.br"[\s\S]*?Content-Encoding = "br"/u);
  assert.match(netlify,
    /for = "\/cssgalaxy\/prepared\.json"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(netlify,
    /for = "\/cssgalaxy\/g3\/1500\/catalog\.json"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(netlify,
    /for = "\/cssgalaxy\/g2\/1000\/catalog\.json"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(sourceAuthority,
    /https:\/\/raw\.githubusercontent\.com\/\$\{segments\[0\]\}\/\$\{segments\[1\]\}/u);
  for (const required of [
    "Originally done by Uli Siegmund",
    "Port from Cluster/EGS to C/Intuition by Harald Backert",
    "Port to X11 and incorporation into xlockmore by Hubert Feyrer",
    "Permission to use, copy, modify, and distribute this software",
    "This file is provided AS IS with no warranties of any kind",
  ]) assert.match(notice, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path));
      else throw new Error(`Unexpected deploy entry ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}

async function digestTree(root) {
  const entries = new Map();
  for (const path of await listFiles(root)) {
    entries.set(path, createHash("sha256").update(
      await readFile(resolve(root, path))).digest("hex"));
  }
  return entries;
}
