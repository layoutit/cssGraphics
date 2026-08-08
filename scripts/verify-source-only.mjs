#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, lstatSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const SOURCE_ONLY_SCHEMA = 1;

const STRICT_SOURCE_RENDERER_PATTERNS = Object.freeze([
  ["canvas-construction", /createElement\(\s*["']canvas["']|new\s+OffscreenCanvas\b/iu],
  ["drawing-context", /getContext\(\s*["'](?:2d|bitmaprenderer|webgl2?|webgpu)["']/iu],
  ["gpu-runtime", /WebGL(?:2)?RenderingContext|navigator\.gpu|GPUCanvasContext/iu],
  ["wasm-runtime", /WebAssembly\.(?:compile|instantiate)|instantiateStreaming\(|\.wasm(?:\b|["'])/iu],
  ["emulator-runtime", /(?:from|import\s*)[\s\S]{0,80}["'][^"']*(?:dosbox|mupen64|retroarch|emulator)[^"']*["']/iu],
]);
const STRICT_AUDITOR_PATHS = new Set([
  "src/adapters/flowerbox/tools/audit-runtime-surface.mjs",
]);
const STRICT_PATH_GUARD_PATHS = new Set([
  "scripts/verify-source-only.mjs",
]);
const MACHINE_PATH_METADATA_PREFIXES = Object.freeze([
  "notes/burnlists/",
]);
const HOSTING_FILES = new Set([
  ".openai/hosting.json",
  "vercel.json",
  "firebase.json",
]);
const DISTRIBUTION_CATALOG_PATH = "site/public/catalog.json";
const DISTRIBUTION_CATALOG_SCHEMA = "cssgraphics.distribution@1";
const DISTRIBUTION_PREFIXES = Object.freeze([
  "site/public/models/",
  "site/public/previews/",
]);
const README_MEDIA_PATHS = new Set([
  "site/public/favicon.ico",
  "site/readme/animated-morph-sphere.gif",
  "site/readme/cube-to-sphere.gif",
  "site/readme/pipes.gif",
  "src/adapters/3dpipes/public/pipes-social.png",
  "src/adapters/flowerbox/public/flower-social.png",
]);
const SHA256 = /^[a-f0-9]{64}$/u;

const GENERATED_PREFIXES = Object.freeze([
  ".local/",
  "build/generated/",
  "build/reports/",
  "bench/results/",
  "node_modules/",
  "dist/",
  "coverage/",
  ".agents/",
  ".playwright-cli/",
  "debug/",
  "captures/",
  "traces/",
]);

const UPSTREAM_SHAPED_PREFIXES = Object.freeze([
  "upstreams/",
  "vendor/",
  "third_party/",
  "src/actors/",
  "src/levels/",
  "src/textures/",
  "src/audio/",
  "src/sound/",
  "src/text/",
]);

const DATA_EXTENSIONS = new Set([
  ".z64", ".n64", ".v64", ".rom",
  ".bin", ".raw", ".rgba16", ".rgba32", ".ia16", ".ia8", ".i8", ".ci8", ".ci4",
  ".obj", ".mtl", ".gltf", ".glb",
  ".wav", ".aiff", ".aif", ".aifc", ".m64", ".seq",
  ".ttf", ".otf", ".woff", ".woff2",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
]);

const ROM_HEADERS = Object.freeze([
  Buffer.from([0x80, 0x37, 0x12, 0x40]),
  Buffer.from([0x37, 0x80, 0x40, 0x12]),
  Buffer.from([0x40, 0x12, 0x37, 0x80]),
]);

const normalize = (value) => String(value).replaceAll("\\", "/").replace(/^\.\//, "");

export function inspectCandidatePath(candidatePath, bytes = null) {
  const path = normalize(candidatePath);
  const issues = [];

  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    issues.push("path must be a normalized repository-relative path");
    return issues;
  }

  if (GENERATED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    issues.push("generated, local-input, reference, or evidence path is not source-only");
  }
  if (UPSTREAM_SHAPED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    issues.push("upstream-shaped source/data tree is denied; use ignored prepare inputs");
  }

  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const extension = extname(basename);
  const readmeMedia = README_MEDIA_PATHS.has(path);
  if (basename.startsWith("baserom.")
    || (DATA_EXTENSIONS.has(extension) && !readmeMedia)) {
    issues.push(`Nintendo/game-data-capable extension or name is denied: ${extension || basename}`);
  }
  if (!path.startsWith("internal/")
    && /^(screenshot|capture|frame[-_]?\d+|trace)([._-]|$)/i.test(basename)) {
    issues.push("capture, screenshot, frame, or trace artifact is denied");
  }

  if (bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buffer.length === 8 * 1024 * 1024) {
      issues.push("an 8 MiB candidate may be a Nintendo 64 ROM");
    }
    if (ROM_HEADERS.some((header) => buffer.subarray(0, 4).equals(header))) {
      issues.push("Nintendo 64 ROM byte-order header detected");
    }
    if (buffer.includes(0) && !readmeMedia) {
      issues.push("unexpected binary content");
    }
    const sourceByteLimit = (readmeMedia ? 2 : 1) * 1024 * 1024;
    if (buffer.length > sourceByteLimit
      && !path.endsWith("pnpm-lock.yaml")) {
      issues.push(
        `unexpected source-only file larger than ${
          readmeMedia ? 2 : 1
        } MiB`,
      );
    }
  }

  return [...new Set(issues)];
}

function distributionContract(root) {
  const failures = [];
  const resources = new Map();
  const catalogPath = resolve(root, DISTRIBUTION_CATALOG_PATH);
  if (!existsSync(catalogPath)) {
    return {
      resources,
      failures: [`${DISTRIBUTION_CATALOG_PATH}: distribution catalog is missing`],
    };
  }

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    return {
      resources,
      failures: [
        `${DISTRIBUTION_CATALOG_PATH}: distribution catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const fail = (message) =>
    failures.push(`${DISTRIBUTION_CATALOG_PATH}: ${message}`);
  if (catalog?.schema !== DISTRIBUTION_CATALOG_SCHEMA) fail("unsupported schema");
  const runtime = catalog?.runtime;
  if (!runtime || runtime.package !== "@layoutit/polycss-morph"
    || typeof runtime.version !== "string"
    || typeof runtime.license !== "string") {
    fail("invalid runtime metadata");
  } else {
    const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    if (packageManifest.dependencies?.[runtime.package] !== runtime.version) {
      fail("runtime version does not match package.json");
    }
  }

  const addResource = (path, descriptor, label) => {
    if (resources.has(path)) {
      fail(`duplicate path ${path}`);
      return;
    }
    if (!descriptor || !Number.isSafeInteger(descriptor.bytes)
      || descriptor.bytes <= 0 || !SHA256.test(descriptor.sha256 ?? "")
      || !["application/json", "image/png", "image/webp", "text/css"]
        .includes(descriptor.mediaType)) {
      fail(`${label} has invalid metadata`);
      return;
    }
    resources.set(path, Object.freeze({
      bytes: descriptor.bytes,
      mediaType: descriptor.mediaType,
      sha256: descriptor.sha256,
    }));
    if (!existsSync(resolve(root, path))) {
      failures.push(`${path}: declared distribution resource is missing`);
    }
  };

  if (!Array.isArray(catalog?.assets) || catalog.assets.length === 0) {
    fail("assets are missing");
    return { resources, failures };
  }

  const ids = new Set();
  const roleFiles = {
    runtime: ["runtime.json", "application/json"],
    presentation: ["presentation.json", "application/json"],
    stylesheet: ["model.css", "text/css"],
    "animation-plan": ["animation-plan.json", "application/json"],
  };
  for (const asset of catalog.assets) {
    const id = asset?.id;
    if (typeof id !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)
      || ids.has(id)
      || asset.root !== `models/${id}`) {
      fail("asset identity is invalid");
      continue;
    }
    ids.add(id);
    const source = asset.source;
    if (!Array.isArray(source?.authors) || source.authors.length === 0
      || !source.url?.startsWith("https://")
      || !source.licenseUrl?.startsWith("https://")
      || !source.license || !source.changes || !SHA256.test(source.sha256 ?? "")) {
      fail(`asset ${id} source metadata is invalid`);
    }
    if (asset.preview?.path !== `previews/${id}.webp`
      || asset.preview.mediaType !== "image/webp") {
      fail(`asset ${id} preview is invalid`);
    } else {
      addResource(`site/public/${asset.preview.path}`, asset.preview, `${id} preview`);
    }

    const counts = new Map();
    for (const resource of asset.resources ?? []) {
      const spec = roleFiles[resource?.role];
      const isImage = resource?.role === "image";
      const pathIsSafe = typeof resource?.path === "string"
        && !resource.path.startsWith("/")
        && !resource.path.split("/").some((part) => part === "." || part === "..");
      if (!pathIsSafe || (!spec && !isImage)
        || (spec && (resource.path !== spec[0] || resource.mediaType !== spec[1]))
        || (isImage && (!resource.path.startsWith("assets/")
          || !["image/png", "image/webp"].includes(resource.mediaType)))) {
        fail(`asset ${id} resource is invalid`);
        continue;
      }
      counts.set(resource.role, (counts.get(resource.role) ?? 0) + 1);
      addResource(
        `site/public/${asset.root}/${resource.path}`,
        resource,
        `${id} ${resource.role}`,
      );
    }
    for (const role of ["runtime", "presentation", "stylesheet"]) {
      if (counts.get(role) !== 1) fail(`asset ${id} must declare one ${role}`);
    }
    const planCount = counts.get("animation-plan") ?? 0;
    if (!counts.get("image")
      || (asset.mode === "animation-clip" ? planCount !== 1 : planCount !== 0)) {
      fail(`asset ${id} image or animation-plan binding is invalid`);
    }
  }

  return { resources, failures };
}

function inspectDistributionResource(candidatePath, bytes, descriptor) {
  const issues = [];
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length !== descriptor.bytes) {
    issues.push("declared distribution byte size is stale");
  }
  if (createHash("sha256").update(buffer).digest("hex") !== descriptor.sha256) {
    issues.push("declared distribution sha256 is stale");
  }
  if (descriptor.mediaType === "application/json") {
    try {
      JSON.parse(buffer.toString("utf8"));
    } catch {
      issues.push("declared JSON resource is invalid");
    }
  } else if (descriptor.mediaType === "text/css") {
    if (buffer.includes(0)) issues.push("declared stylesheet contains binary data");
  } else if (descriptor.mediaType === "image/webp"
    && (buffer.length < 12
      || buffer.subarray(0, 4).toString("ascii") !== "RIFF"
      || buffer.subarray(8, 12).toString("ascii") !== "WEBP")) {
    issues.push("declared WebP resource has an invalid signature");
  } else if (descriptor.mediaType === "image/png"
    && !buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )) {
    issues.push("declared PNG resource has an invalid signature");
  }
  if (candidatePath.startsWith("site/public/previews/")
    && buffer.length > 256 * 1024) {
    issues.push("declared distribution preview is larger than 256 KiB");
  }
  return issues.map((issue) => `${normalize(candidatePath)}: ${issue}`);
}

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

export function verifyIgnoreContract(root = process.cwd()) {
  const mustBeIgnored = [
    ".local/roms/baserom.us.z64",
    ".local/upstreams/sm64js/src/index.js",
    "build/generated/public/cssgraphics/models/mario/manifest.json",
    "build/generated/public/cssgraphics/models/example-head/manifest.json",
    "build/reports/rom-qualification.json",
    "bench/results/title-head/reference/frame-0001.png",
    "dist/index.html",
    "captures/title-head.png",
    "traces/browser.trace.json",
    "node_modules/.source-only-sentinel",
    ".env",
  ];
  const mustRemainVisible = [
    DISTRIBUTION_CATALOG_PATH,
    "site/public/previews/box.webp",
    "src/index.ts",
  ];
  const issues = [];

  for (const path of mustBeIgnored) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: root });
    if (result.status !== 0) issues.push(`${path}: expected ignored`);
  }
  for (const path of mustRemainVisible) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: root });
    if (result.status === 0) issues.push(`${path}: source must remain visible`);
  }
  return issues;
}

function strictContentIssues(root, candidate, bytes) {
  const issues = [];
  if (HOSTING_FILES.has(candidate) || candidate.startsWith(".github/workflows/")) {
    issues.push("hosting or deployment configuration is outside the local-only product scope");
  }
  if (bytes.includes(0)) return issues;
  const source = bytes.toString("utf8");
  const machineRoot = resolve(root);
  const machineParent = resolve(machineRoot, "..");
  if (!STRICT_PATH_GUARD_PATHS.has(candidate)
    && !MACHINE_PATH_METADATA_PREFIXES.some((prefix) => candidate.startsWith(prefix))
    && (source.includes(machineRoot) || source.includes(`${machineParent}${sep}`) || source.includes("file://"))) {
    issues.push("machine-specific absolute path is denied");
  }
  const productContractCandidate = candidate.startsWith("src/")
    || ["README.md", "package.json"].includes(candidate);
  if (productContractCandidate
    && /castle-grounds-area-1-first-control|CASTLE_GROUNDS_SCENE|cssgraphics-castle-grounds/iu.test(source)) {
    issues.push("stale Castle Grounds product contract is denied");
  }
  if (candidate.startsWith("src/") && !STRICT_AUDITOR_PATHS.has(candidate)) {
    for (const [name, pattern] of STRICT_SOURCE_RENDERER_PATTERNS) {
      if (pattern.test(source)) issues.push(`${name} implementation is denied from source modules`);
    }
  }
  return issues;
}

export function scanRepository(root = process.cwd(), { strict = false } = {}) {
  runGit(root, ["rev-parse", "--git-dir"]);
  const listed = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const candidates = listed.split("\0")
    .filter((candidate) => candidate && existsSync(resolve(root, candidate)))
    .sort();
  const distribution = distributionContract(root);
  const failures = [...distribution.failures];

  for (const candidate of candidates) {
    const absolute = resolve(root, candidate);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      failures.push(`${candidate}: symlinks are denied by the source-only contract`);
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(absolute);
    const distributionResource = distribution.resources.get(candidate);
    if (distributionResource) {
      failures.push(
        ...inspectDistributionResource(candidate, bytes, distributionResource),
      );
    } else if (
      DISTRIBUTION_PREFIXES.some((prefix) => candidate.startsWith(prefix))
    ) {
      failures.push(`${candidate}: file is outside the public distribution closure`);
    } else {
      for (const issue of inspectCandidatePath(candidate, bytes)) {
        failures.push(`${candidate}: ${issue}`);
      }
    }
    if (strict) {
      for (const issue of strictContentIssues(root, candidate, bytes)) {
        failures.push(`${candidate}: ${issue}`);
      }
    }
  }

  failures.push(...verifyIgnoreContract(root));
  return { schema: SOURCE_ONLY_SCHEMA, strict, candidates, failures };
}

export function main(root = process.cwd(), argv = process.argv.slice(2)) {
  const unknown = argv.filter((argument) => argument !== "--strict");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const strict = argv.includes("--strict");
  const result = scanRepository(root, { strict });
  if (strict) {
    const rows = result.candidates.map((path) => {
      const bytes = readFileSync(resolve(root, path));
      return `${path}\0${createHash("sha256").update(bytes).digest("hex")}`;
    });
    const report = {
      schema: "cssgraphics-source-only-audit@1",
      status: result.failures.length === 0 ? "pass" : "fail",
      strict: true,
      candidateFiles: result.candidates.length,
      sourceBindingSha256: createHash("sha256").update(`${rows.join("\n")}\n`).digest("hex"),
      localInputsVisible: result.candidates.some((path) => path.startsWith(".local/")),
      generatedOutputVisible: result.candidates.some((path) => /^(?:build|bench\/results|dist)\//u.test(path)),
      hostingConfigurationVisible: result.candidates.some((path) => HOSTING_FILES.has(path) || path.startsWith(".github/workflows/")),
      forbiddenRendererImplementationVisible: result.failures.some((failure) => /implementation is denied/u.test(failure)),
      staleCastleGroundsProductContractVisible: result.failures.some((failure) => /stale Castle Grounds/u.test(failure)),
      machineAbsolutePathVisible: result.failures.some((failure) => /machine-specific absolute path/u.test(failure)),
      auditOnlyCapabilityGuards: [...STRICT_AUDITOR_PATHS].sort(),
      failures: result.failures,
    };
    const reportPath = resolve(root, "build/reports/cssgraphics-source-only.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (result.failures.length > 0) {
    console.error("Source-only check failed:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log(`Source-only check passed: ${result.candidates.length} visible source files; local/generated data ignored${strict ? "; strict package audit passed" : ""}.`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = main();
