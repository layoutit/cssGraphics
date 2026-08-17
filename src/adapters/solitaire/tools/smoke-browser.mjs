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
const screenshotRoot = dirname(process.env.CSSSOLITAIRE_SMOKE_SCREENSHOT ??
  join(repositoryRoot, "bench", "results", "csssolitaire", "browser-smoke.png"));
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
    await mkdir(screenshotRoot, { recursive: true });
    const viewportEvidence = [];
    for (const config of [
      { name: "mobile", width: 390, height: 844, mobile: true, bankId: "mobile",
        profileIndex: 1, displayedFoundations: 1, retainedLeaves: 683 },
      { name: "portrait-2", width: 600, height: 900, bankId: "small-desktop",
        profileIndex: 2, displayedFoundations: 2, retainedLeaves: 1952 },
      { name: "portrait-3", width: 800, height: 1_000, bankId: "small-desktop",
        profileIndex: 3, displayedFoundations: 3, retainedLeaves: 1952 },
      { name: "portrait-4", width: 960, height: 1_200, bankId: "small-desktop",
        profileIndex: 4, displayedFoundations: 4, retainedLeaves: 1952 },
      { name: "small-desktop", width: 1_440, height: 900, bankId: "small-desktop",
        profileIndex: 0, displayedFoundations: 4, retainedLeaves: 1952 },
      { name: "large-desktop", width: 2_560, height: 1_440, bankId: "large-desktop",
        profileIndex: 0, displayedFoundations: 4, retainedLeaves: 3888 },
    ]) {
      viewportEvidence.push(await captureViewport(browser, port, route, screenshotRoot, config));
    }
    const sourcePhysics = await captureSourcePhysics(browser, port, route);
    const patternSequence = await capturePatternSequence(browser, port, route);
    const startupSelections = await captureStartupSelections(browser, port, route);
    const mobileContinuity = await captureMobileContinuity(browser, port, route);
    const reducedMotion = await captureReducedMotion(browser, port, route);
    const retainedBankResize = await captureRetainedBankResize(browser, port, route);
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      headless: true,
      browser: browser.version(),
      deploy,
      route,
      viewportEvidence,
      sourcePhysics,
      patternSequence,
      startupSelections,
      mobileContinuity,
      reducedMotion,
      retainedBankResize,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function captureViewport(browser, port, route, screenshotRoot, config) {
  const { page, browserErrors } = await openPreparedPage(browser, port, route, config, 0);
  try {
    const initial = await page.evaluate(() => {
      const state = window.__cssSolitaireDebug.pause();
      const stats = window.__cssSolitaireDebug.stats();
      const leaves = [...document.querySelectorAll(".polycss-scene > b")];
      const foundations = leaves.slice(0, 4)
        .filter((leaf) => getComputedStyle(leaf).display !== "none");
      const firstRect = foundations[0].getBoundingClientRect();
      const resources = performance.getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.includes("csssolitaire"));
      const host = document.body;
      const camera = host.querySelector(":scope > .polycss-camera");
      return {
        state,
        stats,
        retainedLeaves: leaves.length,
        displayedFoundations: foundations.length,
        firstCard: {
          left: firstRect.left,
          top: firstRect.top,
          width: firstRect.width,
          height: firstRect.height,
          radius: getComputedStyle(foundations[0]).borderRadius,
          edge: getComputedStyle(foundations[0]).boxShadow,
          imageRendering: getComputedStyle(foundations[0]).imageRendering,
        },
        resources,
        stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
        errors: window.__cssSolitaireDebug.errors(),
        forbiddenSceneElements: camera.querySelectorAll("canvas,svg").length,
        mainCount: host.querySelectorAll(":scope > main").length,
        dataAttributeCount: [...camera.querySelectorAll("*")].reduce((count, element) =>
          count + [...element.attributes].filter(({ name }) => name.startsWith("data-")).length, 0),
        invalidLeafClassCount: leaves.filter((leaf) => leaf.classList.length > 0).length,
        matrix2dLeafCount: leaves.filter((leaf) =>
          getComputedStyle(leaf).transform.startsWith("matrix(")).length,
      };
    });
    const expectedFiles = selectedBankFiles(config);
    const preparedResources = initial.resources.filter((path) =>
      /solitaire-(?:(?:mobile|small-desktop|large-desktop)\.polycss\.txt|schedule-(?:mobile|small-desktop|large-desktop)\.json|layout-[a-z0-9-]+\.json)$/u
        .test(path));
    if (browserErrors.length || initial.errors.length || !initial.stable ||
        initial.stats.selectedPreparedBank !== config.bankId ||
        initial.stats.preparedBankId !== config.bankId ||
        initial.stats.preparedBankLoadCount !== 1 ||
        initial.stats.runtimePreparedBankSwitchCount !== 0 ||
        initial.state.responsiveProfileIndex !== config.profileIndex ||
        initial.retainedLeaves !== config.retainedLeaves ||
        initial.displayedFoundations !== config.displayedFoundations ||
        initial.stats.runtimePatternLayoutLeavesVisited !== initial.state.timelineTrailLeafCount ||
        initial.stats.runtimePatternLayoutLeavesRequired !== initial.state.timelineTrailLeafCount ||
        initial.stats.runtimePatternLayoutUnusedLeavesVisited !== 0 ||
        initial.stats.runtimeResponsiveMatrixResolutionCount !== initial.state.timelineTrailLeafCount + 4 ||
        initial.stats.runtimeAnimationFrameCallbackCount !== 0 ||
        initial.stats.runtimeGeometryCalculationCount !== 0 ||
        initial.stats.runtimeTrajectoryCalculationCount !== 0 ||
        initial.stats.runtimeAtlasRasterizationCount !== 0 || initial.stats.runtimeDomGrowth !== false ||
        initial.forbiddenSceneElements !== 0 || initial.mainCount !== 0 ||
        initial.dataAttributeCount !== 0 || initial.invalidLeafClassCount !== 0 ||
        initial.matrix2dLeafCount !== config.retainedLeaves - (4 - config.displayedFoundations) ||
        initial.firstCard.radius !== "14px" ||
        initial.firstCard.edge !== "none" || initial.firstCard.imageRendering !== "auto" ||
        Math.abs(initial.firstCard.top - 80) > 0.1 ||
        JSON.stringify(preparedResources.sort()) !== JSON.stringify(expectedFiles.sort())) {
      throw new Error(`cssSolitaire ${config.name} bank failed: ${JSON.stringify({ browserErrors, initial })}`);
    }
    const visual = await page.evaluate(() => {
      const state = window.__cssSolitaireDebug.snapshot();
      window.__cssSolitaireDebug.seek(state.durationMs / 2 - 100);
      const rects = [...document.querySelectorAll(".polycss-scene > b")]
        .filter((leaf) => {
          const style = getComputedStyle(leaf);
          return style.display !== "none" && style.visibility === "visible";
        })
        .map((leaf) => leaf.getBoundingClientRect());
      return {
        visibleLeaves: rects.length,
        bounds: {
          left: Math.min(...rects.map(({ left }) => left)),
          top: Math.min(...rects.map(({ top }) => top)),
          right: Math.max(...rects.map(({ right }) => right)),
          bottom: Math.max(...rects.map(({ bottom }) => bottom)),
        },
      };
    });
    if (visual.visibleLeaves < 100 || visual.bounds.top < 7.8 || visual.bounds.top > 80.1 ||
        Math.abs(visual.bounds.bottom - config.height) > 0.2 ||
        (config.bankId === "mobile" &&
          (visual.bounds.left < -0.1 || visual.bounds.right > config.width + 0.1))) {
      throw new Error(`cssSolitaire ${config.name} visual bounds failed: ${JSON.stringify(visual)}`);
    }
    const screenshotPath = join(screenshotRoot, `browser-smoke-${config.name}.png`);
    const screenshot = await page.screenshot({ path: screenshotPath });
    const cardPixelRatio = whitePixelRatio(screenshot);
    if (cardPixelRatio < 0.08) {
      throw new Error(`cssSolitaire ${config.name} screenshot is visually empty: ${cardPixelRatio}`);
    }
    return {
      name: config.name,
      selectedBank: initial.stats.selectedPreparedBank,
      profileIndex: initial.state.responsiveProfileIndex,
      retainedLeaves: initial.retainedLeaves,
      activeTrailLeaves: initial.state.timelineTrailLeafCount,
      cardSize: [initial.firstCard.width, initial.firstCard.height],
      resources: preparedResources,
      visual,
      cardPixelRatio,
      screenshotPath,
    };
  } finally {
    await page.close();
  }
}

