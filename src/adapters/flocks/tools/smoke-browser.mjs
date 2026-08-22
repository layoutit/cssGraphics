#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repositoryRoot = resolve(new URL("../../../..", import.meta.url).pathname);
const deploy = process.argv.includes("--deploy");
const resultRoot = resolve(repositoryRoot, `bench/results/cssflocks/${deploy ? "deploy" : "browser"}`);
const port = 4177;
const proof = `${Date.now().toString(36)}-${process.pid}`;
const url = `http://127.0.0.1:${port}/flocks/?window=source-114s&palette=rotate-120`;
const cacheBustedHtmlUrl = `http://127.0.0.1:${port}/flocks/?proof=${proof}`;
await mkdir(resultRoot, { recursive: true });
let serverOutput = "";
const server = spawn("pnpm", deploy ? [
  "exec", "vite", "preview",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  "--outDir", resolve(repositoryRoot, "dist/site"),
] : [
  "exec", "vite",
  "--config", "src/adapters/flocks/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });

let browser;
try {
  await waitForServer(url, server);
  const cacheBustedHtml = deploy ? await fetch(cacheBustedHtmlUrl, { cache: "no-store" }) : null;
  if (cacheBustedHtml && (!cacheBustedHtml.ok || !(await cacheBustedHtml.text()).includes("/flocks/assets/"))) {
    throw new Error(`Flocks cache-busted built HTML probe failed: ${cacheBustedHtml.status}`);
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const assetRequests = [];
  if (deploy) {
    await page.route("**/cssflocks/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      requestUrl.searchParams.set("proof", proof);
      assetRequests.push(requestUrl.href);
      await route.continue({ url: requestUrl.href });
    });
  }
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  const startedAt = performance.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  try {
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.href,
      bodyClass: document.body.className,
      bodyText: document.body.innerText,
      debugReady: window.__cssFlocksDebug?.ready ?? null,
      debugErrors: window.__cssFlocksDebug?.errors ?? null,
    })).catch(() => null);
    throw new Error(`Flocks smoke readiness failed: ${JSON.stringify({ state, pageErrors, consoleErrors, failedResponses, assetRequests })}`, { cause: error });
  }
  const readyMilliseconds = performance.now() - startedAt;
  const initial = await page.evaluate(() => {
    const camera = document.querySelector(".example-stage > .polycss-camera");
    const scene = camera?.querySelector(":scope > .polycss-scene");
    const roots = scene ? [...scene.children].filter((element) => element.tagName === "DIV") : [];
    const leaves = roots.flatMap((root) => [...root.children]);
    window.__cssFlocksSmokeIdentity = { roots, leaves };
    return {
      bodyClass: document.body.className,
      debugErrors: window.__cssFlocksDebug.errors,
      stats: window.__cssFlocksDebug.stats(),
      cameraCount: document.querySelectorAll(".example-stage > .polycss-camera").length,
      sceneCount: camera?.querySelectorAll(":scope > .polycss-scene").length ?? 0,
      directRootCount: roots.length,
      leafCount: leaves.length,
      modelWrapperCount: document.querySelectorAll("[data-poly-morph-model]").length,
      rendererCanvasCount: camera?.querySelectorAll("canvas").length ?? 0,
      rendererSvgCount: camera?.querySelectorAll("svg").length ?? 0,
      directRootParents: roots.every((root) => root.parentElement === scene),
      colors: roots.slice(0, 8).map((root) => getComputedStyle(root).color),
    };
  });
  await page.waitForTimeout(2_200);
  const afterPlayback = await page.evaluate(() => {
    const camera = document.querySelector(".example-stage > .polycss-camera");
    const scene = camera?.querySelector(":scope > .polycss-scene");
    const roots = scene ? [...scene.children].filter((element) => element.tagName === "DIV") : [];
    const leaves = roots.flatMap((root) => [...root.children]);
    const initialIdentity = window.__cssFlocksSmokeIdentity;
    return {
      stats: window.__cssFlocksDebug.stats(),
      directRootCount: roots.length,
      leafCount: leaves.length,
      sameRootIdentity: roots.length === initialIdentity.roots.length &&
        roots.every((root, index) => root === initialIdentity.roots[index]),
      sameLeafIdentity: leaves.length === initialIdentity.leaves.length &&
        leaves.every((leaf, index) => leaf === initialIdentity.leaves[index]),
      modelWrapperCount: document.querySelectorAll("[data-poly-morph-model]").length,
      rendererCanvasCount: camera?.querySelectorAll("canvas").length ?? 0,
      rendererSvgCount: camera?.querySelectorAll("svg").length ?? 0,
    };
  });
  const screenshotPath = resolve(resultRoot, "default.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const report = {
    schema: "cssflocks-browser-smoke@1",
    headless: true,
    deploy,
    cacheBustProof: deploy ? proof : null,
    cacheBustedHtmlUrl: deploy ? cacheBustedHtmlUrl : null,
    url,
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    readyMilliseconds: Number(readyMilliseconds.toFixed(2)),
    initial,
    afterPlayback,
    pageErrors,
    consoleErrors,
    failedResponses,
    assetRequests,
    screenshotPath,
  };
  assertSmoke(report);
  const reportPath = resolve(resultRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await browser?.close();
  await writeFile(resolve(resultRoot, "server.log"), serverOutput);
  await stopServer(server);
}

function assertSmoke(report) {
  const expectedRoots = 324;
  const expectedLeaves = 1_944;
  if (report.initial.bodyClass !== "ready" ||
      report.initial.stats?.productBugCount !== expectedRoots ||
      report.initial.cameraCount !== 1 || report.initial.sceneCount !== 1 ||
      report.initial.directRootCount !== expectedRoots || report.initial.leafCount !== expectedLeaves ||
      !report.initial.directRootParents || report.initial.modelWrapperCount !== 0 ||
      report.initial.rendererCanvasCount !== 0 || report.initial.rendererSvgCount !== 0 ||
      report.afterPlayback.directRootCount !== expectedRoots || report.afterPlayback.leafCount !== expectedLeaves ||
      !report.afterPlayback.sameRootIdentity || !report.afterPlayback.sameLeafIdentity ||
      report.afterPlayback.modelWrapperCount !== 0 || report.afterPlayback.rendererCanvasCount !== 0 ||
      report.afterPlayback.rendererSvgCount !== 0 || report.afterPlayback.stats?.runtimeDomGrowth !== false ||
      report.initial.debugErrors.length > 0 || report.pageErrors.length > 0 || report.consoleErrors.length > 0 ||
      report.failedResponses.length > 0 || (report.deploy && (report.assetRequests.length < 8 ||
        report.assetRequests.some((requestUrl) => new URL(requestUrl).searchParams.get("proof") !== report.cacheBustProof)))) {
    throw new Error(`Flocks headless browser smoke failed: ${JSON.stringify(report)}`);
  }
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks Vite server exited early: ${child.exitCode}`);
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      // Bounded readiness retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Flocks Vite server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
