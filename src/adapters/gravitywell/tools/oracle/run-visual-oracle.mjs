#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import sharp from "sharp";
import { CSSGRAVITYWELL_SEED } from "../../src/prepare/cssgravitywell/sourceModel.mjs";

const adapterRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(adapterRoot, "../../..");
const sourceRoot = resolveRequiredSourceRoot();
const outputRoot = resolve(
  process.env.CSSGRAVITYWELL_VISUAL_ORACLE_OUT ??
  join(repositoryRoot, "bench/results/cssgravitywell/native-browser-visual"),
);
const width = 960;
const height = 600;
const ticks = Object.freeze([0, 60, 120, 239]);
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
  expected: nativeA.framesDir,
  actual: nativeB.framesDir,
  out: join(outputRoot, "native/visual-aa"),
  label: "cssgravitywell_native_visual_aa",
  diffFrames: "worst",
});
if (!nativeAa.pass || nativeA.statesSha256 !== nativeB.statesSha256) {
  throw new Error("Native Gravity Well capture is not deterministic; cross-renderer comparison is invalid");
}

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
    label: "cssgravitywell_browser_visual_aa",
    diffFrames: "worst",
  });
  if (!browserAa.pass) {
    throw new Error("Browser Gravity Well capture is not deterministic; native comparison is invalid");
  }
  const nativeBrowser = await compareSequences({
    expected: nativeA.framesDir,
    actual: browserA.framesDir,
    out: join(outputRoot, "native-browser-compare"),
    label: "cssgravitywell_native_browser",
    diffFrames: "all",
  });
  const preview = await writeTriptych({ nativeA, browserA, nativeBrowser, tick: 120 });
  const report = {
    schema: "cssgravitywell-native-browser-visual-oracle@1",
    status: nativeBrowser.pass ? "aligned" : "not-aligned",
    source: {
      revision: sourceLock.revision,
      primaryPath: sourceLock.primary.path,
      primarySha256: sourceLock.primary.sha256,
    },
    seed: CSSGRAVITYWELL_SEED,
    ticks,
    viewport: { width, height, deviceScaleFactor: 1 },
    native: {
      aaExact: nativeAa.pass,
      stateAaExact: nativeA.statesSha256 === nativeB.statesSha256,
      framesDir: nativeA.framesDir,
      renderer: nativeA.renderer,
    },
    browser: {
      aaExact: browserAa.pass,
      framesDir: browserA.framesDir,
      rendererContract: "retained DOM / CSS transforms; no Canvas, WebGL, SVG scene, or clip-path",
      audit: browserA.audit,
    },
    comparison: {
      exact: nativeBrowser.pass,
      reportPath: nativeBrowser.manifestPath,
      worst: nativeBrowser.worst[0] ?? null,
      frames: nativeBrowser.frames,
    },
    preview,
    note: nativeBrowser.pass
      ? "Native and browser raster frames are exact at the selected deterministic ticks."
      : "The state oracle remains separate. This visual oracle is valid and currently exposes raster/camera/primitive divergence.",
  };
  const reportPath = join(outputRoot, "native-browser-visual-oracle.json");
  await writeJson(reportPath, report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await browser?.close();
  server.process.kill("SIGTERM");
}

