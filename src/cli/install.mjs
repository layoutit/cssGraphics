import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { validateCssGraphicsModelPackage } from "../model-package/modelPackage.mjs";
import { buildCssGraphicsCatalog } from "./catalog.mjs";

export const CSSGRAPHICS_INSTALLATION_SCHEMA = "cssgraphics.installation.v1";
export const CSSGRAPHICS_PUBLIC_ROOT = "public/cssgraphics";

function fail(message) {
  throw new TypeError(message);
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function packageJson(root) {
  const path = resolve(root, "package.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`cssGraphics package metadata is unreadable at ${path}.`);
  }
}

function ensureTargetPackage(targetRoot) {
  const path = resolve(targetRoot, "package.json");
  if (existsSync(path)) return { path, created: false };
  const fallbackName = basename(targetRoot).toLowerCase().replace(/[^a-z0-9._-]+/gu, "-") || "cssgraphics-app";
  writeFileSync(path, `${JSON.stringify({ name: fallbackName, private: true, type: "module" }, null, 2)}\n`);
  return { path, created: true };
}

function targetPackageManager(targetRoot) {
  if (existsSync(resolve(targetRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(targetRoot, "package.json"))) {
    try {
      const manager = JSON.parse(readFileSync(resolve(targetRoot, "package.json"), "utf8")).packageManager;
      if (typeof manager === "string" && manager.startsWith("pnpm@")) return "pnpm";
    } catch {
      // npm will report malformed project metadata with its normal error.
    }
  }
  return "npm";
}

function runChecked(command, args, { cwd, env = process.env, timeout = 900_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal ?? "unknown"})${output ? `:\n${output}` : ""}`);
  }
  return result;
}

function browserExecutable(env) {
  const candidates = [
    env.CSSGRAPHICS_BROWSER_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    env.PROGRAMFILES
      ? resolve(env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")
      : null,
    env["PROGRAMFILES(X86)"]
      ? resolve(env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe")
      : null,
  ].filter(Boolean);
  const executable = candidates.find((path) => {
    try {
      return lstatSync(realpathSync(path)).isFile();
    } catch {
      return false;
    }
  });
  if (!executable) {
    fail("Preparing Mario requires an installed Chrome or Chromium browser.");
  }
  return executable;
}

export function installCssGraphicsDependency({ targetRoot, packageRoot, env = process.env }) {
  const metadata = packageJson(packageRoot);
  if (metadata.name !== "cssgraphics" || typeof metadata.version !== "string") {
    fail("The executing package is not a versioned cssgraphics package.");
  }
  if (realpathSync(targetRoot) === realpathSync(packageRoot)) return Object.freeze({ manager: "self", installed: false });
  const initialized = ensureTargetPackage(targetRoot);
  const manager = targetPackageManager(targetRoot);
  const spec = env.CSSGRAPHICS_PACKAGE_SPEC || `cssgraphics@${metadata.version}`;
  try {
    if (manager === "pnpm") {
      runChecked("pnpm", ["add", "--save-exact", "--ignore-scripts", spec], { cwd: targetRoot, env });
    } else {
      runChecked("npm", ["install", "--save-exact", "--ignore-scripts", spec], { cwd: targetRoot, env });
    }
  } catch (error) {
    if (initialized.created) rmSync(initialized.path, { force: true });
    throw error;
  }
  return Object.freeze({ manager, installed: true, spec });
}

function installationMarker(targetRoot) {
  return resolve(targetRoot, ".cssgraphics", "installation.json");
}

function readOwnedInstallation(targetRoot, finalRoot) {
  if (!existsSync(finalRoot)) return null;
  const markerPath = installationMarker(targetRoot);
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    fail(`${CSSGRAPHICS_PUBLIC_ROOT} already exists and is not owned by cssgraphics.`);
  }
  if (marker?.schema !== CSSGRAPHICS_INSTALLATION_SCHEMA || marker.publicRoot !== CSSGRAPHICS_PUBLIC_ROOT
    || marker.modelId !== "mario" || marker.romModelIncluded !== true) {
    fail(`${CSSGRAPHICS_PUBLIC_ROOT} has an invalid cssgraphics ownership marker.`);
  }
  return marker;
}

function assertCopyableTree(root, label) {
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    fail(`${label} is missing or unsafe.`);
  }
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail(`${label} contains a symbolic link.`);
      if (stat.isDirectory()) visit(path);
      else if (!stat.isFile()) fail(`${label} contains a non-file entry.`);
    }
  };
  visit(root);
}

function filesUnder(root, prefix = "") {
  const rows = [];
  for (const name of readdirSync(resolve(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const absolute = resolve(root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) rows.push(...filesUnder(root, path));
    else rows.push(path);
  }
  return rows;
}

async function copyModelClosure(source, target, label, expectedId) {
  assertCopyableTree(source, label);
  const manifestBytes = readFileSync(resolve(source, "manifest.json"));
  const bundle = await validateCssGraphicsModelPackage({
    manifestBytes,
    loadResource: async (path) => readFileSync(resolve(source, path)),
  });
  if (bundle.manifest.id !== expectedId) {
    fail(`${label} declares ${bundle.manifest.id} instead of ${expectedId}.`);
  }
  const declared = [
    "manifest.json",
    ...bundle.manifest.resources.model.parts.map(({ path }) => path),
    bundle.manifest.resources.styles.path,
    ...Object.values(bundle.manifest.resources.assets).map(({ path }) => path),
  ].sort();
  const actual = filesUnder(source);
  if (actual.length !== declared.length || actual.some((path, index) => path !== declared[index])) {
    fail(`${label} contains files outside its declared package closure.`);
  }
  for (const path of declared) {
    const destination = resolve(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(source, path), destination);
  }
}

function installStagedRoot(staging, target) {
  const backup = resolve(dirname(target), `.cssgraphics-previous-${process.pid}`);
  if (existsSync(backup)) fail("A prior cssGraphics installation backup already exists.");
  let movedPrevious = false;
  try {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      renameSync(target, backup);
      movedPrevious = true;
    }
    renameSync(staging, target);
  } catch (error) {
    if (movedPrevious && !existsSync(target) && existsSync(backup)) renameSync(backup, target);
    throw error;
  }
  if (movedPrevious) rmSync(backup, { recursive: true, force: true });
}

export async function prepareCssGraphicsRomModel({ romPath, packageRoot, targetRoot, env = process.env }) {
  const {
    metadata,
    prepare: prepareMario,
    package: packageMario,
  } = await import("../adapters/super-mario-64/index.mjs");
  const token = `${process.pid}-${Date.now()}`;
  const relativeRoot = `build/generated/cssgraphics-installs/${token}`;
  const relativeReportRoot = `build/reports/cssgraphics-installs/${token}`;
  const outputParent = resolve(packageRoot, relativeRoot);
  const reportRoot = resolve(packageRoot, relativeReportRoot);
  const outputRoot = resolve(outputParent, `models/${metadata.modelId}`);
  const preparedRoot = resolve(outputParent, "title-head");
  if (!isInside(resolve(packageRoot, "build/generated"), outputRoot)) {
    fail("The temporary ROM-model output escaped the package generated root.");
  }
  if (!isInside(resolve(packageRoot, "build/reports"), reportRoot)) {
    fail("The temporary ROM-model reports escaped the package report root.");
  }
  const childEnv = {
    ...env,
    CSSGRAPHICS_BROWSER_EXECUTABLE: browserExecutable(env),
    NO_COLOR: "1",
    SM64_ROM: romPath,
    SM64_UPSTREAM_ROOT: ".local/upstreams",
    SM64_GENERATED_ROOT: `${relativeRoot}/title-head`,
    SM64_REPORT_ROOT: relativeReportRoot,
  };
  try {
    mkdirSync(outputParent, { recursive: true });
    const prepared = await prepareMario({
      repoRoot: packageRoot,
      romPath,
      outputRoot: preparedRoot,
      reportRoot,
      env: childEnv,
      syncUpstreams: true,
    });
    await packageMario({
      prepared: prepared.packageInput,
      outputRoot,
    });
    assertCopyableTree(outputRoot, "Prepared ROM model");
    return Object.freeze({
      root: outputRoot,
      qualification: prepared.qualification,
      cleanup() {
        if (isInside(resolve(packageRoot, "build/generated/cssgraphics-installs"), outputParent)) {
          rmSync(outputParent, { recursive: true, force: true });
        }
        if (isInside(resolve(packageRoot, "build/reports/cssgraphics-installs"), reportRoot)) {
          rmSync(reportRoot, { recursive: true, force: true });
        }
      },
    });
  } catch (error) {
    rmSync(outputParent, { recursive: true, force: true });
    rmSync(reportRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function runCssGraphicsInstall(plan, {
  packageRoot = resolve(import.meta.dirname, "../.."),
  env = process.env,
  installLibrary = installCssGraphicsDependency,
  prepareRom = prepareCssGraphicsRomModel,
  buildCatalog = buildCssGraphicsCatalog,
} = {}) {
  if (!plan || plan.schema !== "cssgraphics.install-plan.v1") fail("A cssGraphics install plan is required.");
  if (!plan.romPath) fail("Preparing the initial cssGraphics release requires a Super Mario 64 ROM.");
  const targetRoot = realpathSync(plan.targetRoot);
  const finalRoot = resolve(targetRoot, CSSGRAPHICS_PUBLIC_ROOT);
  if (!isInside(targetRoot, finalRoot)) fail("The cssGraphics public root escaped the target project.");
  readOwnedInstallation(targetRoot, finalRoot);
  const temporary = mkdtempSync(resolve(targetRoot, ".cssgraphics-install-"));
  const staging = resolve(temporary, "cssgraphics");
  mkdirSync(resolve(staging, "models"), { recursive: true });
  let preparedRom = null;
  try {
    preparedRom = await prepareRom({
      romPath: plan.romPath,
      packageRoot,
      targetRoot,
      env,
    });
    const romRoot = preparedRom.root;
    await copyModelClosure(
      romRoot,
      resolve(staging, "models/mario"),
      "Prepared ROM model",
      "mario",
    );

    const catalog = await buildCatalog({
      modelRoots: [romRoot],
    });
    writeFileSync(resolve(staging, "catalog.json"), catalog.bytes);
    const marker = {
      schema: CSSGRAPHICS_INSTALLATION_SCHEMA,
      publicRoot: CSSGRAPHICS_PUBLIC_ROOT,
      modelId: "mario",
      romModelIncluded: true,
      defaultModelId: catalog.catalog.defaultId,
      catalogGenerationHash: catalog.catalog.generationHash,
      romCopied: false,
    };
    const dependency = await installLibrary({ targetRoot, packageRoot, env });
    installStagedRoot(staging, finalRoot);
    const markerPath = installationMarker(targetRoot);
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    return Object.freeze({
      schema: CSSGRAPHICS_INSTALLATION_SCHEMA,
      targetRoot,
      publicRoot: finalRoot,
      dependency,
      catalog: catalog.catalog,
      romModelIncluded: marker.romModelIncluded,
      romCopied: false,
    });
  } finally {
    preparedRom?.cleanup?.();
    rmSync(temporary, { recursive: true, force: true });
  }
}
