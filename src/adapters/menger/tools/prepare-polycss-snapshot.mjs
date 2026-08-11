#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import {
  adapterRoot,
  generatedPrivateRoot,
  generatedPublicRoot,
  manifestPath,
  repositoryRoot,
} from "../src/prepare/cssmenger/paths.mjs";
import { buildMengerPreparedGeometry } from "../src/prepare/cssmenger/mengerGeometry.mjs";
import {
  buildPreparedMengerSparseLightingAtlas,
  DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS,
  MOBILE_LIGHTING_SAMPLE_INTERVAL_TICKS,
  preparedMengerSparseLightingAtlasBytes,
} from "../src/prepare/cssmenger/sparseLightingAtlas.mjs";

const sceneId = sceneIdFromArgs(process.argv.slice(2));
const sceneUrl = `/cssmenger/scenes/${sceneId}.json`;
const scenePath = join(generatedPublicRoot, "scenes", `${sceneId}.json`);
const privateScenePath = join(generatedPrivateRoot, "scenes", `${sceneId}.prepared.json`);
const snapshotPath = join(generatedPublicRoot, "scenes", `${sceneId}.polycss.txt`);
const snapshotUrl = `/cssmenger/scenes/${sceneId}.polycss.txt`;
await stagePreparedScene();
const port = await freePort();
let output = "";
const server = spawn("pnpm", ["exec", "vite", "--config", join(adapterRoot, "vite.config.mjs"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repositoryRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/tools/polycss-snapshot-page.html?sceneUrl=${encodeURIComponent(sceneUrl)}`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => ["ready", "error"].includes(window.__cssMengerDebugSnapshot?.status),
      null,
      { timeout: 120_000 },
    );
    const snapshot = await page.evaluate(() => window.__cssMengerDebugSnapshot);
    if (snapshot.status !== "ready") throw new Error(snapshot.error || "cssMenger snapshot failed");
    const { desktopAtlas, mobileAtlas } = await prepareSparseLightingAtlases(snapshot.frontFacingSchedule);
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, bindFinalAtlasDimensions(snapshot.html, desktopAtlas, mobileAtlas));
    await rm(join(dirname(snapshotPath), `${sceneId}.polycss.html`), { force: true });
    await publishRuntimeScene(snapshot.frontFacingSchedule, desktopAtlas, mobileAtlas);
    console.log(JSON.stringify({
      snapshotPath,
      snapshotUrl,
      mountedLeaves: snapshot.mountedLeaves,
      stats: snapshot.stats,
      sparseLightingAtlases: {
        desktop: atlasSummary(desktopAtlas),
        mobile: atlasSummary(mobileAtlas),
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function bindFinalAtlasDimensions(html, desktopAtlas, mobileAtlas) {
  if (typeof html !== "string" || (html.match(/<\/style>/gu) ?? []).length !== 1 ||
      !validResponsiveAtlas(desktopAtlas, "desktop") || !validResponsiveAtlas(mobileAtlas, "mobile") ||
      desktopAtlas.slotWidth !== mobileAtlas.slotWidth || desktopAtlas.slotHeight !== mobileAtlas.slotHeight) {
    throw new Error("Prepared cssMenger snapshot cannot bind final atlas dimensions");
  }
  return html.replace(
    "</style>",
    `.polycss-scene{--cssmenger-atlas-width:${desktopAtlas.width}px;` +
      `--cssmenger-atlas-height:${desktopAtlas.height}px;` +
      `--cssmenger-tile-width:${desktopAtlas.tileWidth}px;` +
      `--cssmenger-tile-height:${desktopAtlas.tileHeight}px}` +
      `body>.polycss-camera>.polycss-scene>b{background-image:url("${desktopAtlas.assetUrl}")}` +
      `.polycss-scene.cssmenger-mobile-atlas{--cssmenger-atlas-width:${mobileAtlas.width}px;` +
      `--cssmenger-atlas-height:${mobileAtlas.height}px}` +
      `body>.polycss-camera>.polycss-scene.cssmenger-mobile-atlas>b{` +
      `background-image:url("${mobileAtlas.assetUrl}")}</style>`,
  );
}

function validResponsiveAtlas(atlas, profile) {
  const suffix = profile === "mobile" ? "-mobile" : "";
  return atlas?.profile === profile && Number.isSafeInteger(atlas.width) && Number.isSafeInteger(atlas.height) &&
    new RegExp(`^/cssmenger/assets/lighting-grid${suffix}-[a-f0-9]{64}\\.avif$`, "u").test(atlas.assetUrl);
}

function atlasSummary(atlas) {
  return {
    assetUrl: atlas.assetUrl,
    byteLength: atlas.byteLength,
    decodedBytes: atlas.decodedBytes,
    slotCount: atlas.slotCount,
    lightingSampleIntervalTicks: atlas.lightingSampleIntervalTicks,
  };
}

async function stagePreparedScene() {
  let scene = JSON.parse(await readFile(scenePath, "utf8"));
  if (!Array.isArray(scene.meshes)) {
    scene = JSON.parse(await readFile(privateScenePath, "utf8"));
    if (!Array.isArray(scene.meshes)) throw new Error("Private cssMenger prepared geometry is missing");
    await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
  }
  await mkdir(dirname(privateScenePath), { recursive: true });
  await writeFile(privateScenePath, `${JSON.stringify(scene, null, 2)}\n`);
}

async function prepareSparseLightingAtlases(frontFacingSchedule) {
  const scene = JSON.parse(await readFile(privateScenePath, "utf8"));
  const initialColorRow = scene.playback.colorRows[scene.playback.initial.stateIndex];
  const geometry = buildMengerPreparedGeometry({
    depth: scene.sourceProfile.depth,
    axisColors: initialColorRow.map((index) => scene.playback.palette[index].material),
  });
  const desktopAtlas = await buildPreparedMengerSparseLightingAtlas({
    geometry,
    playback: scene.playback,
    frontFacingSchedule,
    lightingSampleIntervalTicks: DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS,
    profile: "desktop",
  });
  const mobileAtlas = await buildPreparedMengerSparseLightingAtlas({
    geometry,
    playback: scene.playback,
    frontFacingSchedule,
    lightingSampleIntervalTicks: scene.sourceProfile.depth === 2
      ? DESKTOP_LIGHTING_SAMPLE_INTERVAL_TICKS
      : MOBILE_LIGHTING_SAMPLE_INTERVAL_TICKS,
    profile: "mobile",
  });
  for (const contract of [desktopAtlas, mobileAtlas]) {
    const bytes = preparedMengerSparseLightingAtlasBytes(contract);
    if (!bytes || bytes.length !== contract.byteLength) {
      throw new Error(`Prepared cssMenger ${contract.profile} lighting atlas bytes are unavailable`);
    }
    const assetPath = join(generatedPublicRoot, contract.assetUrl.replace(/^\/cssmenger\//u, ""));
    await mkdir(dirname(assetPath), { recursive: true });
    const temporary = `${assetPath}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, assetPath);
  }
  return { desktopAtlas, mobileAtlas };
}

