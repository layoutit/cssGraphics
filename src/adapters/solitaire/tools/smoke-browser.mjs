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
      observer.observe(document.querySelector(".solitaire-prepared-scene"), { childList: true, subtree: true });
      window.__cssSolitaireSmoke = { mutations, observer };
    });

    const sampled = await page.evaluate(() => [0, 1250, 3500, 6500, 10000, 13584, 13585, 14585, 26210, 27210]
      .map((timeMs) => window.__cssSolitaireDebug.seek(timeMs)));
    const [initial, firstArc, secondArc, middle, thirdArc, nearEnd, rewindStart, rewinding, rewound, wrapped] = sampled;
    const visibleBounds = await page.evaluate(() => {
      const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[0].durationMs;
      window.__cssSolitaireDebug.seek(durationMs / 2 - 100);
      const rects = [...document.querySelectorAll(".solitaire-prepared-scene > s")]
        .filter((leaf) => getComputedStyle(leaf).visibility === "visible")
        .map((leaf) => leaf.getBoundingClientRect());
      window.__cssSolitaireDebug.seek(0);
      return {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      };
    });
    const autoplayLoop = await page.evaluate(async () => {
      window.__cssSolitaireDebug.seek(26787);
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
      const leaves = [...document.querySelectorAll(".solitaire-prepared-scene > s")];
      const first = leaves[0];
      const rect = first.getBoundingClientRect();
      const foundationRects = leaves.slice(0, 4).map((leaf) => {
        const foundationRect = leaf.getBoundingClientRect();
        return {
          left: foundationRect.left,
          top: foundationRect.top,
          width: foundationRect.width,
          height: foundationRect.height,
        };
      });
      const computedTransforms = leaves.map((leaf) => getComputedStyle(leaf).transform);
      const scene = document.getElementById("scene");
      const camera = scene?.querySelector(":scope > .solitaire-prepared-camera");
      const preparedScene = camera?.querySelector(":scope > .solitaire-prepared-scene");
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
        structure: {
          bodyChildren: [...document.body.children].map((element) => element.tagName),
          sceneChildCount: scene?.childElementCount,
          cameraChildCount: camera?.childElementCount,
          preparedSceneChildCount: preparedScene?.childElementCount,
          sceneDescendantCount: scene?.querySelectorAll("*").length,
          unexpectedSceneElementCount: scene?.querySelectorAll(
            "button,canvas,nav,output,section,svg,style,[contenteditable]",
          ).length,
          dataAttributeCount: [...scene.querySelectorAll("*")].reduce((count, element) =>
            count + [...element.attributes].filter(({ name }) => name.startsWith("data-")).length, 0),
          inlineStyleDeclarationCount: [...scene.querySelectorAll("*")].reduce((count, element) =>
            count + element.style.length, 0),
        },
        radius: getComputedStyle(first).borderRadius,
        cardEdge: getComputedStyle(first).boxShadow,
        imageRendering: getComputedStyle(first).imageRendering,
        cardRect: { width: rect.width, height: rect.height },
        foundationRects,
        resources,
        shell: {
          path: document.querySelector(".site-wordmark-path")?.textContent,
          buttons: document.querySelectorAll("button, nav, section, output").length,
          sceneBackground: getComputedStyle(document.getElementById("scene")).backgroundImage,
        },
        composition: {
          sceneTransformStyle: getComputedStyle(document.querySelector(".solitaire-prepared-scene")).transformStyle,
          matrix2dLeafCount: computedTransforms.filter((transform) => transform.startsWith("matrix(")).length,
          matrix3dLeafCount: computedTransforms.filter((transform) => transform.startsWith("matrix3d(")).length,
          leafInlineStyleDeclarationCount: leaves.reduce((count, leaf) => count + leaf.style.length, 0),
        },
      };
    });
    if (readyMs >= 5_000 || initial.frameIndex !== 0 || initial.visibleTrailCards !== 0 ||
        initial.visibleFoundationCards !== 4 ||
        firstArc.sourceStep !== 100 || firstArc.visibleTrailCards !== 101 ||
        secondArc.sourceStep !== 400 || secondArc.visibleTrailCards !== 401 ||
        middle.sourceStep !== 800 || middle.visibleTrailCards !== 801 ||
        thirdArc.sourceStep !== 1266 || thirdArc.visibleTrailCards !== 1267 ||
        thirdArc.visibleFoundationCards !== 3 ||
        nearEnd.sourceStep !== 1679 || nearEnd.visibleTrailCards !== 1679 ||
        nearEnd.visibleFoundationCards !== 0 ||
        rewindStart.visibleTrailCards !== 1678 || rewindStart.visibleFoundationCards !== 0 ||
        rewinding.visibleTrailCards <= 0 || rewinding.visibleTrailCards >= nearEnd.visibleTrailCards ||
        rewinding.visibleFoundationCards !== 1 ||
        rewound.frameIndex !== 608 || rewound.visibleTrailCards !== 0 || rewound.visibleFoundationCards !== 4 ||
        wrapped.frameIndex !== 0 || wrapped.visibleTrailCards !== 0 || wrapped.visibleFoundationCards !== 4 ||
        autoplayLoop.playheadMs >= 500 || autoplayLoop.visibleTrailCards !== 0 ||
        autoplayLoop.patternIndex === 0 || autoplayLoop.patternCount !== 24 ||
        bankSequence.length !== 24 || new Set(bankSequence).size !== 24 ||
        bankSequence.some((patternId, index) => index > 0 && patternId === bankSequence[index - 1]) ||
        !evidence.stable || evidence.retainedLeaves !== 1952 || evidence.visibleLeaves !== 4 ||
        evidence.forbiddenSceneElements !== 0 || evidence.mutations.added !== 0 || evidence.mutations.removed !== 0 ||
        JSON.stringify(evidence.structure.bodyChildren) !==
          JSON.stringify(deploy ? ["HEADER", "MAIN"] : ["HEADER", "MAIN", "SCRIPT"]) ||
        evidence.structure.sceneChildCount !== 1 || evidence.structure.cameraChildCount !== 1 ||
        evidence.structure.preparedSceneChildCount !== 1952 || evidence.structure.sceneDescendantCount !== 1954 ||
        evidence.structure.unexpectedSceneElementCount !== 0 || evidence.structure.dataAttributeCount !== 0 ||
        evidence.structure.inlineStyleDeclarationCount !== 0 ||
        evidence.radius !== "14px" ||
        evidence.cardEdge !== "none" ||
        evidence.imageRendering !== "auto" ||
        Math.abs(evidence.cardRect.width - 99.84375) > 0.1 || Math.abs(evidence.cardRect.height - 135) > 0.1 ||
        evidence.foundationRects.some((rect, index) =>
          Math.abs(rect.left - [430.078125, 562.55859375, 695.0390625, 827.51953125][index]) > 0.1 ||
          Math.abs(rect.top - 80) > 0.1 || Math.abs(rect.width - 99.84375) > 0.1 ||
          Math.abs(rect.height - 135) > 0.1) ||
        evidence.shell.path !== "/solitaire" ||
        evidence.shell.buttons !== 0 ||
        !evidence.shell.sceneBackground.startsWith("linear-gradient(rgb(0, 128, 0)") ||
        evidence.composition.sceneTransformStyle !== "flat" ||
        evidence.composition.matrix2dLeafCount !== 1952 || evidence.composition.matrix3dLeafCount !== 0 ||
        evidence.composition.leafInlineStyleDeclarationCount !== 0 ||
        evidence.stats.runtimeAnimationFrameCallbackCount !== 0 ||
        evidence.stats.runtimeTimerCallbackCount < 1 || evidence.stats.loopCount < 1 ||
        evidence.stats.preparedPatternCount !== 24 ||
        evidence.stats.runtimePreparedPatternSwitchCount !== 23 ||
        evidence.stats.runtimePatternLayoutWrites < 1 ||
        evidence.stats.runtimeRandomSelectionCount < 1 ||
        evidence.stats.runtimeRandomSelectionPurpose !== "prepared-pattern-shuffled-bag-index-only" ||
        evidence.stats.runtimeGeometryCalculationCount !== 0 ||
        evidence.stats.runtimeGeometryBoundsCalculationCount !== 0 ||
        evidence.stats.runtimeFitCalculationPurpose !== "single-root-presentation-scale-only" ||
        Math.abs(evidence.stats.runtimePresentationScale - 1.40625) > 0.000001 ||
        evidence.stats.runtimePresentationScaleWrites !== 0 ||
        evidence.stats.runtimeTrajectoryCalculationCount !== 0 ||
        evidence.stats.runtimeAtlasRasterizationCount !== 0 ||
        evidence.stats.runtimeDomMutationCount !== 0 ||
        !evidence.resources.includes("/csssolitaire/manifest.json") ||
        !evidence.resources.includes("/csssolitaire/solitaire.polycss.txt") ||
        !evidence.resources.includes("/csssolitaire/solitaire-playback.json") ||
        evidence.resources.some((path) => path.endsWith("model.json"))) {
      throw new Error(`cssSolitaire smoke contract failed: ${JSON.stringify({ readyMs, sampled, evidence })}`);
    }
    if (visibleBounds.left > -0.9 * evidence.cardRect.width ||
        visibleBounds.right < 960 + 0.9 * evidence.cardRect.width ||
        visibleBounds.top < 7.9 || visibleBounds.top > 80 ||
        Math.abs(visibleBounds.bottom - 540) > 0.2) {
      throw new Error(`cssSolitaire cards no longer exit the fixed playfield: ${JSON.stringify(visibleBounds)}`);
    }
    await page.evaluate(() => {
      const state = window.__cssSolitaireDebug.snapshot();
      const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[state.patternIndex].durationMs;
      window.__cssSolitaireDebug.seek(durationMs / 2 - 100);
    });
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
      const displayedFoundations = [...document.querySelectorAll(".solitaire-prepared-scene > s.foundation")]
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
        retainedLeaves: document.querySelectorAll(".solitaire-prepared-scene > s").length,
        displayedFoundationCount: displayedFoundations.length,
        cardRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        foundationRects,
        sceneTransform: getComputedStyle(document.querySelector(".solitaire-prepared-scene")).transform,
        mutations: { ...window.__cssSolitaireSmoke.mutations },
      };
    });
    await page.evaluate(() => {
      const state = window.__cssSolitaireDebug.snapshot();
      const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[state.patternIndex].durationMs;
      window.__cssSolitaireDebug.seek(durationMs / 2 - 100);
    });
    const mobileEvidence = await page.evaluate(() => {
      const visibleLeaves = [...document.querySelectorAll(".solitaire-prepared-scene > s")]
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
    if (!mobileInitial.portraitMedia || !mobileInitial.stable || mobileInitial.retainedLeaves !== 1952 ||
        mobileInitial.displayedFoundationCount !== 1 ||
        Math.abs(mobileInitial.cardRect.width - 72.109375) > 0.1 ||
        Math.abs(mobileInitial.cardRect.height - 97.5) > 0.1 ||
        mobileInitial.cardRect.height <= mobileInitial.cardRect.width ||
        Math.abs(mobileInitial.cardRect.left - 158.9453125) > 0.1 ||
        Math.abs(mobileInitial.cardRect.top - 80) > 0.1 ||
        mobileInitial.sceneTransform !== "none" ||
        mobileInitial.mutations.added !== 0 || mobileInitial.mutations.removed !== 0 ||
        !mobileEvidence.stable || mobileEvidence.visibleLeaves <= 1 ||
        mobileEvidence.intersectingVisibleLeaves <= 4 ||
        mobileEvidence.visibleBounds.left > 8 || mobileEvidence.visibleBounds.right < 382 ||
        mobileEvidence.visibleBounds.top < 7.9 ||
        mobileEvidence.visibleBounds.top >= 0.2 * 844 ||
        Math.abs(mobileEvidence.visibleBounds.bottom - 844) > 0.2 ||
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
      { width: 390, height: 844, expected: 1, expectedSize: [72.109375, 97.5], expectedLefts: [158.9453125] },
      { width: 600, height: 900, expected: 2, expectedSize: [88.75, 120], expectedLefts: [322.25, 425] },
      { width: 800, height: 1_000, expected: 3, expectedSize: [98.611111, 133.333333], expectedLefts: [355.833333, 469.444444, 583.055556] },
      { width: 960, height: 1_200, expected: 4, expectedSize: [118.333333, 160], expectedLefts: [423, 558.333333, 693.666667, 829] },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      const layout = await page.evaluate(() => {
        window.__cssSolitaireDebug.seek(0);
        const cards = [...document.querySelectorAll(".solitaire-prepared-scene > s.foundation")]
          .filter((foundation) => getComputedStyle(foundation).display !== "none")
          .map((foundation) => {
            const rect = foundation.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          });
        const state = window.__cssSolitaireDebug.snapshot();
        const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[state.patternIndex].durationMs;
        window.__cssSolitaireDebug.seek(durationMs / 2 - 100);
        const visibleRects = [...document.querySelectorAll(".solitaire-prepared-scene > s")]
          .filter((leaf) => {
            const style = getComputedStyle(leaf);
            return style.display !== "none" && style.visibility === "visible";
          })
          .map((leaf) => leaf.getBoundingClientRect());
        return {
          cards,
          visibleLeft: Math.min(...visibleRects.map((rect) => rect.left)),
          visibleRight: Math.max(...visibleRects.map((rect) => rect.right)),
        };
      });
      responsiveCardCounts.push({
        ...viewport,
        expectedTop: 80,
        displayed: layout.cards.length,
        ...layout,
      });
    }
    if (responsiveCardCounts.some(({
      width, expected, expectedTop, expectedSize, displayed, expectedLefts, cards, visibleLeft, visibleRight,
    }) =>
      expected !== displayed || cards.some((card, index) =>
        Math.abs(card.left - expectedLefts[index]) > 0.1 ||
        Math.abs(card.top - expectedTop) > 0.1 ||
        Math.abs(card.width - expectedSize[0]) > 0.1 || Math.abs(card.height - expectedSize[1]) > 0.1) ||
      (expected === 1
        ? visibleLeft < -0.1 || visibleRight > width + 0.1
        : visibleLeft > -0.9 * expectedSize[0] || visibleRight < width + 0.9 * expectedSize[0]))) {
      throw new Error(`cssSolitaire responsive slot layout drifted: ${JSON.stringify(responsiveCardCounts)}`);
    }
    const landscapeViewports = [];
    for (const viewport of [
      { width: 960, height: 540, expectedSize: [99.84375, 135], expectedLefts: [430.078125, 562.558594, 695.039063, 827.519531] },
      { width: 1_280, height: 720, expectedSize: [133.125, 180], expectedLefts: [573.4375, 750.078125, 926.71875, 1_103.359375] },
      { width: 1_440, height: 900, expectedSize: [149.765625, 202.5], expectedLefts: [645.117188, 843.837891, 1_042.558594, 1_241.279297] },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(50);
      const layout = await page.evaluate(() => {
        window.__cssSolitaireDebug.seek(0);
        const cards = [...document.querySelectorAll(".solitaire-prepared-scene > s.foundation")]
          .map((foundation) => {
            const rect = foundation.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          });
        const state = window.__cssSolitaireDebug.snapshot();
        const durationMs = window.__cssSolitaireDebug.manifest.sourceProfile.patterns[state.patternIndex].durationMs;
        window.__cssSolitaireDebug.seek(durationMs / 2 - 100);
        const visible = [...document.querySelectorAll(".solitaire-prepared-scene > s")]
          .filter((leaf) => getComputedStyle(leaf).visibility === "visible")
          .map((leaf) => leaf.getBoundingClientRect());
        return {
          cards,
          visibleLeft: Math.min(...visible.map((rect) => rect.left)),
          visibleTop: Math.min(...visible.map((rect) => rect.top)),
          visibleBottom: Math.max(...visible.map((rect) => rect.bottom)),
        };
      });
      landscapeViewports.push({ ...viewport, expectedTop: 80, ...layout });
    }
    if (landscapeViewports.some(({
      height, expectedTop, expectedSize, expectedLefts, cards, visibleLeft, visibleTop, visibleBottom,
    }) =>
      cards.some((card, index) => Math.abs(card.left - expectedLefts[index]) > 0.1 ||
        Math.abs(card.top - expectedTop) > 0.1 || Math.abs(card.width - expectedSize[0]) > 0.1 ||
        Math.abs(card.height - expectedSize[1]) > 0.1) ||
      visibleLeft > -0.9 * expectedSize[0] ||
      visibleTop < 7.9 || visibleTop > 80 || Math.abs(visibleBottom - height) > 0.2)) {
      throw new Error(`cssSolitaire viewport fill drifted: ${JSON.stringify(landscapeViewports)}`);
    }
    await page.evaluate(() => window.__cssSolitaireSmoke.observer.disconnect());
    process.stdout.write(`${JSON.stringify({
      status: "passed", headless: true, browser: browser.version(), deploy, route,
      readyMs, sampled, autoplayLoop, bankSequence, evidence, visibleBounds, cardPixelRatio, screenshotPath,
      mobileInitial, mobileEvidence, mobileCardPixelRatio, mobileScreenshotPath,
      responsiveCardCounts, landscapeViewports,
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
