#!/usr/bin/env node
// SPDX-License-Identifier: HPND
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
const generatedAt = new Date().toISOString();
const outputRoot = resolve(
  repositoryRoot,
  "bench/results/csscityflow/motion-face-audit",
  generatedAt.replaceAll(":", "-"),
);
const liveVideoRoot = resolve(outputRoot, "live-video-raw");
const culledFramesRoot = resolve(outputRoot, "culled-frames");
const unculledFramesRoot = resolve(outputRoot, "unculled-frames");
const presentationFramesRoot = resolve(outputRoot, "presentation-frames");
const route = process.env.CSSCITYFLOW_MOTION_AUDIT_URL ??
  "http://127.0.0.1:4325/cityflow/";
const width = 1_280;
const height = 720;
const liveDurationMilliseconds = 6_000;
const sampleRateHz = 60;
const sampleCount = 302;

await rm(outputRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(liveVideoRoot, { recursive: true }),
  mkdir(culledFramesRoot, { recursive: true }),
  mkdir(unculledFramesRoot, { recursive: true }),
  mkdir(presentationFramesRoot, { recursive: true }),
]);
const response = await fetch(route);
if (!response.ok) throw new Error(`Cityflow motion-audit route failed: ${response.status}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
let browserVersion;
try {
  browserVersion = browser.version();
  const live = await captureLiveVideo(browser);
  const sequence = await captureMatchedSequence(browser);
  const culledVideo = resolve(outputRoot, "culled-60fps.mp4");
  const unculledVideo = resolve(outputRoot, "unculled-60fps.mp4");
  const presentationVideo = resolve(outputRoot, "presentation-60fps.mp4");
  await Promise.all([
    encodeSequence(culledFramesRoot, culledVideo),
    encodeSequence(unculledFramesRoot, unculledVideo),
    encodeSequence(presentationFramesRoot, presentationVideo),
  ]);
  const report = {
    schema: "csscityflow-motion-face-audit@2",
    generatedAt,
    route,
    browser: {
      name: "Google Chrome",
      channel: "chrome",
      version: browserVersion,
      headless: true,
    },
    viewport: { width, height, deviceScaleFactor: 1 },
    live,
    sequence: {
      ...sequence,
      sampleRateHz,
      sampleCount,
      culledFramesRoot,
      unculledFramesRoot,
      presentationFramesRoot,
      culledVideo,
      unculledVideo,
      presentationVideo,
    },
  };
  const reportPath = resolve(outputRoot, "capture.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath, outputRoot }, null, 2));
} finally {
  await browser.close();
}

async function captureLiveVideo(browserHandle) {
  const context = await browserHandle.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: liveVideoRoot, size: { width, height } },
  });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await openReadyScene(page);
  const video = page.video();
  const telemetry = await page.evaluate(async ({ durationMilliseconds }) => {
    const player = globalThis.__csscityflow.player;
    player.pause();
    player.seekFrame(0);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const samples = [];
    const startedAt = performance.now();
    player.resume();
    await new Promise((resolveSamples) => {
      function sample(timestamp) {
        const stats = player.stats();
        samples.push({
          callback: samples.length,
          elapsedMilliseconds: timestamp - startedAt,
          frameIndex: stats.frameIndex,
          frameCount: stats.frameCount,
          visibleFaceCount: stats.visibleFaceCount,
          shapeStyleWrites: stats.lastPublication.shapeStyleWrites,
          visibilityWrites: stats.lastPublication.visibilityWrites,
          publicationCount: stats.publicationCount,
        });
        if (timestamp - startedAt >= durationMilliseconds) resolveSamples();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    player.pause();
    return {
      durationMilliseconds,
      callbackCount: samples.length,
      transformAnimationCount: [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")].reduce(
        (sum, root) => sum + root.getAnimations().length,
        0,
      ),
      skippedPreparedStateCount: samples.slice(1).reduce((sum, sample, index) => {
        const previous = samples[index];
        const publicationDelta = sample.publicationCount - previous.publicationCount;
        if (publicationDelta === 0) return sum;
        const frameDelta = (sample.frameIndex - previous.frameIndex + sample.frameCount) %
          sample.frameCount;
        return sum + Number(publicationDelta !== 1 || frameDelta !== 1);
      }, 0),
      samples,
    };
  }, { durationMilliseconds: liveDurationMilliseconds });
  const videoPath = resolve(outputRoot, "cityflow-live.webm");
  await page.close();
  await context.close();
  await video.saveAs(videoPath);
  if (errors.length > 0 || telemetry.transformAnimationCount !== 0 ||
      telemetry.skippedPreparedStateCount !== 0) {
    throw new Error(`Cityflow live-video capture failed: ${JSON.stringify({
      errors,
      transformAnimationCount: telemetry.transformAnimationCount,
      skippedPreparedStateCount: telemetry.skippedPreparedStateCount,
    })}`);
  }
  return { videoPath, telemetry };
}

async function captureMatchedSequence(browserHandle) {
  const context = await browserHandle.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const culledPage = await context.newPage();
  const unculledPage = await context.newPage();
  const presentationPage = await context.newPage();
  const culledErrors = collectErrors(culledPage);
  const unculledErrors = collectErrors(unculledPage);
  const presentationErrors = collectErrors(presentationPage);
  await Promise.all([
    openReadyScene(culledPage),
    openReadyScene(unculledPage),
    openReadyScene(presentationPage),
  ]);
  await Promise.all([
    installGeometryAuditStyles(culledPage, false),
    installGeometryAuditStyles(unculledPage, true),
  ]);
  await unculledPage.evaluate(async () => {
    const response = await fetch("/csscityflow/cityflow.playback.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Cityflow audit playback failed: ${response.status}`);
    globalThis.__csscityflowAuditPlayback = await response.json();
  });
  const frameMilliseconds = await culledPage.evaluate(() => {
    const player = globalThis.__csscityflow.player;
    player.pause();
    player.seekFrame(0);
    return player.stats().frameMilliseconds;
  });
  await unculledPage.evaluate(() => {
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflow.player.seekFrame(0);
  });
  await presentationPage.evaluate(() => {
    globalThis.__csscityflow.player.pause();
    globalThis.__csscityflow.player.seekFrame(0);
  });
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const presentationTimeMilliseconds = sampleIndex * 1_000 / sampleRateHz;
    const frameIndex = Math.floor(
      (presentationTimeMilliseconds + 0.001) / frameMilliseconds,
    ) % 301;
    await Promise.all([
      setAuditTime(culledPage, presentationTimeMilliseconds),
      setAuditTime(unculledPage, presentationTimeMilliseconds, true),
      setAuditTime(presentationPage, presentationTimeMilliseconds),
    ]);
    const frameName = `frame_${String(sampleIndex).padStart(4, "0")}.png`;
    await Promise.all([
      culledPage.screenshot({ path: resolve(culledFramesRoot, frameName) }),
      unculledPage.screenshot({ path: resolve(unculledFramesRoot, frameName) }),
      presentationPage.screenshot({ path: resolve(presentationFramesRoot, frameName) }),
    ]);
    samples.push({ sampleIndex, presentationTimeMilliseconds, frameIndex });
  }
  await context.close();
  const errors = [...culledErrors, ...unculledErrors, ...presentationErrors];
  if (errors.length > 0) throw new Error(`Cityflow matched-sequence capture failed: ${errors.join("\n")}`);
  const samplesPath = resolve(outputRoot, "sequence-samples.json");
  await writeFile(samplesPath, `${JSON.stringify(samples, null, 2)}\n`);
  const faceComparison = await compareMatchedFrames();
  const temporalDeltas = {
    culledGeometry: await compareConsecutiveFrames(culledFramesRoot),
    unculledGeometry: await compareConsecutiveFrames(unculledFramesRoot),
    presentation: await compareConsecutiveFrames(presentationFramesRoot),
  };
  if (faceComparison.largestStrongMismatchComponentPixelCount > 1) {
    throw new Error(`Cityflow matched-sequence face comparison failed: ${JSON.stringify(
      faceComparison,
    )}`);
  }
  return { frameMilliseconds, samplesPath, faceComparison, temporalDeltas };
}

