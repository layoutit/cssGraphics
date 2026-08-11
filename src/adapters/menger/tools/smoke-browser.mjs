#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmenger/paths.mjs";

const smokeDir = join("bench", "results", "cssmenger", "smoke");
const screenshotPath = join(smokeDir, "default-route.png");
const narrowMobileScreenshotPath = join(smokeDir, "mobile-360-default-route.png");
const mobileScreenshotPath = join(smokeDir, "mobile-390-default-route.png");
const statePath = join(smokeDir, "state.json");
const port = await freePort();
const route = `http://127.0.0.1:${port}/`;
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(smokeDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const requests = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null,
      { timeout: 30_000 });

    const evidence = await page.evaluate(() => {
      const debug = globalThis.__cssMengerDebug;
      const scene = document.querySelector(".polycss-camera > .polycss-scene");
      const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b")];
      const importantRules = [];
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...(sheet.cssRules ?? [])]) {
          if (rule.cssText?.includes("!important")) importantRules.push(rule.cssText);
        }
      }
      const firstStyle = getComputedStyle(leaves[0]);
      return {
        status: document.body.dataset.portStatus,
        ready: debug?.ready === true,
        stable: debug?.assertStableDomIdentity?.() === true,
        errors: debug?.errors?.() ?? [],
        stats: debug?.stats?.() ?? null,
        bCount: leaves.length,
        iCount: document.querySelectorAll(".polycss-camera > .polycss-scene > i").length,
        sCount: document.querySelectorAll(".polycss-camera > .polycss-scene > s").length,
        forbiddenRendererCount: document.querySelectorAll("canvas, svg:not(.site-wordmark-svg):not(.site-action-icon)").length,
        leafImportantInlineCount: leaves.filter((leaf) => leaf.getAttribute("style")?.includes("important")).length,
        leafBackgroundSizeInlineCount: leaves.filter((leaf) => leaf.style.backgroundSize).length,
        leafImageRenderingInlineCount: leaves.filter((leaf) => leaf.style.imageRendering).length,
        leafInlineProperties: [...new Set(leaves.flatMap((leaf) => [...leaf.style]))].sort(),
        sceneInlineProperties: [...scene.style].sort(),
        cameraInlineProperties: [...document.querySelector(".polycss-camera").style].sort(),
        importantRules,
        computed: {
          width: firstStyle.width,
          height: firstStyle.height,
          imageRendering: firstStyle.imageRendering,
          backfaceVisibility: firstStyle.backfaceVisibility,
          backgroundSize: firstStyle.backgroundSize,
        },
        expectedBackgroundSize: `${debug.scene.planeAtlas.width}px ${debug.scene.planeAtlas.height}px`,
        atlasUrl: debug.scene.planeAtlas.assetUrl,
        atlasWidth: debug.scene.planeAtlas.width,
        atlasHeight: debug.scene.planeAtlas.height,
        atlasPageCount: debug.scene.metrics.atlasPageCount,
        sceneVariableWidth: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-width"),
        sceneVariableHeight: getComputedStyle(scene).getPropertyValue("--cssmenger-atlas-height"),
      };
    });

    const sampledStates = [];
    for (const tick of [0, 36, 420, 1_439]) {
      sampledStates.push(await page.evaluate((stateIndex) => {
        const debug = globalThis.__cssMengerDebug;
        debug.seek(stateIndex);
        const scene = document.querySelector(".polycss-camera > .polycss-scene");
        const actual = new DOMMatrix(scene.style.transform).toFloat64Array();
        const expected = new DOMMatrix(debug.scene.playback.transforms[stateIndex]).toFloat64Array();
        return {
          tick: debug.state().tick,
          paused: debug.state().paused,
          matrixMaxDelta: Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))),
        };
      }, tick));
    }
    const playbackProgress = await page.evaluate(async () => {
      const debug = globalThis.__cssMengerDebug;
      debug.seek(0);
      debug.resume();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      debug.pause();
      return debug.state();
    });
    const atlasRequests = requests.filter((path) => /^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(path));
    const pageRequests = requests.filter((path) => /(?:page|frame)-\d+/u.test(path));

    if (pageErrors.length || evidence.status !== "ready" || !evidence.ready || !evidence.stable ||
        evidence.errors.length || evidence.bCount !== 84 || evidence.iCount !== 0 || evidence.sCount !== 0 ||
        evidence.forbiddenRendererCount !== 0 || evidence.leafImportantInlineCount !== 0 ||
        evidence.leafBackgroundSizeInlineCount !== 0 || evidence.leafImageRenderingInlineCount !== 0 ||
        evidence.leafInlineProperties.some((property) =>
          !["background-position", "background-position-x", "background-position-y"].includes(property)) ||
        evidence.sceneInlineProperties.some((property) => !["--a", "transform"].includes(property)) ||
        evidence.cameraInlineProperties.length !== 0 ||
        evidence.importantRules.length !== 0 || evidence.computed.width !== "27px" ||
        evidence.computed.height !== "27px" || evidence.computed.imageRendering !== "pixelated" ||
        evidence.computed.backfaceVisibility !== "hidden" ||
        evidence.computed.backgroundSize !== evidence.expectedBackgroundSize ||
        evidence.sceneVariableWidth !== `${evidence.atlasWidth}px` ||
        evidence.sceneVariableHeight !== `${evidence.atlasHeight}px` || evidence.atlasPageCount !== 1 ||
        atlasRequests.length !== 1 || pageRequests.length !== 0 ||
        sampledStates.some((sample, index) => sample.tick !== [0, 36, 420, 1_439][index] ||
          !sample.paused || sample.matrixMaxDelta > 1e-5) ||
        playbackProgress.tick < 25 || playbackProgress.tick > 45 || !playbackProgress.paused ||
        evidence.stats.runtimeDomMutationCount !== 0 || evidence.stats.runtimeDomGrowth !== false ||
        evidence.stats.runtimeLightingCalculationCount !== 0 || evidence.stats.runtimeGeometryConstructionCount !== 0) {
      throw new Error(`cssMenger browser smoke failed: ${JSON.stringify({
        evidence, sampledStates, playbackProgress, atlasRequests, pageRequests, pageErrors,
      })}`);
    }
    await page.evaluate(() => globalThis.__cssMengerDebug.seek(36));
    await page.screenshot({ path: screenshotPath });
    const mobileFraming = [];
    for (const viewport of [
      { width: 360, height: 780, expectedScale: "0.82", screenshotPath: narrowMobileScreenshotPath },
      { width: 390, height: 844, expectedScale: "0.88", screenshotPath: mobileScreenshotPath },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tick of [0, 320, 720, 1_439]) {
        mobileFraming.push(await page.evaluate(({ stateIndex, expectedScale }) => {
          const debug = globalThis.__cssMengerDebug;
          debug.seek(stateIndex);
          const leaves = [...document.querySelectorAll(".polycss-camera > .polycss-scene > b")];
          const bounds = leaves.map((leaf) => leaf.getBoundingClientRect())
            .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0);
          return {
            tick: debug.state().tick,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            expectedScale,
            computedScale: getComputedStyle(document.querySelector(".polycss-scene")).scale,
            left: Math.min(...bounds.map((rectangle) => rectangle.left)),
            right: Math.max(...bounds.map((rectangle) => rectangle.right)),
            top: Math.min(...bounds.map((rectangle) => rectangle.top)),
            bottom: Math.max(...bounds.map((rectangle) => rectangle.bottom)),
          };
        }, { stateIndex: tick, expectedScale: viewport.expectedScale }));
      }
      await page.screenshot({ path: viewport.screenshotPath });
    }
    if (mobileFraming.some((frame) => frame.tick === null || frame.computedScale !== frame.expectedScale ||
        frame.left < 0 || frame.right > frame.viewportWidth || frame.top < 50 ||
        frame.bottom > frame.viewportHeight)) {
      throw new Error(`cssMenger mobile framing failed: ${JSON.stringify(mobileFraming)}`);
    }
    const result = {
      route,
      evidence,
      sampledStates,
      playbackProgress,
      mobileFraming,
      atlasRequests,
      pageRequests,
      pageErrors,
    };
    await writeFile(statePath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({
      status: "pass",
      screenshotPath,
      narrowMobileScreenshotPath,
      mobileScreenshotPath,
      statePath,
      ...result,
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const instance = createServer();
    instance.listen(0, "127.0.0.1", () => {
      const address = instance.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      instance.close(() => resolvePort(selected));
    });
    instance.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
