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
const mobileScreenshotPath = process.env.CSSSOLITAIRE_SMOKE_MOBILE_SCREENSHOT ??
  join(dirname(screenshotPath), "browser-smoke-mobile.png");
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

    const sampled = await page.evaluate(() => [0, 1250, 3500, 6500, 10000, 13097, 13098, 14098, 25223, 26223]
      .map((timeMs) => window.__cssSolitaireDebug.seek(timeMs)));
    const [initial, firstArc, secondArc, middle, thirdArc, nearEnd, rewindStart, rewinding, rewound, wrapped] = sampled;
    const autoplayLoop = await page.evaluate(async () => {
      window.__cssSolitaireDebug.seek(25800);
      window.__cssSolitaireDebug.resume();
      await new Promise((resolveWait) => setTimeout(resolveWait, 650));
      return window.__cssSolitaireDebug.pause();
    });
    const bankSequence = await page.evaluate(async (firstPatternId) => {
      const patternIds = [firstPatternId, window.__cssSolitaireDebug.snapshot().patternId];
      for (let index = 0; index < 22; index += 1) {
        const state = window.__cssSolitaireDebug.snapshot();
        const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[state.patternIndex].durationMs;
        window.__cssSolitaireDebug.seek(durationMs - 40);
        window.__cssSolitaireDebug.resume();
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        patternIds.push(window.__cssSolitaireDebug.pause().patternId);
      }
      return patternIds;
    }, initial.patternId);
    const evidence = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll(".csssolitaire-board > s")];
      const first = leaves[0];
      const rect = first.getBoundingClientRect();
      const computedTransforms = leaves.map((leaf) => getComputedStyle(leaf).transform);
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
          sceneBackground: getComputedStyle(document.getElementById("scene")).backgroundImage,
        },
        composition: {
          sceneTransformStyle: getComputedStyle(document.querySelector(".solitaire-prepared-scene")).transformStyle,
          boardTransformStyle: getComputedStyle(document.querySelector(".csssolitaire-board")).transformStyle,
          matrix2dLeafCount: computedTransforms.filter((transform) => transform.startsWith("matrix(")).length,
          matrix3dLeafCount: computedTransforms.filter((transform) => transform.startsWith("matrix3d(")).length,
          landscapePreparedTransformCount: leaves.filter((leaf) =>
            leaf.style.getPropertyValue("--csssolitaire-landscape-transform").startsWith("matrix(")).length,
          portraitPreparedTransformCounts: [1, 2, 3, 4].map((cardCount) =>
            leaves.filter((leaf) => leaf.style
              .getPropertyValue(`--csssolitaire-portrait-${cardCount}-transform`)
              .startsWith("matrix(")).length),
        },
      };
    });
    if (readyMs >= 5_000 || initial.frameIndex !== 0 || initial.visibleTrailCards !== 0 ||
        initial.visibleFoundationCards !== 4 ||
        firstArc.sourceStep !== 100 || firstArc.visibleTrailCards !== 101 ||
        secondArc.sourceStep !== 400 || secondArc.visibleTrailCards !== 401 ||
        middle.sourceStep !== 800 || middle.visibleTrailCards !== 801 ||
        thirdArc.sourceStep !== 1266 || thirdArc.visibleTrailCards !== 1267 ||
        thirdArc.visibleFoundationCards !== 1 ||
        nearEnd.sourceStep !== 1614 || nearEnd.visibleTrailCards !== 1614 ||
        nearEnd.visibleFoundationCards !== 0 ||
        rewindStart.visibleTrailCards !== 1612 || rewindStart.visibleFoundationCards !== 0 ||
        rewinding.visibleTrailCards <= 0 || rewinding.visibleTrailCards >= nearEnd.visibleTrailCards ||
        rewinding.visibleFoundationCards !== 1 ||
        rewound.frameIndex !== 584 || rewound.visibleTrailCards !== 0 || rewound.visibleFoundationCards !== 4 ||
        wrapped.frameIndex !== 0 || wrapped.visibleTrailCards !== 0 || wrapped.visibleFoundationCards !== 4 ||
        autoplayLoop.playheadMs >= 500 || autoplayLoop.visibleTrailCards !== 0 ||
        autoplayLoop.patternIndex === 0 || autoplayLoop.patternCount !== 24 ||
        bankSequence.length !== 24 || new Set(bankSequence).size !== 24 ||
        bankSequence.some((patternId, index) => index > 0 && patternId === bankSequence[index - 1]) ||
        !evidence.stable || evidence.retainedLeaves !== 1911 || evidence.visibleLeaves !== 4 ||
        evidence.forbiddenSceneElements !== 0 || evidence.mutations.added !== 0 || evidence.mutations.removed !== 0 ||
        evidence.radius !== "14px" || evidence.imageRendering !== "auto" ||
        !(evidence.cardRect.height > evidence.cardRect.width) || evidence.shell.path !== "/solitaire" ||
        evidence.shell.buttons !== 0 ||
        !evidence.shell.sceneBackground.startsWith("linear-gradient(rgb(11, 17, 25)") ||
        evidence.composition.sceneTransformStyle !== "flat" ||
        evidence.composition.boardTransformStyle !== "flat" ||
        evidence.composition.matrix2dLeafCount !== 1911 || evidence.composition.matrix3dLeafCount !== 0 ||
        evidence.composition.landscapePreparedTransformCount !== 1911 ||
        evidence.composition.portraitPreparedTransformCounts[3] !== 1911 ||
        evidence.composition.portraitPreparedTransformCounts.some((count, index, counts) =>
          index > 0 && count <= counts[index - 1]) ||
        evidence.stats.runtimeAnimationFrameCallbackCount !== 0 ||
        evidence.stats.runtimeTimerCallbackCount < 1 || evidence.stats.loopCount < 1 ||
        evidence.stats.preparedPatternCount !== 24 ||
        evidence.stats.runtimePreparedPatternSwitchCount !== 23 ||
        evidence.stats.runtimePatternLayoutWrites < 1 ||
        evidence.stats.runtimeRandomSelectionCount < 1 ||
        evidence.stats.runtimeRandomSelectionPurpose !== "prepared-pattern-shuffled-bag-index-only" ||
        evidence.stats.runtimeGeometryCalculationCount !== 0 ||
        evidence.stats.runtimeTrajectoryCalculationCount !== 0 ||
        evidence.stats.runtimeAtlasRasterizationCount !== 0 ||
        evidence.stats.runtimeDomMutationCount !== 0 ||
        !evidence.resources.includes("/csssolitaire/manifest.json") ||
        !evidence.resources.includes("/csssolitaire/solitaire.polycss.html") ||
        !evidence.resources.includes("/csssolitaire/solitaire-playback.json") ||
        evidence.resources.some((path) => path.endsWith("model.json"))) {
      throw new Error(`cssSolitaire smoke contract failed: ${JSON.stringify({ readyMs, sampled, evidence })}`);
    }
    await page.evaluate(() => window.__cssSolitaireDebug.seek(10000));
    const visibleBounds = await page.evaluate(() => {
      const rects = [...document.querySelectorAll(".csssolitaire-board > s")]
        .filter((leaf) => getComputedStyle(leaf).visibility === "visible")
        .map((leaf) => leaf.getBoundingClientRect());
      return {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      };
    });
    if (visibleBounds.left >= 0 || visibleBounds.top >= 0 || visibleBounds.bottom <= 540) {
      throw new Error(`cssSolitaire cards no longer exit the fixed playfield: ${JSON.stringify(visibleBounds)}`);
    }
    await mkdir(dirname(screenshotPath), { recursive: true });
    const screenshot = await page.screenshot({ path: screenshotPath });
    const png = PNG.sync.read(screenshot);
    let cardPixels = 0;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const [red, green, blue] = png.data.subarray(offset, offset + 3);
      if (red > 220 && green > 220 && blue > 220) cardPixels += 1;
    }
    const cardPixelRatio = cardPixels / (png.width * png.height);
    if (cardPixelRatio < 0.12) throw new Error(`cssSolitaire screenshot is visually empty: ${cardPixelRatio}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileInitial = await page.evaluate(() => {
      window.__cssSolitaireDebug.seek(0);
      const displayedFoundations = [...document.querySelectorAll(".csssolitaire-board > s.foundation")]
        .filter((foundation) => getComputedStyle(foundation).display !== "none");
      const leaf = displayedFoundations[0];
      const rect = leaf.getBoundingClientRect();
      const foundationRects = displayedFoundations
        .map((foundation) => {
          const foundationRect = foundation.getBoundingClientRect();
          return { left: foundationRect.left, right: foundationRect.right };
        });
      return {
        portraitMedia: matchMedia("(orientation: portrait)").matches,
        stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
        retainedLeaves: document.querySelectorAll(".csssolitaire-board > s").length,
        displayedFoundationCount: displayedFoundations.length,
        cardRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        foundationRects,
        sceneTransform: getComputedStyle(document.querySelector(".solitaire-prepared-scene")).transform,
        boardTransform: getComputedStyle(document.querySelector(".csssolitaire-board")).transform,
        mutations: { ...window.__cssSolitaireSmoke.mutations },
      };
    });
    await page.evaluate(() => window.__cssSolitaireDebug.seek(10000));
    const mobileEvidence = await page.evaluate(() => {
      const visibleLeaves = [...document.querySelectorAll(".csssolitaire-board > s")]
        .filter((leaf) => {
          const style = getComputedStyle(leaf);
          return style.display !== "none" && style.visibility === "visible";
        });
      const rects = visibleLeaves.map((leaf) => leaf.getBoundingClientRect());
      return {
        stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
        visibleLeaves: visibleLeaves.length,
        intersectingVisibleLeaves: rects.filter((rect) =>
          rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight).length,
        visibleBounds: {
          left: Math.min(...rects.map((rect) => rect.left)),
          top: Math.min(...rects.map((rect) => rect.top)),
          right: Math.max(...rects.map((rect) => rect.right)),
          bottom: Math.max(...rects.map((rect) => rect.bottom)),
        },
        mutations: { ...window.__cssSolitaireSmoke.mutations },
      };
    });
    if (!mobileInitial.portraitMedia || !mobileInitial.stable || mobileInitial.retainedLeaves !== 1911 ||
        mobileInitial.displayedFoundationCount !== 1 ||
        mobileInitial.cardRect.width < 65 || mobileInitial.cardRect.width > 80 ||
        mobileInitial.cardRect.height < 90 || mobileInitial.cardRect.height > 110 ||
        mobileInitial.cardRect.height <= mobileInitial.cardRect.width ||
        mobileInitial.cardRect.left < 150 || mobileInitial.cardRect.left > 170 ||
        mobileInitial.boardTransform !== "matrix(1, 0, 0, 1, -192, -360)" ||
        mobileInitial.mutations.added !== 0 || mobileInitial.mutations.removed !== 0 ||
        !mobileEvidence.stable || mobileEvidence.visibleLeaves <= 1 ||
        mobileEvidence.intersectingVisibleLeaves <= 4 ||
        mobileEvidence.visibleBounds.left > 8 || mobileEvidence.visibleBounds.right < 382 ||
        mobileEvidence.visibleBounds.top >= 0.2 * 844 ||
        mobileEvidence.visibleBounds.bottom <= 0.72 * 844 ||
        mobileEvidence.visibleBounds.bottom - mobileEvidence.visibleBounds.top <= 0.65 * 844 ||
        mobileEvidence.mutations.added !== 0 || mobileEvidence.mutations.removed !== 0) {
      throw new Error(`cssSolitaire mobile contract failed: ${JSON.stringify({ mobileInitial, mobileEvidence })}`);
    }
    const mobileScreenshot = await page.screenshot({ path: mobileScreenshotPath });
    const mobilePng = PNG.sync.read(mobileScreenshot);
    let mobileCardPixels = 0;
    for (let offset = 0; offset < mobilePng.data.length; offset += 4) {
      const [red, green, blue] = mobilePng.data.subarray(offset, offset + 3);
      if (red > 220 && green > 220 && blue > 220) mobileCardPixels += 1;
    }
    const mobileCardPixelRatio = mobileCardPixels / (mobilePng.width * mobilePng.height);
    if (mobileCardPixelRatio < 0.08) {
      throw new Error(`cssSolitaire mobile screenshot is visually empty: ${mobileCardPixelRatio}`);
    }
    const responsiveCardCounts = [];
    for (const viewport of [
      { width: 390, height: 844, expected: 1 },
      { width: 600, height: 900, expected: 2 },
      { width: 800, height: 1_000, expected: 3 },
      { width: 960, height: 1_200, expected: 4 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      const displayed = await page.evaluate(() => {
        window.__cssSolitaireDebug.seek(0);
        return [...document.querySelectorAll(".csssolitaire-board > s.foundation")]
          .filter((foundation) => getComputedStyle(foundation).display !== "none").length;
      });
      responsiveCardCounts.push({ ...viewport, displayed });
    }
    if (responsiveCardCounts.some(({ expected, displayed }) => expected !== displayed)) {
      throw new Error(`cssSolitaire responsive card count drifted: ${JSON.stringify(responsiveCardCounts)}`);
    }
    await page.evaluate(() => window.__cssSolitaireSmoke.observer.disconnect());
    process.stdout.write(`${JSON.stringify({
      status: "passed", headless: true, browser: browser.version(), deploy, route,
      readyMs, sampled, autoplayLoop, bankSequence, evidence, visibleBounds, cardPixelRatio, screenshotPath,
      mobileInitial, mobileEvidence, mobileCardPixelRatio, mobileScreenshotPath,
      responsiveCardCounts,
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
