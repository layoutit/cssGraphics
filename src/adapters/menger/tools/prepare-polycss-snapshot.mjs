#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import {
  adapterRoot,
  generatedPrivateRoot,
  generatedPublicRoot,
  repositoryRoot,
} from "../src/prepare/cssmenger/paths.mjs";

const sceneId = "depth-3";
const sceneUrl = `/cssmenger/scenes/${sceneId}.json`;
const scenePath = join(generatedPublicRoot, "scenes", `${sceneId}.json`);
const privateScenePath = join(generatedPrivateRoot, "scenes", `${sceneId}.prepared.json`);
const snapshotPath = join(generatedPublicRoot, "scenes", `${sceneId}.polycss.html`);
const snapshotUrl = `/cssmenger/scenes/${sceneId}.polycss.html`;
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
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, snapshot.html);
    await publishRuntimeScene();
    console.log(JSON.stringify({ snapshotPath, snapshotUrl, mountedLeaves: snapshot.mountedLeaves, stats: snapshot.stats }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
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

async function publishRuntimeScene() {
  const scene = JSON.parse(await readFile(privateScenePath, "utf8"));
  const runtimeScene = {
    ...scene,
    renderer: { ...scene.renderer, runtimeGeometryPayload: false },
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
