#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import sharp from "sharp";
import {
  CSSCITYFLOW_FRAME_MILLISECONDS,
  CSSCITYFLOW_PREPARED_FRAME_COUNT,
  CSSCITYFLOW_SEED,
  CITYFLOW_BANKS,
} from "../../src/prepare/csscityflow/sourceModel.mjs";
import { ensureCityflowSourceTree } from "../../src/prepare/csscityflow/sourceAuthority.mjs";

const adapterRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const sourceIdentity = await ensureCityflowSourceTree();
const sourceRoot = sourceIdentity.sourceRoot;
const outputRoot = resolve(
  process.env.CSSCITYFLOW_VISUAL_ORACLE_OUT ??
  join(repositoryRoot, "bench/results/csscityflow/native-browser-visual"),
);
const width = readPositiveIntegerEnvironment("CSSCITYFLOW_VISUAL_ORACLE_WIDTH", 1280);
const height = readPositiveIntegerEnvironment("CSSCITYFLOW_VISUAL_ORACLE_HEIGHT", 720);
const bankId = process.env.CSSCITYFLOW_VISUAL_ORACLE_BANK ??
  (width < 600 ? "mobile" : "desktop");
const bank = CITYFLOW_BANKS[bankId];
if (!bank) throw new Error(`Unknown Cityflow visual-oracle bank: ${bankId}`);
const frameCount = readFrameCount();
const diffFrames = [
  "worst",
  ...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((frameCount - 1) * ratio))),
].join(",");
const sourceLock = JSON.parse(await readFile(join(adapterRoot, "notes/references/source-lock.json"), "utf8"));
const oracleScript = resolve(
  process.env.CSS_FRAME_SEQUENCE_ORACLE_SCRIPT ??
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills/frame-sequence-oracle/scripts/frame-sequence.mjs"),
);

await assertSourceIdentity();
await assertReadable(oracleScript, "frame-sequence oracle");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const binary = await compileNativeCapture();
const nativeA = await captureNativeRun(binary, join(outputRoot, "native/run-a"));
const nativeB = await captureNativeRun(binary, join(outputRoot, "native/run-b"));
const nativeAa = await compareSequences({
  expected: nativeA,
  actual: nativeB,
  out: join(outputRoot, "native/visual-aa"),
  label: "csscityflow_native_visual_aa",
  thresholds: ["0", "0", "0"],
  diffFrames: "worst",
});
if (!nativeAa.pass) throw new Error("Native Cityflow frame capture is not deterministic");

const server = await startBrowserServer();
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserA = await captureBrowserRun(browser, server.url, join(outputRoot, "browser/run-a"));
  const browserB = await captureBrowserRun(browser, server.url, join(outputRoot, "browser/run-b"));
  const browserAa = await compareSequences({
    expected: browserA.framesDir,
    actual: browserB.framesDir,
    out: join(outputRoot, "browser/visual-aa"),
    label: "csscityflow_browser_visual_aa",
    thresholds: ["0", "0", "0"],
    diffFrames: "worst",
  });
  if (!browserAa.pass) throw new Error("Browser Cityflow frame capture is not deterministic");
  const nativeBrowser = await compareSequences({
    expected: nativeA,
    actual: browserA.framesDir,
    out: join(outputRoot, "native-browser-compare"),
    label: "csscityflow_native_browser",
      thresholds: ["1.125", "0.05", "2"],
    diffFrames,
  });
  const worstFrame = nativeBrowser.worst[0]?.frame ?? 0;
  const preview = await writeTriptych({
    nativeDir: nativeA,
    browserDir: browserA.framesDir,
    comparison: nativeBrowser,
    frame: worstFrame,
  });
  const report = {
    schema: "csscityflow-native-browser-visual-oracle@1",
    status: nativeBrowser.pass ? "aligned" : "not-aligned",
    source: {
      repository: sourceIdentity.repository,
      revision: sourceLock.revision,
      primaryPath: sourceLock.primary.path,
      primarySha256: sourceLock.primary.sha256,
      verifiedFiles: sourceIdentity.files,
    },
    seed: CSSCITYFLOW_SEED,
    bankId,
    boxCount: bank.boxCount,
    frames: frameCount,
    sourceFrameMilliseconds: CSSCITYFLOW_FRAME_MILLISECONDS,
    viewport: { width, height, deviceScaleFactor: 1 },
    native: { aaExact: nativeAa.pass, framesDir: nativeA },
    browser: {
      aaExact: browserAa.pass,
      framesDir: browserA.framesDir,
      audit: browserA.audit,
      rendererContract: "retained DOM / CSS transforms; no Canvas, WebGL, SVG scene, or runtime rasterization",
    },
    comparison: {
      pass: nativeBrowser.pass,
      thresholds: nativeBrowser.thresholds,
      reportPath: nativeBrowser.manifestPath,
      worst: nativeBrowser.worst[0] ?? null,
    },
    preview,
  };
  const reportPath = join(outputRoot, "native-browser-visual-oracle.json");
  await writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!nativeBrowser.pass) process.exitCode = 1;
} finally {
  await browser?.close();
  server.process.kill("SIGTERM");
}

