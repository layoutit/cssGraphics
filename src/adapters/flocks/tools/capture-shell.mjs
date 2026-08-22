#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssflocks/shell");
const port = 4189;
const url = `http://127.0.0.1:${port}/flocks/?palette=rotate-120`;
const profiles = [
  { id: "desktop", viewport: { width: 1280, height: 800 }, expectedHeaderHeight: 55 },
  { id: "mobile", viewport: { width: 390, height: 844 }, expectedHeaderHeight: 50 },
];
await mkdir(outputRoot, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/flocks/vite.config.mjs", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot, env: process.env, stdio: "ignore",
});
let browser;
try {
  await waitForServer(url, server);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const reports = [];
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const loading = await shellMetrics(page);
    await page.screenshot({ path: resolve(outputRoot, `${profile.id}-loading.png`) });
    await page.waitForFunction(() => window.__cssFlocksDebug?.ready === true, null, { timeout: 30_000 });
    const ready = await shellMetrics(page);
    await page.screenshot({ path: resolve(outputRoot, `${profile.id}-ready.png`) });
    const report = { id: profile.id, viewport: profile.viewport, expectedHeaderHeight: profile.expectedHeaderHeight, loading, ready, errors };
    if (errors.length || loading.header.height !== profile.expectedHeaderHeight ||
        ready.header.height !== profile.expectedHeaderHeight || ready.wordmark.width !== 156 ||
        JSON.stringify(loading.header) !== JSON.stringify(ready.header) ||
        JSON.stringify(loading.wordmark) !== JSON.stringify(ready.wordmark) ||
        ready.githubAccessibleName !== "View cssGraphics on GitHub" || ready.wordmarkAccessibleName !== "css.graphics home" ||
        ready.projectCount !== 7 || ready.flocksListed || ready.cameraCount !== 1) {
      throw new Error(`Flocks production shell capture failed: ${JSON.stringify(report)}`);
    }
    reports.push(report);
    await context.close();
  }
  const output = { schema: "cssflocks-production-shell-capture@1", url, reports };
  await writeFile(resolve(outputRoot, "report.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser?.close();
  await stopServer(server);
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".examples-header");
    const wordmark = document.querySelector(".examples-wordmark svg");
    const github = document.querySelector(".examples-github-link");
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    return {
      bodyClass: document.body.className,
      header: box(header),
      wordmark: box(wordmark),
      github: box(github),
      wordmarkAccessibleName: document.querySelector(".examples-wordmark").getAttribute("aria-label"),
      githubAccessibleName: github.getAttribute("aria-label"),
      githubHref: github.href,
      svgCount: header.querySelectorAll("svg").length,
      projectCount: document.querySelectorAll("#asset-list .project-thumbnail").length,
      flocksListed: [...document.querySelectorAll("#asset-list .project-thumbnail")]
        .some((link) => new URL(link.href).pathname === "/flocks/"),
      cameraCount: document.querySelectorAll(".example-stage > .polycss-camera").length,
    };
  });
}

async function waitForServer(targetUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Flocks shell server exited early: ${child.exitCode}`);
    try { const response = await fetch(targetUrl); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Flocks shell server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