async function compileNativeCapture() {
  if (process.platform !== "darwin") throw new Error("The Gravity Well native visual oracle requires macOS CGL");
  const compiler = process.env.CC || "clang";
  const sdk = resolveSdk();
  const captureSource = join(adapterRoot, "tools/native/headless/capture-gravitywell.c");
  const captureInclude = join(adapterRoot, "tools/native/headless/include");
  const sourceFiles = [
    captureSource,
    ...["screenhackI.h", "utils.h", "visual.h", "xlockmore.h"].map((name) => join(captureInclude, name)),
    join(sourceRoot, "hacks/glx/gravitywell.c"),
    ...["gltrackball.c", "gltrackball.h", "trackball.c", "trackball.h", "quaternion.c", "quaternion.h"].map((name) => join(sourceRoot, "hacks/glx", name)),
    ...["yarandom.c", "yarandom.h", "colors.c", "colors.h", "hsv.c", "hsv.h"].map((name) => join(sourceRoot, "utils", name)),
  ];
  const identity = createHash("sha256").update(compiler).update(sdk);
  const inputs = [];
  for (const path of sourceFiles) {
    const bytes = await readFile(path);
    identity.update(path).update(bytes);
    inputs.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  const key = identity.digest("hex").slice(0, 20);
  const buildDir = join(outputRoot, "native-build", key);
  const binary = join(buildDir, "capture-gravitywell");
  await mkdir(buildDir, { recursive: true });
  for (const name of ["colors.c", "colors.h", "hsv.c", "hsv.h"]) {
    await copyFile(join(sourceRoot, "utils", name), join(buildDir, name));
  }
  const compileFlags = [
    "-std=gnu11", "-O2", "-Wno-deprecated-declarations",
    "-DHAVE_UNISTD_H", "-DGETTIMEOFDAY_TWO_ARGS",
    "-isysroot", sdk,
    "-include", join(captureInclude, "xlockmore.h"),
    "-I", captureInclude,
    "-I", buildDir,
    "-I", join(sourceRoot, "hacks/glx"),
    "-I", join(sourceRoot, "utils"),
  ];
  const temporary = `${binary}.tmp-${process.pid}`;
  const result = spawnSync(compiler, [
    ...compileFlags,
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
  if (result.status !== 0) throw new Error(`Unable to compile native gravitywell.c capture:\n${result.stderr || result.stdout}`);
  await chmod(temporary, 0o755);
  await rename(temporary, binary);
  await writeJson(join(buildDir, "native-binding.json"), {
    schema: "cssgravitywell-native-build-binding@1",
    compiler,
    compilerVersion: spawnSync(compiler, ["--version"], { encoding: "utf8" }).stdout.split("\n")[0],
    sdk,
    compileFlags,
    executableSha256: sha256(await readFile(binary)),
    inputs,
  });
  return binary;
}

async function captureNativeRun(binary, runRoot) {
  const framesDir = join(runRoot, "frames");
  const statesPath = join(runRoot, "states.jsonl");
  await mkdir(framesDir, { recursive: true });
  const result = spawnSync(binary, [
    framesDir,
    statesPath,
    String(CSSGRAVITYWELL_SEED),
    String(width),
    String(height),
    ...ticks.map((tick) => String(tick + 1)),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native gravitywell.c capture failed:\n${result.stderr || result.stdout}`);
  const frameNames = (await readdir(framesDir)).filter((name) => /^frame_\d{4}\.ppm$/u.test(name)).sort();
  if (frameNames.length !== ticks.length) throw new Error(`Native capture wrote ${frameNames.length} of ${ticks.length} frames`);
  const statesBytes = await readFile(statesPath);
  const renderer = JSON.parse(await readFile(join(framesDir, "native-renderer.json"), "utf8"));
  return {
    runRoot,
    framesDir,
    statesPath,
    statesSha256: sha256(statesBytes),
    renderer,
  };
}

async function captureBrowserRun(browser, url, runRoot) {
  const framesDir = join(runRoot, "frames");
  await mkdir(framesDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    const captureUrl = new URL(url);
    captureUrl.searchParams.set("bank", "0");
    captureUrl.searchParams.set("cycle", "0");
    await page.goto(captureUrl.href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null, { timeout: 30_000 });
    await page.evaluate(() => window.__cssGravityWellDebug.pause());
    await page.addStyleTag({ content: `
      :root, html, body, .polycss-camera { background: #000 !important; }
      .site-header, .cssgravitywell-error-message { display: none !important; }
    ` });
    const initial = await page.evaluate(() => ({
      ready: Boolean(window.__cssGravityWellDebug?.ready),
      status: document.body.dataset.portStatus,
      scene: window.__cssGravityWellDebug?.scene?.() ?? null,
      state: window.__cssGravityWellDebug?.state?.() ?? null,
      forbiddenRendererElements: document.querySelectorAll(".polycss-camera canvas, .polycss-camera svg").length,
      clipPathCount: [...document.querySelectorAll(".polycss-camera *")].filter((element) => getComputedStyle(element).clipPath !== "none").length,
    }));
    if (errors.length || !initial.ready || initial.status !== "ready" || initial.forbiddenRendererElements || initial.clipPathCount) {
      throw new Error(`Gravity Well browser oracle did not become valid: ${JSON.stringify({ initial, errors })}`);
    }
    const states = [];
    for (let index = 0; index < ticks.length; index += 1) {
      const tick = ticks[index];
      const state = await page.evaluate(async (sourceTick) => {
        await window.__cssGravityWellDebug.seekSourceTick(sourceTick);
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        return {
          ...window.__cssGravityWellDebug.state(),
          stableDom: window.__cssGravityWellDebug.assertStableDomIdentity(),
          stats: window.__cssGravityWellDebug.stats(),
        };
      }, tick);
      if (state.sourceFrameIndex !== tick || !state.paused || !state.stableDom) {
        throw new Error(`Browser failed to publish prepared tick ${tick}: ${JSON.stringify(state)}`);
      }
      states.push(state);
      await page.locator(".polycss-camera").screenshot({ path: join(framesDir, frameName(index)) });
    }
    const audit = await page.evaluate(() => ({
      elementCount: document.querySelectorAll(".polycss-camera *").length,
      leafCount: document.querySelectorAll(".polycss-scene > div > .polycss-mesh > b").length,
      canvasCount: document.querySelectorAll("canvas").length,
      svgSceneCount: document.querySelectorAll(".polycss-camera svg").length,
      clipPathCount: [...document.querySelectorAll(".polycss-camera *")].filter((element) => getComputedStyle(element).clipPath !== "none").length,
      stableDom: window.__cssGravityWellDebug.assertStableDomIdentity(),
    }));
    const statesPath = join(runRoot, "states.jsonl");
    await writeFile(statesPath, `${states.map((state) => JSON.stringify(state)).join("\n")}\n`);
    await writeJson(join(runRoot, "browser-capture.json"), {
      schema: "cssgravitywell-browser-frame-sequence@1",
      url,
      ticks,
      viewport: { width, height, deviceScaleFactor: 1 },
      captureMode: "deterministic-prepared-state-seek",
      framesDir,
      statesPath,
      audit,
    });
    return { runRoot, framesDir, statesPath, audit };
  } finally {
    await page.close();
  }
}

async function compareSequences({ expected, actual, out, label, diffFrames }) {
  const result = spawnSync(process.execPath, [
    oracleScript,
    "compare",
    "--expected", expected,
    "--actual", actual,
    "--out", out,
    "--replace",
    "--label", label,
    "--mean-threshold", "0",
    "--changed-threshold", "0",
    "--channel-threshold", "0",
    "--diff-frames", diffFrames,
    "--diff-amplify", "1",
    "--max-frames", String(ticks.length),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Frame comparison ${label} failed to run`);
  return JSON.parse(await readFile(join(out, `${label}.json`), "utf8"));
}

async function writeTriptych({ nativeA, browserA, nativeBrowser, tick }) {
  const index = ticks.indexOf(tick);
  if (index < 0) throw new Error(`Triptych tick ${tick} is not in the oracle schedule`);
  const previewDir = join(outputRoot, "preview");
  await mkdir(previewDir, { recursive: true });
  const nativePath = join(previewDir, `native-tick-${tick}.png`);
  const browserPath = join(previewDir, `browser-tick-${tick}.png`);
  const diffPath = join(previewDir, `absolute-diff-tick-${tick}.png`);
  const triptychPath = join(previewDir, `native-browser-diff-tick-${tick}.png`);
  const nativeFrame = join(nativeA.framesDir, `frame_${String(index).padStart(4, "0")}.ppm`);
  const browserFrame = join(browserA.framesDir, frameName(index));
  const diffRow = nativeBrowser.diffs.find((entry) => entry.frame === index);
  if (!diffRow?.png) throw new Error(`Missing absolute-diff frame for tick ${tick}`);
  const conversion = spawnSync("sips", ["-s", "format", "png", nativeFrame, "--out", nativePath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (conversion.status !== 0) throw new Error(conversion.stderr || "Unable to convert native PPM preview to PNG");
  await copyFile(browserFrame, browserPath);
  await copyFile(diffRow.png, diffPath);
  const labels = ["NATIVE gravitywell.c", "BROWSER retained DOM", "ABSOLUTE DIFF"];
  const panelBuffers = await Promise.all([nativePath, browserPath, diffPath].map((path) => sharp(path).png().toBuffer()));
  const labelSvg = Buffer.from(`<svg width="${width * 3}" height="40" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#080b0f"/>
    ${labels.map((label, panel) => `<text x="${panel * width + 20}" y="27" fill="#f2f2f2" font-family="Arial, sans-serif" font-size="18">${label} · tick ${tick}</text>`).join("")}
  </svg>`);
  await sharp({ create: { width: width * 3, height: height + 40, channels: 3, background: "#000" } })
    .composite([
      { input: labelSvg, left: 0, top: 0 },
      ...panelBuffers.map((input, panel) => ({ input, left: panel * width, top: 40 })),
    ])
    .png()
    .toFile(triptychPath);
  return { tick, nativePath, browserPath, absoluteDiffPath: diffPath, triptychPath };
}

async function startBrowserServer() {
  const configured = process.env.CSSGRAVITYWELL_ORACLE_URL;
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
    if (child.exitCode !== null) throw new Error(`Gravity Well oracle Vite exited early:\n${output}`);
  });
  return { url: `http://127.0.0.1:${port}/gravitywell/`, process: child };
}

async function assertSourceIdentity() {
  const revision = git("rev-parse", "HEAD");
  const primaryBytes = await readFile(join(sourceRoot, sourceLock.primary.path));
  if (revision !== sourceLock.revision || sha256(primaryBytes) !== sourceLock.primary.sha256) {
    throw new Error(`Gravity Well source identity mismatch: ${revision}/${sha256(primaryBytes)}`);
  }
}

function resolveRequiredSourceRoot() {
  const configured = process.env.CSSGRAVITYWELL_SOURCE_ROOT;
  if (!configured) throw new Error("Set CSSGRAVITYWELL_SOURCE_ROOT to the pinned XScreenSaver checkout");
  return resolve(configured);
}

function resolveSdk() {
  const configured = process.env.CSSGRAVITYWELL_MACOS_SDK;
  if (configured) return resolve(configured);
  const result = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Unable to locate macOS SDK");
  return result.stdout.trim();
}

function git(...args) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
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
  throw new Error("Timed out waiting for Gravity Well oracle server");
}