async function compileNativeCapture() {
  if (process.platform !== "darwin") throw new Error("The Cityflow native visual oracle requires macOS CGL");
  const compiler = process.env.CC || "clang";
  const sdk = resolveSdk();
  const captureSource = join(adapterRoot, "tools/native/headless/capture-cityflow.c");
  const captureInclude = join(adapterRoot, "tools/native/headless/include");
  const inputs = [
    captureSource,
    ...["screenhackI.h", "utils.h", "visual.h", "xlockmore.h"].map((name) => join(captureInclude, name)),
    join(sourceRoot, sourceLock.primary.path),
    ...["gltrackball.c", "gltrackball.h", "trackball.c", "trackball.h", "quaternion.c", "quaternion.h"].map((name) => join(sourceRoot, "hacks/glx", name)),
    ...["yarandom.c", "yarandom.h", "colors.c", "colors.h", "hsv.c", "hsv.h"].map((name) => join(sourceRoot, "utils", name)),
  ];
  const identity = createHash("sha256").update(compiler).update(sdk);
  for (const path of inputs) identity.update(path).update(await readFile(path));
  const buildDir = join(outputRoot, "native-build", identity.digest("hex").slice(0, 20));
  const binary = join(buildDir, "capture-cityflow");
  await mkdir(buildDir, { recursive: true });
  for (const name of ["colors.c", "colors.h", "hsv.c", "hsv.h"]) {
    await copyFile(join(sourceRoot, "utils", name), join(buildDir, name));
  }
  const temporary = `${binary}.tmp-${process.pid}`;
  const result = spawnSync(compiler, [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-isysroot", sdk,
    "-include", join(captureInclude, "xlockmore.h"),
    "-I", captureInclude,
    "-I", buildDir,
    "-I", join(sourceRoot, "hacks/glx"),
    "-I", join(sourceRoot, "utils"),
    captureSource,
    join(sourceRoot, "hacks/glx/gltrackball.c"),
    join(sourceRoot, "hacks/glx/trackball.c"),
    join(sourceRoot, "hacks/glx/quaternion.c"),
    join(sourceRoot, "utils/yarandom.c"),
    join(buildDir, "colors.c"),
    join(buildDir, "hsv.c"),
    "-framework", "OpenGL", "-lm", "-o", temporary,
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to compile native cityflow.c capture:\n${result.stderr || result.stdout}`);
  await chmod(temporary, 0o755);
  await rename(temporary, binary);
  await writeJson(join(buildDir, "native-binding.json"), {
    schema: "csscityflow-native-build-binding@1",
    compiler,
    sdk,
    executableSha256: sha256(await readFile(binary)),
    inputs: await Promise.all(inputs.map(async (path) => ({ path, sha256: sha256(await readFile(path)) }))),
  });
  return binary;
}

async function captureNativeRun(binary, runRoot) {
  const framesDir = join(runRoot, "frames");
  await mkdir(framesDir, { recursive: true });
  const result = spawnSync(binary, [
    framesDir,
    String(CSSCITYFLOW_SEED),
    String(bank.boxCount),
    String(width),
    String(height),
    String(frameCount),
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native cityflow.c capture failed:\n${result.stderr || result.stdout}`);
  const frames = (await readdir(framesDir)).filter((name) => /^frame_\d{4}\.ppm$/u.test(name));
  if (frames.length !== frameCount) throw new Error(`Native capture wrote ${frames.length} of ${frameCount} frames`);
  return framesDir;
}

async function captureBrowserRun(browser, url, runRoot) {
  const framesDir = join(runRoot, "frames");
  await mkdir(framesDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__csscityflow?.ready || globalThis.__csscityflow?.errors?.length, null, { timeout: 30_000 });
    await page.addStyleTag({ content: `
      .examples-sidebar, .example-info { display: none !important; }
      .example-stage { position: fixed !important; inset: 0 !important; }
    ` });
    const initial = await page.evaluate(async () => {
      const roots = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
      const leaves = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")];
      globalThis.__csscityflowOracleIdentity = { roots, leaves };
      globalThis.__csscityflow.player.pause();
      globalThis.__csscityflow.player.seekSourceFrame(1);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      return {
        roots: roots.length,
        leaves: leaves.length,
        animations: roots.flatMap((element) => element.getAnimations()).length,
        canvas: document.querySelectorAll("canvas").length,
        sceneSvg: document.querySelectorAll(".polycss-camera svg").length,
      };
    });
    if (errors.length || initial.roots !== bank.boxCount ||
        initial.leaves !== bank.boxCount * 3 ||
        initial.animations !== 0 ||
        initial.canvas !== 0 || initial.sceneSvg !== 0) {
      throw new Error(`Cityflow browser oracle is invalid: ${JSON.stringify({ initial, errors })}`);
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      await page.evaluate(async ({ frameIndex }) => {
        globalThis.__csscityflow.player.seekSourceFrame(frameIndex);
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      }, { frameIndex: frame });
      await page.screenshot({ path: join(framesDir, frameName(frame)) });
    }
    const audit = await page.evaluate(() => {
      const expected = globalThis.__csscityflowOracleIdentity;
      const roots = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
      const leaves = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div>b")];
      return {
        stableRootIdentity: roots.every((element, index) => element === expected.roots[index]),
        stableLeafIdentity: leaves.every((element, index) => element === expected.leaves[index]),
        rootCount: roots.length,
        leafCount: leaves.length,
        transformAnimationCount: roots.flatMap((element) => element.getAnimations()).length,
        canvasCount: document.querySelectorAll("canvas").length,
        sceneSvgCount: document.querySelectorAll(".polycss-camera svg").length,
        player: globalThis.__csscityflow.player.stats(),
        stage: {
          width: document.querySelector(".example-stage")?.clientWidth,
          height: document.querySelector(".example-stage")?.clientHeight,
        },
      };
    });
    if (!audit.stableRootIdentity || !audit.stableLeafIdentity ||
        audit.transformAnimationCount !== 0 || errors.length) {
      throw new Error(`Cityflow browser DOM identity drifted: ${JSON.stringify({ audit, errors })}`);
    }
    await writeJson(join(runRoot, "browser-capture.json"), {
      schema: "csscityflow-browser-frame-sequence@1",
      url,
      frameCount,
      viewport: { width, height, deviceScaleFactor: 1 },
      captureMode: "paused-prepared-sequential-player-source-frame-seek",
      audit,
    });
    return { framesDir, audit };
  } finally {
    await page.close();
  }
}

