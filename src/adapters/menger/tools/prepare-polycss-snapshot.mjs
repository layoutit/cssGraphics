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
  preparedMengerSparseLightingAtlasBytes,
} from "../src/prepare/cssmenger/sparseLightingAtlas.mjs";

const sceneId = "depth-3";
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
    const sparseLightingAtlas = await prepareSparseLightingAtlas(snapshot.frontFacingSchedule);
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, bindFinalAtlasDimensions(snapshot.html, sparseLightingAtlas));
    await rm(join(dirname(snapshotPath), `${sceneId}.polycss.html`), { force: true });
    await publishRuntimeScene(snapshot.frontFacingSchedule, sparseLightingAtlas);
    console.log(JSON.stringify({
      snapshotPath,
      snapshotUrl,
      mountedLeaves: snapshot.mountedLeaves,
      stats: snapshot.stats,
      sparseLightingAtlas: {
        assetUrl: sparseLightingAtlas.assetUrl,
        byteLength: sparseLightingAtlas.byteLength,
        decodedBytes: sparseLightingAtlas.decodedBytes,
        slotCount: sparseLightingAtlas.slotCount,
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

function bindFinalAtlasDimensions(html, atlas) {
  if (typeof html !== "string" || (html.match(/<\/style>/gu) ?? []).length !== 1 ||
      !Number.isSafeInteger(atlas?.width) || !Number.isSafeInteger(atlas?.height) ||
      !/^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(atlas.assetUrl)) {
    throw new Error("Prepared cssMenger snapshot cannot bind final atlas dimensions");
  }
  return html.replace(
    "</style>",
    `.polycss-scene{--cssmenger-atlas-width:${atlas.width}px;` +
      `--cssmenger-atlas-height:${atlas.height}px}` +
      `body>.polycss-camera>.polycss-scene>b{background-image:url("${atlas.assetUrl}")}</style>`,
  );
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

async function prepareSparseLightingAtlas(frontFacingSchedule) {
  const scene = JSON.parse(await readFile(privateScenePath, "utf8"));
  const initialColorRow = scene.playback.colorRows[scene.playback.initial.stateIndex];
  const geometry = buildMengerPreparedGeometry({
    depth: scene.sourceProfile.depth,
    axisColors: initialColorRow.map((index) => scene.playback.palette[index].material),
  });
  const contract = await buildPreparedMengerSparseLightingAtlas({
    geometry,
    playback: scene.playback,
    frontFacingSchedule,
  });
  const bytes = preparedMengerSparseLightingAtlasBytes(contract);
  if (!bytes || bytes.length !== contract.byteLength) {
    throw new Error("Prepared cssMenger sparse lighting atlas bytes are unavailable");
  }
  const assetPath = join(generatedPublicRoot, contract.assetUrl.replace(/^\/cssmenger\//u, ""));
  await mkdir(dirname(assetPath), { recursive: true });
  const temporary = `${assetPath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, assetPath);
  return contract;
}

async function publishRuntimeScene(frontFacingSchedule, sparseLightingAtlas) {
  const scene = JSON.parse(await readFile(privateScenePath, "utf8"));
  if (frontFacingSchedule?.schema !== "cssmenger-prepared-front-facing-leaf-schedule@1" ||
      frontFacingSchedule.stateCount !== scene.playback?.stateCount ||
      frontFacingSchedule.offsets?.length !== scene.playback.stateCount * 3 + 1 ||
      frontFacingSchedule.offsets.at(-1) !== frontFacingSchedule.leafIndices?.length) {
    throw new Error("Prepared cssMenger front-facing schedule is invalid");
  }
  if (sparseLightingAtlas?.schema !== "cssmenger-prepared-sparse-leaf-lighting-atlas@1" ||
      sparseLightingAtlas.visibleLeafFieldCount !== frontFacingSchedule.leafIndices.length ||
      sparseLightingAtlas.slotCount > sparseLightingAtlas.visibleLeafFieldCount ||
      sparseLightingAtlas.sourceStateCount !== scene.playback.stateCount) {
    throw new Error("Prepared cssMenger sparse lighting atlas is invalid");
  }
  const intermediateAtlas = scene.planeAtlas;
  const runtimeScene = {
    ...scene,
    playback: { ...scene.playback, frontFacingSchedule },
    planeAtlas: sparseLightingAtlas,
    metrics: {
      ...scene.metrics,
      preparedPlaneAtlasWidth: sparseLightingAtlas.width,
      preparedPlaneAtlasHeight: sparseLightingAtlas.height,
      preparedPlaneAtlasDecodedBytes: sparseLightingAtlas.decodedBytes,
      preparedPlaneAtlasTotalEncodedBytes: sparseLightingAtlas.byteLength,
      atlasPageCount: 1,
      preparedRenderWrapperCount: 2,
      preparedModelRootCount: 0,
      preparedAxisRootCount: 0,
      preparedFrontFacingLeafCountPerState: Object.freeze({
        minimum: frontFacingSchedule.minimumSelectedLeafCountPerState,
        maximum: frontFacingSchedule.maximumSelectedLeafCountPerState,
        average: frontFacingSchedule.averageSelectedLeafCountPerState,
      }),
      preparedVisibleLightingFieldCount: sparseLightingAtlas.visibleLeafFieldCount,
      preparedOmittedBackFacingLightingFieldCount: sparseLightingAtlas.omittedBackFacingLeafFieldCount,
      preparedLightingAddressUpdateCount: sparseLightingAtlas.addressUpdateCount,
      preparedRedundantLightingAddressWriteCountRemoved:
        sparseLightingAtlas.redundantAddressWriteCountRemoved,
    },
    renderer: {
      ...scene.renderer,
      representation: "retained-coplanar-plane-leaves-with-one-sparse-prepared-source-cell-lighting-grid",
      runtimeGeometryPayload: false,
      runtimeLightingCalculation: false,
    },
    oracle: {
      ...scene.oracle,
      browserVisualCapture: "qualified-local-bit-exact-aa-common-prefix-0-45",
      visualComparison: "exact-first-common-prefix-diverged",
    },
    warnings: [
      "The first product slice fixes source depth at 3; the XScreenSaver depth-change sequence remains outside this slice.",
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
