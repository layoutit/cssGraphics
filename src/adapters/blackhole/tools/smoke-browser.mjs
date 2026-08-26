#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const deploy = process.argv.includes("--deploy");
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const resultRoot = resolve(repositoryRoot, "bench/results/cssblackhole", deploy ? "deploy" : "local");
const port = Number(process.env.CSSBLACKHOLE_SMOKE_PORT ?? 4210);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("Luminet browser-smoke port drifted");
}
const route = `http://127.0.0.1:${port}${deploy ? "/luminet/" : "/"}`;
const server = deploy ? createStaticDeployServer(resolve(repositoryRoot, "dist/site")) :
  await createViteServer({
    configFile: resolve(repositoryRoot, "src/adapters/blackhole/vite.config.mjs"),
    logLevel: "error",
    server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
  });
await mkdir(resultRoot, { recursive: true });
if (deploy) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
} else {
  await server.listen();
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const profiles = [];
  for (const specification of [
    { id: "desktop", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, pointSize: 2,
      spaceContextPath: "/cssblackhole/space-context-landscape.webp" },
    { id: "monitor27", viewport: { width: 2206, height: 1233 }, deviceScaleFactor: 1, pointSize: 2,
      spaceContextPath: "/cssblackhole/space-context-landscape.webp" },
    { id: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, pointSize: 2,
      spaceContextPath: "/cssblackhole/space-context-portrait.webp" },
    { id: "hidpi", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, pointSize: 2,
      spaceContextPath: "/cssblackhole/space-context-portrait@2x.webp" },
  ]) profiles.push(await smokeProfile(specification));
  const report = Object.freeze({
    schema: "cssblackhole-browser-smoke@1",
    capturedAt: new Date().toISOString(),
    route,
    deploy,
    browser: Object.freeze({ name: "Google Chrome", version: browser.version(), headless: true }),
    profiles,
  });
  const reportPath = resolve(resultRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, accepted: true,
    profiles: profiles.map(({ id, initial, final }) => ({
      id,
      leaves: initial.leafCount,
      deviceScaleFactor: initial.pointPresentation.deviceScaleFactor,
      pointSize: initial.pointPresentation.width,
      framesPerSecond: initial.stats.framesPerSecond,
      changedTransformCount: final.changedTransformCount,
      transitions: final.stats.preparedConfigurationSwitchCount,
    })),
  }, null, 2));
} finally {
  await browser?.close();
  if (deploy) await new Promise((resolvePromise) => server.close(resolvePromise));
  else await server.close();
}

