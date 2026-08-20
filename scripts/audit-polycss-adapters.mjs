#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const slug = options.slug;
const namespace = `css${slug}`;
const adapterRoot = resolve(repositoryRoot, "src/adapters", slug);
const checks = [];

check("adapter slug is safe", /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug), slug);
check("adapter root exists", existsSync(adapterRoot), repositoryPath(adapterRoot));

const packageManifest = readJson(resolve(repositoryRoot, "package.json"), "package.json parses");
const scripts = packageManifest?.scripts ?? {};
const requiredScripts = [
  `dev:${slug}`,
  `build:${slug}`,
  `build:${slug}:full`,
  `build:${slug}:deploy`,
  `prepare:${slug}`,
  `prepare:${slug}:check`,
  `test:${slug}`,
  `test:${slug}:assets`,
  `test:${slug}:browser`,
  `test:${slug}:deploy`,
  `capture:${slug}:reference`,
  `capture:${slug}:browser`,
  `compare:${slug}:visual`,
  `capture:${slug}:reference:frames`,
  `capture:${slug}:browser:frames`,
  `compare:${slug}:frames`,
];
for (const name of requiredScripts) {
  check(`package script ${name}`, typeof scripts[name] === "string" && scripts[name].trim().length > 0, scripts[name] ?? "missing");
}
check("package depends on @layoutit/polycss", typeof packageManifest?.dependencies?.["@layoutit/polycss"] === "string", packageManifest?.dependencies?.["@layoutit/polycss"] ?? "missing");
check("adapter audit script is wired", scripts["audit:adapters"] === "node scripts/audit-polycss-adapters.mjs", scripts["audit:adapters"] ?? "missing");

const requiredFiles = [
  ".env.example",
  "NOTICE.md",
  "README.md",
  "index.html",
  "vite.config.mjs",
  "src/main.mjs",
  `src/${namespace}/client.mjs`,
  `src/${namespace}/debugApi.mjs`,
  `src/${namespace}/devtoolsAttrs.mjs`,
  `src/${namespace}/manifestClient.mjs`,
  `src/${namespace}/polycssScene.mjs`,
  `src/${namespace}/routeState.mjs`,
  `src/${namespace}/styles.css`,
  `src/prepare/${namespace}/paths.mjs`,
  `src/prepare/${namespace}/dataSource.mjs`,
  `src/prepare/${namespace}/slicePlan.mjs`,
  `src/prepare/${namespace}/formatAdapters.mjs`,
  `src/prepare/${namespace}/prepare.mjs`,
  `src/prepare/${namespace}/sceneBuilder.mjs`,
  `src/prepare/${namespace}/writeManifest.mjs`,
  `src/prepare/${namespace}/provenance.mjs`,
  `tools/prepare-${namespace}.mjs`,
  "tools/check-prepare-determinism.mjs",
  "tools/smoke-browser.mjs",
  "tools/capture-reference-frame.mjs",
  "tools/capture-browser-frame.mjs",
  "tools/compare-reference-frame.mjs",
  "tools/frameSequenceArtifacts.mjs",
  "tools/capture-reference-frames.mjs",
  "tools/capture-browser-frames.mjs",
  "tools/compare-frame-sequence.mjs",
  `test/${namespace}-route-state.test.mjs`,
  `test/${namespace}-assets.test.mjs`,
  `test/${namespace}-source-lock.test.mjs`,
  "notes/references/source-lock.json",
];
for (const path of requiredFiles) {
  check(`adapter file ${path}`, existsSync(resolve(adapterRoot, path)), path);
}

const sourceLock = readJson(resolve(adapterRoot, "notes/references/source-lock.json"), "source lock parses");
check("source lock schema", sourceLock?.schema === `${namespace}-source-lock@1`, sourceLock?.schema ?? "missing");
check("source revision is pinned", /^[0-9a-f]{40}$/u.test(sourceLock?.revision ?? ""), sourceLock?.revision ?? "missing");
check("source digest is pinned", /^[0-9a-f]{64}$/u.test(sourceLock?.sha256 ?? ""), sourceLock?.sha256 ?? "missing");
check("adapter source license is GPL-2.0-or-later", sourceLock?.license === "GPL-2.0-or-later", sourceLock?.license ?? "missing");
const dependencyLicenses = Object.values(sourceLock?.dependencies ?? {}).flatMap((dependency) =>
  (dependency?.files ?? []).map((file) => file?.license));
