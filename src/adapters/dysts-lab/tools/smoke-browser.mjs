#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const deploy = process.argv.includes("--deploy");
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/csschaos", deploy ? "deploy" : "local");
const port = Number(process.env.CSSCHAOS_SMOKE_PORT ?? 4216);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("Chaos browser-smoke port drifted");
}
const origin = `http://127.0.0.1:${port}`;
const route = `${origin}${deploy ? "/chaos/" : "/"}`;
const server = deploy ? createStaticDeployServer(resolve(repositoryRoot, "dist/site")) :
  await createViteServer({
    configFile: resolve(repositoryRoot, "src/adapters/dysts-lab/vite.config.mjs"),
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
  });
await mkdir(resultRoot, { recursive: true });
if (deploy) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
} else await server.listen();

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const profiles = [];
  const specifications = [
    { id: "desktop", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    { id: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  ];
  if (deploy) specifications.push({
    id: "home", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, home: true,
  });
  for (const specification of specifications) profiles.push(await smokeProfile(specification));
  const report = Object.freeze({
    schema: "csschaos-browser-smoke@1",
    capturedAt: new Date().toISOString(),
    route,
    deploy,
    browser: { name: "Google Chrome", version: browser.version(), headless: true },
    profiles,
  });
  const reportPath = resolve(resultRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    accepted: true,
    reportPath,
    profiles: profiles.map(({ id, initial, final }) => ({
      id,
      leaves: initial.leafCount,
      initialSystem: initial.stats.currentSystem,
      changedTransformCount: final.changedTransformCount,
      transitions: final.stats.transitionCount,
      sourceFrameDropCount: final.stats.sourceFrameDropCount,
    })),
  }, null, 2));
} finally {
  await browser?.close();
  if (deploy) await new Promise((resolvePromise) => {
    const cleanupDeadline = setTimeout(() => {
      server.unref();
      resolvePromise();
    }, 1_000);
    server.close(() => {
      clearTimeout(cleanupDeadline);
      resolvePromise();
    });
    server.closeAllConnections();
  });
  else await server.close();
}