async function smokeProfile(specification) {
  const page = await browser.newPage({
    viewport: specification.viewport,
    deviceScaleFactor: specification.deviceScaleFactor,
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  await page.goto(`${route}?proof=${specification.id}-${Date.now().toString(36)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__cssBlackHoleDebug?.ready === true, null, {
    timeout: 30_000,
  });
  const initial = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    const stage = document.querySelector(".example-stage");
    const camera = stage?.querySelector(":scope > .polycss-camera");
    const point = leaves[0];
    const presentation = stage instanceof HTMLElement && camera instanceof HTMLElement
      ? (() => {
        const stageBounds = stage.getBoundingClientRect();
        const cameraBounds = camera.getBoundingClientRect();
        const sourceBounds = window.__cssBlackHoleDebug.catalog().luminetPreparedState.bounds;
        const padding = 90;
        const verticalViewportPadding = 22;
        const paddedBounds = {
          minimumX: Math.max(0, sourceBounds.minimumX - padding),
          maximumX: Math.min(800, sourceBounds.maximumX + padding),
          minimumY: Math.max(0, sourceBounds.minimumY - padding),
          maximumY: Math.min(600, sourceBounds.maximumY + padding),
        };
        const paddedWidth = paddedBounds.maximumX - paddedBounds.minimumX;
        const paddedHeight = paddedBounds.maximumY - paddedBounds.minimumY;
        const centerX = (paddedBounds.minimumX + paddedBounds.maximumX) / 2;
        const centerY = (paddedBounds.minimumY + paddedBounds.maximumY) / 2;
        const scale = Number(getComputedStyle(camera)
          .getPropertyValue("--cssblackhole-presentation-scale"));
        const offsetX = Number.parseFloat(getComputedStyle(camera)
          .getPropertyValue("--cssblackhole-presentation-offset-x"));
        const offsetY = Number.parseFloat(getComputedStyle(camera)
          .getPropertyValue("--cssblackhole-presentation-offset-y"));
        const expectedScale = Math.min(
          stageBounds.width / paddedWidth,
          Math.max(1, stageBounds.height - verticalViewportPadding * 2) / paddedHeight);
        const tolerance = 0.01;
        const projectedBounds = {
          left: stageBounds.left + stageBounds.width / 2 +
            (paddedBounds.minimumX - centerX) * scale,
          top: stageBounds.top + stageBounds.height / 2 +
            (paddedBounds.minimumY - centerY) * scale,
          right: stageBounds.left + stageBounds.width / 2 +
            (paddedBounds.maximumX - centerX) * scale,
          bottom: stageBounds.top + stageBounds.height / 2 +
            (paddedBounds.maximumY - centerY) * scale,
        };
        return {
          stage: {
            left: stageBounds.left,
            top: stageBounds.top,
            right: stageBounds.right,
            bottom: stageBounds.bottom,
            width: stageBounds.width,
            height: stageBounds.height,
          },
          camera: { width: cameraBounds.width, height: cameraBounds.height },
          paddedBounds,
          projectedBounds,
          center: { x: centerX, y: centerY },
          scale,
          expectedScale,
          offset: { x: offsetX, y: offsetY },
          preparedBoundsContained: projectedBounds.left >= stageBounds.left - tolerance &&
            projectedBounds.top >= stageBounds.top - tolerance &&
            projectedBounds.right <= stageBounds.right + tolerance &&
            projectedBounds.bottom <= stageBounds.bottom + tolerance,
          sharedShellOwnsStage: innerWidth > 760
            ? stageBounds.left > 0
            : stageBounds.top > 0 && stageBounds.bottom < innerHeight,
        };
      })()
      : null;
    const pointBounds = point?.getBoundingClientRect();
    const pointPresentation = camera instanceof HTMLElement && pointBounds
      ? {
        deviceScaleFactor: devicePixelRatio,
        policyValue: getComputedStyle(camera)
          .getPropertyValue("--cssblackhole-point-size").trim(),
        width: pointBounds.width,
        height: pointBounds.height,
      }
      : null;
    window.__cssBlackHoleSmokeLeaves = leaves;
    window.__cssBlackHoleSmokeInitialTransforms = leaves.map((leaf) => leaf.style.transform);
    return {
      bodyClass: document.body.className,
      stats: window.__cssBlackHoleDebug.stats(),
      errors: window.__cssBlackHoleDebug.errors,
      leafCount: leaves.length,
      inlineTransformCount: leaves.filter((leaf) => leaf.style.transform).length,
      computedTransformCount: leaves.filter((leaf) => getComputedStyle(leaf).transform !== "none").length,
      spaceContextBackgroundImage: stage instanceof HTMLElement
        ? getComputedStyle(stage).backgroundImage : null,
      spaceContextBackgroundRepeat: stage instanceof HTMLElement
        ? getComputedStyle(stage).backgroundRepeat : null,
      presentation,
      pointPresentation,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      robots: document.querySelector('meta[name="robots"]')?.content ?? null,
    };
  });
  await page.waitForTimeout(6_500);
  const final = await page.evaluate(async () => {
    const leaves = [...document.querySelectorAll(".polycss-scene > b")];
    const stable = window.__cssBlackHoleSmokeLeaves;
    const stats = window.__cssBlackHoleDebug.stats();
    window.__cssBlackHoleDebug.pause();
    const pausedFrame = window.__cssBlackHoleDebug.stats().publishedStreamFrame;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    const pausedFrameAfterWait = window.__cssBlackHoleDebug.stats().publishedStreamFrame;
    const topDownSlot = window.__cssBlackHoleDebug.catalog()
      .configurationLoop.presentationSlots.find((slot) => slot.view === "top");
    await window.__cssBlackHoleDebug.seekStreamFrame(topDownSlot.startFrameIndex);
    const stageBounds = document.querySelector(".example-stage").getBoundingClientRect();
    const leafBounds = leaves.map((leaf) => leaf.getBoundingClientRect());
    const topDownVerticalMargins = {
      top: Math.min(...leafBounds.map((bounds) => bounds.top)) - stageBounds.top,
      bottom: stageBounds.bottom - Math.max(...leafBounds.map((bounds) => bounds.bottom)),
    };
    window.__cssBlackHoleDebug.resume();
    return {
      stats,
      leafCount: leaves.length,
      stableIdentity: leaves.length === stable.length &&
        leaves.every((leaf, index) => leaf === stable[index]),
      changedTransformCount: leaves.reduce((count, leaf, index) => count + Number(
        leaf.style.transform !== window.__cssBlackHoleSmokeInitialTransforms[index]), 0),
      pausedFrame,
      pausedFrameAfterWait,
      topDownVerticalMargins,
    };
  });
  const screenshotPath = resolve(resultRoot, `route-${specification.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const report = Object.freeze({
    id: specification.id,
    viewport: { ...specification.viewport, deviceScaleFactor: specification.deviceScaleFactor },
    expectedPointSize: specification.pointSize,
    expectedSpaceContextPath: specification.spaceContextPath,
    initial,
    final,
    pageErrors,
    consoleErrors,
    failedResponses,
    requests,
    screenshotPath,
  });
  assertSmoke(report);
  await page.close();
  return report;
}

function assertSmoke(report) {
  const preparedRequests = report.requests.filter((path) => path.startsWith("/cssblackhole/"));
  const presentation = report.initial.presentation;
  if (report.initial.bodyClass !== "ready" ||
      report.initial.stats?.adapterId !== "luminet" ||
      report.initial.stats?.starCount !== 1979 ||
      report.initial.stats?.configurationCount !== 3 ||
      report.initial.stats?.sourceFramesPerSecond !== 60 ||
      report.initial.stats?.framesPerSecond !== 60 ||
      report.initial.stats?.orbitalSpeedScale !== 0.5 ||
      JSON.stringify(report.initial.stats?.presentationSlotHoldSeconds) !==
        JSON.stringify([5, 2.75, 1.5, 2.75]) ||
      JSON.stringify(report.initial.stats?.transitionCadenceSecondsBySlot) !==
        JSON.stringify([7, 4.75, 3.5, 4.75]) ||
      report.initial.stats?.transitionDurationSeconds !== 2 ||
      report.initial.leafCount !== 1979 ||
      report.initial.inlineTransformCount !== 1979 ||
      report.initial.computedTransformCount !== 1979 ||
      report.initial.canonical !== "https://css.graphics/luminet/" ||
      report.initial.robots !== "index, follow" ||
      report.initial.errors.length !== 0 ||
      report.initial.stats?.runtimePhysicsCount !== 0 ||
      report.initial.stats?.runtimeRasterizationCount !== 0 ||
      report.initial.stats?.runtimeDomReconstructionCount !== 0 ||
      report.initial.stats?.materializedBlockTransformCharacterLimit !== 3_200_000 ||
      report.initial.stats?.materializedBlockScheduleByteLimit !== 260_000 ||
      report.initial.stats?.maximumPreparedBlockTransformCharacters !== 3_159_406 ||
      report.initial.stats?.maximumPreparedBlockScheduleBytes !== 253_720 ||
      report.initial.stats?.retainedMaterializedBlockCount !== 1 ||
      report.initial.stats?.retainedMaterializedTransformBytes > 3_200_000 ||
      report.initial.stats?.retainedMaterializedScheduleBytes > 260_000 ||
      report.initial.stats?.workerMaterializationMaximumResponseChunkCharacters > 112_000 ||
      report.initial.stats?.spaceContextSourceStarCountPerPlate !== 1000 ||
      report.initial.stats?.spaceContextPointPrimitive !== "axis-aligned-square" ||
      report.initial.stats?.spaceContextRuntimeDomNodeCount !== 0 ||
      report.initial.stats?.spaceContextRuntimeAnimationCount !== 0 ||
      report.initial.stats?.spaceContextRuntimeStyleWriteCount !== 0 ||
      report.initial.stats?.spaceContextRuntimeRasterizationCount !== 0 ||
      report.initial.stats?.initialSnapshotReuseCount !== 1 ||
      report.initial.stats?.initialSnapshotDomWriteCount !== 0 ||
      report.initial.stats?.runtimeSchedulerTransport !==
        "refresh-calibrated-requestAnimationFrame-prepared-publication-at-sixty-hertz" ||
      report.initial.stats?.schedulerLeadMilliseconds !== 0 ||
      report.initial.stats?.schedulerDelayRequestCount !== 0 ||
      report.initial.stats?.schedulerDelayCallbackCount !== 0 ||
      report.initial.stats?.schedulerNoopCallbackCount !== 0 ||
      report.initial.stats?.pointSize !== 2 ||
      report.initial.stats?.pointSizePolicy !== "2px-all-resolution-tiers" ||
      !report.initial.spaceContextBackgroundImage?.includes("space-context-") ||
      report.initial.spaceContextBackgroundRepeat !== "repeat" ||
      report.initial.pointPresentation?.deviceScaleFactor !== report.viewport.deviceScaleFactor ||
      report.initial.pointPresentation?.policyValue !== `${report.expectedPointSize}px` ||
      Math.abs(report.initial.pointPresentation.width - report.expectedPointSize) > 0.02 ||
      Math.abs(report.initial.pointPresentation.height - report.expectedPointSize) > 0.02 ||
      report.initial.stats?.presentationFit !== "prepared-content-bounds-contain" ||
      report.initial.stats?.sourceViewport?.width !== 800 ||
      report.initial.stats?.sourceViewport?.height !== 600 ||
      report.initial.stats?.presentationPaddingPixels !== 90 ||
      report.initial.stats?.presentationVerticalViewportPaddingPixels !== 22 ||
      presentation?.preparedBoundsContained !== true ||
      Math.abs(presentation.offset.x + presentation.center.x) > 0.000_1 ||
      Math.abs(presentation.offset.y + presentation.center.y) > 0.000_1 ||
      presentation?.sharedShellOwnsStage !== true ||
      Math.abs(presentation.scale - presentation.expectedScale) > 0.000_001 ||
      report.final.leafCount !== 1979 || !report.final.stableIdentity ||
      report.final.changedTransformCount < 100 ||
      report.final.stats?.preparedConfigurationSwitchCount < 1 ||
      report.final.stats?.retainedMaterializedBlockCount < 1 ||
      report.final.stats?.retainedMaterializedBlockCount > 2 ||
      report.final.stats?.retainedMaterializedTransformBytes > 6_400_000 ||
      report.final.stats?.retainedMaterializedScheduleBytes > 520_000 ||
      report.final.stats?.preparedBlockWaitCount !== 0 ||
      report.final.stats?.preparedBankWaitCount !== 0 ||
      report.final.stats?.sourceFrameDropCount !== 0 ||
      report.final.stats?.schedulerNoopCallbackCount !== 0 ||
      report.final.stats?.runtimeDomGrowth !== false ||
      report.final.topDownVerticalMargins?.top < 23 ||
      report.final.topDownVerticalMargins?.bottom < 23 ||
      (report.id === "monitor27" &&
        (report.final.topDownVerticalMargins.top < 70 ||
          report.final.topDownVerticalMargins.bottom < 70)) ||
      report.final.pausedFrame !== report.final.pausedFrameAfterWait ||
      !preparedRequests.includes(report.expectedSpaceContextPath) ||
      preparedRequests.length < 6 || report.pageErrors.length !== 0 ||
      report.consoleErrors.length !== 0 || report.failedResponses.length !== 0) {
    throw new Error(`Luminet browser smoke failed: ${JSON.stringify(report)}`);
  }
}

function createStaticDeployServer(root) {
  const rootPrefix = `${root}${sep}`;
  return createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", route).pathname);
      const normalized = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const path = resolve(root, `.${normalized}`);
      if (!path.startsWith(rootPrefix)) return response.writeHead(403).end();
      const bytes = await readFile(path);
      response.statusCode = 200;
      response.setHeader("Content-Type", mediaType(path));
      response.setHeader("Content-Length", bytes.byteLength);
      if (path.endsWith(".bin.br")) {
        response.setHeader("Content-Encoding", "br");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (error?.code === "ENOENT") return response.writeHead(404).end();
      response.writeHead(500).end();
    }
  });
}

function mediaType(path) {
  if (path.endsWith(".bin.br")) return "application/octet-stream";
  return new Map([
    [".css", "text/css"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".webp", "image/webp"],
  ]).get(extname(path)) ?? "application/octet-stream";
}
