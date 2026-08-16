#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

import { adapterRoot, repositoryRoot } from "../src/prepare/csssolitaire/paths.mjs";

const deploy = process.argv.includes("--deploy");
const port = await freePort();
const route = deploy ? "/solitaire/" : "/";
const screenshotPath = process.env.CSSSOLITAIRE_SMOKE_SCREENSHOT ??
  join(repositoryRoot, "bench", "results", "csssolitaire", "browser-smoke.png");
let output = "";
const server = spawn("pnpm", deploy ? [
  "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port),
  "--strictPort", "--outDir", join(repositoryRoot, "dist", "site"),
] : [
  "exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
        errors.push(message.text());
      }
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const startedAt = performance.now();
    await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__cssSolitaireDebug?.ready === true ||
      window.__cssSolitaireDebug?.errors().length > 0, null, { timeout: 30_000 });
    const readyMs = performance.now() - startedAt;
    const productErrors = await page.evaluate(() => window.__cssSolitaireDebug.errors());
    if (errors.length || productErrors.length) {
      throw new Error(`cssSolitaire browser errors:\n${[...errors, ...productErrors].join("\n")}`);
    }
    await page.evaluate(() => {
      window.__cssSolitaireDebug.pause();
      const mutations = { added: 0, removed: 0 };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          mutations.added += record.addedNodes.length;
          mutations.removed += record.removedNodes.length;
        }
      });
      observer.observe(document.querySelector(".csssolitaire-board"), { childList: true, subtree: true });
      window.__cssSolitaireSmoke = { mutations, observer };
    });

    const sampled = await page.evaluate(() => [0, 1250, 7250, 35750, 69474, 69475, 70475]
      .map((timeMs) => window.__cssSolitaireDebug.seek(timeMs)));
    const [initial, firstArc, firstHandoff, middle, nearEnd, cleared, wrapped] = sampled;
    const autoplayLoop = await page.evaluate(async () => {
      window.__cssSolitaireDebug.seek(70100);
      window.__cssSolitaireDebug.resume();
      await new Promise((resolveWait) => setTimeout(resolveWait, 650));
      return window.__cssSolitaireDebug.pause();
    });
    const evidence = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll(".csssolitaire-board > s")];
      const first = leaves[0];
      const rect = first.getBoundingClientRect();
      const resources = performance.getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.includes("csssolitaire"));
      return {
        stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
        stats: window.__cssSolitaireDebug.stats(),
        mutations: { ...window.__cssSolitaireSmoke.mutations },
        retainedLeaves: leaves.length,
        visibleLeaves: leaves.filter((leaf) => getComputedStyle(leaf).visibility === "visible").length,
        forbiddenSceneElements: document.querySelectorAll("#scene canvas, #scene svg").length,
        radius: getComputedStyle(first).borderRadius,
        imageRendering: getComputedStyle(first).imageRendering,
        cardRect: { width: rect.width, height: rect.height },
        resources,
        shell: {
          path: document.querySelector(".site-wordmark-path")?.textContent,
          buttons: document.querySelectorAll("button, nav, section, output").length,
        },
      };
    });
    if (readyMs >= 5_000 || initial.frameIndex !== 0 || initial.visibleTrailCards !== 0 ||
        firstArc.sourceStep !== 100 || firstArc.visibleTrailCards !== 101 ||
        firstHandoff.sourceStep !== 900 || firstHandoff.visibleTrailCards !== 901 ||
        middle.sourceStep !== 4700 || middle.visibleTrailCards !== 4676 ||
        nearEnd.sourceStep !== 9131 || nearEnd.visibleTrailCards !== 8835 ||
        cleared.frameIndex !== 1646 || cleared.visibleTrailCards !== 0 ||
        wrapped.frameIndex !== 0 || wrapped.visibleTrailCards !== 0 ||
        autoplayLoop.playheadMs >= 500 || autoplayLoop.visibleTrailCards !== 0 ||
        !evidence.stable || evidence.retainedLeaves !== 8839 || evidence.visibleLeaves !== 4 ||
        evidence.forbiddenSceneElements !== 0 || evidence.mutations.added !== 0 || evidence.mutations.removed !== 0 ||
        evidence.radius !== "14px" || evidence.imageRendering !== "auto" ||
        !(evidence.cardRect.height > evidence.cardRect.width) || evidence.shell.path !== "/solitaire" ||
        evidence.shell.buttons !== 0 || evidence.stats.runtimeAnimationFrameCallbackCount !== 0 ||
        evidence.stats.runtimeTimerCallbackCount < 1 || evidence.stats.loopCount < 1 ||
        evidence.stats.runtimeGeometryCalculationCount !== 0 ||
        evidence.stats.runtimeTrajectoryCalculationCount !== 0 ||
        evidence.stats.runtimeRandomNumberCount !== 0 ||
        evidence.stats.runtimeAtlasRasterizationCount !== 0 ||
        evidence.stats.runtimeDomMutationCount !== 0 ||
        !evidence.resources.includes("/csssolitaire/manifest.json") ||
        !evidence.resources.includes("/csssolitaire/solitaire.polycss.html") ||
        !evidence.resources.includes("/csssolitaire/solitaire-playback.json") ||
        evidence.resources.some((path) => path.endsWith("model.json"))) {
      throw new Error(`cssSolitaire smoke contract failed: ${JSON.stringify({ readyMs, sampled, evidence })}`);
    }
    await page.evaluate(() => window.__cssSolitaireDebug.seek(35750));
    await mkdir(dirname(screenshotPath), { recursive: true });
    const screenshot = await page.screenshot({ path: screenshotPath });
    const png = PNG.sync.read(screenshot);
    let nonGreenPixels = 0;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const [red, green, blue] = png.data.subarray(offset, offset + 3);
      if (!(red < 12 && green > 112 && green < 144 && blue < 12)) nonGreenPixels += 1;
    }
    const nonGreenRatio = nonGreenPixels / (png.width * png.height);
    if (nonGreenRatio < 0.12) throw new Error(`cssSolitaire screenshot is visually empty: ${nonGreenRatio}`);
    await page.evaluate(() => window.__cssSolitaireSmoke.observer.disconnect());
    process.stdout.write(`${JSON.stringify({
      status: "passed", headless: true, browser: browser.version(), deploy, route,
      readyMs, sampled, autoplayLoop, evidence, nonGreenRatio, screenshotPath,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolvePort(typeof address === "object" && address ? address.port : 0));
    });
    listener.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMs, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for cssSolitaire Vite server");
}