async function smokeProfile(specification) {
  const page = await browser.newPage({
    viewport: specification.viewport,
    deviceScaleFactor: specification.deviceScaleFactor,
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  const target = `${specification.home ? `${origin}/` : route}` +
    `?start=coullet&proof=${specification.id}`;
  await page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__cssChaosDebug?.ready === true, null, {
    timeout: 30_000,
  });
  const initial = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    const camera = document.querySelector(".example-stage > .polycss-camera");
    window.__cssChaosSmokeLeaves = leaves;
    window.__cssChaosSmokeTransforms = leaves.map((leaf) => leaf.style.transform);
    return {
      bodyClass: document.body.className,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      robots: document.querySelector('meta[name="robots"]')?.content ?? null,
      leafCount: leaves.length,
      nonLeafSceneChildCount: document.querySelectorAll(
        ".polycss-scene > :not(b)").length,
      forbiddenRendererCount: document.querySelectorAll(".example-stage canvas, .example-stage svg").length,
      cameraScale: camera instanceof HTMLElement ?
        getComputedStyle(camera).getPropertyValue("--stage-scale").trim() : null,
      stats: window.__cssChaosDebug.stats(),
      errors: window.__cssChaosDebug.errors,
    };
  });
  await page.waitForTimeout(7_200);
  const final = await page.evaluate(async () => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    const stable = window.__cssChaosSmokeLeaves;
    const initialTransforms = window.__cssChaosSmokeTransforms;
    const stats = window.__cssChaosDebug.stats();
    const paused = window.__cssChaosDebug.pause();
    const pausedFrame = window.__cssChaosDebug.stats().publishedFrame;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    const pausedFrameAfterWait = window.__cssChaosDebug.stats().publishedFrame;
    window.__cssChaosDebug.resume();
    return {
      stats,
      stableIdentity: leaves.length === stable.length &&
        leaves.every((leaf, index) => leaf === stable[index]),
      changedTransformCount: leaves.reduce((count, leaf, index) =>
        count + Number(leaf.style.transform !== initialTransforms[index]), 0),
      paused,
      pausedFrame,
      pausedFrameAfterWait,
    };
  });
  const screenshotPath = resolve(resultRoot, `route-${specification.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const report = { id: specification.id, viewport: specification.viewport,
    deviceScaleFactor: specification.deviceScaleFactor, initial, final, pageErrors,
    consoleErrors, failedResponses, requests, screenshotPath,
    expectedCanonical: specification.home ? "https://css.graphics/" :
      "https://css.graphics/chaos/" };
  assertSmoke(report);
  await page.close();
  return report;
}

function assertSmoke(report) {
  const assetRequests = report.requests.filter((path) => path.startsWith("/csschaos/"));
  if (report.initial.bodyClass !== "ready" ||
      report.initial.canonical !== report.expectedCanonical ||
      report.initial.robots !== "index, follow" ||
      report.initial.leafCount !== 2000 || report.initial.nonLeafSceneChildCount !== 0 ||
      report.initial.forbiddenRendererCount !== 0 ||
      !Number.isFinite(Number(report.initial.cameraScale)) ||
      report.initial.stats?.adapterId !== "chaos" ||
      report.initial.stats?.currentSystem !== "Coullet" ||
      report.initial.stats?.sequenceSystemCount !== 50 ||
      report.initial.stats?.starCount !== 2000 ||
      report.initial.stats?.retainedDomMode !== "prepared-flat-polycss-snapshot" ||
      report.initial.stats?.retainedCameraRootCount !== 1 ||
      report.initial.stats?.retainedSceneRootCount !== 1 ||
      report.initial.stats?.retainedPointWrapperCount !== 0 ||
      report.initial.stats?.retainedPointLeafCount !== 2000 ||
      report.initial.stats?.retainedPointIdCount !== 0 ||
      report.initial.stats?.retainedPointDataAttributeCount !== 0 ||
      report.initial.stats?.framesPerSecond !== 60 ||
      report.initial.stats?.sourceFrameStep !== 2 ||
      report.initial.stats?.runtimePhysicsCount !== 0 ||
      report.initial.stats?.runtimeRasterizationCount !== 0 ||
      report.initial.stats?.runtimeDomMutationCount !== 0 ||
      report.initial.errors.length !== 0 ||
      !report.final.stableIdentity || report.final.changedTransformCount < 1900 ||
      report.final.stats?.transitionCount < 1 ||
      report.final.stats?.sourceFrameStep !== 2 ||
      report.final.stats?.sourceFrameDropCount !== 0 ||
      report.final.stats?.workerStartCount !== 1 ||
      report.final.stats?.retainedPreparedSystemCount > 2 ||
      report.final.paused !== true ||
      report.final.pausedFrame !== report.final.pausedFrameAfterWait ||
      assetRequests.filter((path) => path.endsWith("prepared.json")).length !== 1 ||
      assetRequests.filter((path) =>
        /\/snapshot-[a-f0-9]{64}\.html$/u.test(path)).length !== 1 ||
      assetRequests.filter((path) => path.endsWith(".bin.br")).length < 2 ||
      report.pageErrors.length || report.consoleErrors.length || report.failedResponses.length) {
    throw new Error(`Chaos ${report.id} browser smoke failed:\n${JSON.stringify(report, null, 2)}`);
  }
}

function createStaticDeployServer(root) {
  const rootPrefix = `${root}${sep}`;
  return createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", route).pathname);
      const normalized = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const path = resolve(root, `.${normalized}`);
      if (!path.startsWith(rootPrefix)) return response.writeHead(403).end();
      const bytes = await readFile(path);
      response.statusCode = 200;
      response.setHeader("Content-Type", mediaType(path));
      response.setHeader("Content-Length", bytes.byteLength);
      if (path.endsWith(".bin.br")) {
        response.setHeader("Content-Encoding", "br");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (error?.code === "ENOENT") return response.writeHead(404).end();
      response.writeHead(500).end();
    }
  });
}

function mediaType(path) {
  if (path.endsWith(".bin.br")) return "application/octet-stream";
  return new Map([
    [".css", "text/css"], [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"], [".webp", "image/webp"],
  ]).get(extname(path)) ?? "application/octet-stream";
}