check("source dependency licenses are explicit", dependencyLicenses.length > 0 && dependencyLicenses.every((license) => typeof license === "string" && license.length > 0), dependencyLicenses.join(", ") || "missing");

const readme = readAdapter("README.md");
const notice = readAdapter("NOTICE.md");
const envExample = readAdapter(".env.example");
for (const value of [sourceLock?.revision, sourceLock?.path, sourceLock?.sha256, sourceLock?.license]) {
  check(`notice records ${value}`, typeof value === "string" && notice.includes(value), value ?? "missing");
}
check("notice records dependency license", notice.includes("LGPL-2.1-or-later"), "NOTICE.md");
check("notice points to GPL terms", notice.includes("src/adapters/electropaint/LICENSE.GPL-2.0") && existsSync(resolve(repositoryRoot, "src/adapters/electropaint/LICENSE.GPL-2.0")), "NOTICE.md");
check("documentation has no bootstrap status language", !/first[ -]slice|placeholder|remain(?:s)? later gate|reserved for a later deploy/iu.test(`${readme}\n${notice}\n${envExample}`), "README.md, NOTICE.md, .env.example");
check("environment documents generated root", /CSSFLOCKS_GENERATED_PUBLIC_DIR=/u.test(envExample), ".env.example");
check("environment documents deploy switch", /CSSFLOCKS_DEPLOY_BUILD=0/u.test(envExample), ".env.example");

const documentedCommands = [...readme.matchAll(/^pnpm\s+([^\s]+)/gmu)].map((match) => match[1]);
for (const command of documentedCommands) {
  check(`documented command ${command}`, typeof scripts[command] === "string", scripts[command] ?? "missing package script");
}
check("README documents every promotion command", [
  "audit:adapters",
  "verify:source-only",
  `prepare:${slug}:check`,
  `test:${slug}`,
  `test:${slug}:browser`,
  `capture:${slug}:reference:frames`,
  `capture:${slug}:browser:frames`,
  `compare:${slug}:frames`,
  `build:${slug}:deploy`,
  `test:${slug}:deploy`,
].every((name) => documentedCommands.includes(name)), documentedCommands.join(", "));
check("README names only ignored evidence roots", [...readme.matchAll(/`((?:bench\/results|build\/generated)[^`]+)`/gu)]
  .every((match) => match[1].startsWith("bench/results/") || match[1].startsWith("build/generated/")), "README.md");

const viteConfig = readAdapter("vite.config.mjs");
check("Vite uses generated public assets in development", viteConfig.includes("publicDir: deployBuild ? false : generatedPublicDir"), "vite.config.mjs");
check("Vite deploy copies only adapter assets", viteConfig.includes(`dist/site/${namespace}`) && viteConfig.includes(`resolve(generatedPublicDir, "${namespace}")`), "vite.config.mjs");
check("Vite deploy route is adapter-scoped", viteConfig.includes(`base: deployBuild ? "/${slug}/"`) && viteConfig.includes(`"dist/site/${slug}"`), "vite.config.mjs");

const gitignore = readFileSync(resolve(repositoryRoot, ".gitignore"), "utf8");
for (const ignored of [".local/", "build/generated/", "bench/results/", "dist/"]) {
  check(`gitignore contains ${ignored}`, gitignore.split(/\r?\n/u).includes(ignored), ".gitignore");
}
check("no standalone-layout aliases were added", !existsSync(resolve(repositoryRoot, "src", slug)) &&
  !existsSync(resolve(repositoryRoot, "tools", `prepare-${slug}.mjs`)), `src/${slug}, tools/prepare-${slug}.mjs`);
const adapterSource = walk(adapterRoot).filter((path) => /\.(?:mjs|js|ts|css|html|md|json|cpp|h)$/u.test(path))
  .map((path) => readFileSync(path, "utf8")).join("\n");
check("adapter source has no checkout-specific absolute path", !/(?:\/Users\/|\/home\/)[^\s"'`]+|\.codex\/skills/iu.test(adapterSource), "src/adapters/<slug>");