function selectedBankFiles({ bankId, profileIndex }) {
  if (bankId === "mobile") return [
    "/csssolitaire/solitaire-mobile.polycss.txt",
    "/csssolitaire/solitaire-schedule-mobile.json",
    "/csssolitaire/solitaire-layout-mobile.json",
  ];
  if (bankId === "large-desktop") return [
    "/csssolitaire/solitaire-large-desktop.polycss.txt",
    "/csssolitaire/solitaire-schedule-large-desktop.json",
    "/csssolitaire/solitaire-layout-large-desktop.json",
  ];
  const profileName = ["landscape", "phone", "portrait-2", "portrait-3", "portrait-4"][profileIndex];
  return [
    "/csssolitaire/solitaire-small-desktop.polycss.txt",
    "/csssolitaire/solitaire-schedule-small-desktop.json",
    `/csssolitaire/solitaire-layout-${profileName}.json`,
  ];
}

async function captureSourcePhysics(browser, port, route) {
  const { page, browserErrors } = await openPreparedPage(browser, port, route, {
    width: 960, height: 540,
  }, 0);
  try {
    const sampled = await page.evaluate(() => {
      window.__cssSolitaireDebug.pause();
      return [0, 1250, 3500, 6500, 10000, 13584, 13585, 14585, 26210, 27210]
        .map((timeMs) => window.__cssSolitaireDebug.seek(timeMs));
    });
    const [initial, firstArc, secondArc, middle, thirdArc, nearEnd, rewindStart,
      rewinding, rewound, wrapped] = sampled;
    if (browserErrors.length || initial.patternIndex !== 0 || initial.frameIndex !== 0 ||
        initial.launchCardCount !== 12 || firstArc.sourceStep !== 100 ||
        firstArc.visibleTrailCards !== 101 || secondArc.sourceStep !== 400 ||
        secondArc.visibleTrailCards !== 401 || middle.sourceStep !== 800 ||
        middle.visibleTrailCards !== 801 || thirdArc.sourceStep !== 1266 ||
        thirdArc.visibleTrailCards !== 1267 || thirdArc.visibleFoundationCards !== 3 ||
        nearEnd.sourceStep !== 1679 || nearEnd.visibleTrailCards !== 1679 ||
        nearEnd.visibleFoundationCards !== 0 || rewindStart.visibleTrailCards !== 1678 ||
        rewinding.visibleTrailCards <= 0 || rewinding.visibleTrailCards >= nearEnd.visibleTrailCards ||
        rewinding.visibleFoundationCards !== 1 || rewound.frameIndex !== 608 ||
        rewound.visibleTrailCards !== 0 || rewound.visibleFoundationCards !== 4 ||
        wrapped.frameIndex !== 0 || wrapped.visibleTrailCards !== 0 ||
        wrapped.visibleFoundationCards !== 4) {
      throw new Error(`cssSolitaire source physics failed: ${JSON.stringify({ browserErrors, sampled })}`);
    }
    return sampled;
  } finally {
    await page.close();
  }
}

