#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import {
  adapterRoot,
  generatedPublicRoot,
  generatedRoot,
  repositoryRoot,
} from "../src/prepare/cssgears/paths.mjs";

const args = parseArgs(process.argv.slice(2));
const manifestPath = join(generatedPublicRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await removeStaleShowreelSnapshots(manifest);
const sceneIds = args.scene
  ? [args.scene]
  : manifest.scenes?.map((scene) => scene.id) ?? [];
if (sceneIds.length === 0 || sceneIds.some((sceneId) => typeof sceneId !== "string" || !sceneId)) {
  throw new Error("Prepared cssGears manifest has no snapshot scenes");
}
for (const sceneId of sceneIds) await stagePreparedScene(sceneId);
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
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
    const snapshots = [];
    for (const sceneId of sceneIds) {
      const paths = scenePaths(sceneId);
      const sourceSceneUrl = "/@fs/" + resolve(paths.preparedScenePath);
      await page.goto("http://127.0.0.1:" + port + "/tools/polycss-snapshot-page.html?sceneUrl=" + encodeURIComponent(paths.sceneUrl) + "&sourceSceneUrl=" + encodeURIComponent(sourceSceneUrl), { waitUntil: "networkidle" });
      await page.waitForFunction(() => ["ready", "error"].includes(window.__cssGearsSnapshot?.status), null, { timeout: 60_000 });
      const snapshot = await page.evaluate(() => window.__cssGearsSnapshot);
      if (snapshot.status === "error") throw new Error(snapshot.error);
      if (typeof snapshot.html !== "string" || !snapshot.html.includes("polycss-scene") || snapshot.html.includes("<script")) {
        throw new Error(`Snapshot ${sceneId} failed sanity checks.`);
      }
      await mkdir(dirname(paths.snapshotPath), { recursive: true });
      await writeFile(paths.snapshotPath, snapshot.html + "\n");
      await publishRuntimeScene(sceneId, snapshot.foldedTransforms, snapshot.foldedShowreelTransforms);
      snapshots.push({ sceneId, snapshotPath: paths.snapshotPath, snapshotUrl: paths.snapshotUrl });
    }
    const showreelSnapshot = await buildShowreelBankSnapshot(page, manifest);
    await publishCompressedRuntimeAssets(sceneIds);
    console.log(JSON.stringify({ snapshots, showreelSnapshot }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function publishRuntimeScene(sceneId, foldedTransforms, foldedShowreelTransforms) {
  const paths = scenePaths(sceneId);
  const scenePath = paths.runtimeScenePath;
  const scene = JSON.parse(await readFile(paths.preparedScenePath, "utf8"));
  if (!Array.isArray(scene.meshes) || scene.meshes.length !== scene.metrics.preparedGearRootCount) {
    throw new Error("Prepared cssGears source scene is missing its gear meshes");
  }
  if (!Array.isArray(foldedTransforms) || foldedTransforms.length !== scene.playback.transforms.length ||
      foldedTransforms.some((transform) => typeof transform !== "string" || !transform.startsWith("matrix3d("))) {
    throw new Error("Prepared cssGears folded gear transforms are incomplete");
  }
  if (!Array.isArray(foldedShowreelTransforms) ||
      foldedShowreelTransforms.length !== scene.showreel?.transforms?.length ||
      foldedShowreelTransforms.some((transform) => typeof transform !== "string" || !transform.startsWith("matrix3d("))) {
    throw new Error("Prepared cssGears folded showreel transforms are incomplete");
  }
  const sourceTheta = scene.playback.transforms.map((transform) => {
    const match = /rotateZ\(([-+0-9.eE]+)deg\)$/u.exec(transform);
    if (!match) throw new Error(`Prepared cssGears source transform has no theta: ${transform}`);
    return Number(match[1]);
  });
  const runtimeScene = {
    ...scene,
    playback: { ...scene.playback, transforms: foldedTransforms, sourceTheta },
    showreel: { ...scene.showreel, transforms: foldedShowreelTransforms },
    renderer: { ...scene.renderer, runtimeGeometryPayload: false },
    meshDescriptors: scene.meshes.map((mesh) => ({
      id: mesh.id,
      gearIndex: mesh.gearIndex,
      sourceId: mesh.sourceId,
      polygonCount: mesh.polygons.length,
      sourceGear: mesh.sourceGear,
    })),
  };
  delete runtimeScene.meshes;
  const temporary = `${scenePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(runtimeScene, null, 2)}\n`);
  await rename(temporary, scenePath);
}

async function buildShowreelBankSnapshot(page, preparedManifest) {
  const showreel = preparedManifest.showreel;
  if (!showreel?.enabledOnRootRoute) return null;
  const tokens = showreel.sceneTokens ?? [];
  if (typeof showreel.snapshotUrl !== "string" || tokens.length !== preparedManifest.scenes.length ||
      tokens.some(({ sceneId, token }, index) =>
        sceneId !== preparedManifest.scenes[index]?.id || !/^[a-z]$/u.test(token) || token === "d" || token === "g")) {
    throw new Error("Prepared cssGears showreel bank is incomplete");
  }
  const banks = await Promise.all(tokens.map(async ({ sceneId, token }) => {
    const [html, scene] = await Promise.all([
      readFile(scenePaths(sceneId).snapshotPath, "utf8"),
      readFile(scenePaths(sceneId).runtimeScenePath, "utf8").then(JSON.parse),
    ]);
    return { html, lighting: scene.lighting, token };
  }));
  const html = await page.evaluate((preparedBanks) => {
    const documents = preparedBanks.map(({ html }) => new DOMParser().parseFromString(html, "text/html"));
    const target = documents[0];
    const style = target.querySelector("style");
    const targetRoot = target.querySelector(".polycss-scene");
    const targetGears = [...(targetRoot?.querySelectorAll(":scope > .g") ?? [])];
    if (!(style instanceof HTMLStyleElement) || !(targetRoot instanceof HTMLElement) || targetGears.length !== 3) {
      throw new Error("Prepared cssGears showreel target is incomplete");
    }
    for (let bankIndex = 0; bankIndex < preparedBanks.length; bankIndex += 1) {
      const token = preparedBanks[bankIndex].token;
      const root = documents[bankIndex].querySelector(".polycss-scene");
      const gears = [...(root?.querySelectorAll(":scope > .g") ?? [])];
      if (!(root instanceof HTMLElement) || gears.length !== 3) {
        throw new Error(`Prepared cssGears showreel bank ${bankIndex} is incomplete`);
      }
      for (let gearIndex = 0; gearIndex < 3; gearIndex += 1) {
        if (bankIndex === 0) {
          targetGears[gearIndex].className = `g ${token}`;
          for (const leaf of targetGears[gearIndex].querySelectorAll(":scope > b")) leaf.className = token;
          continue;
        }
        for (const leaf of gears[gearIndex].querySelectorAll(":scope > b")) {
          const imported = target.importNode(leaf, true);
          imported.className = token;
          targetGears[gearIndex].append(imported);
        }
      }
    }
    style.textContent += `.g>b{display:none}` + preparedBanks
      .map(({ token }) => `.g.${token}>b.${token}`)
      .join(",") + `{display:block}` + preparedBanks
      .map(({ token, lighting }) =>
        `.g>b.${token}{background-image:url("${lighting.assetUrl}");background-size:${lighting.backgroundSize}}`)
      .join("");
    return `<!doctype html>${target.documentElement.outerHTML}\n`;
  }, banks);
  if ((html.match(/class="g a"/gu) ?? []).length !== 3 ||
      (html.match(/<b\b/gu) ?? []).length !== showreel.retainedLeafCount ||
      /\sdata-[\w-]+=/iu.test(html) || /<script\b|<canvas\b|<svg\b/iu.test(html)) {
    throw new Error("Prepared cssGears showreel bank failed its lean-DOM contract");
  }
  const snapshotPath = join(generatedRoot, "public", showreel.snapshotUrl.replace(/^\//u, ""));
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, gzipSync(Buffer.from(html), { level: 9 }));
  return { snapshotPath, snapshotUrl: showreel.snapshotUrl };
}

async function publishCompressedRuntimeAssets(sceneIds) {
  for (const sceneId of sceneIds) {
    const paths = scenePaths(sceneId);
    const [sceneBytes, snapshotBytes] = await Promise.all([
      readFile(paths.runtimeScenePath),
      readFile(paths.snapshotPath),
    ]);
    await Promise.all([
      writeFile(paths.compressedRuntimeScenePath, gzipSync(sceneBytes, { level: 9 })),
      writeFile(paths.compressedSnapshotPath, gzipSync(snapshotBytes, { level: 9 })),
    ]);
    await Promise.all([
      unlink(paths.runtimeScenePath),
      unlink(paths.snapshotPath),
    ]);
  }
}

async function removeStaleShowreelSnapshots(preparedManifest) {
  const scenesDirectory = join(generatedPublicRoot, "scenes");
  const expected = new Set([preparedManifest.showreel?.snapshotUrl]
    .filter(Boolean)
    .map((url) => url.replace(/^\/cssgears\/scenes\//u, "")));
  for (const name of await readdir(scenesDirectory)) {
    if ((name.endsWith(".showreel.polycss.html") || name.endsWith(".showreel.polycss.html.gz")) &&
        !expected.has(name)) {
      await unlink(join(scenesDirectory, name));
    }
  }
}

async function stagePreparedScene(sceneId) {
  const paths = scenePaths(sceneId);
  const scene = JSON.parse(await readFile(paths.runtimeScenePath, "utf8"));
  if (Array.isArray(scene.meshes)) {
    await mkdir(dirname(paths.preparedScenePath), { recursive: true });
    await writeFile(paths.preparedScenePath, `${JSON.stringify(scene, null, 2)}\n`);
    return;
  }
  try {
    const prepared = JSON.parse(await readFile(paths.preparedScenePath, "utf8"));
    if (!Array.isArray(prepared.meshes)) throw new Error("missing meshes");
  } catch {
    throw new Error("Prepared cssGears geometry is missing. Run pnpm prepare:cssgears once to restore the private snapshot input.");
  }
}

function scenePaths(sceneId) {
  const sceneUrl = "/cssgears/scenes/" + sceneId + ".json";
  return Object.freeze({
    sceneUrl,
    snapshotPath: join(generatedPublicRoot, "scenes", sceneId + ".polycss.html"),
    snapshotUrl: "/cssgears/scenes/" + sceneId + ".polycss.html.gz",
    compressedSnapshotPath: join(generatedPublicRoot, "scenes", sceneId + ".polycss.html.gz"),
    runtimeScenePath: join(generatedRoot, "public", sceneUrl.replace(/^\//, "")),
    compressedRuntimeScenePath: join(generatedPublicRoot, "scenes", sceneId + ".json.gz"),
    preparedScenePath: join(generatedRoot, "private", "cssgears", "scenes", sceneId + ".prepared.json"),
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
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