async function compareConsecutiveFrames(framesRoot) {
  const rows = [];
  let previous = await rawFrame(framesRoot, 0);
  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    const current = await rawFrame(framesRoot, sampleIndex);
    let channelAbsoluteDelta = 0;
    let changedPixelCount = 0;
    for (let byteIndex = 0; byteIndex < current.data.length; byteIndex += 3) {
      const delta = Math.abs(current.data[byteIndex] - previous.data[byteIndex]) +
        Math.abs(current.data[byteIndex + 1] - previous.data[byteIndex + 1]) +
        Math.abs(current.data[byteIndex + 2] - previous.data[byteIndex + 2]);
      channelAbsoluteDelta += delta;
      changedPixelCount += Number(delta !== 0);
    }
    rows.push({
      fromSampleIndex: sampleIndex - 1,
      toSampleIndex: sampleIndex,
      channelAbsoluteDelta,
      changedPixelCount,
    });
    previous = current;
  }
  const ordered = rows.map(({ channelAbsoluteDelta }) => channelAbsoluteDelta)
    .sort((left, right) => left - right);
  return {
    intervalCount: rows.length,
    zeroDeltaIntervalCount: rows.filter(({ channelAbsoluteDelta }) =>
      channelAbsoluteDelta === 0).length,
    minimumChannelAbsoluteDelta: ordered[0],
    medianChannelAbsoluteDelta: percentile(ordered, 0.5),
    p95ChannelAbsoluteDelta: percentile(ordered, 0.95),
    maximumChannelAbsoluteDelta: ordered.at(-1),
    loopClosureInterval: rows.at(-1),
    worstIntervals: [...rows].sort((left, right) =>
      right.channelAbsoluteDelta - left.channelAbsoluteDelta).slice(0, 10),
  };
}