async function capturePatternSequence(browser, port, route) {
  const { page } = await openPreparedPage(browser, port, route, { width: 960, height: 540 }, 0);
  try {
    const result = await page.evaluate(async () => {
      window.__cssSolitaireDebug.pause();
      const patternIds = [window.__cssSolitaireDebug.snapshot().patternId];
      for (let index = 0; index < 23; index += 1) {
        const state = window.__cssSolitaireDebug.snapshot();
        window.__cssSolitaireDebug.seek(state.durationMs - 40);
        window.__cssSolitaireDebug.resume();
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        patternIds.push(window.__cssSolitaireDebug.pause().patternId);
      }
      const sourcePatterns = window.__cssSolitaireDebug.manifest.sourceProfile.patterns;
      const directions = patternIds.map((id) => Math.sign(
        sourcePatterns.find((pattern) => pattern.id === id).phoneHorizontalVelocity,
      ));
      return { patternIds, directions, stable: window.__cssSolitaireDebug.assertStableDomIdentity() };
    });
    if (!result.stable || result.patternIds.length !== 24 || new Set(result.patternIds).size !== 24 ||
        result.directions.some((direction, index) =>
          index > 0 && direction === result.directions[index - 1])) {
      throw new Error(`cssSolitaire prepared pattern sequence failed: ${JSON.stringify(result)}`);
    }
    return result;
  } finally {
    await page.close();
  }
}

