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
    visibleWallLeaves: [...document.querySelectorAll(".cssmaze-walls > b, .cssmaze-walls > i, .cssmaze-walls > s, .cssmaze-walls > u")]
      .filter((leaf) => getComputedStyle(leaf).visibility !== "hidden").length,
    preparedMetadataCount: [...document.querySelectorAll("#scene *")].reduce(
      (count, element) => count + [...element.attributes]
        .filter((attribute) => attribute.name.startsWith("data-")).length,
      0,
    ),
    pageMetadata: (() => {
      const names = [...document.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes]
          .map((attribute) => attribute.name)
          .filter((name) => name.startsWith("data-")));
      const tooling = names.filter((name) => name === "data-vite-dev-id").length;
      return { total: names.length, tooling, product: names.length - tooling };
    })(),
    backfaceVisibility: {
      wall: getComputedStyle(document.querySelector(".cssmaze-walls > s")).backfaceVisibility,
      ceiling: getComputedStyle(document.querySelector(".cssmaze-surfaces > s:last-child")).backfaceVisibility,
    },
    preparedCameraSmoothing: {
      property: getComputedStyle(document.querySelector(".cssmaze-world")).transitionProperty,
      duration: getComputedStyle(document.querySelector(".cssmaze-world")).transitionDuration,
      timing: getComputedStyle(document.querySelector(".cssmaze-world")).transitionTimingFunction,
    },
    atlasLeafSizing: {
      sizing: window.__cssMazeDebug.scene.renderer.textureLeafSizing,
      backend: window.__cssMazeDebug.scene.renderer.textureBackend,
      imageRendering: getComputedStyle(document.querySelector(".cssmaze-walls > s")).imageRendering,
      floor: Number.parseFloat(getComputedStyle(document.querySelector(".cssmaze-surfaces > s:first-child")).width),
      wall: Number.parseFloat(getComputedStyle(document.querySelector(".cssmaze-walls > s")).width),
    },
    viewport: { width: innerWidth, height: innerHeight },
    cameraRect: (() => {
      const rect = document.querySelector("#scene > .polycss-camera").getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })(),
    shell: (() => {
      const scene = document.getElementById("scene");
      const header = document.querySelector(".site-header");
      const wordmark = document.querySelector(".site-wordmark");
      const action = document.querySelector(".site-action-icon-only");
      const wordmarkText = document.querySelector(".site-wordmark-svg text");
      const logoOutline = document.querySelector(".site-action-icon-outline");
      const sceneRect = scene.getBoundingClientRect();
      const wordmarkRect = wordmark.getBoundingClientRect();
      return {
        wordmarkPath: document.querySelector(".site-wordmark-path")?.textContent ?? "",
        homeHref: wordmark?.href ?? "",
        githubHref: action?.href ?? "",
        changeControlCount: document.querySelectorAll("#change-maze, button").length,
        statusScaffolding: document.querySelectorAll("#app, #status, nav, section, output").length,
        rootBackground: getComputedStyle(document.documentElement).backgroundImage,
        sceneBackground: getComputedStyle(scene).backgroundImage,
        headerBackground: getComputedStyle(header).backgroundImage,
        headerPosition: getComputedStyle(header).position,
        headerPointerEvents: getComputedStyle(header).pointerEvents,
        wordmarkPointerEvents: getComputedStyle(wordmark).pointerEvents,
        actionPointerEvents: getComputedStyle(action).pointerEvents,
        wordmarkColor: getComputedStyle(wordmark).color,
        wordmarkStroke: getComputedStyle(wordmarkText).stroke,
        wordmarkStrokeWidth: getComputedStyle(wordmarkText).strokeWidth,
        wordmarkPaintOrder: getComputedStyle(wordmarkText).paintOrder,
        logoOutlineCount: document.querySelectorAll(".site-action-icon-outline").length,
        logoOutlineStrokeWidth: getComputedStyle(logoOutline).strokeWidth,
        sceneRect: { left: sceneRect.left, top: sceneRect.top, right: sceneRect.right, bottom: sceneRect.bottom },
        wordmarkOverScene: wordmarkRect.left < sceneRect.right && wordmarkRect.right > sceneRect.left &&
          wordmarkRect.top < sceneRect.bottom && wordmarkRect.bottom > sceneRect.top,
      };
    })(),
  }));
  if (!evidence.stable || evidence.forbiddenElements !== 0 ||
      evidence.retainedLeaves !== evidence.stats.retainedPolygonLeafCount ||
      evidence.backfaceVisibility.wall !== "visible" ||
      evidence.backfaceVisibility.ceiling !== "visible" ||
      evidence.preparedCameraSmoothing.property !== "transform" ||
      evidence.preparedCameraSmoothing.duration !== "0.02s" ||
      evidence.preparedCameraSmoothing.timing !== "linear" ||
      evidence.preparedMetadataCount !== 0 ||
      evidence.pageMetadata.product !== 0 ||
      evidence.atlasLeafSizing.sizing !== "raster" ||
      evidence.atlasLeafSizing.backend !== "atlas" ||
      evidence.atlasLeafSizing.imageRendering !== "pixelated" ||
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
      evidence.shell.headerBackground !== "none" ||
      evidence.shell.headerPosition !== "fixed" ||
      evidence.shell.headerPointerEvents !== "none" ||
      evidence.shell.wordmarkPointerEvents !== "auto" ||
      evidence.shell.actionPointerEvents !== "auto" ||
      evidence.shell.wordmarkColor !== "rgb(174, 180, 188)" ||
      evidence.shell.wordmarkStroke !== "none" ||
      evidence.shell.wordmarkPaintOrder !== "normal" ||
      evidence.shell.logoOutlineCount !== 2 ||
      evidence.shell.logoOutlineStrokeWidth !== "4px" ||
      !evidence.shell.wordmarkOverScene ||
      evidence.shell.sceneRect.left !== 0 || evidence.shell.sceneRect.top !== 0 ||
      evidence.shell.sceneRect.right !== evidence.viewport.width ||
      evidence.shell.sceneRect.bottom !== evidence.viewport.height ||
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
    }
  }
  const visual = {
    visibleRatio: visiblePixels / (png.width * png.height),
    upperVisibleRatio: upperVisiblePixels / upperPixelCount,
    redWallRatio: redWallPixels / (png.width * png.height),
    upperCeilingRatio: upperCeilingPixels / upperPixelCount,
    lowerFloorRatio: lowerFloorPixels / lowerPixelCount,
  };
  if (visual.visibleRatio < 0.45 || visual.upperVisibleRatio < 0.35 ||
      visual.redWallRatio < 0.15 || visual.upperCeilingRatio < 0.15 ||
      visual.lowerFloorRatio < 0.15) {
    throw new Error(`cssMaze visual smoke contract failed: ${JSON.stringify(visual)}`);
  }
  return { initial, evidence, path: expectedPath, visual };
}, { deploy });

console.log(JSON.stringify({ status: "passed", deploy, screenshotPath, ...result }, null, 2));
