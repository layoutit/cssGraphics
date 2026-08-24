#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { CSSGALAXY_VARIANT_COUNTS } from "../src/prepare/cssgalaxy/sourceModel.mjs";
import { CSSGALAXY_FRAME_SEQUENCE_PLAN as plan } from "./frameSequencePlan.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssgalaxy/comparison");
const frameOracle = "/Users/ekrof/.codex/skills/frame-sequence-oracle/scripts/frame-sequence.mjs";
const port = 4201;
const baseUrl = `http://127.0.0.1:${port}/`;
const server = spawn("pnpm", ["exec", "vite", "--config", "src/adapters/galaxy/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
{ cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let serverOutput = "";
server.stdout.on("data", (bytes) => { serverOutput += bytes; });
server.stderr.on("data", (bytes) => { serverOutput += bytes; });

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const reports = [];
  for (const count of CSSGALAXY_VARIANT_COUNTS) {
    const root = resolve(resultRoot, String(count), "browser");
    const raw = resolve(root, "raw");
    const packaged = resolve(root, "packaged");
    await rm(root, { recursive: true, force: true });
    await mkdir(raw, { recursive: true });
    const context = await browser.newContext({ viewport: plan.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${baseUrl}?stars=${count}&seed=${plan.seed}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__cssGalaxyDebug?.ready === true, null, { timeout: 30_000 });
    await page.evaluate(() => window.__cssGalaxyDebug.pause());
    const initial = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(".polycss-scene > b"));
      window.__cssGalaxyCaptureIdentityNodes = nodes;
      return {
        leafCount: nodes.length,
        debugIdentityAssertion: window.__cssGalaxyDebug.assertStableDomIdentity(),
      };
    });
    for (let ordinal = 0; ordinal < plan.capturedFrameCount; ordinal += 1) {
      const streamFrame = ordinal * plan.sourceFrameStride;
      await page.evaluate((index) => window.__cssGalaxyDebug.seekStreamFrame(index), streamFrame);
      await page.screenshot({
        path: resolve(raw, `frame_${String(ordinal).padStart(4, "0")}.png`),
        animations: "disabled",
      });
    }
    const final = await page.evaluate(() => {
      const current = Array.from(document.querySelectorAll(".polycss-scene > b"));
      const retained = window.__cssGalaxyCaptureIdentityNodes;
      return {
        stats: window.__cssGalaxyDebug.stats(),
        leafCount: current.length,
        stableNodeReferences: retained.length === current.length &&
          retained.every((node, index) => node === current[index]),
        debugIdentityAssertion: window.__cssGalaxyDebug.assertStableDomIdentity(),
        wrapperCount: document.querySelectorAll(".polycss-scene > div").length,
        leafIdCount: document.querySelectorAll(".polycss-scene > b[id]").length,
        leafDataAttributeCount: current.reduce((sum, leaf) => sum +
          [...leaf.attributes].filter((attribute) => attribute.name.startsWith("data-")).length, 0),
        bodyClass: document.body.className,
      };
    });
    await context.close();
    if (errors.length > 0 || final.bodyClass !== "ready" || initial.leafCount !== count ||
        final.leafCount !== count || !initial.debugIdentityAssertion || !final.stableNodeReferences ||
        !final.debugIdentityAssertion || final.wrapperCount !== 0 || final.leafIdCount !== 0 ||
        final.leafDataAttributeCount !== 0) {
      throw new Error(`Browser Galaxy ${count} sequence drifted: ${JSON.stringify({ errors, final })}`);
    }
    await run(process.execPath, [frameOracle, "package", "--frames", raw, "--out", packaged,
      "--label", `cssgalaxy_${count}_browser`, "--expected-frames", String(plan.capturedFrameCount),
      "--lead-frames", "20", "--replace"]);
    const report = Object.freeze({
      schema: "cssgalaxy-browser-frame-sequence@1",
      starCount: count,
      plan,
      browser: Object.freeze({ name: "Google Chrome", channel: "chrome", version: browserVersion, headless: true }),
      route: `${baseUrl}?stars=${count}&seed=${plan.seed}`,
      errors: Object.freeze(errors),
      stableIdentity: final.stableNodeReferences && final.debugIdentityAssertion,
      identityEvidence: "same-page DOM reference equality plus prepared-snapshot identity assertion",
      retainedTopology: Object.freeze({ directPointLeaves: final.leafCount,
        perPointWrappers: final.wrapperCount, pointIds: final.leafIdCount,
        pointDataAttributes: final.leafDataAttributeCount }),
      finalStats: final.stats,
      raw,
      packaged,
    });
    await writeFile(resolve(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    reports.push(report);
    process.stdout.write(`browser Galaxy ${count}: ${raw}\n`);
  }
  console.log(JSON.stringify({ resultRoot, reports }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  await stopServer();
  await writeFile(resolve(resultRoot, "browser-capture-server.log"), serverOutput).catch(() => undefined);
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Galaxy Vite exited early: ${server.exitCode}`);
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Galaxy Vite did not become ready");
}

async function stopServer() {
  if (server.exitCode !== null) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  await Promise.race([
    new Promise((resolvePromise) => server.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (server.exitCode === null) {
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
}

async function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; });
    child.stderr.on("data", (bytes) => { stderr += bytes; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise({ stdout, stderr }) :
      reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}