async function captureStartupSelections(browser, port, route) {
  const selections = [];
  for (const randomValue of [0, 7, 23]) {
    const { page, browserErrors } = await openPreparedPage(browser, port, route, {
      width: 390, height: 844, mobile: true,
    }, randomValue);
    try {
      const result = await page.evaluate(() => ({
        state: window.__cssSolitaireDebug.pause(),
        stats: window.__cssSolitaireDebug.stats(),
        resources: performance.getEntriesByType("resource")
          .map((entry) => new URL(entry.name).pathname)
          .filter((path) => path.includes("csssolitaire")),
        errors: window.__cssSolitaireDebug.errors(),
      }));
      if (browserErrors.length || result.errors.length || result.state.patternIndex !== randomValue ||
          result.stats.selectedPreparedBank !== "mobile" || result.state.retainedLeafCount !== 683 ||
          result.stats.runtimePatternLayoutLeavesVisited !== result.state.timelineTrailLeafCount ||
          !result.resources.includes("/csssolitaire/solitaire-mobile.polycss.txt") ||
          !result.resources.includes("/csssolitaire/solitaire-schedule-mobile.json") ||
          result.resources.some((path) => path.includes("small-desktop") || path.includes("large-desktop"))) {
        throw new Error(`cssSolitaire startup selection failed: ${JSON.stringify({ browserErrors, result })}`);
      }
      selections.push({
        randomValue,
        patternIndex: result.state.patternIndex,
        trailLeafCount: result.state.timelineTrailLeafCount,
      });
    } finally {
      await page.close();
    }
  }
  return selections;
}

async function captureMobileContinuity(browser, port, route) {
  const { page, browserErrors } = await openPreparedPage(browser, port, route, {
    width: 390, height: 844, mobile: true,
  }, 0);
  try {
    const result = await page.evaluate(() => {
      window.__cssSolitaireDebug.pause();
      const initial = window.__cssSolitaireDebug.seek(0);
      const positions = [];
      for (let timeMs = 500; timeMs < initial.durationMs; timeMs += 50) {
        const state = window.__cssSolitaireDebug.seek(timeMs);
        if (state.rewinding) break;
        const leaves = [...document.querySelectorAll(".polycss-scene > b")];
        let index = leaves.length - 1;
        while (index >= 4 && leaves[index].style.visibility !== "visible") index -= 1;
        if (index >= 4) positions.push(leaves[index].getBoundingClientRect().x);
      }
      let previousDirection = 0;
      let directionChanges = 0;
      for (let index = 1; index < positions.length; index += 1) {
        const direction = Math.sign(positions[index] - positions[index - 1]);
        if (direction && previousDirection && direction !== previousDirection) directionChanges += 1;
        if (direction) previousDirection = direction;
      }
      let forward = 0;
      let rewind = initial.durationMs;
      while (rewind - forward > 1) {
        const middle = Math.floor((forward + rewind) / 2);
        if (window.__cssSolitaireDebug.seek(middle).rewinding) rewind = middle;
        else forward = middle;
      }
      window.__cssSolitaireDebug.seek(forward);
      const leaves = [...document.querySelectorAll(".polycss-scene > b")];
      let endIndex = leaves.length - 1;
      while (endIndex >= 4 && leaves[endIndex].style.visibility !== "visible") endIndex -= 1;
      return {
        durationMs: initial.durationMs,
        launchCardCount: initial.launchCardCount,
        trailLeafCount: initial.timelineTrailLeafCount,
        directionChanges,
        floorGapCssPixels: innerHeight - leaves[endIndex].getBoundingClientRect().bottom,
        errors: window.__cssSolitaireDebug.errors(),
      };
    });
    if (browserErrors.length || result.errors.length || result.durationMs !== 12210 ||
        result.launchCardCount !== 1 || result.trailLeafCount !== 679 ||
        result.directionChanges < 3 || Math.abs(result.floorGapCssPixels) > 0.1) {
      throw new Error(`cssSolitaire mobile continuity failed: ${JSON.stringify({ browserErrors, result })}`);
    }
    return result;
  } finally {
    await page.close();
  }
}

