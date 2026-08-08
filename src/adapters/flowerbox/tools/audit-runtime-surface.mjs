#!/usr/bin/env node

import { existsSync } from "node:fs";
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
  "src/cssflower/preparedAssetLoaders.mjs",
  "src/cssflower/preparedPlayback.mjs",
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

const index = sources.get("index.html");
if (!/<body>\s*<header class="site-header">[\s\S]*<\/header>\s*<\/body>/u.test(index) ||
    !index.includes('class="site-wordmark" href="https://css.graphics/flower/"') ||
    !index.includes('class="site-actions" aria-label="Scene actions"') ||
    !index.includes('href="https://github.com/layoutit/cssGraphics"') ||
    /<(?:main|section|article|form|button|input|output|img|video|canvas|svg)\b/iu.test(index) ||
    /\bdata-[a-z0-9-]+=/iu.test(index)) {
  failures.push("index.html is not the branded direct-camera shell");
}
for (const [path, source] of sources) {
  reject(path, source, "alternate renderer", /(?:getContext\s*\(|WebGLRenderingContext|WebGPU|GPUDevice|from\s+["']three["']|createElement\s*\(\s*["'](?:canvas|svg)["']|<(?:canvas|svg)\b)/iu);
  reject(path, source, "browser prepare or oracle import", /from\s+["'][^"']*(?:\/prepare\/|\/oracle\/)/u);
  reject(path, source, "runtime geometry or lighting construction", /\b(?:buildCubeTopology|deformCubePoints|computeSmoothPointNormals|computePreparedVertexLighting|createPolyScene)\b/u);
  reject(path, source, "native replay ingestion", /fetch[^\n]*(?:native|replay|state-packet)|(?:native|replay)[^\n]*fetch/iu);
}
const productCss = sources.get("src/cssflower/styles.css");
reject("src/cssflower/styles.css", productCss, "paint-heavy product CSS", /(?:clip-path|mask(?:-image)?|filter|box-shadow|text-shadow|linear-gradient|radial-gradient|mix-blend-mode)\s*:/iu);
const playback = sources.get("src/cssflower/preparedPlayback.mjs");
if (!playback.includes("createPolyMorphPreparedDomTarget({") ||
    !playback.includes("morphTarget.leaves[leafIndex].writeTransform(transform)")) {
  failures.push("PolyCSS Morph prepared leaf target is missing");
}
if (/projectedPageStyles|applyPreparedProjectedLeafLayout|\.style\.cssText/u.test(playback)) {
  failures.push("Projected-page or direct leaf cssText path is present");
}
if (/\b(?:document|DOMParser|MutationObserver|Image)\b|createElement|appendChild|replaceChildren/u.test(playback)) {
  failures.push("Prepared playback constructs DOM");
}
if (existsSync(join(adapterRoot, "src/cssflower/projectedPageStyles.mjs"))) {
  failures.push("Projected-page runtime module remains");
}

const bank = await inspectFlowerboxProductBank(join(repositoryRoot, "build", "generated", "public", "cssflower"));
if (bank.closureBytes >= 8_000_000) failures.push(`Product bank is too large: ${bank.closureBytes}`);
if (bank.timelineStateCount !== 360 || bank.geometryStateCount !== 73 ||
    bank.transformBlockCount !== 5 || bank.lightingAssetCount !== 1 ||
    bank.lightingQuality !== 83 || bank.visibilityMinimumOwnedPixels !== 8) {
  failures.push("Product bank is not the accepted rounded q83/min-8 closure with the negative cube lobe");
}

const report = {
  schema: "cssgraphics-flowerbox-runtime-audit@2",
  status: failures.length === 0 ? "pass" : "fail",
  renderer: "retained-dom-polycss-only",
  morphTarget: "@layoutit/polycss-morph#createPolyMorphPreparedDomTarget",
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
  excluded: [
    "Microsoft source",
    "Microsoft binaries",
    "native captures",
    "oracle packets",
    "projected visual packs",
    "Three.js",
    "pixelmatch",
  ],
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
