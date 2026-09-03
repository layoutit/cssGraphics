#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { analyzeTrace, extractFrameScreenshots, loadTrace, renderFrameChartSvg, renderMarkdown } from "./frame-sleuth.mjs";
import { promisify } from "node:util";

const run = promisify(execFile);

export const CAPTURE_SCHEMA = "cssgraphics-frame-sleuth-capture@1";
export const DEFAULT_CAPTURE_DURATION_MS = 8_000;
export const DEFAULT_STARTUP_TRIM_MS = 1_000;

const DEVTOOLS_TRACE_CATEGORIES = Object.freeze([
  "benchmark",
  "blink",
  "blink.user_timing",
  "browser",
  "cc",
  "content",
  "cppgc",
  "devtools.timeline",
  "disabled-by-default-blink.debug.layout",
  "disabled-by-default-devtools.target-rundown",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.v8-source-rundown",
  "disabled-by-default-devtools.v8-source-rundown-sources",
  "disabled-by-default-v8.compile",
  "disabled-by-default-v8.cpu_profiler",
  "disabled-by-default-v8.gc",
  "disabled-by-default-v8.inspector",
  "disabled-by-default-v8.stack_trace",
  "interactions",
  "loading",
  "navigation",
  "rail",
  "renderer_host",
  "v8",
  "v8.execute",
]);

const LEAN_TRACE_CATEGORIES = Object.freeze([
  "benchmark",
  "blink.user_timing",
  "browser",
  "cc",
  "devtools.timeline",
  "loading",
  "rail",
  "renderer_host",
  "toplevel",
]);

const HELP = `FrameSleuth Tracer — capture a DevTools-grade real-Chrome trace and analyze it

Usage:
  pnpm framesleuth:trace -- <url> [options]

Options:
  --output <path>       Raw trace path ending in .json.gz (default: unique ignored result path)
  --duration-ms <ms>    Total untouched recording time including navigation (default: 8000)
  --startup-ms <ms>     Trim this duration for the separate steady report (default: 1000)
  --headed              Explicitly open installed Chrome (may take focus)
  --screenshots         Capture DevTools screenshot events (adds recording overhead)
  --width <pixels>      Set an explicit CSS viewport width; requires --height
  --height <pixels>     Set an explicit CSS viewport height; requires --width
  --help                Show this help

The default is a fresh headless installed-Chrome process and never opens a
window. Tracing begins on
about:blank before cold navigation. The tracer never waits for network-idle or
app readiness and never pauses, seeks, steps, or warms the measured page.
`;

export function traceCategories({ screenshots = false, lean = false, frameTimeline = false } = {}) {
  return Object.freeze([
    ...(lean ? LEAN_TRACE_CATEGORIES : DEVTOOLS_TRACE_CATEGORIES),
    ...(lean && frameTimeline ? ["disabled-by-default-devtools.timeline.frame"] : []),
    ...(screenshots ? ["disabled-by-default-devtools.screenshot"] : []),
  ]);
}

