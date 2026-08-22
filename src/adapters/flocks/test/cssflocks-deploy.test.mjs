import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(repositoryRoot, "build/generated/public/cssflocks");
const deployedAssetsRoot = resolve(repositoryRoot, "dist/site/cssflocks");
const deployedRouteRoot = resolve(repositoryRoot, "dist/site/flocks");

test("deploy build contains the exact generated cssflocks tree and only hashed route bundles", async () => {
  const [generated, deployed, routeFiles] = await Promise.all([
    digestTree(generatedRoot),
    digestTree(deployedAssetsRoot),
    listFiles(deployedRouteRoot),
  ]);
  assert.equal(generated.size, 458);
  assert.deepEqual(deployed, generated);
  assert.ok(routeFiles.includes("index.html"));
  assert.equal(routeFiles.filter((path) => path === "index.html").length, 1);
  const bundles = routeFiles.filter((path) => path !== "index.html");
  assert.ok(bundles.length >= 3);
  assert.ok(bundles.every((path) => /^assets\/[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9_-]{8,}\.(?:css|js)$/u.test(path)),
    `unhashed or unexpected Flocks route file: ${bundles.join(", ")}`);
  assert.equal(routeFiles.some((path) => path.startsWith("cssflocks/") || path.startsWith("cssface/") || path.startsWith("cssgraphics/")), false);
  const html = await readFile(resolve(deployedRouteRoot, "index.html"), "utf8");
  assert.match(html, /(?:src|href)="\/flocks\/assets\//u);
});

test("Flocks deploy and cache policy are integrated without adding a landing project", async () => {
  const [vite, netlify, packageJson, landingManifest, landingHtml] = await Promise.all([
    readFile(resolve(repositoryRoot, "src/adapters/flocks/vite.config.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "netlify.toml"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(repositoryRoot, "site/public/projects.json"), "utf8"),
    readFile(resolve(repositoryRoot, "site/pages/index.astro"), "utf8"),
  ]);
  assert.match(vite, /publicDir:\s*deployBuild \? false : generatedPublicDir/u);
  assert.match(vite, /rm\(deployAssets,[^;]+force: true/u);
  assert.match(vite, /cp\(resolve\(generatedPublicDir, "cssflocks"\), deployAssets/u);
  assert.match(vite, /deployBuild \? "dist\/site\/flocks" : "dist\/flocks"/u);
  assert.match(netlify, /for = "\/cssflocks\/\*\/blocks\/\*"[\s\S]*?max-age=31536000, immutable/u);
  assert.match(netlify, /for = "\/cssflocks\/model\/\*"[\s\S]*?max-age=31536000, immutable/u);
  for (const path of ["manifest.json", "prepared.json"]) {
    assert.match(netlify, new RegExp(`for = "\\/cssflocks\\/${path.replace(".", "\\.")}"[\\s\\S]*?Cache-Control = "no-cache"`, "u"));
  }
  assert.match(netlify, /for = "\/cssflocks\/\*\/catalog\.json"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(netlify, /for = "\/cssflocks\/model\/catalog\.json"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(netlify, /for = "\/cssflocks\/scenes\/\*"[\s\S]*?Cache-Control = "no-cache"/u);
  assert.match(packageJson, /"build:flocks:deploy": "CSSFLOCKS_DEPLOY_BUILD=1 pnpm build:flocks"/u);
  assert.match(packageJson, /pnpm prepare:flocks[\s\S]*CSSFLOCKS_DEPLOY_BUILD=1 pnpm build:flocks/u);
  assert.match(packageJson, /"test:flocks:deploy"/u);
  assert.equal(JSON.parse(landingManifest).projects.some((project) => project.id === "flocks"), false);
  assert.doesNotMatch(landingHtml, /href="\/flocks\/"/u);
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
