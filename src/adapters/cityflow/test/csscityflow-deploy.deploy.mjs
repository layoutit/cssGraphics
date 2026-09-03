// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/csscityflow");
const deployedAssetsRoot = resolve(repositoryRoot, "dist/site/csscityflow");
const deployedRouteRoot = resolve(repositoryRoot, "dist/site/cityflow");

test("atomic site deploy contains the exact Cityflow tree and current shared shell", async () => {
  const [generated, deployed, routeFiles, html] = await Promise.all([
    digestTree(generatedRoot),
    digestTree(deployedAssetsRoot),
    listFiles(deployedRouteRoot),
    readFile(resolve(deployedRouteRoot, "index.html"), "utf8"),
  ]);
  assert.deepEqual(deployed, generated);
  assert.ok(generated.has("prepared.json"));
  assert.ok(generated.has("cityflow.playback.json"));
  assert.ok(routeFiles.includes("index.html"));
  assert.equal(routeFiles.filter((path) => path === "index.html").length, 1);
  const bundles = routeFiles.filter((path) => path !== "index.html");
  assert.ok(bundles.length >= 2);
  assert.ok(bundles.every((path) =>
    /^assets\/[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u.test(path)),
  `unhashed or unexpected Cityflow route file: ${bundles.join(", ")}`);
  assert.match(html, /data-project-id="cityflow"/u);
  assert.match(html, /(?:src|href)="\/cityflow\/assets\//u);
  assert.doesNotMatch(html, /noindex|nofollow/u);
});

test("public Cityflow attribution, previews, preparation, and cache contracts are complete", async () => {
  const [manifestText, netlify, packageJson, astroConfig, notice, sourceAuthority, preview, sidebar] =
    await Promise.all([
      readFile(resolve(repositoryRoot, "site/public/projects.json"), "utf8"),
      readFile(resolve(repositoryRoot, "netlify.toml"), "utf8"),
      readFile(resolve(repositoryRoot, "package.json"), "utf8"),
      readFile(resolve(repositoryRoot, "astro.config.mjs"), "utf8"),
      readFile(resolve(repositoryRoot, "src/adapters/cityflow/NOTICE.md"), "utf8"),
      readFile(resolve(repositoryRoot,
        "src/adapters/cityflow/src/prepare/csscityflow/sourceAuthority.mjs"), "utf8"),
      sharp(resolve(repositoryRoot, "site/public/landing/cityflow.webp")).metadata(),
      sharp(resolve(repositoryRoot, "site/public/landing/sidebar/cityflow.webp")).metadata(),
    ]);
  const project = JSON.parse(manifestText).projects.find(({ id }) => id === "cityflow");
  assert.equal(project?.number, 12);
  assert.equal(project?.route, "/cityflow/");
  assert.equal(project?.preview, "/landing/cityflow.webp");
  assert.equal(preview.width, 960);
  assert.equal(preview.height, 540);
  assert.equal(sidebar.width, 480);
  assert.equal(sidebar.height, 270);
  assert.match(packageJson, /"build:cityflow:deploy": "CSSCITYFLOW_DEPLOY_BUILD=1 pnpm build:cityflow"/u);
  assert.match(packageJson, /pnpm prepare:cityflow[^\n]+node scripts\/copy-deploy-products\.mjs/u);
  assert.match(astroConfig, /"\.css": "text\/css; charset=utf-8"/u);
  assert.match(netlify,
    /for = "\/csscityflow\/assets\/\*"[\s\S]*?Cache-Control = "public, max-age=31536000, immutable"/u);
  assert.match(netlify, /for = "\/csscityflow\/\*"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(sourceAuthority, /https:\/\/raw\.githubusercontent\.com\/\$\{segments\[0\]\}\/\$\{segments\[1\]\}/u);
  assert.match(notice, /Permission to use, copy, modify, distribute, and sell this software/u);
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
    entries.set(path, createHash("sha256").update(await readFile(resolve(root, path))).digest("hex"));
  }
  return entries;
}
