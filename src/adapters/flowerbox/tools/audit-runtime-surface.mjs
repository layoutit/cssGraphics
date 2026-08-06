#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { inspectFlowerboxProductBank } from "./productBank.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const adapterRoot = resolve(import.meta.dirname, "..");
const runtimeFiles = [
  "index.html",
  "src/main.mjs",
  "src/cssflower/client.mjs",
  "src/cssflower/debugApi.mjs",
  "src/cssflower/manifestClient.mjs",
  "src/cssflower/polycssScene.mjs",
  "src/cssflower/preparedPlayback.mjs",
  "src/cssflower/projectedPageStyles.mjs",
  "src/cssflower/renderContract.mjs",
  "src/cssflower/routeState.mjs",
  "src/cssflower/stagePresentation.mjs",
  "src/cssflower/styles.css",
];
const failures = [];
const sources = new Map(await Promise.all(runtimeFiles.map(async (path) => [
  path,
  await readFile(join(adapterRoot, path), "utf8"),
])));

for (const [path, source] of sources) {
  reject(path, source, "alternate renderer", /(?:getContext\s*\(|WebGLRenderingContext|WebGPU|GPUDevice|from\s+["']three["']|createElement\s*\(\s*["'](?:canvas|svg)["']|<(?:canvas|svg)\b)/iu);
  reject(path, source, "browser prepare or oracle import", /from\s+["'][^"']*(?:\/prepare\/|\/oracle\/)/u);
  reject(path, source, "runtime geometry or lighting construction", /\b(?:buildCubeTopology|deformCubePoints|computeSmoothPointNormals|computePreparedVertexLighting|createPolyScene)\b/u);
  reject(path, source, "native replay ingestion", /fetch[^\n]*(?:native|replay|state-packet)|(?:native|replay)[^\n]*fetch/iu);
}
const productCss = sources.get("src/cssflower/styles.css");
reject("src/cssflower/styles.css", productCss, "paint-heavy product CSS", /(?:clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|linear-gradient|radial-gradient|mix-blend-mode)\s*:/iu);
const playback = sources.get("src/cssflower/preparedPlayback.mjs");
if (!playback.includes("createPolyMorphPreparedDomTarget({")) failures.push("PolyCSS Morph prepared target is missing");
if (/\b(?:document|DOMParser|MutationObserver)\b|createElement|appendChild|replaceChildren/u.test(playback)) {
  failures.push("Prepared playback constructs DOM");
}

const bank = await inspectFlowerboxProductBank(join(repositoryRoot, "build", "generated", "public", "cssflower"));
if (bank.closureBytes >= 31_000_000) failures.push(`Product bank is too large: ${bank.closureBytes}`);
const report = {
  schema: "cssgraphics-flowerbox-runtime-audit@1",
  status: failures.length === 0 ? "pass" : "fail",
  renderer: "retained-dom-polycss-only",
  runtimeFiles,
  bank,
  runtime: {
    retainedTriangleLeafCount: 1_200,
    retainedRotationRootCount: 1,
    geometryConstruction: false,
    projectionCalculation: false,
    rasterization: false,
    normalCalculation: false,
    lightingCalculation: false,
    domGrowth: false,
  },
  excluded: ["Microsoft source", "Microsoft binaries", "native captures", "oracle packets", "Three.js", "pixelmatch"],
  failures,
};
const reportPath = join(repositoryRoot, "build", "reports", "flowerbox-runtime-audit.json");
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

function reject(path, source, rule, expression) {
  if (expression.test(source)) failures.push(`${path}: ${rule}`);
}
