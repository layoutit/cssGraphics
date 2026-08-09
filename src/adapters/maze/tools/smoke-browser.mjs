#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";
import { withCssmazeBrowser } from "./browser-runner.mjs";

// withCssmazeBrowser launches Chromium with headless: true.

const screenshotPath = resolve(
  process.env.CSSMAZE_SMOKE_SCREENSHOT ??
    "bench/results/cssmaze/browser-smoke.png",
);
const deploy = process.argv.includes("--deploy");
const expectedPath = deploy ? "/maze/" : "/";

const result = await withCssmazeBrowser(async ({ page }) => {
  const initial = await page.evaluate(() => ({
    sceneId: window.__cssMazeDebug.state().sceneId,
    seed: window.__cssMazeDebug.state().seed,
  }));
  await page.setViewportSize({ width: 960, height: 900 });
  await page.evaluate(() => new Promise((resolveFrame) =>
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  await page.evaluate(() => {
    const nodeMutations = { added: 0, removed: 0 };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        nodeMutations.added += record.addedNodes.length;
        nodeMutations.removed += record.removedNodes.length;
      }
    });
    observer.observe(document.getElementById("scene"), { childList: true, subtree: true });
    window.__cssMazeSmokeNodeMutations = { observer, nodeMutations };
  });
  await page.evaluate(() => window.__cssMazeDebug.seek(420));
  await page.waitForTimeout(100);
  const evidence = await page.evaluate(() => ({
    state: window.__cssMazeDebug.state(),
    stats: window.__cssMazeDebug.stats(),
    stable: window.__cssMazeDebug.assertStableDomIdentity(),
    retainedLeaves: document.querySelectorAll(".cssmaze-world b, .cssmaze-world i, .cssmaze-world s, .cssmaze-world u").length,
    forbiddenElements: document.querySelectorAll("#scene canvas, #scene svg").length,
    externalNodeMutations: { ...window.__cssMazeSmokeNodeMutations.nodeMutations },
    visibleWallLeaves: [...document.querySelectorAll(".cssmaze-walls > [data-polycss-leaf=polygon]")]
      .filter((leaf) => getComputedStyle(leaf).visibility !== "hidden").length,
    backfaceVisibility: {
      wall: getComputedStyle(document.querySelector('[data-group^="wall-"]')).backfaceVisibility,
      ceiling: getComputedStyle(document.querySelector('[data-group="ceiling"]')).backfaceVisibility,
    },
    preparedCameraSmoothing: {
      property: getComputedStyle(document.querySelector(".cssmaze-world")).transitionProperty,
      duration: getComputedStyle(document.querySelector(".cssmaze-world")).transitionDuration,
      timing: getComputedStyle(document.querySelector(".cssmaze-world")).transitionTimingFunction,
    },
    atlasLeafSizing: {
      raster: document.querySelectorAll('[data-polycss-texture-leaf-sizing="raster"]').length,
      canonical: document.querySelectorAll('[data-polycss-texture-leaf-sizing="canonical"]').length,
      floor: Number(document.querySelector('[data-group="floor"]').dataset.polycssTextureLeafWidth),
      wall: Number(document.querySelector('[data-group^="wall-"]').dataset.polycssTextureLeafWidth),
    },
    viewport: { width: innerWidth, height: innerHeight },
    cameraRect: (() => {
      const rect = document.querySelector("#scene > .polycss-camera").getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })(),
    shell: {
      wordmarkPath: document.querySelector(".site-wordmark-path")?.textContent ?? "",
      homeHref: document.querySelector(".site-wordmark")?.href ?? "",
      githubHref: document.querySelector(".site-action-icon-only")?.href ?? "",
      changeControlCount: document.querySelectorAll("#change-maze, button").length,
      statusScaffolding: document.querySelectorAll("#app, #status, nav, section, output").length,
      rootBackground: getComputedStyle(document.documentElement).backgroundImage,
      sceneBackground: getComputedStyle(document.getElementById("scene")).backgroundImage,
      headerBackground: getComputedStyle(document.querySelector(".site-header")).backgroundImage,
    },
  }));
  if (!evidence.stable || evidence.forbiddenElements !== 0 ||
      evidence.retainedLeaves !== evidence.stats.retainedPolygonLeafCount ||
      evidence.backfaceVisibility.wall !== "visible" ||
      evidence.backfaceVisibility.ceiling !== "visible" ||
      evidence.preparedCameraSmoothing.property !== "transform" ||
      evidence.preparedCameraSmoothing.duration !== "0.02s" ||
      evidence.preparedCameraSmoothing.timing !== "linear" ||
      evidence.atlasLeafSizing.raster !== evidence.retainedLeaves ||
      evidence.atlasLeafSizing.canonical !== 0 ||
      evidence.atlasLeafSizing.floor !== 600 ||
      evidence.atlasLeafSizing.wall !== 50 ||
      evidence.stats.runtimeGeometryConstructionCount !== 0 ||
      evidence.stats.runtimeMazeGenerationCount !== 0 ||
      evidence.stats.runtimeSceneGenerationCount !== 0 ||
      evidence.stats.runtimeRotationScoringCount !== 0 ||
      evidence.stats.presentationFit !== "cover" ||
      evidence.stats.runtimeLeafVisibilityComparisonCount !== 0 ||
      evidence.stats.runtimeAnimationFrameCallbackCount !== 0 ||
      evidence.shell.wordmarkPath !== "/maze" ||
      evidence.shell.homeHref !== "https://css.graphics/maze/" ||
      evidence.shell.githubHref !== "https://github.com/layoutit/cssGraphics" ||
      evidence.shell.changeControlCount !== 0 || evidence.shell.statusScaffolding !== 0 ||
      !evidence.shell.rootBackground.startsWith("linear-gradient(rgb(11, 17, 25)") ||
      !evidence.shell.sceneBackground.startsWith("linear-gradient(rgb(11, 17, 25)") ||
      !evidence.shell.headerBackground.startsWith("linear-gradient(rgb(11, 17, 25)") ||
      evidence.cameraRect.left > 0 || evidence.cameraRect.top > 0 ||
      evidence.cameraRect.right < evidence.viewport.width ||
      evidence.cameraRect.bottom < evidence.viewport.height ||
      evidence.stats.preparedBankSceneCount !== 24 ||
      evidence.stats.mountedSceneCount !== 1 ||
      evidence.stats.runtimeVisibilityCalculationCount !== 0 ||
      evidence.visibleWallLeaves < 1 ||
      evidence.visibleWallLeaves >= evidence.stats.retainedPolygonLeafCount - 2 ||
      evidence.externalNodeMutations.added !== 0 || evidence.externalNodeMutations.removed !== 0 ||
      evidence.stats.runtimeDomMutationCount !== 0) {
    throw new Error(`cssMaze browser smoke contract failed: ${JSON.stringify(evidence)}`);
  }
  await page.evaluate(() => window.__cssMazeSmokeNodeMutations.observer.disconnect());
  await page.evaluate(() => window.__cssMazeDebug.seek(420));
  await page.waitForTimeout(100);
  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await page.screenshot({ path: screenshotPath });
  const png = PNG.sync.read(screenshot);
  let visiblePixels = 0;
  let upperVisiblePixels = 0;
  let redWallPixels = 0;
  let upperCeilingPixels = 0;
  let lowerFloorPixels = 0;
  let shellHeaderPixels = 0;
  const shellHeaderPixelCount = png.width * 50;
  const upperPixelCount = png.width * Math.floor(png.height * 0.4);
  const lowerPixelCount = png.width * (png.height - Math.ceil(png.height * 0.6));
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const visible = red + green + blue > 54;
      if (visible) {
        visiblePixels += 1;
        if (y < png.height * 0.4) upperVisiblePixels += 1;
      }
      if (red > 50 && red > green * 1.7 && red > blue * 1.7) redWallPixels += 1;
      if (y < png.height * 0.4 &&
          Math.min(red, green, blue) > 50 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) < 35) {
        upperCeilingPixels += 1;
      }
      if (y > png.height * 0.6 &&
          red > 55 && green > 30 && red > green * 1.2 && green > blue * 1.15) {
        lowerFloorPixels += 1;
      }
      if (y < 50 && red + green + blue < 150) shellHeaderPixels += 1;
    }
  }
  const visual = {
    visibleRatio: visiblePixels / (png.width * png.height),
    upperVisibleRatio: upperVisiblePixels / upperPixelCount,
    redWallRatio: redWallPixels / (png.width * png.height),
    upperCeilingRatio: upperCeilingPixels / upperPixelCount,
    lowerFloorRatio: lowerFloorPixels / lowerPixelCount,
    shellHeaderBackgroundRatio: shellHeaderPixels / shellHeaderPixelCount,
  };
  if (visual.visibleRatio < 0.45 || visual.upperVisibleRatio < 0.35 ||
      visual.redWallRatio < 0.15 || visual.upperCeilingRatio < 0.15 ||
      visual.lowerFloorRatio < 0.15 || visual.shellHeaderBackgroundRatio < 0.9) {
    throw new Error(`cssMaze visual smoke contract failed: ${JSON.stringify(visual)}`);
  }
  return { initial, evidence, path: expectedPath, visual };
}, { deploy });

console.log(JSON.stringify({ status: "passed", deploy, screenshotPath, ...result }, null, 2));