const spdxFiles = [
  `src/prepare/${namespace}/modelBuilder.mjs`,
  `src/prepare/${namespace}/prepare.mjs`,
  `src/prepare/${namespace}/provenance.mjs`,
  `src/prepare/${namespace}/sourceModel.mjs`,
  `src/prepare/${namespace}/terminalSeam.mjs`,
  `src/shared/${namespace}/bugTransform.mjs`,
  `src/shared/${namespace}/preparedBlockTransport.mjs`,
  "tools/native-geometry-oracle.cpp",
  "tools/native-sequence-oracle.cpp",
  "tools/native-state-oracle.cpp",
];
for (const path of spdxFiles) {
  check(`SPDX ${path}`, readAdapter(path).includes("SPDX-License-Identifier: GPL-2.0-or-later"), path);
}

const runtimePaths = walk(resolve(adapterRoot, "src", namespace)).filter((path) => /\.(?:mjs|css)$/u.test(path));
const runtimeSource = runtimePaths.map((path) => `${repositoryPath(path)}\n${readFileSync(path, "utf8")}`).join("\n");
const forbiddenRuntime = [
  ["Canvas construction", /createElement\(\s*["']canvas["']|OffscreenCanvas/iu],
  ["drawing context", /getContext\(\s*["'](?:2d|bitmaprenderer|webgl2?|webgpu)["']/iu],
  ["GPU renderer", /WebGL(?:2)?RenderingContext|navigator\.gpu|GPUCanvasContext/iu],
  ["runtime geometry", /runtimeGeometryConstructionCount\s*\+=|createElementNS\(/iu],
];
for (const [label, pattern] of forbiddenRuntime) check(`runtime avoids ${label}`, !pattern.test(runtimeSource), label);
const css = readAdapter(`src/${namespace}/styles.css`);
for (const [label, pattern] of [
  ["clipping", /clip-path\s*:/iu],
  ["masking", /(?:^|[;{])\s*(?:-webkit-)?mask(?:-image)?\s*:/imu],
  ["filters", /(?:^|[;{])\s*(?:backdrop-)?filter\s*:/imu],
  ["shadows", /(?:box|text)-shadow\s*:/iu],
  ["gradients", /(?:linear|radial|conic)-gradient\s*\(/iu],
  ["blend modes", /(?:mix|background)-blend-mode\s*:/iu],
]) check(`adapter CSS avoids ${label}`, !pattern.test(css), `src/${namespace}/styles.css`);

const tracked = execFileSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean);
check("generated and evidence trees are untracked", tracked.every((path) =>
  !["build/generated/", "bench/results/", ".local/", "dist/"].some((prefix) => path.startsWith(prefix))), "git ls-files");

const result = Object.freeze({
  schema: "cssgraphics-adapter-audit@1",
  root: repositoryRoot,
  slug,
  namespace,
  ok: checks.every((entry) => entry.ok),
  checks,
});
if (options.json) console.log(JSON.stringify(result, null, 2));
else {
  for (const entry of checks) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.ok ? "" : `: ${entry.detail}`}`);
  console.log(`Adapter audit ${result.ok ? "passed" : "failed"}: ${checks.filter((entry) => entry.ok).length}/${checks.length} checks`);
}
if (!result.ok) process.exitCode = 1;

function check(name, ok, detail) {
  checks.push(Object.freeze({ name, ok: Boolean(ok), detail: String(detail) }));
}

function readAdapter(path) {
  const absolute = resolve(adapterRoot, path);
  if (!existsSync(absolute)) return "";
  return readFileSync(absolute, "utf8");
}

function readJson(path, checkName) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    check(checkName, true, repositoryPath(path));
    return value;
  } catch (error) {
    check(checkName, false, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function parseArguments(argumentsList) {
  let parsedSlug = "";
  let json = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--slug") parsedSlug = argumentsList[++index] ?? "";
    else if (argument === "--json") json = true;
    else throw new Error(`Unknown adapter-audit argument: ${argument}`);
  }
  if (!parsedSlug) throw new Error("Adapter audit requires --slug <adapter>");
  return Object.freeze({ slug: parsedSlug, json });
}
