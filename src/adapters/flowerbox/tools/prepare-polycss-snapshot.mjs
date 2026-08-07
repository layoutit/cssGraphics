#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const sceneId = args.scene ?? "default-cube";
const sceneUrl = "/cssflower/scenes/" + sceneId + ".json";
const generatedRoot = join("build", "generated", "public", "cssflower");
const manifestPath = join(generatedRoot, "manifest.json");
const snapshotPath = join(generatedRoot, "scenes", sceneId + ".polycss.html");
const snapshotUrl = "/cssflower/scenes/" + sceneId + ".polycss.html";
const temporaryLightingSeedPath = join(generatedRoot, "assets", "flower-box-space-texels.png");
const port = await freePort();
let output = "";
const server = spawn("pnpm", [
  "exec", "vite", "--config", "src/adapters/flowerbox/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], {
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitFor(() => output.includes("Local:") || output.includes("http://127.0.0.1:" + port), 20_000, () => {
    if (server.exitCode !== null) throw new Error("Vite exited early:\n" + output);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:" + port + "/tools/polycss-snapshot-page.html?sceneUrl=" + encodeURIComponent(sceneUrl), { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const status = window.__cssFlowerDebugSnapshot?.status;
      return status === "ready" || status === "error";
    }, null, { timeout: 60_000 });
    const snapshot = await page.evaluate(() => window.__cssFlowerDebugSnapshot);
    if (snapshot?.status === "error") {
      throw new Error("Snapshot page failed:\n" + snapshot.error);
    }
    if (typeof snapshot.html !== "string" || !snapshot.html.includes("polycss-scene") || snapshot.html.includes("<script")) {
      throw new Error("Snapshot failed sanity checks.");
    }
    const snapshotBytes = Buffer.from(snapshot.html + "\n");
    const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
    await writeAtomic(snapshotPath, snapshotBytes);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const manifestScene = manifest.scenes?.find((entry) => entry.id === sceneId);
    if (!manifestScene) throw new Error(`Manifest scene ${sceneId} is missing`);
    const snapshotContract = {
      schema: "cssflower-retained-snapshot-contract@1",
      url: snapshotUrl,
      sha256: snapshotSha256,
      byteLength: snapshotBytes.length,
      retainedTriangleLeafCount: snapshot.retainedLeafCount,
      retainedRotationRootCount: snapshot.retainedRotationRootCount,
      triangleIdCount: snapshot.triangleIdCount,
      seamBleed: snapshot.seamBleed,
      boundarySeamBleed: snapshot.boundarySeamBleed,
      boundaryAdjacentTriangleCount: snapshot.boundaryAdjacentTriangleCount,
      mergedCellCount: snapshot.mergedCellCount,
      lightingAtlasStateCount: snapshot.lightingAtlasStateCount,
      lightingAtlasDataUrlCount: snapshot.lightingAtlasDataUrlCount,
      preparedAtlasReferenceCount: snapshot.preparedAtlasReferenceCount,
      lightingAtlasSelfContained: false,
      scriptCount: snapshot.scriptCount,
      canvasCount: snapshot.canvasCount,
      svgCount: snapshot.svgCount,
      surfaceLeafCounts: snapshot.stats.surfaceLeafCounts,
    };
    manifestScene.snapshot = snapshotContract;
    manifest.assets = { ...manifest.assets, snapshot: snapshotContract };
    await writeAtomic(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
    await unlink(temporaryLightingSeedPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    console.log(JSON.stringify({ snapshotPath, snapshotUrl, ...snapshotContract }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
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

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
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
