#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssselectropaint/paths.mjs";

const commandLine = process.argv.slice(2);
if (commandLine[0] === "--") commandLine.shift();
const options = parseOptions(commandLine);
const outputDirectory = isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);
await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length !== 0) {
  throw new Error(`Browser timing output must be an empty directory: ${outputDirectory}`);
}

const port = await freePort();
let serverOutput = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitFor(() => serverOutput.includes("Local:") || serverOutput.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const route = `http://127.0.0.1:${port}/`;
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => globalThis.__cssElectropaint?.status === "ready" || globalThis.__cssElectropaint?.status === "error",
      null,
      { timeout: 120_000 },
    );
    if (await page.evaluate(() => globalThis.__cssElectropaint?.status) !== "ready") {
      throw new Error(await page.evaluate(() => globalThis.__cssElectropaint?.error ?? "ElectroPaint failed"));
    }
    const result = await page.evaluate(async ({ startState, stateCount }) => {
      const api = globalThis.__cssElectropaint;
      api.pause();
      await api.setState(startState);
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const scene = document.querySelector(".polycss-scene");
      if (!(scene instanceof HTMLElement)) throw new Error("ElectroPaint timing scene is missing");
      const before = api.stats().player;
      const events = [{ sequenceIndex: 0, stateIndex: startState, timestampMilliseconds: 0 }];
      let lastStateIndex = startState;
      const startedAt = performance.now();
      await new Promise((resolveCapture, rejectCapture) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          rejectCapture(new Error(`Browser timing capture stopped at ${events.length}/${stateCount} states`));
        }, Math.max(15_000, stateCount * 35));
        const observer = new MutationObserver((records) => {
          if (!records.some((record) => record.type === "attributes" && record.attributeName === "style")) return;
          const stateIndex = api.stats().player.stateIndex;
          if (stateIndex === lastStateIndex) return;
          events.push({
            sequenceIndex: events.length,
            stateIndex,
            timestampMilliseconds: performance.now() - startedAt,
          });
          lastStateIndex = stateIndex;
          if (events.length === stateCount) {
            clearTimeout(timeout);
            observer.disconnect();
            resolveCapture();
          }
        });
        observer.observe(scene, { subtree: true, attributes: true, attributeFilter: ["style", "class"] });
        api.resume();
      });
      api.pause();
      const after = api.stats().player;
      return {
        events,
        appCounterDelta: Object.fromEntries(Object.keys(after)
          .filter((key) => typeof after[key] === "number" && typeof before[key] === "number")
          .map((key) => [key, after[key] - before[key]])),
        presentationCadence: api.scene.playback.presentationCadence,
        userAgent: navigator.userAgent,
      };
    }, { startState: options.start, stateCount: options.states });
    if (pageErrors.length > 0) throw new Error(`Browser timing page errors: ${pageErrors.join("; ")}`);
    const output = {
      schema: "cssselectropaint-browser-timing@1",
      capturedAt: new Date().toISOString(),
      browser: chromeVersion(result.userAgent),
      channel: "chrome",
      headless: true,
      route,
      viewport: { width: options.width, height: options.height, deviceScaleFactor: 1 },
      startState: options.start,
      stateCount: options.states,
      events: result.events,
      appCounterDelta: result.appCounterDelta,
      presentationCadence: result.presentationCadence,
      pageErrors,
    };
    const outputPath = resolve(outputDirectory, "browser-timing.json");
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({
      status: "captured",
      outputPath,
      schema: output.schema,
      browser: output.browser,
      viewport: output.viewport,
      startState: output.startState,
      stateCount: output.stateCount,
      elapsedMilliseconds: output.events.at(-1).timestampMilliseconds,
      appCounterDelta: output.appCounterDelta,
      pageErrors: output.pageErrors,
    }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function parseOptions(argumentsList) {
  const values = {
    out: resolve(repositoryRoot, "bench", "results", "cssselectropaint", "temporal", "browser-timing"),
    states: 1_500,
    start: 0,
    width: 960,
    height: 540,
  };
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`Invalid option ${flag ?? ""}`);
    const key = { "--out": "out", "--states": "states", "--start": "start", "--width": "width", "--height": "height" }[flag];
    if (!key) throw new Error(`Unknown option ${flag}`);
    values[key] = key === "out" ? value : integer(value, flag);
  }
  if (values.states < 2 || values.states > 64_000 || values.start < 0 ||
      values.start + values.states > 64_000 || values.width < 64 || values.width > 1_920 ||
      values.height < 64 || values.height > 1_080) {
    throw new Error("Browser timing capture range or viewport is invalid");
  }
  return values;
}

function integer(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} requires an integer`);
  return parsed;
}

function chromeVersion(userAgent) {
  const match = /Chrome\/([^ ]+)/u.exec(userAgent);
  return Object.freeze({ name: "Google Chrome", version: match?.[1] ?? "unknown" });
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(selected));
    });
    probe.on("error", rejectPort);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const startedAt = Date.now();
  while (!predicate()) {
    onPoll();
    if (Date.now() - startedAt > timeoutMilliseconds) throw new Error(`Timed out starting Vite:\n${serverOutput}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}