async function captureReducedMotion(browser, port, route) {
  const { page, browserErrors } = await openPreparedPage(browser, port, route, {
    width: 390, height: 844, mobile: true, reducedMotion: "reduce",
  }, 0);
  try {
    const result = await page.evaluate(async () => {
      const before = window.__cssSolitaireDebug.snapshot();
      await new Promise((resolveWait) => setTimeout(resolveWait, 3_200));
      const after = window.__cssSolitaireDebug.snapshot();
      return {
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        before,
        after,
        timerCallbacks: window.__cssSolitaireDebug.stats().runtimeTimerCallbackCount,
        errors: window.__cssSolitaireDebug.errors(),
      };
    });
    if (browserErrors.length || result.errors.length || !result.reduced || !result.before.playing ||
        !result.after.playing || result.after.playheadMs < 2_800 ||
        result.after.frameIndex <= result.before.frameIndex || result.timerCallbacks === 0) {
      throw new Error(`cssSolitaire reduced-motion autoplay failed: ${JSON.stringify(result)}`);
    }
    return {
      beforeFrame: result.before.frameIndex,
      afterFrame: result.after.frameIndex,
      timerCallbacks: result.timerCallbacks,
    };
  } finally {
    await page.close();
  }
}

async function captureRetainedBankResize(browser, port, route) {
  const results = [];
  for (const config of [
    { width: 390, height: 844, mobile: true, resize: [1_200, 800], bank: "mobile", leaves: 683 },
    { width: 2_560, height: 1_440, resize: [1_200, 800], bank: "large-desktop", leaves: 3888 },
  ]) {
    const { page } = await openPreparedPage(browser, port, route, config, 0);
    try {
      const before = await page.evaluate(() => ({
        stats: window.__cssSolitaireDebug.stats(),
      }));
      await page.setViewportSize({ width: config.resize[0], height: config.resize[1] });
      await page.waitForFunction(() => window.__cssSolitaireDebug.stats().runtimePresentationUpdateCount > 1);
      const after = await page.evaluate(() => ({
        stats: window.__cssSolitaireDebug.stats(),
        leaves: document.querySelectorAll(".polycss-scene > b").length,
        stable: window.__cssSolitaireDebug.assertStableDomIdentity(),
        errors: window.__cssSolitaireDebug.errors(),
      }));
      if (after.errors.length || !after.stable || after.leaves !== config.leaves ||
          after.stats.selectedPreparedBank !== config.bank || after.stats.preparedBankLoadCount !== 1 ||
          after.stats.runtimePreparedBankSwitchCount !== 0 ||
          before.stats.selectedPreparedBank !== after.stats.selectedPreparedBank) {
        throw new Error(`cssSolitaire retained bank resize failed: ${JSON.stringify({ config, before, after })}`);
      }
      results.push({ bank: config.bank, retainedLeaves: after.leaves, switchCount: 0 });
    } finally {
      await page.close();
    }
  }
  return results;
}

async function openPreparedPage(browser, port, route, config, randomValue) {
  const mobile = config.mobile === true;
  const page = await browser.newPage({
    viewport: { width: config.width, height: config.height },
    screen: { width: config.width, height: config.height },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
      : undefined,
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
  await page.emulateMedia({ reducedMotion: config.reducedMotion ?? "no-preference" });
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__cssSolitaireDebug?.ready === true ||
    window.__cssSolitaireDebug?.errors().length > 0, null, { timeout: 30_000 });
  return { page, browserErrors };
}

function whitePixelRatio(bytes) {
  const png = PNG.sync.read(bytes);
  let whitePixels = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const [red, green, blue] = png.data.subarray(offset, offset + 3);
    if (red > 220 && green > 220 && blue > 220) whitePixels += 1;
  }
  return whitePixels / (png.width * png.height);
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