async function rawFrame(framesRoot, sampleIndex) {
  return sharp(resolve(framesRoot, `frame_${String(sampleIndex).padStart(4, "0")}.png`))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.floor((values.length - 1) * fraction)];
}

async function compareMatchedFrames() {
  const frameNames = Array.from(
    { length: sampleCount },
    (_, sampleIndex) => `frame_${String(sampleIndex).padStart(4, "0")}.png`,
  );
  const strongBlackMaximum = 64;
  const strongWhiteMinimum = 192;
  let totalPixelCount = 0;
  let changedPixelCount = 0;
  let strongMismatchPixelCount = 0;
  let largestStrongMismatchComponentPixelCount = 0;
  let maxChannelDelta = 0;
  let worstFrame = null;

  for (const frameName of frameNames) {
    const [culled, unculled] = await Promise.all([
      sharp(resolve(culledFramesRoot, frameName)).removeAlpha().raw().toBuffer({
        resolveWithObject: true,
      }),
      sharp(resolve(unculledFramesRoot, frameName)).removeAlpha().raw().toBuffer({
        resolveWithObject: true,
      }),
    ]);
    const pixelCount = culled.info.width * culled.info.height;
    let frameChangedPixelCount = 0;
    let frameStrongMismatchPixelCount = 0;
    let frameMaxChannelDelta = 0;
    const frameStrongMismatchPixels = new Set();
    for (let byteIndex = 0; byteIndex < culled.data.length; byteIndex += 3) {
      const pixelIndex = byteIndex / 3;
      const culledMaximum = Math.max(
        culled.data[byteIndex],
        culled.data[byteIndex + 1],
        culled.data[byteIndex + 2],
      );
      const culledMinimum = Math.min(
        culled.data[byteIndex],
        culled.data[byteIndex + 1],
        culled.data[byteIndex + 2],
      );
      const unculledMaximum = Math.max(
        unculled.data[byteIndex],
        unculled.data[byteIndex + 1],
        unculled.data[byteIndex + 2],
      );
      const unculledMinimum = Math.min(
        unculled.data[byteIndex],
        unculled.data[byteIndex + 1],
        unculled.data[byteIndex + 2],
      );
      const channelDelta = Math.max(
        Math.abs(culled.data[byteIndex] - unculled.data[byteIndex]),
        Math.abs(culled.data[byteIndex + 1] - unculled.data[byteIndex + 1]),
        Math.abs(culled.data[byteIndex + 2] - unculled.data[byteIndex + 2]),
      );
      if (channelDelta !== 0) frameChangedPixelCount += 1;
      if (
        (culledMaximum <= strongBlackMaximum && unculledMinimum >= strongWhiteMinimum) ||
        (unculledMaximum <= strongBlackMaximum && culledMinimum >= strongWhiteMinimum)
      ) {
        frameStrongMismatchPixelCount += 1;
        frameStrongMismatchPixels.add(pixelIndex);
      }
      frameMaxChannelDelta = Math.max(frameMaxChannelDelta, channelDelta);
    }
    const frameLargestStrongMismatchComponentPixelCount = largestComponentPixelCount(
      frameStrongMismatchPixels,
      culled.info.width,
      culled.info.height,
    );
    totalPixelCount += pixelCount;
    changedPixelCount += frameChangedPixelCount;
    strongMismatchPixelCount += frameStrongMismatchPixelCount;
    largestStrongMismatchComponentPixelCount = Math.max(
      largestStrongMismatchComponentPixelCount,
      frameLargestStrongMismatchComponentPixelCount,
    );
    maxChannelDelta = Math.max(maxChannelDelta, frameMaxChannelDelta);
    if (!worstFrame || frameChangedPixelCount > worstFrame.changedPixelCount) {
      worstFrame = {
        frameName,
        changedPixelCount: frameChangedPixelCount,
        changedPixelRatio: frameChangedPixelCount / pixelCount,
        strongMismatchPixelCount: frameStrongMismatchPixelCount,
        largestStrongMismatchComponentPixelCount:
          frameLargestStrongMismatchComponentPixelCount,
        maxChannelDelta: frameMaxChannelDelta,
      };
    }
  }

  return {
    comparison: "paired-white-face-coverage",
    strongBlackMaximum,
    strongWhiteMinimum,
    frameCount: frameNames.length,
    totalPixelCount,
    changedPixelCount,
    changedPixelRatio: changedPixelCount / totalPixelCount,
    strongMismatchPixelCount,
    largestStrongMismatchComponentPixelCount,
    maxChannelDelta,
    worstFrame,
  };
}

