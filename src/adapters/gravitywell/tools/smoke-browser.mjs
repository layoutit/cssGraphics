#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";

const adapterRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = resolve(repositoryRoot, "bench/results/cssgravitywell/smoke");
const screenshotPath = resolve(outputRoot, "default-route.png");
const statePath = resolve(outputRoot, "state.json");
const externalUrl = process.env.CSSGRAVITYWELL_SMOKE_URL;
const port = externalUrl ? null : await freePort();
const route = externalUrl ?? `http://127.0.0.1:${port}/gravitywell/`;
let server = null;
let serverOutput = "";
if (!externalUrl) {
  server = spawn("pnpm", [
    "exec", "vite", "--config", resolve(adapterRoot, "vite.config.mjs"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
}

let browser;
try {
  await mkdir(outputRoot, { recursive: true });
  if (server) await waitFor(() => serverOutput.includes("Local:"), 20_000);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  let loadingIndicator = null;
  {
    const loadingPage = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    await loadingPage.route("**/favicon.ico", (faviconRoute) => faviconRoute.fulfill({ status: 204 }));
    await loadingPage.route("**/cssgravitywell/catalog.json", async (catalogRoute) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      await catalogRoute.continue();
    });
    await loadingPage.goto(route, { waitUntil: "domcontentloaded" });
    await loadingPage.waitForFunction(() => document.body.classList.contains("loading"));
    loadingIndicator = await loadingPage.evaluate(() => {
      const indicator = getComputedStyle(document.body, "::after");
      const cover = getComputedStyle(document.body, "::before");
      return {
        bodyClassName: document.body.className,
        content: indicator.content,
        width: indicator.width,
        height: indicator.height,
        borderRadius: indicator.borderRadius,
        animationName: indicator.animationName,
        coverContent: cover.content,
        coverPosition: cover.position,
      };
    });
    await loadingPage.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 30_000 });
    await loadingPage.close();
  }
  if (loadingIndicator.bodyClassName !== "loading" || loadingIndicator.content !== '""' ||
      loadingIndicator.width !== "18px" || loadingIndicator.height !== "18px" ||
      loadingIndicator.borderRadius !== "50%" ||
      loadingIndicator.animationName !== "cssgravitywell-loading" ||
      loadingIndicator.coverContent !== '""' || loadingIndicator.coverPosition !== "fixed") {
    throw new Error(`Gravity Well loading indicator failed: ${JSON.stringify(loadingIndicator)}`);
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await page.route("**/favicon.ico", (faviconRoute) => faviconRoute.fulfill({ status: 204 }));
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.portStatus), null, { timeout: 30_000 });
  const initialCompleteBankEvidence = await page.evaluate(() => {
    const stats = globalThis.__cssGravityWellDebug.stats().transformBlocks;
    return {
      loadCount: stats.loadCount,
      residentBlockCount: stats.residentBlockCount,
      preparedCompleteBank: stats.preparedCompleteBank,
      activationWaitCount: stats.activationWaitCount,
    };
  });
  await page.evaluate(async () => globalThis.__cssGravityWellDebug.seekSourceTick(120));
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const evidence = await page.evaluate(() => {
    const debug = globalThis.__cssGravityWellDebug;
    const leaves = [...document.querySelectorAll(".polycss-morph-leaf")];
    const sceneElements = [...document.querySelectorAll(".polycss-camera, .polycss-camera *")];
    return {
      status: document.body.dataset.portStatus,
      ready: debug.ready,
      errors: debug.errors(),
      state: debug.state(),
      stats: debug.stats(),
      catalogBankCount: debug.catalog()?.bankCount ?? 0,
      selection: debug.selection(),
      stable: debug.assertStableDomIdentity(),
      retainedLeaves: leaves.length,
      retainedSceneElements: sceneElements.length,
      retainedShapeRoots: document.querySelectorAll(".polycss-morph-shape").length,
      forbiddenCanvasCount: document.querySelectorAll(".polycss-camera canvas").length,
      forbiddenSvgCount: document.querySelectorAll(".polycss-camera svg").length,
      clipPathCount: sceneElements.filter((element) => getComputedStyle(element).clipPath !== "none").length,
      dataAttributeCount: sceneElements.reduce((sum, element) => sum +
        element.getAttributeNames().filter((name) => name.startsWith("data-")).length, 0),
      preparedColorCount: new Set(leaves.map((leaf) => getComputedStyle(leaf).color)).size,
      visibleBackfaceLeafCount: leaves.filter(
        (leaf) => getComputedStyle(leaf).backfaceVisibility === "visible",
      ).length,
      visibleLeafCount: leaves.filter((leaf) => {
        const rect = leaf.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
          rect.left < innerWidth && rect.top < innerHeight && getComputedStyle(leaf).visibility === "visible";
      }).length,
      shellPath: document.querySelector(".site-wordmark-path")?.textContent ?? "",
      bodyClassName: document.body.className,
      loadingIndicatorContent: getComputedStyle(document.body, "::after").content,
      activeBankDataset: Number(document.body.dataset.activeBank),
      activeSeedDataset: Number(document.body.dataset.activeSeed),
    };
  });
  if (pageErrors.length || evidence.errors.length || evidence.status !== "ready" || !evidence.ready ||
      !evidence.stable || evidence.state.sourceFrameIndex !== 120 || !evidence.state.paused ||
      evidence.catalogBankCount !== 24 || evidence.stats.preparedBankCount !== 24 ||
      evidence.state.activeBankIndex !== evidence.activeBankDataset ||
      evidence.stats.activeSeed !== evidence.activeSeedDataset ||
      evidence.retainedLeaves !== 1_922 || evidence.retainedSceneElements !== 1_926 ||
      evidence.retainedShapeRoots !== 1 || evidence.forbiddenCanvasCount !== 0 ||
      evidence.forbiddenSvgCount !== 0 || evidence.clipPathCount !== 0 ||
      evidence.dataAttributeCount !== 0 || evidence.preparedColorCount < 8 ||
      evidence.visibleBackfaceLeafCount !== evidence.retainedLeaves ||
      evidence.visibleLeafCount < 500 || evidence.shellPath !== "/gravitywell" ||
      evidence.bodyClassName !== "ready" || evidence.loadingIndicatorContent !== "none" ||
      evidence.stats.runtimeGeometryConstructionCount !== 0 ||
      evidence.stats.runtimeTopologyConstructionCount !== 0 ||
      evidence.stats.runtimeAffineEvaluationCount !== 0 ||
      evidence.stats.runtimeColorCalculationCount !== 0 ||
      evidence.stats.transformBlocks.loadCount !== 16 ||
      evidence.stats.transformBlocks.preparedCompleteBank !== true ||
      evidence.stats.transformBlocks.activationWaitCount !== 0 ||
      initialCompleteBankEvidence.loadCount !== 16 ||
      initialCompleteBankEvidence.residentBlockCount !== 16 ||
      initialCompleteBankEvidence.preparedCompleteBank !== true ||
      initialCompleteBankEvidence.activationWaitCount !== 0 ||
      evidence.stats.runtimeDomCreationCount !== 0 || evidence.stats.runtimeDomRemovalCount !== 0) {
    throw new Error(`Gravity Well browser smoke failed: ${JSON.stringify({ evidence, pageErrors })}`);
  }
  await page.screenshot({ path: screenshotPath });
  const sparseBlockEvidence = await page.evaluate(async () => {
    const debug = globalThis.__cssGravityWellDebug;
    const leaves = [...document.querySelectorAll(".polycss-morph-leaf")];
    const blockBoundary = debug.scene().playback.blockFrameCount;
    const targetFrame = blockBoundary + 7;
    const styles = () => leaves.map((leaf) => ({
      style: `${leaf.style.transform}\n${leaf.style.color}`,
      visibility: leaf.style.visibility,
    }));
    const compare = (left, right) => left.reduce(
      (count, value, index) => count + Number(
        value.visibility !== right[index].visibility ||
        (value.visibility !== "hidden" && value.style !== right[index].style),
      ),
      0,
    );
    await debug.seek(blockBoundary - 1);
    await debug.step(1);
    const sequentialBoundary = styles();
    await debug.seek(blockBoundary + 1);
    await debug.seek(blockBoundary);
    const directBoundary = styles();
    await debug.seek(targetFrame - 1);
    await debug.step(1);
    const sequentialWithinBlock = styles();
    await debug.seek(targetFrame + 1);
    await debug.seek(targetFrame);
    const directWithinBlock = styles();
    return {
      blockBoundary,
      targetFrame,
      boundaryStyleDifferenceCount: compare(sequentialBoundary, directBoundary),
      withinBlockStyleDifferenceCount: compare(sequentialWithinBlock, directWithinBlock),
      stable: debug.assertStableDomIdentity(),
    };
  });
  if (!sparseBlockEvidence.stable ||
      sparseBlockEvidence.boundaryStyleDifferenceCount !== 0 ||
      sparseBlockEvidence.withinBlockStyleDifferenceCount !== 0) {
    throw new Error(`Gravity Well sparse transform playback failed: ${JSON.stringify(sparseBlockEvidence)}`);
  }
  await page.evaluate(async () => {
    const debug = globalThis.__cssGravityWellDebug;
    await debug.seek(debug.scene().timeline.sourceFrameEndIndex);
  });
  await page.waitForFunction(
    () => globalThis.__cssGravityWellDebug?.stats()?.pendingBankReady === true,
    null,
    { timeout: 30_000 },
  );
  const cycleEvidence = await page.evaluate(async () => {
    const debug = globalThis.__cssGravityWellDebug;
    const leaves = [...document.querySelectorAll(".polycss-morph-leaf")];
    const { allWellsCompleteFrameIndex, terminalFlatFrameIndex: terminalFrameIndex } = debug.scene().timeline;
    await debug.seek(allWellsCompleteFrameIndex);
    const completionBankIndex = debug.state().activeBankIndex;
    await debug.step(1);
    const postCompletionHoldBankIndex = debug.state().activeBankIndex;
    await debug.seek(terminalFrameIndex);
    const before = {
      activeBankIndex: debug.state().activeBankIndex,
      frameIndex: debug.state().frameIndex,
      switchCount: debug.stats().preparedBankSwitchCount,
      styles: leaves.map((leaf) => `${leaf.style.transform}\n${leaf.style.color}`),
    };
    await debug.step(1);
    const after = {
      activeBankIndex: debug.state().activeBankIndex,
      frameIndex: debug.state().frameIndex,
      switchCount: debug.stats().preparedBankSwitchCount,
      styles: leaves.map((leaf) => `${leaf.style.transform}\n${leaf.style.color}`),
    };
    let changedStyleCount = 0;
    for (let index = 0; index < before.styles.length; index += 1) {
      if (before.styles[index] !== after.styles[index]) changedStyleCount += 1;
    }
    return {
      terminalFrameIndex,
      allWellsCompleteFrameIndex,
      completionBankIndex,
      postCompletionHoldBankIndex,
      beforeActiveBankIndex: before.activeBankIndex,
      afterActiveBankIndex: after.activeBankIndex,
      beforeFrameIndex: before.frameIndex,
      afterFrameIndex: after.frameIndex,
      beforeSwitchCount: before.switchCount,
      afterSwitchCount: after.switchCount,
      changedStyleCount,
      stable: debug.assertStableDomIdentity(),
    };
  });
  if (!cycleEvidence.stable ||
      cycleEvidence.allWellsCompleteFrameIndex >= cycleEvidence.terminalFrameIndex ||
      cycleEvidence.completionBankIndex !== cycleEvidence.postCompletionHoldBankIndex ||
      cycleEvidence.beforeFrameIndex !== cycleEvidence.terminalFrameIndex ||
      cycleEvidence.afterFrameIndex !== 0 ||
      cycleEvidence.beforeActiveBankIndex === cycleEvidence.afterActiveBankIndex ||
      cycleEvidence.afterSwitchCount !== cycleEvidence.beforeSwitchCount + 1 ||
      cycleEvidence.changedStyleCount !== 0) {
    throw new Error(`Gravity Well flat-boundary cycle failed: ${JSON.stringify(cycleEvidence)}`);
  }
  await writeFile(statePath, `${JSON.stringify({
    route,
    loadingIndicator,
    initialCompleteBankEvidence,
    evidence,
    sparseBlockEvidence,
    cycleEvidence,
    pageErrors,
    screenshotPath,
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "passed",
    route,
    loadingIndicator,
    initialCompleteBankEvidence,
    screenshotPath,
    statePath,
    sparseBlockEvidence,
    cycleEvidence,
    ...evidence,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server?.exitCode === null) server.kill("SIGTERM");
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

async function waitFor(predicate, timeoutMilliseconds) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    if (server?.exitCode !== null) throw new Error(`Vite exited early:\n${serverOutput}`);
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for Vite:\n${serverOutput}`);
}
