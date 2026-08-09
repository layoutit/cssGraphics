#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssgears/paths.mjs";

const requireReady = process.argv.includes("--require-ready");
const smokeDir = join("bench", "results", "cssgears", "smoke");
const screenshotPath = join(smokeDir, "default-route.png");
const mobileScreenshotPath = join(smokeDir, "mobile-route.png");
const statePath = join(smokeDir, "state.json");
const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(smokeDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.body.classList.contains("error") || window.__cssGearsDebug?.ready,
      null,
      { timeout: 30_000 },
    );
    const segment = await page.evaluate(() => {
      const api = window.__cssGearsDebug;
      if (!api?.ready) return null;
      api.pause();
      const sample = (tick) => {
        api.setTick(tick);
        return api.nodes().gearRoots.map((root) => getComputedStyle(root).transform);
      };
      const entryStart = sample(0);
      const entryMiddle = sample(20);
      const locked = sample(39);
      const spinStart = sample(40);
      const spinNext = sample(41);
      const spinEnd = sample(539);
      const exitStart = sample(540);
      const exitEnd = sample(579);
      const outgoingScene = api.scene.id;
      const outgoingClasses = api.nodes().gearRoots.map((root) => root.className);
      api.step(1);
      const nextEntry = api.nodes().gearRoots.map((root) => getComputedStyle(root).transform);
      const incomingScene = api.scene.id;
      const incomingClasses = api.nodes().gearRoots.map((root) => root.className);
      const sequence = [outgoingScene, incomingScene];
      while (sequence.length < 24) {
        api.setTick(579);
        api.step(1);
        sequence.push(api.scene.id);
      }
      const lastScene = sequence.at(-1);
      api.setTick(579);
      api.step(1);
      const nextCycleScene = api.scene.id;
      api.setTick(20);
      return {
        entryStart, entryMiddle, locked, spinStart, spinNext, spinEnd, exitStart, exitEnd,
        nextEntry, outgoingScene, incomingScene, outgoingClasses, incomingClasses,
        sequence, lastScene, nextCycleScene,
        stableDom: api.assertStableDomIdentity(),
      };
    });
    await page.screenshot({ path: screenshotPath });
    const browserState = await page.evaluate(() => ({
      status: document.body.classList.contains("ready") ? "ready" : "error",
      message: document.getElementById("status")?.textContent ?? "",
      debugReady: Boolean(window.__cssGearsDebug),
      errors: window.__cssGearsDebug?.errors?.() ?? [],
      meshCount: window.__cssGearsDebug?.meshes?.().length ?? 0,
      route: window.__cssGearsDebug?.route ?? null,
      scene: window.__cssGearsDebug?.scene ? {
        id: window.__cssGearsDebug.scene.id,
        seed: window.__cssGearsDebug.scene.sourceProfile?.seed,
        presentation: window.__cssGearsDebug.scene.sourceProfile?.presentation,
        responsivePresentation: window.__cssGearsDebug.scene.showreel?.responsivePresentation,
        metrics: window.__cssGearsDebug.scene.metrics,
      } : null,
      bank: window.__cssGearsDebug?.manifest?.preparedBank ?? null,
      stats: window.__cssGearsDebug?.stats?.() ?? null,
      dom: {
        divs: document.querySelectorAll("#scene div").length,
        gearRoots: document.querySelectorAll("#scene .polycss-scene > .g").length,
        directFaces: document.querySelectorAll("#scene .polycss-scene > .g > b").length,
        activeFaces: [...document.querySelectorAll("#scene .polycss-scene > .g > b")]
          .filter((leaf) => getComputedStyle(leaf).display !== "none").length,
        nestedElementsUnderFaces: document.querySelectorAll("#scene .polycss-scene > .g > b > *").length,
      },
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    const mobilePaintBounds = await captureMobilePaintBounds(page);
    const mobile = {
      ...await page.evaluate(() => ({
        stats: window.__cssGearsDebug.stats(),
        sceneId: window.__cssGearsDebug.scene.id,
        responsivePresentation: window.__cssGearsDebug.scene.showreel.responsivePresentation,
      })),
      paintBounds: mobilePaintBounds,
    };
    await page.screenshot({ path: mobileScreenshotPath });
    const state = { ...browserState, segment };
    await writeFile(statePath, JSON.stringify({
      ...state,
      screenshotPath,
      mobileScreenshotPath,
      mobile,
    }, null, 2) + "\n");
    if (!state.debugReady) throw new Error("Missing window.__cssGearsDebug.");
    if (state.status === "ready" && (
      state.stats?.schema !== "cssgears-prepared-player-stats@15" ||
      state.stats?.loadedPreparedBankCount !== 24 ||
      state.stats?.runtimeSchedulerTransport !== "deadline-setTimeout-requestAnimationFrame-prepared-publication" ||
      state.stats?.runtimeSchedulerNoopCallbackCount !== 0 ||
      state.stats?.runtimeSchedulerCallbackCount !== state.stats?.runtimeSchedulerStateTransitions ||
      state.stats?.runtimeSchedulerRequestCount !==
        state.stats?.runtimeSchedulerStateTransitions + state.stats?.runtimeSchedulerCancelCount ||
      state.stats?.retainedLightingGroupCount !== 0 ||
      state.stats?.retainedDynamicLightingLeafCount !== 0 ||
      state.stats?.preparedStaticLightingLeafCount !== state.stats?.retainedPolygonLeafCount ||
      state.stats?.preparedLightingAtlasStateCount !== 24 ||
      state.stats?.preparedLightingAtlasTextureLeafCount !== state.stats?.retainedPolygonLeafCount ||
      state.stats?.preparedLightingAtlasReadyTextureLeafCount !== state.stats?.retainedPolygonLeafCount ||
      state.stats?.preparedRenderBundleCount !== state.scene?.metrics?.preparedRenderBundleCount ||
      state.stats?.preparedMergedSourceFaceCount !== state.scene?.metrics?.mergedSourceFaceCount ||
      state.stats?.preparedSourceFaceCoverageExact !== true ||
      state.stats?.preparedLightingAtlasUniqueUrlCount !== 24 ||
      state.stats?.retainedSceneBankCount !== 24 ||
      state.stats?.runtimePreparedBankSwitchCount !== 24 ||
      state.stats?.runtimeRootClassWrites !== state.stats.runtimePreparedBankSwitchCount * 3 ||
      state.stats?.startupRootClassWrites > 3 ||
      state.stats?.runtimeRandomSelectionPurpose !== "prepared-bank-index-only" ||
      state.stats?.runtimeLightingCalculationCount !== 0 ||
      state.stats?.runtimeCameraCalculationCount !== 0 ||
      state.stats?.runtimeLightingRowWrites !== 0 ||
      state.stats?.runtimeLightingRowComparisons !== 0 ||
      state.stats?.runtimeLightingPublicationCount !== 0 ||
      state.stats?.runtimeApplyStableDomIdentityChecks !== 0 ||
      state.stats?.runtimePerFrameLeafStyleWrites !== 0 ||
      state.stats?.runtimeDomMutationCount !== 0 ||
      state.bank?.schema !== "cssgears-prepared-bank@2" ||
      state.bank?.sceneIds?.length !== 24 ||
      state.route?.selection !== "random-prepared-shuffled-bank" ||
      state.route?.activeScene !== state.scene?.id || state.route?.activeSeed !== state.scene?.seed ||
      state.scene?.presentation?.runtimeCameraCalculation !== false ||
      state.dom?.divs !== 5 || state.dom?.gearRoots !== 3 ||
      state.dom?.directFaces !== state.stats?.retainedPolygonLeafCount ||
      state.dom?.activeFaces !== state.stats?.activePreparedLeafCount || state.dom?.nestedElementsUnderFaces !== 0
    )) {
      throw new Error("Prepared lighting/runtime-work contract regressed: " + JSON.stringify(state.stats));
    }
    if (state.status === "ready" && (!segment?.stableDom ||
        JSON.stringify(segment.entryStart) === JSON.stringify(segment.entryMiddle) ||
        JSON.stringify(segment.entryMiddle) === JSON.stringify(segment.locked) ||
        JSON.stringify(segment.locked) !== JSON.stringify(segment.spinStart) ||
        JSON.stringify(segment.spinStart) === JSON.stringify(segment.spinNext) ||
        JSON.stringify(segment.spinEnd) !== JSON.stringify(segment.exitStart) ||
        JSON.stringify(segment.exitStart) === JSON.stringify(segment.exitEnd) ||
        JSON.stringify(segment.exitEnd) === JSON.stringify(segment.nextEntry) ||
        segment.outgoingScene === segment.incomingScene ||
        JSON.stringify(segment.outgoingClasses) === JSON.stringify(segment.incomingClasses) ||
        new Set(segment.sequence).size !== 24 || segment.lastScene === segment.nextCycleScene)) {
      throw new Error("Prepared cssGears showreel did not enter, lock, spin, exit, and switch banks.");
    }
    if (state.status === "ready" && (
      mobile.stats?.profile !== "mobile" ||
      mobile.stats?.rotationDegrees !== mobile.responsivePresentation?.mobile?.rotationDegrees ||
      mobile.stats?.scale <= 0 || mobile.stats?.runtimeOrientationCalculationCount !== 0 ||
      mobile.stats?.runtimeGeometryBoundsCalculationCount !== 0 ||
      mobile.paintBounds?.length !== 24 || new Set(mobile.paintBounds.map(({ id }) => id)).size !== 24 ||
      mobile.paintBounds.some(({ id, clipped }) => clipped || !state.bank.sceneIds.includes(id))
    )) {
      throw new Error("Prepared cssGears mobile portrait presentation regressed: " + JSON.stringify(mobile));
    }
    if (requireReady && state.status !== "ready") throw new Error("Runtime did not become ready: " + JSON.stringify(state));
    if (state.status === "error" && !/Run pnpm prepare:cssgears first/.test(state.message)) {
      throw new Error("Unexpected browser error: " + JSON.stringify({ state, pageErrors }));
    }
    console.log(JSON.stringify({ ...state, mobile, smokeDir, screenshotPath, mobileScreenshotPath, statePath }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function captureMobilePaintBounds(page) {
  const viewport = page.viewportSize();
  await page.evaluate(() => {
    window.__cssGearsDebug.pause();
    document.querySelectorAll("#scene .g").forEach((root) => { root.style.visibility = "hidden"; });
  });
  const background = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => {
    document.querySelectorAll("#scene .g").forEach((root) => { root.style.removeProperty("visibility"); });
  });
  const rows = [];
  const seenSceneIds = new Set();
  let transitionCount = 0;
  while (rows.length < 24 && transitionCount < 48) {
    const scene = await page.evaluate(() => ({
      id: window.__cssGearsDebug.scene.id,
      safeInsetPixels: window.__cssGearsDebug.scene.showreel.responsivePresentation.mobile.safeInsetPixels,
    }));
    if (!seenSceneIds.has(scene.id)) {
      seenSceneIds.add(scene.id);
      const bounds = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
      for (const tick of [39, 40, 140, 240, 340, 440, 539]) {
        await page.evaluate((preparedTick) => window.__cssGearsDebug.setTick(preparedTick), tick);
        includePaintedPixels(bounds, PNG.sync.read(await page.screenshot()), background);
      }
      const inset = scene.safeInsetPixels;
      rows.push({
        ...scene,
        bounds,
        clipped: bounds.minX < inset || bounds.minY < inset ||
          bounds.maxX > viewport.width - 1 - inset || bounds.maxY > viewport.height - 1 - inset,
      });
    }
    await page.evaluate(() => {
      window.__cssGearsDebug.setTick(579);
      window.__cssGearsDebug.step(1);
    });
    transitionCount += 1;
  }
  await page.evaluate(() => window.__cssGearsDebug.setTick(39));
  return rows;
}

function includePaintedPixels(bounds, frame, background) {
  if (frame.width !== background.width || frame.height !== background.height) {
    throw new Error("cssGears mobile paint oracle dimensions drifted");
  }
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const offset = (y * frame.width + x) * 4;
      const difference = Math.max(
        Math.abs(frame.data[offset] - background.data[offset]),
        Math.abs(frame.data[offset + 1] - background.data[offset + 1]),
        Math.abs(frame.data[offset + 2] - background.data[offset + 2]),
      );
      if (difference <= 4) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMs, onPoll = () => undefined) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Vite.\n" + output);
}