async function compareSequences({ expected, actual, out, label, thresholds, diffFrames }) {
  const [mean, changed, channel] = thresholds;
  const result = spawnSync(process.execPath, [
    oracleScript,
    "compare",
    "--expected", expected,
    "--actual", actual,
    "--out", out,
    "--replace",
    "--label", label,
    "--mean-threshold", mean,
    "--changed-threshold", changed,
    "--channel-threshold", channel,
    "--diff-frames", diffFrames,
    "--max-frames", String(frameCount),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Frame comparison ${label} failed`);
  return JSON.parse(await readFile(join(out, `${label}.json`), "utf8"));
}

async function writeTriptych({ nativeDir, browserDir, comparison, frame }) {
  const previewDir = join(outputRoot, "preview");
  await mkdir(previewDir, { recursive: true });
  const nativePath = join(nativeDir, `frame_${String(frame).padStart(4, "0")}.ppm`);
  const browserPath = join(browserDir, frameName(frame));
  const diff = comparison.diffs.find((entry) => entry.frame === frame);
  if (!diff?.png) throw new Error(`Missing diff for frame ${frame}`);
  const nativePreviewPath = join(previewDir, `native-frame-${String(frame).padStart(4, "0")}.png`);
  const conversion = spawnSync("sips", ["-s", "format", "png", nativePath, "--out", nativePreviewPath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (conversion.status !== 0) throw new Error(conversion.stderr || "Unable to convert native Cityflow PPM preview");
  const labels = ["NATIVE cityflow.c", "BROWSER retained DOM", "ABSOLUTE DIFF"];
  const panels = await Promise.all([nativePreviewPath, browserPath, diff.png].map((path) => sharp(path).png().toBuffer()));
  const labelSvg = Buffer.from(`<svg width="${width * 3}" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#080b0f"/>${labels.map((label, index) => `<text x="${index * width + 20}" y="27" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="18">${label} · frame ${frame}</text>`).join("")}</svg>`);
  const triptychPath = join(previewDir, `native-browser-diff-frame-${String(frame).padStart(4, "0")}.png`);
  await sharp({ create: { width: width * 3, height: height + 40, channels: 3, background: "#000" } })
    .composite([
      { input: labelSvg, left: 0, top: 0 },
      ...panels.map((input, index) => ({ input, left: index * width, top: 40 })),
    ])
    .png()
    .toFile(triptychPath);
  return { frame, triptychPath };
}

async function startBrowserServer() {
  const configured = process.env.CSSCITYFLOW_ORACLE_URL;
  if (configured) return { url: configured, process: { kill() {} } };
  const port = await freePort();
  let output = "";
  const child = spawn("pnpm", [
    "exec", "vite",
    "--config", join(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (child.exitCode !== null) throw new Error(`Cityflow oracle Vite exited early:\n${output}`);
  });
  return { url: `http://127.0.0.1:${port}/`, process: child };
}

async function assertSourceIdentity() {
  if (sourceIdentity.revision !== sourceLock.revision ||
      !sourceIdentity.files.some(({ path, sha256: digest }) =>
        path === sourceLock.primary.path && digest === sourceLock.primary.sha256) ||
      !sourceIdentity.files.some(({ path, sha256: digest }) =>
        path === sourceLock.config.path && digest === sourceLock.config.sha256)) {
    throw new Error("Cityflow source identity does not match the pinned source lock");
  }
}

function resolveSdk() {
  const configured = process.env.CSSCITYFLOW_MACOS_SDK;
  if (configured) return resolve(configured);
  const result = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Unable to locate macOS SDK");
  return result.stdout.trim();
}

function readFrameCount() {
  const value = Number(process.env.CSSCITYFLOW_VISUAL_ORACLE_FRAMES ?? 48);
  if (!Number.isSafeInteger(value) || value < 1 || value > CSSCITYFLOW_PREPARED_FRAME_COUNT) {
    throw new RangeError(
      `Cityflow visual oracle frame count must be an integer from 1 through ${CSSCITYFLOW_PREPARED_FRAME_COUNT}`,
    );
  }
  return value;
}

function readPositiveIntegerEnvironment(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frameName(index) {
  return `frame_${String(index).padStart(4, "0")}.png`;
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertReadable(path, label) {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const instance = createServer();
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      const port = typeof address === "object" && address ? address.port : 0;
      instance.close(() => resolvePort(port));
    });
    instance.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for Cityflow oracle server");
}