async function publishRuntimeScene(frontFacingSchedule, desktopAtlas, mobileAtlas) {
  const scene = JSON.parse(await readFile(privateScenePath, "utf8"));
  if (frontFacingSchedule?.schema !== "cssmenger-prepared-front-facing-leaf-schedule@1" ||
      frontFacingSchedule.stateCount !== scene.playback?.stateCount ||
      frontFacingSchedule.offsets?.length !== scene.playback.stateCount * 3 + 1 ||
      frontFacingSchedule.offsets.at(-1) !== frontFacingSchedule.leafIndices?.length) {
    throw new Error("Prepared cssMenger front-facing schedule is invalid");
  }
  if (![desktopAtlas, mobileAtlas].every((atlas) =>
    atlas?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
    atlas.visibleLeafFieldCount === frontFacingSchedule.leafIndices.length &&
    atlas.slotCount <= atlas.visibleLeafFieldCount &&
    atlas.sourceStateCount === scene.playback.stateCount)) {
    throw new Error("Prepared cssMenger sparse lighting atlas is invalid");
  }
  const intermediateAtlas = scene.planeAtlas;
  const runtimeScene = {
    ...scene,
    playback: { ...scene.playback, frontFacingSchedule },
    planeAtlas: desktopAtlas,
    mobilePlaneAtlas: mobileAtlas,
    metrics: {
      ...scene.metrics,
      preparedPlaneAtlasWidth: desktopAtlas.width,
      preparedPlaneAtlasHeight: desktopAtlas.height,
      preparedPlaneAtlasDecodedBytes: desktopAtlas.decodedBytes,
      preparedPlaneAtlasTotalEncodedBytes: desktopAtlas.byteLength,
      preparedMobilePlaneAtlasWidth: mobileAtlas.width,
      preparedMobilePlaneAtlasHeight: mobileAtlas.height,
      preparedMobilePlaneAtlasDecodedBytes: mobileAtlas.decodedBytes,
      preparedMobilePlaneAtlasTotalEncodedBytes: mobileAtlas.byteLength,
      atlasPageCount: 2,
      preparedRenderWrapperCount: 2,
      preparedModelRootCount: 0,
      preparedAxisRootCount: 0,
      preparedFrontFacingLeafCountPerState: Object.freeze({
        minimum: frontFacingSchedule.minimumSelectedLeafCountPerState,
        maximum: frontFacingSchedule.maximumSelectedLeafCountPerState,
        average: frontFacingSchedule.averageSelectedLeafCountPerState,
      }),
      preparedVisibleLightingFieldCount: desktopAtlas.visibleLeafFieldCount,
      preparedOmittedBackFacingLightingFieldCount: desktopAtlas.omittedBackFacingLeafFieldCount,
      preparedLightingAddressUpdateCount: desktopAtlas.addressUpdateCount,
      preparedRedundantLightingAddressWriteCountRemoved:
        desktopAtlas.redundantAddressWriteCountRemoved,
      preparedMobileLightingAddressUpdateCount: mobileAtlas.addressUpdateCount,
      preparedMobileRedundantLightingAddressWriteCountRemoved:
        mobileAtlas.redundantAddressWriteCountRemoved,
    },
    renderer: {
      ...scene.renderer,
      representation: "retained-coplanar-plane-leaves-with-responsive-sparse-prepared-source-cell-lighting-grids",
      runtimeGeometryPayload: false,
      runtimeLightingCalculation: false,
    },
    oracle: {
      ...scene.oracle,
      browserVisualCapture: "qualified-local-bit-exact-aa-common-prefix-0-45",
      visualComparison: "exact-first-common-prefix-diverged",
    },
    warnings: [
      `This prepared product scene fixes source depth at ${scene.sourceProfile.depth}; the XScreenSaver depth-change sequence remains outside this slice.`,
      "The prepared source rotator segment wraps from its final state to its first state for endless playback.",
      "Wander and interactive trackball input are disabled in this first slice.",
      "Moving two-light RGB and palette colors are prepared off the runtime path into exact source-cell face tiles.",
      "Coplanar bundles preserve an exact one-to-one census of all source faces before merging.",
      "The fresh exact-first browser/native pixel comparison diverges for the deduplicated atlas; native visual parity remains unqualified.",
    ],
    meshDescriptors: scene.meshes.map((mesh) => ({
      id: mesh.id,
      axisGroup: mesh.axisGroup,
      sourceId: mesh.sourceId,
      polygonCount: mesh.polygons.length,
    })),
  };
  delete runtimeScene.meshes;
  const temporary = `${scenePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(runtimeScene, null, 2)}\n`);
  await rename(temporary, scenePath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = manifest.scenes?.find((candidate) => candidate.id === sceneId);
  if (!entry) throw new Error(`cssMenger manifest is missing ${sceneId}`);
  entry.metrics = runtimeScene.metrics;
  const manifestTemporary = `${manifestPath}.tmp`;
  await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(manifestTemporary, manifestPath);
  if (intermediateAtlas?.assetUrl) {
    await rm(join(generatedPublicRoot, intermediateAtlas.assetUrl.replace(/^\/cssmenger\//u, "")), { force: true });
  }
}

function sceneIdFromArgs(argv) {
  const sceneIndex = argv.indexOf("--scene");
  const value = sceneIndex >= 0 ? argv[sceneIndex + 1] : "depth-3";
  if (!["depth-2", "depth-3"].includes(value)) {
    throw new RangeError(`Unknown prepared cssMenger scene ${value}`);
  }
  return value;
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

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}
