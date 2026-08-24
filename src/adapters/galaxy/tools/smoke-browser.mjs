#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

if (!process.argv.includes("--deploy")) {
  throw new Error("Galaxy browser smoke currently requires the built --deploy route");
}

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const deployRoot = resolve(repositoryRoot, "dist/site");
const resultRoot = resolve(repositoryRoot, "bench/results/cssgalaxy/deploy");
const port = 4210;
const route = `http://127.0.0.1:${port}/galaxy/`;
const server = createStaticDeployServer(deployRoot);
await mkdir(resultRoot, { recursive: true });
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolvePromise);
});

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const version = browser.version();
  const profiles = [];
  for (const specification of [
    { id: "desktop", viewport: { width: 1280, height: 800 }, starCount: 1500, galaxyCount: 3 },
    { id: "mobile", viewport: { width: 390, height: 844 }, starCount: 1000, galaxyCount: 2 },
  ]) profiles.push(await smokeProfile(specification));
  const report = Object.freeze({
    schema: "cssgalaxy-deploy-browser-smoke@2",
    capturedAt: new Date().toISOString(),
    route,
    browser: Object.freeze({ name: "Google Chrome", channel: "chrome", version, headless: true }),
    profiles,
  });
  const reportPath = resolve(resultRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, accepted: true, profiles }, null, 2));
} catch (error) {
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

async function smokeProfile(specification) {
  const page = await browser.newPage({ viewport: specification.viewport, deviceScaleFactor: 1 });
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
  await page.goto(`${route}?proof=${specification.id}-${Date.now().toString(36)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__cssGalaxyDebug?.ready === true, null, {
    timeout: 30_000,
  });
  const initial = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    window.__cssGalaxySmokeLeaves = leaves;
    window.__cssGalaxySmokeInitialTransforms = leaves.map((leaf) => leaf.style.transform);
    return {
      bodyClass: document.body.className,
      stats: window.__cssGalaxyDebug.stats(),
      errors: window.__cssGalaxyDebug.errors,
      leafCount: leaves.length,
      inlineTransformCount: leaves.filter((leaf) => leaf.style.transform).length,
      inlinePositionCount: leaves.filter((leaf) =>
        leaf.style.getPropertyValue("--cssgalaxy-position")).length,
      computedTransformCount: leaves.filter((leaf) => getComputedStyle(leaf).transform !== "none").length,
      translateCount: leaves.filter((leaf) => leaf.style.translate).length,
      robots: document.querySelector('meta[name="robots"]')?.content ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
    };
  });
  await page.waitForTimeout(2_200);
  const final = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    const stable = window.__cssGalaxySmokeLeaves;
    return {
      stats: window.__cssGalaxyDebug.stats(),
      leafCount: leaves.length,
      stableIdentity: leaves.length === stable.length &&
        leaves.every((leaf, index) => leaf === stable[index]),
      changedTransformCount: leaves.reduce((count, leaf, index) => count + Number(
        leaf.style.transform !== window.__cssGalaxySmokeInitialTransforms[index]), 0),
    };
  });
  const screenshotPath = resolve(resultRoot, `route-${specification.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const report = Object.freeze({
    id: specification.id,
    expectedStarCount: specification.starCount,
    expectedGalaxyCount: specification.galaxyCount,
    viewport: Object.freeze({ ...specification.viewport, deviceScaleFactor: 1 }),
    initial,
    final,
    pageErrors,
    consoleErrors,
    failedResponses,
    requests,
    screenshotPath,
  });
  assertSmoke(report);
  await page.close();
  return report;
}

function assertSmoke(report) {
  const assetRequests = report.requests.filter((path) => path.startsWith("/galaxy/assets/"));
  const preparedRequests = report.requests.filter((path) => path.startsWith("/cssgalaxy/"));
  const fullLandingPreviewRequests = report.requests.filter((path) =>
    /^\/landing\/(?!sidebar\/)/u.test(path));
  if (report.initial.bodyClass !== "ready" ||
      report.initial.stats?.profileId !== report.id ||
      report.initial.stats?.galaxyCount !== report.expectedGalaxyCount ||
      report.initial.leafCount !== report.expectedStarCount ||
      report.initial.inlineTransformCount !== report.expectedStarCount ||
      report.initial.inlinePositionCount !== 0 ||
      report.initial.computedTransformCount !== report.expectedStarCount ||
      report.initial.translateCount !== 0 ||
      report.initial.robots !== "index, follow" ||
      report.initial.canonical !== "https://css.graphics/galaxy/" ||
      report.initial.errors.length !== 0 || report.initial.stats?.runtimePhysicsCount !== 0 ||
      report.initial.stats?.runtimeDomReconstructionCount !== 0 ||
      report.final.leafCount !== report.expectedStarCount || !report.final.stableIdentity ||
      report.final.changedTransformCount < 100 || report.final.stats?.runtimeDomGrowth !== false ||
      assetRequests.length < 3 || preparedRequests.length < 4 ||
      fullLandingPreviewRequests.length !== 0 ||
      report.pageErrors.length !== 0 || report.consoleErrors.length !== 0 ||
      report.failedResponses.length !== 0) {
    throw new Error(`Galaxy deploy smoke failed: ${JSON.stringify(report)}`);
  }
}

function createStaticDeployServer(root) {
  const rootPrefix = `${root}${sep}`;
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", route).pathname);
      const normalized = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const path = resolve(root, `.${normalized}`);
      if (!path.startsWith(rootPrefix)) {
        response.writeHead(403).end();
        return;
      }
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
      if (error?.code === "ENOENT") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(500).end();
    }
  });
}

function mediaType(path) {
  if (path.endsWith(".bin.br")) return "application/octet-stream";
  return new Map([
    [".css", "text/css"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".webp", "image/webp"],
  ]).get(extname(path)) ?? "application/octet-stream";
}
