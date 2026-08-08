#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const deploy = process.argv.includes("--deploy");
const smokeDir = join(repositoryRoot, ".local", "evidence", deploy
  ? "flowerbox-deploy-smoke"
  : "flowerbox-public-smoke");
const screenshotPath = join(smokeDir, "default-route.png");
const statePath = join(smokeDir, "state.json");
const port = await freePort();
let output = "";
const server = spawn("pnpm", deploy ? [
  "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  "--outDir", resolve(repositoryRoot, "dist/site"),
] : [
  "exec", "vite", "--config", "src/adapters/flowerbox/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await mkdir(smokeDir, { recursive: true });
  await waitFor(() => output.includes("Local:") || output.includes(`http://127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    const lightingGridRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("request", (request) => {
      if (/\/cssflower\/assets\/lighting\/grid-[a-f0-9]{64}\.avif$/u.test(new URL(request.url()).pathname)) {
        lightingGridRequests.push(request.url());
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    let releaseManifest;
    let observeManifestRequest;
    const manifestRelease = new Promise((resolve) => { releaseManifest = resolve; });
    const manifestRequested = new Promise((resolve) => { observeManifestRequest = resolve; });
    await page.route("**/cssflower/manifest.json", async (route) => {
      observeManifestRequest();
      await manifestRelease;
      await route.continue();
    });
    const navigation = page.goto(`http://127.0.0.1:${port}/${deploy ? "flower/" : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await Promise.race([
      manifestRequested,
      new Promise((_, reject) => setTimeout(() => reject(new Error("cssFlower manifest was not requested")), 5_000)),
    ]);
    await navigation;
    const loading = await page.evaluate(() => {
      const style = getComputedStyle(document.body, "::after");
      return {
        bodyChildCount: document.body.childElementCount,
        bodyAttributeNames: document.body.getAttributeNames(),
        content: style.content,
        position: style.position,
        width: style.width,
        height: style.height,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
      };
    });
    releaseManifest();
    await page.waitForFunction(() => ["ready", "error"].includes(globalThis.__cssFlowerDebug?.status), null, {
      timeout: 30_000,
    });
    const startup = await page.evaluate(() => ({
      status: globalThis.__cssFlowerDebug?.status ?? "missing",
      errors: globalThis.__cssFlowerDebug?.errors?.() ?? ["debug-api-missing"],
    }));
    if (startup.status !== "ready") {
      throw new Error(`cssFlower failed before browser proof: ${JSON.stringify(startup)}`);
    }
    const loadingAfterReady = await page.evaluate(() => {
      const style = getComputedStyle(document.body, "::after");
      return {
        bodyAttributeNames: document.body.getAttributeNames(),
        bodyClassName: document.body.className,
        content: style.content,
        animationName: style.animationName,
      };
    });

    const proof = await page.evaluate(async () => {
      const debug = globalThis.__cssFlowerDebug;
      if (!debug?.ready) throw new Error(`cssFlower debug API is not ready: ${JSON.stringify(debug?.errors?.())}`);
      debug.pause();
      const retained = debug.nodes();
      const root = retained.rotationRoot;
      const mesh = retained.mesh;
      const leaves = [...retained.leaves];
      const header = document.body.querySelector(":scope > .site-header");
      const wordmark = header?.querySelector(":scope > .site-wordmark");
      const actions = header?.querySelector(":scope > .site-actions");
      const github = actions?.querySelector(":scope > .site-action");
      const camera = document.body.querySelector(":scope > .polycss-camera");
      const scene = camera?.firstElementChild;
      const triangleIds = debug.scene.lighting.faces.map((face) => face.triangleId);
      const initialLeafTransforms = leaves.map((leaf) => leaf.style.transform);
      const rootInitialTransform = root.style.transform;
      const rows = [];
      for (const tick of [0, 31, 32, 45, 48, 49, 50, 51, 99, 149, 179, 180, 359, 360, 361]) {
        await debug.setTick(tick);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const current = debug.nodes();
        const sameLeaves = current.leaves.length === leaves.length &&
          current.leaves.every((leaf, index) => leaf === leaves[index]);
        rows.push({ tick, sameRoot: current.rotationRoot === root, sameLeaves, stats: debug.stats() });
        debug.assertStableDomIdentity();
      }
      await debug.setTick(40);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bodyRect = document.body.getBoundingClientRect();
      const cameraRect = camera.getBoundingClientRect();
      const allClasses = [...document.body.querySelectorAll("[class]")]
        .flatMap((element) => [...element.classList]);
      const permittedClasses = new Set([
        "polycss-camera",
        "polycss-scene",
        "polycss-mesh",
        "site-header",
        "site-wordmark",
        "site-wordmark-css",
        "site-wordmark-graphics",
        "site-wordmark-path",
        "site-actions",
        "site-action",
      ]);
      const customClasses = [...new Set(allClasses.filter((name) => !permittedClasses.has(name)))];
      const stylesheetText = document.head.querySelector("style")?.textContent ?? "";
      const preparedLeafRuleCount = (stylesheetText.match(/\.polycss-mesh>u\.[a-zA-Z]{1,2} \{/gu) ?? []).length;
      const preparedAddressProperties = new Set([
        "background-position",
        "background-position-x",
        "background-position-y",
      ]);
      return {
        status: debug.status,
        errors: debug.errors(),
        meshCount: debug.meshes().length,
        retainedRootCount: Number(root.parentElement === scene),
        retainedLeafCount: leaves.length,
        triangleIdCount: new Set(triangleIds).size,
        polycssStableTriangleCount: document.querySelectorAll(".polycss-mesh > u").length,
        rasterAtlasLeafCount: preparedLeafRuleCount,
        rasterLeafWidths: [...new Set(debug.scene.lighting.faces.map((face) => face.leafWidth))].sort((a, b) => a - b),
        rasterLeafHeights: [...new Set(debug.scene.lighting.faces.map((face) => face.leafHeight))].sort((a, b) => a - b),
        retainedLeafTags: [...new Set(leaves.map((leaf) => leaf.tagName))],
        bodyRect: { x: bodyRect.x, y: bodyRect.y, width: bodyRect.width, height: bodyRect.height },
        cameraRect: { x: cameraRect.x, y: cameraRect.y, width: cameraRect.width, height: cameraRect.height },
        bodyChildCount: document.body.children.length,
        bodyAttributeNames: document.body.getAttributeNames(),
        bodyClassName: document.body.className,
        dataAttributeCount: [...document.body.querySelectorAll("*")].reduce((count, element) =>
          count + element.getAttributeNames().filter((name) => name.startsWith("data-")).length, 0),
        bodyElementCount: document.body.querySelectorAll("*").length,
        customClassCount: customClasses.length,
        customClassUniqueCount: new Set(customClasses).size,
        customClassMaxLength: Math.max(...customClasses.map((name) => name.length)),
        customClassesValid: customClasses.every((name) => /^[a-zA-Z]{1,2}$/u.test(name)),
        comparisonElementCount: document.body.querySelectorAll("main,header,section,article,form,button,input,output,img,video,canvas,svg,script").length,
        shellWordmarkText: wordmark?.textContent?.replace(/\s+/gu, "") ?? "",
        shellWordmarkHref: wordmark?.href ?? "",
        shellGithubText: github?.textContent?.trim() ?? "",
        shellGithubHref: github?.href ?? "",
        shellStructure: header?.parentElement === document.body &&
          header === document.body.firstElementChild &&
          actions?.parentElement === header &&
          github?.parentElement === actions &&
          camera === document.body.lastElementChild,
        snapshotStyleCount: document.head.querySelectorAll("style").length,
        preparedLeafRuleCount,
        leafInlineTransformCount: leaves.filter((leaf) => leaf.style.transform.startsWith("matrix3d(")).length,
        leafInlinePreparedAddressPropertyCount: leaves.reduce((count, leaf) =>
          count + [...leaf.style].filter((name) => preparedAddressProperties.has(name)).length, 0),
        leafInlineVisibilityCount: leaves.filter((leaf) => leaf.style.visibility.length > 0).length,
        leafInlineUnexpectedPropertyCount: leaves.reduce((count, leaf) =>
          count + [...leaf.style].filter((name) =>
            name !== "transform" && name !== "visibility" && !preparedAddressProperties.has(name)).length, 0),
        rootInlinePropertyNames: [...root.style].sort(),
        cameraInlinePropertyCount: camera.style.length,
        cameraInlinePropertyNames: [...camera.style].sort(),
        sceneInlinePropertyCount: scene.style.length,
        meshInlinePropertyCount: mesh.style.length,
        directStructure: camera?.classList.contains("polycss-camera") === true &&
          camera.parentElement === document.body &&
          scene?.classList.contains("polycss-scene") === true &&
          scene.parentElement === camera &&
          root.parentElement === scene &&
          mesh.classList.contains("polycss-mesh") &&
          mesh.parentElement === root &&
          leaves.every((leaf) => leaf.parentElement === mesh),
        canvasCount: document.querySelectorAll("canvas").length,
        svgCount: document.querySelectorAll("svg").length,
        leafTransformChangeCount: leaves.reduce((count, leaf, index) => (
          count + Number(leaf.style.transform !== initialLeafTransforms[index])
        ), 0),
        rootTransformChanged: root.style.transform !== rootInitialTransform,
        identityRows: rows.map((row) => ({
          tick: row.tick,
          sameRoot: row.sameRoot,
          sameLeaves: row.sameLeaves,
          timelineStateIndex: row.stats.timelineStateIndex,
          geometryStateIndex: row.stats.geometryStateIndex,
          rootStateIndex: row.stats.rootStateIndex,
          transformBlockIndex: row.stats.transformBlockIndex,
          lightingPageIndex: row.stats.lightingPageIndex,
          lightingPageRowIndex: row.stats.lightingPageRowIndex,
          preparedAssetMappingMatches: (() => {
            const expected = debug.scene.playback.cycle.states[row.stats.timelineStateIndex];
            return row.stats.transformBlockIndex === expected.transformBlockIndex &&
              row.stats.lightingPageIndex === expected.lightingPageIndex &&
              row.stats.lightingPageRowIndex === expected.lightingPageRowIndex;
          })(),
          sfHex: row.stats.sourceSfHex,
          sfiHex: row.stats.sourceSfiHex,
          rotation: row.stats.sourceRotationDegrees,
        })),
        stats: debug.stats(),
      };
    });

    const responsiveFits = [];
    for (const expected of [
      { width: 390, height: 844, scale: 0.54166667 },
      { width: 1280, height: 720, scale: 1 },
      { width: 720, height: 720, scale: 1 },
      { width: 960, height: 900, scale: 1.25 },
    ]) {
      await page.setViewportSize({ width: expected.width, height: expected.height });
      await page.waitForFunction((expectedScale) =>
        Math.abs(globalThis.__cssFlowerDebug.stats().presentationScale - expectedScale) < 1e-7,
      expected.scale, { timeout: 5_000 });
      responsiveFits.push(await page.evaluate((target) => {
        const debug = globalThis.__cssFlowerDebug;
        debug.assertStableDomIdentity();
        const bodyRect = document.body.getBoundingClientRect();
        const camera = document.body.querySelector(":scope > .polycss-camera");
        const cameraRect = camera.getBoundingClientRect();
        return {
          ...target,
          bodyRect: { x: bodyRect.x, y: bodyRect.y, width: bodyRect.width, height: bodyRect.height },
          cameraRect: { x: cameraRect.x, y: cameraRect.y, width: cameraRect.width, height: cameraRect.height },
          retainedLeafCount: debug.nodes().leaves.length,
          runtimeDomMutationCount: debug.stats().runtimeDomMutationCount,
          presentationScale: debug.stats().presentationScale,
        };
      }, expected));
    }

    const expansionFits = [];
    for (const tick of [0, 49, 149]) {
      await page.evaluate((value) => globalThis.__cssFlowerDebug.setTick(value), tick);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const path = join(smokeDir, `expansion-tick-${tick}.png`);
      const bytes = await page.locator("body").screenshot({ path });
      expansionFits.push({ tick, path, visibility: imageVisibility(bytes) });
    }
    await page.evaluate(() => globalThis.__cssFlowerDebug.setTick(40));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshotBytes = await page.locator("body").screenshot({ path: screenshotPath });
    const state = {
      schema: "cssgraphics-flowerbox-browser-smoke@2",
      deploy,
      ...proof,
      loading,
      loadingAfterReady,
      pageErrors,
      visibility: imageVisibility(screenshotBytes),
      expansionFits,
      responsiveFits,
      lightingGridRequestCount: lightingGridRequests.length,
      lightingGridRequestUrlCount: new Set(lightingGridRequests).size,
      screenshotPath,
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    assertProof(state);
    console.log(JSON.stringify({ ...state, smokeDir, statePath }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function assertProof(state) {
  const stats = state.stats;
  if (state.loading.bodyChildCount !== 1 || state.loading.bodyAttributeNames.length !== 0 ||
      state.loading.content !== '\"\"' || state.loading.position !== "fixed" ||
      state.loading.width !== "18px" || state.loading.height !== "18px" ||
      state.loading.animationName !== "l" || state.loading.animationDuration !== "0.8s" ||
      state.loadingAfterReady.bodyAttributeNames.join(",") !== "class" ||
      state.loadingAfterReady.bodyClassName !== "r" || state.loadingAfterReady.content !== "none" ||
      state.loadingAfterReady.animationName !== "none" ||
      state.status !== "ready" || state.errors.length !== 0 || state.pageErrors.length !== 0 ||
      state.meshCount !== 1 || state.retainedRootCount !== 1 || state.retainedLeafCount !== 1200 ||
      state.triangleIdCount !== 1200 || state.polycssStableTriangleCount !== 1200 || state.rasterAtlasLeafCount !== 1200 ||
      state.rasterLeafWidths.length < 2 || state.rasterLeafHeights.length < 2 ||
      state.retainedLeafTags.length !== 1 || state.retainedLeafTags[0] !== "U" ||
      state.bodyChildCount !== 2 || state.bodyElementCount !== 1211 ||
      state.bodyAttributeNames.join(",") !== "class" || state.bodyClassName !== "r" ||
      state.dataAttributeCount !== 0 ||
      state.customClassCount !== 1200 || state.customClassUniqueCount !== 1200 ||
      state.customClassMaxLength !== 2 || state.customClassesValid !== true ||
      state.comparisonElementCount !== 1 || state.shellWordmarkText !== "css.graphics/flower" ||
      state.shellWordmarkHref !== "https://css.graphics/flower/" ||
      state.shellGithubText !== "GitHub" || state.shellGithubHref !== "https://github.com/layoutit/cssGraphics" ||
      state.shellStructure !== true || state.snapshotStyleCount !== 1 || state.preparedLeafRuleCount !== 1200 ||
      state.leafInlineTransformCount <= 0 || state.leafInlineTransformCount > 1200 ||
      state.leafInlinePreparedAddressPropertyCount <= 0 ||
      state.leafInlineVisibilityCount !== 1200 ||
      state.leafInlineUnexpectedPropertyCount !== 0 ||
      state.rootInlinePropertyNames.join(",") !== "--cssflower-space-texels,transform" ||
      state.cameraInlinePropertyCount !== 1 || state.cameraInlinePropertyNames.join(",") !== "scale" ||
      state.sceneInlinePropertyCount !== 0 ||
      state.meshInlinePropertyCount !== 0 || state.directStructure !== true ||
      state.canvasCount !== 0 || state.svgCount !== 0 ||
      state.leafTransformChangeCount < 1 || !state.rootTransformChanged ||
      !state.identityRows.every((row) => row.sameRoot && row.sameLeaves) ||
      stats.morphTarget !== "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget" ||
      stats.morphAdopted !== true || stats.morphStableDomIdentity !== true ||
      stats.retainedTriangleLeafCount !== 1200 || stats.retainedRotationRootCount !== 1 ||
      stats.runtimeDomMutationCount !== 0 || stats.runtimeDomGrowth !== false ||
      stats.runtimePolygonConstructionCount !== 0 || stats.runtimeGeometryConstructionCount !== 0 ||
      stats.runtimeRadialProjectionCount !== 0 || stats.runtimeNormalCalculationCount !== 0 ||
      stats.runtimeLightingCalculationCount !== 0 || stats.runtimeAtlasConstructionCount !== 0 ||
      stats.runtimeProjectionCalculationCount !== 0 || stats.runtimeRasterizationCount !== 0 ||
      stats.runtimeLeafTransformWrites <= 0 || stats.runtimePreparedGeometryStatePublishes <= 0 ||
      stats.runtimeSelectedLeafTransformAttempts + stats.runtimeVisibilityCatchupTransformAttempts <
        stats.runtimeLeafTransformWrites ||
      stats.runtimeVisibilityCatchupTransformAttempts < 1 ||
      stats.runtimeVisibilityCatchupTransformWrites < 1 ||
      stats.runtimeVisibilityCatchupTransformWrites > stats.runtimeVisibilityCatchupTransformAttempts ||
      stats.runtimeLeafTransformSelectionTests <= stats.runtimeLeafTransformWrites ||
      stats.runtimeLeafTransformSelectionTests !==
        stats.runtimeSelectedLeafTransformAttempts + stats.runtimeSuppressedLeafTransformWrites ||
      stats.runtimeSuppressedLeafTransformWrites <= 0 || stats.runtimeLeafVisibilityWrites <= 0 ||
      stats.runtimePreparedFrontFacingStateSelections <= 0 || stats.preparedFrontFacingDilationTicks !== 1 ||
      stats.preparedFrontFacingSelectedFaceCount !== 166886 ||
      stats.preparedFrontFacingVisibilityChangeCount !== 8310 ||
      stats.preparedVisibilitySelectionDomain !== "prepared-source-camera-depth16-owned-pixel-occlusion" ||
      stats.preparedVisibilityMinimumOwnedPixels !== 8 ||
      stats.preparedVisibilitySampleGrid !== 1 || stats.preparedVisibilityAdjacencyRings !== 0 ||
      stats.currentFrontFacingLeafCount < 1 || stats.currentFrontFacingLeafCount > 1200 ||
      stats.runtimeLightingAtlasWrites !== 0 || stats.runtimeLightingColumnWrites !== 0 || stats.runtimeLightingRowWrites !== 0 ||
      stats.runtimePreparedLightingAddressWrites <= 0 || stats.runtimePreparedLightingStateSelections <= 0 ||
      stats.runtimeDirectLeafCssTextWrites !== 0 || stats.runtimeProjectedAtlasWrites !== 0 ||
      stats.runtimeProjectedFrameWrites !== 0 || stats.runtimePreparedPageLayoutAdoptions !== 0 ||
      stats.runtimePreparedPageBoundaryLeafStyleWrites !== 0 ||
      stats.transformBlockLoader?.residentBlockCount !== stats.preparedTransformBlockCount ||
      stats.transformBlockLoader?.loadCount !== stats.preparedTransformBlockCount ||
      stats.transformBlockLoader?.releaseCount !== 0 || stats.transformBlockLoader?.errors?.length !== 0 ||
      stats.lightingPageLoader?.schema !== "cssflower-prepared-lighting-grid-loader@1" ||
      stats.lightingPageLoader?.residentGridCount !== 1 || stats.lightingPageLoader?.loadCount !== 1 ||
      stats.lightingPageLoader?.errors?.length !== 0 ||
      state.lightingGridRequestCount !== 1 || state.lightingGridRequestUrlCount !== 1 ||
      stats.stagePresentation !== "responsive" || stats.preparedStageEdgePixels !== 720 ||
      stats.runtimeModelGeometryCalculations !== 0 || Math.abs(stats.presentationScale - 1.25) > 1e-8 ||
      stats.responsivePresentationFit !== "contain" || stats.responsivePresentationStageFraction !== 1 ||
      stats.runtimePresentationScaleWrites < 1 ||
      state.bodyRect.width !== 960 || state.bodyRect.height !== 900 ||
      Math.abs(state.cameraRect.width - 900) > 0.01 || Math.abs(state.cameraRect.height - 900) > 0.01 ||
      Math.abs(state.cameraRect.x - 30) > 0.01 || Math.abs(state.cameraRect.y) > 0.01 ||
      state.responsiveFits.length !== 4 || !state.responsiveFits.every(responsiveFitMatches) ||
      state.expansionFits.length !== 3 || !state.expansionFits.every((entry) =>
        entry.visibility.chromaticPixelCount > 1000 && Math.min(...entry.visibility.chromaticMargins) >= 40) ||
      stats.runtimeShapeTransformWrites !== 0 || stats.polycss?.surfaceLeafCounts?.stableTriangle !== 1200 ||
      state.visibility.nonBlackPixelCount < 1000 || state.visibility.chromaticPixelCount < 1000) {
    throw new Error(`cssFlower browser proof failed:\n${JSON.stringify(state, null, 2)}`);
  }
  const row = (tick) => state.identityRows.find((entry) => entry.tick === tick);
  if (row(48).sfiHex !== "3d4ccccd" || row(49).sfiHex !== "bd4ccccd" ||
      row(149).sfiHex !== "3d4ccccd" || row(179).sfiHex !== "3d4ccccd" ||
      row(45).geometryStateIndex !== 45 || row(48).geometryStateIndex !== 48 ||
      row(49).geometryStateIndex !== 49 || row(50).geometryStateIndex !== 48 ||
      row(149).geometryStateIndex !== 72 || row(179).geometryStateIndex !== 50 ||
      row(180).geometryStateIndex !== 0 || row(359).geometryStateIndex !== 50 ||
      !state.identityRows.every((entry) => entry.preparedAssetMappingMatches) ||
      row(359).timelineStateIndex !== 359 || row(360).timelineStateIndex !== 0 ||
      row(361).timelineStateIndex !== 1 || row(49).rotation[0] - row(48).rotation[0] !== 3 ||
      row(49).rotation[1] - row(48).rotation[1] !== 2) {
    throw new Error(`cssFlower rounded product update/reversal proof failed:\n${JSON.stringify(state.identityRows, null, 2)}`);
  }
}

function responsiveFitMatches(entry) {
  const fittedEdge = Math.min(entry.width, entry.height);
  return Math.abs(entry.bodyRect.width - entry.width) < 0.01 &&
    Math.abs(entry.bodyRect.height - entry.height) < 0.01 &&
    Math.abs(entry.cameraRect.width - fittedEdge) < 0.02 &&
    Math.abs(entry.cameraRect.height - fittedEdge) < 0.02 &&
    Math.abs(entry.cameraRect.x - (entry.width - fittedEdge) / 2) < 0.02 &&
    Math.abs(entry.cameraRect.y - (entry.height - fittedEdge) / 2) < 0.02 &&
    Math.abs(entry.presentationScale - entry.scale) < 1e-7 &&
    entry.retainedLeafCount === 1200 && entry.runtimeDomMutationCount === 0;
}

function imageVisibility(bytes) {
  const png = PNG.sync.read(bytes);
  let nonBlackPixelCount = 0;
  let chromaticPixelCount = 0;
  let minimumX = png.width;
  let minimumY = png.height;
  let maximumX = -1;
  let maximumY = -1;
  let chromaticMinimumX = png.width;
  let chromaticMinimumY = png.height;
  let chromaticMaximumX = -1;
  let chromaticMaximumY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const a = png.data[offset + 3];
      if (a > 0 && Math.max(r, g, b) > 16) {
        nonBlackPixelCount += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
      if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 18 && Math.max(r, g, b) > 30) {
        chromaticPixelCount += 1;
        chromaticMinimumX = Math.min(chromaticMinimumX, x);
        chromaticMinimumY = Math.min(chromaticMinimumY, y);
        chromaticMaximumX = Math.max(chromaticMaximumX, x);
        chromaticMaximumY = Math.max(chromaticMaximumY, y);
      }
    }
  }
  return {
    width: png.width,
    height: png.height,
    nonBlackPixelCount,
    chromaticPixelCount,
    bounds: [minimumX, minimumY, maximumX, maximumY],
    margins: [minimumX, minimumY, png.width - 1 - maximumX, png.height - 1 - maximumY],
    chromaticBounds: [chromaticMinimumX, chromaticMinimumY, chromaticMaximumX, chromaticMaximumY],
    chromaticMargins: [
      chromaticMinimumX,
      chromaticMinimumY,
      png.width - 1 - chromaticMaximumX,
      png.height - 1 - chromaticMaximumY,
    ],
  };
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMs, onPoll = () => undefined) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