export function parseCaptureCli(argv) {
  const options = {
    durationMs: DEFAULT_CAPTURE_DURATION_MS,
    startupMs: DEFAULT_STARTUP_TRIM_MS,
    headless: true,
    screenshots: false,
    width: null,
    height: null,
  };
  const urls = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--output") options.output = requiredValue(argv, ++index, argument);
    else if (argument === "--duration-ms") options.durationMs = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--startup-ms") options.startupMs = nonNegativeInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--headed") options.headless = false;
    else if (argument === "--screenshots") options.screenshots = true;
    else if (argument === "--width") options.width = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument === "--height") options.height = positiveInteger(requiredValue(argv, ++index, argument), argument);
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}.`);
    else urls.push(argument);
  }
  if (options.help) return options;
  if (urls.length !== 1) throw new Error("Provide exactly one URL.");
  let url;
  try {
    url = new URL(urls[0]);
  } catch {
    throw new Error("FrameSleuth Tracer requires an absolute http(s) URL.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("FrameSleuth Tracer requires an absolute http(s) URL.");
  }
  if ((options.width == null) !== (options.height == null)) {
    throw new Error("Use --width and --height together.");
  }
  if (options.startupMs >= options.durationMs) {
    throw new Error("--startup-ms must be smaller than --duration-ms.");
  }
  const output = resolve(options.output ?? defaultTracePath(url));
  if (!output.endsWith(".json.gz")) throw new Error("--output must end in .json.gz.");
  return Object.freeze({ ...options, url: url.href, output });
}

export function captureOutputPaths(tracePath) {
  const absoluteTracePath = resolve(tracePath);
  const stem = basename(absoluteTracePath).slice(0, -".json.gz".length);
  const root = dirname(absoluteTracePath);
  return Object.freeze({
    trace: absoluteTracePath,
    capture: resolve(root, `${stem}.capture.json`),
    analysis: resolve(root, `${stem}.frame-sleuth.json`),
    fullReport: resolve(root, `${stem}.frame-sleuth.md`),
    steadyReport: resolve(root, `${stem}.frame-sleuth-steady.md`),
    fullChart: resolve(root, `${stem}.frame-times.svg`),
    steadyChart: resolve(root, `${stem}.frame-times-steady.svg`),
    screenshots: resolve(root, `${stem}-screenshots`),
    rawTrace: resolve(root, `${stem}.raw.json.gz`),
  });
}

export async function captureFrameSleuthTrace(options, {
  browserType = chromium,
  activatePage = null,
} = {}) {
  if (activatePage !== null && typeof activatePage !== "function") {
    throw new TypeError("FrameSleuth page activation must be a function");
  }
  const paths = captureOutputPaths(options.output);
  await assertOutputsAbsent(paths, options.screenshots, options.frameSleuthFilter === true);
  await mkdir(dirname(paths.trace), { recursive: true });
  const categories = traceCategories(options);
  const errors = [];
  let browser;
  let context;
  let page;
  let browserVersion = null;
  const capturedAt = new Date().toISOString();
  const wallStartedAt = Date.now();
  try {
    browser = await browserType.launch({ channel: "chrome", headless: options.headless });
    browserVersion = browser.version();
    context = await browser.newContext(options.width == null
      ? { viewport: null }
      : { viewport: { width: options.width, height: options.height } });
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await startTrace(cdp, categories);
    const recordingEndsAt = Date.now() + options.durationMs;
    let navigationError = null;
    try {
      await page.goto(options.url, { waitUntil: "commit", timeout: 30_000 });
      if (activatePage) await activatePage(page);
      await page.waitForTimeout(Math.max(0, recordingEndsAt - Date.now()));
    } catch (error) {
      navigationError = error;
    }
    await stopTrace(cdp, paths.trace);
    if (navigationError) throw navigationError;
    let rawTrace = null;
    if (options.frameSleuthFilter === true) {
      await rename(paths.trace, paths.rawTrace);
      await run("python3", [resolve(import.meta.dirname, "filter-frame-sleuth-trace.py"), paths.rawTrace, paths.trace], {
        maxBuffer: 1024 * 1024,
      });
      rawTrace = { path: paths.rawTrace, ...await fileIdentity(paths.rawTrace) };
    }
    const finalUrl = page.url();
    await context.close();
    context = null;
    await browser.close();
    browser = null;

    const loaded = await loadTrace(paths.trace);
    const urlFilter = new URL(options.url).pathname || new URL(options.url).hostname;
    const full = analyzeTrace(loaded, {
      top: 5,
      url: urlFilter,
      question: "what work happened on the worst captured frame?",
    });
    const steady = analyzeTrace(loaded, {
      top: 5,
      url: urlFilter,
      startMs: options.startupMs,
      question: "what work happened on the worst steady-playback frame?",
    });
    if (options.screenshots && steady.screenshots.available) {
      steady.screenshots.extracted = await extractFrameScreenshots(loaded, steady, paths.screenshots);
    }
    await writeFile(paths.fullChart, renderFrameChartSvg(full), { flag: "wx" });
    await writeFile(paths.steadyChart, renderFrameChartSvg(steady), { flag: "wx" });
    await writeFile(paths.fullReport, renderMarkdown(full, null, { frameChart: basename(paths.fullChart) }), { flag: "wx" });
    await writeFile(paths.steadyReport, renderMarkdown(steady, null, { frameChart: basename(paths.steadyChart) }), { flag: "wx" });
    await writeFile(paths.analysis, `${JSON.stringify({ full, steady }, null, 2)}\n`, { flag: "wx" });
    const traceIdentity = await fileIdentity(paths.trace);
    const capture = Object.freeze({
      schema: CAPTURE_SCHEMA,
      capturedAt,
      requestedUrl: options.url,
      finalUrl,
      durationMs: options.durationMs,
      startupTrimMs: options.startupMs,
      wallDurationMs: Date.now() - wallStartedAt,
      browser: {
        name: "Google Chrome",
        channel: "chrome",
        version: browserVersion,
        headless: options.headless,
      },
      viewport: options.width == null ? "browser-default" : { width: options.width, height: options.height },
      cache: "disabled-fresh-context",
      untouchedPage: activatePage === null,
      pageActivation: activatePage === null ? null : "programmatic-after-navigation-commit",
      categories,
      screenshotsRequested: options.screenshots,
      leanCategories: options.lean === true,
      errors,
      trace: { path: paths.trace, ...traceIdentity },
      rawTrace,
      reports: {
        full: paths.fullReport,
        steady: paths.steadyReport,
        analysis: paths.analysis,
        charts: { full: paths.fullChart, steady: paths.steadyChart },
        screenshots: steady.screenshots.extracted,
      },
      selection: steady.selection,
      cadence: steady.cadence,
      worstSteadyFrame: steady.worstFrames[0] ?? null,
    });
    await writeFile(paths.capture, `${JSON.stringify(capture, null, 2)}\n`, { flag: "wx" });
    return capture;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function startTrace(cdp, categories) {
  await cdp.send("Tracing.start", {
    categories: categories.join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    streamCompression: "gzip",
  });
}

async function stopTrace(cdp, path) {
  const completed = new Promise((resolveComplete) => cdp.once("Tracing.tracingComplete", resolveComplete));
  await cdp.send("Tracing.end");
  const { stream } = await completed;
  if (!stream) throw new Error("Chrome trace did not return a stream.");
  const output = createWriteStream(path, { flags: "wx" });
  let succeeded = false;
  try {
    while (true) {
      const result = await cdp.send("IO.read", { handle: stream });
      const bytes = result.base64Encoded ? Buffer.from(result.data, "base64") : Buffer.from(result.data, "utf8");
      if (!output.write(bytes)) await once(output, "drain");
      if (result.eof) break;
    }
    output.end();
    await once(output, "close");
    succeeded = true;
  } finally {
    await cdp.send("IO.close", { handle: stream }).catch(() => undefined);
    if (!succeeded) {
      output.destroy();
      await rm(path, { force: true });
    }
  }
}

async function assertOutputsAbsent(paths, screenshots, filtered) {
  const candidates = [paths.trace, paths.capture, paths.analysis, paths.fullReport, paths.steadyReport, paths.fullChart, paths.steadyChart];
  if (screenshots) candidates.push(paths.screenshots);
  if (filtered) candidates.push(paths.rawTrace);
  for (const path of candidates) {
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing FrameSleuth output ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function fileIdentity(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return Object.freeze({
    byteLength: (await stat(path)).size,
    sha256: hash.digest("hex"),
  });
}

function defaultTracePath(url) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const slug = `${url.hostname}${url.pathname}`.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "") || "page";
  return resolve("bench/results/frame-sleuth", `${timestamp}-${slug}`, "Trace.json.gz");
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (value == null || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${option} requires a positive integer.`);
  return number;
}

function nonNegativeInteger(value, option) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${option} requires a non-negative integer.`);
  return number;
}

async function main(argv) {
  const options = parseCaptureCli(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const capture = await captureFrameSleuthTrace(options);
  process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`FrameSleuth Tracer: ${error.message}\n`);
    process.exitCode = 1;
  });
}
