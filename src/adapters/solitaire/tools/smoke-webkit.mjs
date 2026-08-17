#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { webkit } from "playwright";

import { adapterRoot, repositoryRoot } from "../src/prepare/csssolitaire/paths.mjs";

const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await webkit.launch({ headless: true });
  try {
    const selections = [];
    for (const randomValue of [0, 7, 23]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      });
      const browserErrors = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
          browserErrors.push(message.text());
        }
      });
      await page.addInitScript((value) => {
        Object.defineProperty(Crypto.prototype, "getRandomValues", {
          configurable: true,
          writable: true,
          value(array) {
            array.fill(value);
            return array;
          },
        });
      }, randomValue);
      try {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
        await page.waitForFunction(() => window.__cssSolitaireDebug?.ready === true ||
          window.__cssSolitaireDebug?.errors().length > 0, null, { timeout: 30_000 });
        const initial = await page.evaluate(() => {
          const state = window.__cssSolitaireDebug.snapshot();
          const stats = window.__cssSolitaireDebug.stats();
          return {
            state,
            stats,
            leaves: document.querySelectorAll(".polycss-scene > b").length,
            displayedFoundations: [...document.querySelectorAll(".polycss-scene > b")]
              .slice(0, 4).filter((leaf) => getComputedStyle(leaf).display !== "none").length,
            forbidden: document.querySelectorAll(".polycss-camera canvas,.polycss-camera svg").length,
            resources: performance.getEntriesByType("resource")
              .map((entry) => new URL(entry.name).pathname)
              .filter((path) => path.includes("csssolitaire")),
            productErrors: window.__cssSolitaireDebug.errors(),
          };
        });
        if (browserErrors.length || initial.productErrors.length || initial.state.patternIndex !== randomValue ||
            initial.state.responsiveProfileIndex !== 1 || initial.state.launchCardCount !== 1 ||
            initial.leaves !== 683 || initial.displayedFoundations !== 1 || initial.forbidden !== 0 ||
            !initial.state.identityStable || initial.stats.runtimeDomGrowth !== false ||
            initial.stats.selectedPreparedBank !== "mobile" ||
            initial.stats.preparedBankId !== "mobile" ||
            initial.stats.preparedBankLoadCount !== 1 ||
            initial.stats.runtimePreparedBankSwitchCount !== 0 ||
            initial.stats.runtimeAnimationFrameCallbackCount !== 0 ||
            initial.stats.runtimeGeometryCalculationCount !== 0 ||
            initial.stats.runtimeTrajectoryCalculationCount !== 0 ||
            initial.stats.runtimePatternLayoutLeavesVisited !== initial.state.timelineTrailLeafCount ||
            initial.stats.runtimePatternLayoutLeavesRequired !== initial.state.timelineTrailLeafCount ||
            initial.stats.runtimeResponsiveMatrixResolutionCount !== initial.state.timelineTrailLeafCount + 4 ||
            !initial.resources.includes("/csssolitaire/solitaire-mobile.polycss.txt") ||
            !initial.resources.includes("/csssolitaire/solitaire-schedule-mobile.json") ||
            !initial.resources.includes("/csssolitaire/solitaire-layout-mobile.json") ||
            initial.resources.some((path) =>
              path.includes("small-desktop") || path.includes("large-desktop") ||
              path.includes("solitaire-layout-portrait"))) {
          throw new Error(`cssSolitaire WebKit startup failed: ${JSON.stringify({ browserErrors, initial })}`);
        }
        const motion = await page.evaluate(async () => {
          const before = window.__cssSolitaireDebug.snapshot();
          await new Promise((resolveWait) => setTimeout(resolveWait, 3_200));
          const after = window.__cssSolitaireDebug.snapshot();
          return { before, after, errors: window.__cssSolitaireDebug.errors() };
        });
        if (motion.errors.length || !motion.before.playing || !motion.after.playing ||
            motion.after.playheadMs < 2_800 || motion.after.frameIndex <= motion.before.frameIndex ||
            motion.after.visibleTrailCards <= motion.before.visibleTrailCards) {
          throw new Error(`cssSolitaire WebKit autoplay failed: ${JSON.stringify(motion)}`);
        }
        const handoffStart = await page.evaluate(() => {
          const state = window.__cssSolitaireDebug.pause();
          window.__cssSolitaireDebug.seek(state.durationMs - 40);
          window.__cssSolitaireDebug.resume();
          return state.patternIndex;
        });
        await page.waitForFunction((patternIndex) =>
          window.__cssSolitaireDebug.snapshot().patternIndex !== patternIndex,
        handoffStart, { timeout: 2_000 });
        const handoff = await page.evaluate((previousPatternIndex) => {
          const state = window.__cssSolitaireDebug.pause();
          const patterns = window.__cssSolitaireDebug.manifest.sourceProfile.patterns;
          return {
            previousPatternIndex,
            patternIndex: state.patternIndex,
            directionChanged: Math.sign(patterns[previousPatternIndex].phoneHorizontalVelocity) !==
              Math.sign(patterns[state.patternIndex].phoneHorizontalVelocity),
            stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
            errors: window.__cssSolitaireDebug.errors(),
          };
        }, handoffStart);
        if (handoff.errors.length || handoff.patternIndex === handoff.previousPatternIndex ||
            !handoff.directionChanged || !handoff.stable) {
          throw new Error(`cssSolitaire WebKit handoff failed: ${JSON.stringify(handoff)}`);
        }
        if (randomValue === 0) {
          await page.setViewportSize({ width: 1_200, height: 800 });
          await page.waitForFunction(() =>
            window.__cssSolitaireDebug.stats().runtimePresentationUpdateCount > 1);
          const responsive = await page.evaluate(() => ({
            state: window.__cssSolitaireDebug.snapshot(),
            stats: window.__cssSolitaireDebug.stats(),
            leaves: document.querySelectorAll(".polycss-scene > b").length,
            stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
            errors: window.__cssSolitaireDebug.errors(),
          }));
          if (responsive.errors.length || responsive.state.responsiveProfileIndex !== 1 ||
              responsive.stats.selectedPreparedBank !== "mobile" ||
              responsive.stats.runtimePreparedBankSwitchCount !== 0 ||
              responsive.stats.preparedBankLoadCount !== 1 || responsive.leaves !== 683 ||
              !responsive.stable) {
            throw new Error(`cssSolitaire WebKit retained bank resize failed: ${JSON.stringify(responsive)}`);
          }
        }
        selections.push({
          randomValue,
          patternIndex: initial.state.patternIndex,
          trailLeafCount: initial.state.timelineTrailLeafCount,
          singlePassMatrixResolutions: initial.stats.runtimeResponsiveMatrixResolutionCount,
          handoffPatternIndex: handoff.patternIndex,
        });
      } finally {
        await page.close();
      }
    }
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      engine: "Playwright WebKit",
      realDevice: false,
      selections,
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