function largestComponentPixelCount(pixelIndices, width, height) {
  let largestPixelCount = 0;
  while (pixelIndices.size > 0) {
    const firstPixelIndex = pixelIndices.values().next().value;
    pixelIndices.delete(firstPixelIndex);
    const pending = [firstPixelIndex];
    let componentPixelCount = 0;
    while (pending.length > 0) {
      const pixelIndex = pending.pop();
      componentPixelCount += 1;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const neighbors = [];
      if (x > 0) neighbors.push(pixelIndex - 1);
      if (x + 1 < width) neighbors.push(pixelIndex + 1);
      if (y > 0) neighbors.push(pixelIndex - width);
      if (y + 1 < height) neighbors.push(pixelIndex + width);
      for (const neighbor of neighbors) {
        if (pixelIndices.delete(neighbor)) pending.push(neighbor);
      }
    }
    largestPixelCount = Math.max(largestPixelCount, componentPixelCount);
  }
  return largestPixelCount;
}

async function openReadyScene(page) {
  await page.route("**/favicon.ico", (routeHandler) =>
    routeHandler.fulfill({ status: 204, body: "" }));
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__csscityflow?.ready ||
    globalThis.__csscityflow?.errors?.length, null, { timeout: 30_000 });
  const errors = await page.evaluate(() => globalThis.__csscityflow?.errors ?? []);
  if (errors.length > 0) throw new Error(`Cityflow page failed: ${errors.join("\n")}`);
  await page.addStyleTag({ content: `
    .examples-sidebar, .example-info { display: none !important; }
    .example-stage { position: fixed !important; inset: 0 !important; }
  ` });
}

async function installGeometryAuditStyles(page, unculled) {
  await page.addStyleTag({ content: `
    :root, body, .example-stage { background: #000 !important; }
    .example-stage>.polycss-camera>.polycss-scene>div>b:first-child,
    .example-stage>.polycss-camera>.polycss-scene>div::before,
    .example-stage>.polycss-camera>.polycss-scene>div::after,
    .example-stage>.polycss-camera>.polycss-scene>div.csscityflow-side-1-hidden::before,
    .example-stage>.polycss-camera>.polycss-scene>div.csscityflow-side-2-hidden::after {
      background: #fff !important;
      ${unculled ? "visibility: visible !important;" : ""}
    }
    .example-stage>.polycss-camera>.polycss-scene>div>b {
      ${unculled ? "visibility: visible !important;" : ""}
    }
  ` });
}

async function setAuditTime(page, presentationTimeMilliseconds, publishAllShapes = false) {
  await page.evaluate(({ presentationTimeMilliseconds: nextPresentationTime, publishAll }) => {
    const player = globalThis.__csscityflow.player;
    const stats = player.seekPresentationTime(nextPresentationTime);
    if (!publishAll) return;
    const playback = globalThis.__csscityflowAuditPlayback;
    const boxes = [...document.querySelectorAll(".example-stage>.polycss-camera>.polycss-scene>div")];
    if (playback?.presentationShapeStyles?.length !== stats.frameCount * stats.boxCount ||
        boxes.length !== stats.boxCount) {
      throw new Error("Cityflow unculled audit playback binding drifted");
    }
    const offset = stats.frameIndex * stats.boxCount;
    boxes.forEach((box, boxIndex) => {
      box.style.cssText = playback.presentationShapeStyles[offset + boxIndex];
    });
  }, { presentationTimeMilliseconds, publishAll: publishAllShapes });
}

async function encodeSequence(framesRoot, outputPath) {
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(sampleRateHz),
    "-i", resolve(framesRoot, "frame_%04d.png"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outputPath,
  ]);
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
