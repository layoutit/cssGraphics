import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import {
  CSSFLOWER_LIGHTING_ATLAS_ENCODING,
  CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE,
  CSSFLOWER_LIGHTING_ATLAS_QUALITY,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
  CSSFLOWER_TRANSFORM_BLOCK_SCHEMA,
} from "../../cssflower/renderContract.mjs";
import {
  generatedLightingPagePath,
  generatedAssetDir,
  generatedLightingAssetDir,
  generatedProjectedAssetDir,
  generatedPreparedLightingPath,
  generatedPreparedLightingUrl,
  generatedStateEvidencePath,
  generatedTransformAssetDir,
  generatedTransformBlockPath,
  generatedTransformBlockUrl,
  generatedTransformsPath,
  localRoot,
  localPreparedTransformsPath,
  repoRoot,
} from "./paths.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_AVIFENC = "/opt/homebrew/bin/avifenc";

export async function writeCssflowerPreparedAssets(compiled, {
  avifenc = process.env.CSSFLOWER_AVIFENC || DEFAULT_AVIFENC,
  lightingPageStore,
} = {}) {
  if (!lightingPageStore?.pathFor) {
    throw new TypeError("Prepared cssFlower lighting page store is required");
  }
  await writeAtomic(localPreparedTransformsPath, compiled.transformBytes);
  await unlinkIfPresent(generatedTransformsPath);
  await rm(generatedProjectedAssetDir, { recursive: true, force: true });
  await pruneLegacyLightingPages();
  await prunePublicOracleProofAssets();
  if (!Array.isArray(compiled.lightingPages) || compiled.lightingPages.length !== compiled.lighting.pageCount) {
    throw new Error("Prepared cssFlower lighting pages are incomplete");
  }
  assertNoBrowserPathLeaks(compiled.evidence);
  await writeAtomic(generatedStateEvidencePath, Buffer.from(JSON.stringify(compiled.evidence, null, 2) + "\n"));
  const [transforms, lighting] = await Promise.all([
    materializeTransformBlocks(compiled),
    materializePreparedLightingPages(compiled, lightingPageStore, avifenc),
  ]);
  return Object.freeze({
    transformBytes: compiled.transformBytes.length,
    transformSha256: compiled.transformSha256,
    lightingBytes: lighting.contentAddressedBytes,
    lightingSha256: lighting.grid.sha256,
    lightingPageCount: compiled.lightingPages.length,
    decodedLightingGridBytes: CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
    transforms,
    lighting,
  });
}

async function materializeTransformBlocks(compiled) {
  const triangleCount = compiled.topology.triangleCount;
  const geometryStateCount = compiled.cycle.geometryStateCount;
  const componentCount = 16;
  const values = new Float32Array(
    compiled.transformBytes.buffer,
    compiled.transformBytes.byteOffset,
    compiled.transformBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  if (triangleCount !== 1_200 || values.length !== geometryStateCount * triangleCount * componentCount) {
    throw new Error("Prepared cssFlower matrix3d source is incomplete");
  }
  const blocks = [];
  const keep = new Set();
  for (let startGeometryStateIndex = 0; startGeometryStateIndex < geometryStateCount;
    startGeometryStateIndex += CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES) {
    const blockGeometryStateCount = Math.min(
      CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
      geometryStateCount - startGeometryStateIndex,
    );
    const transformCount = blockGeometryStateCount * triangleCount;
    const lines = new Array(transformCount);
    for (let transformIndex = 0; transformIndex < transformCount; transformIndex += 1) {
      const componentOffset = (startGeometryStateIndex * triangleCount + transformIndex) * componentCount;
      const components = new Array(componentCount);
      for (let component = 0; component < componentCount; component += 1) {
        components[component] = formatCssNumber(values[componentOffset + component]);
      }
      lines[transformIndex] = `matrix3d(${components.join(",")})`;
    }
    const decoded = Buffer.from(`${lines.join("\n")}\n`);
    const encoded = gzipSync(decoded, { level: 9, mtime: 0 });
    const encodedSha256 = sha256(encoded);
    const decodedSha256 = sha256(decoded);
    const assetPath = generatedTransformBlockPath(encodedSha256);
    await writeAtomic(assetPath, encoded);
    keep.add(assetPath);
    blocks.push(Object.freeze({
      index: blocks.length,
      startGeometryStateIndex,
      geometryStateCount: blockGeometryStateCount,
      triangleCount,
      transformCount,
      assetUrl: generatedTransformBlockUrl(encodedSha256),
      byteLength: encoded.length,
      sha256: encodedSha256,
      decodedByteLength: decoded.length,
      decodedSha256,
    }));
  }
  await pruneAssetDirectory(generatedTransformAssetDir, keep);
  return Object.freeze({
    schema: CSSFLOWER_TRANSFORM_BLOCK_SCHEMA,
    distribution: "public-independent-prepared-transform-blocks",
    encoding: "gzip-newline-utf8-geometry-state-major-triangle-major-matrix3d",
    componentCount,
    triangleCount,
    geometryStateCount,
    blockGeometryStateCount: CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
    blockCount: blocks.length,
    byteLength: blocks.reduce((sum, block) => sum + block.byteLength, 0),
    decodedByteLength: blocks.reduce((sum, block) => sum + block.decodedByteLength, 0),
    sourceFloat32: Object.freeze({
      distribution: "ignored-local-preparation-evidence",
      sha256: compiled.transformSha256,
      byteLength: compiled.transformBytes.length,
    }),
    blocks: Object.freeze(blocks),
  });
}

async function materializePreparedLightingPages(compiled, lightingPageStore, avifenc) {
  const encoder = await executableIdentity(avifenc, ["--version"]);
  const binding = sha256(Buffer.from(JSON.stringify({
    encoding: CSSFLOWER_LIGHTING_ATLAS_ENCODING,
    quality: CSSFLOWER_LIGHTING_ATLAS_QUALITY,
    gridColumns: CSSFLOWER_LIGHTING_GRID_COLUMNS,
    gridRows: CSSFLOWER_LIGHTING_GRID_ROWS,
    encoder,
  })));
  if (compiled.lightingPages.length !== CSSFLOWER_LIGHTING_GRID_COLUMNS) {
    throw new Error("Prepared cssFlower horizontal lighting grid source count drifted");
  }
  const sourcePaths = compiled.lightingPages.map((page) => lightingPageStore.pathFor(page.index));
  const sourceBinding = sha256(Buffer.from(compiled.lightingPages.map((page) => page.sha256).join("\n")));
  const cacheRoot = join(localRoot, "cache", "prepared-leaf-lighting-avif-grid", binding);
  const encodedCachePath = join(cacheRoot, `${sourceBinding}.avif`);
  let encoded;
  try {
    encoded = await readFile(encodedCachePath);
    if (encoded.length < 1) throw Object.assign(new Error("empty encoded lighting grid cache"), { code: "ENOENT" });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(dirname(encodedCachePath), { recursive: true });
    const temporary = `${encodedCachePath}.tmp-${process.pid}.avif`;
    await execFileAsync(avifenc, [
      "--qcolor", String(CSSFLOWER_LIGHTING_ATLAS_QUALITY),
      "--speed", "6",
      "--jobs", "2",
      "--yuv", "444",
      "--ignore-exif",
      "--ignore-xmp",
      "--ignore-icc",
      "--grid", `${CSSFLOWER_LIGHTING_GRID_COLUMNS}x${CSSFLOWER_LIGHTING_GRID_ROWS}`,
      ...sourcePaths,
      temporary,
    ], { maxBuffer: 8 * 1024 * 1024 });
    await rename(temporary, encodedCachePath);
    encoded = await readFile(encodedCachePath);
  }
  const encodedSha256 = sha256(encoded);
  const grid = Object.freeze({
    schema: "cssflower-prepared-leaf-lighting-grid@1",
    assetUrl: generatedPreparedLightingUrl(encodedSha256),
    encoding: CSSFLOWER_LIGHTING_ATLAS_ENCODING,
    mimeType: CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE,
    quality: CSSFLOWER_LIGHTING_ATLAS_QUALITY,
    chromaSubsampling: "4:4:4",
    exactPreparedPixels: false,
    columns: CSSFLOWER_LIGHTING_GRID_COLUMNS,
    rows: CSSFLOWER_LIGHTING_GRID_ROWS,
    cellWidth: compiled.lighting.atlasWidth,
    cellHeight: compiled.lighting.atlasHeight,
    width: CSSFLOWER_LIGHTING_GRID_WIDTH,
    height: CSSFLOWER_LIGHTING_GRID_HEIGHT,
    decodedBytes: CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
    byteLength: encoded.length,
    sha256: encodedSha256,
  });
  const pages = Object.freeze(compiled.lightingPages.map((sourcePage) => Object.freeze({
    index: sourcePage.index,
    startStateIndex: sourcePage.startStateIndex,
    usedRowCount: sourcePage.usedRowCount,
    rowCount: sourcePage.rowCount,
    role: sourcePage.role,
    width: sourcePage.width,
    height: sourcePage.height,
    decodedBytes: sourcePage.decodedBytes,
    gridColumn: sourcePage.index,
    gridRow: 0,
    gridOffsetX: sourcePage.index * sourcePage.width,
    gridOffsetY: 0,
    sourceEncoding: sourcePage.encoding,
    sourcePngByteLength: sourcePage.byteLength,
    sourcePngSha256: sourcePage.sha256,
  })));
  const asset = {
    source: encodedCachePath,
    target: generatedPreparedLightingPath(encodedSha256),
  };
  await pruneAssetDirectory(generatedLightingAssetDir, new Set([asset.target]));
  await materializeContentAddressedAssets([asset], 1);
  return Object.freeze({
    schema: "cssflower-prepared-leaf-lighting-assets@2",
    distribution: "public-independent-prepared-leaf-lighting-horizontal-grid",
    encoding: CSSFLOWER_LIGHTING_ATLAS_ENCODING,
    mimeType: CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE,
    quality: CSSFLOWER_LIGHTING_ATLAS_QUALITY,
    pageCount: pages.length,
    assetCount: 1,
    encodedGridBytes: encoded.length,
    contentAddressedBytes: encoded.length,
    encoder,
    grid,
    pages,
  });
}

async function pruneAssetDirectory(root, keepPaths) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const path = join(root, entry.name);
    if (!keepPaths.has(path)) await unlink(path);
  }));
}

async function materializeContentAddressedAssets(assets, concurrency) {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      await hardlinkAtomic(assets[index].source, assets[index].target, index);
    }
  }));
}

async function hardlinkAtomic(source, target, uniqueIndex) {
  await mkdir(dirname(target), { recursive: true });
  try {
    const [sourceStat, targetStat] = await Promise.all([stat(source), stat(target)]);
    if (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${target}.tmp-${process.pid}-${uniqueIndex}`;
  try {
    await link(source, temporary);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await copyFile(source, temporary);
  }
  await rename(temporary, target);
}

export async function createCssflowerPreparedLightingPageStore() {
  const binding = await lightingCacheBinding(repoRoot);
  const cacheParent = join(repoRoot, ".local", "cache", "cssflower", "prepared-leaf-lighting");
  const cacheRoot = join(cacheParent, binding);
  const pagePaths = new Map();
  let hitCount = 0;
  let migratedHitCount = 0;
  let missCount = 0;
  let writeCount = 0;
  return Object.freeze({
    binding,
    async read(expectedPage) {
      const roots = [cacheRoot, ...(await legacyLightingCacheRoots(cacheParent, cacheRoot))];
      for (const root of roots) {
        const paths = cachePaths(root, expectedPage.index);
        try {
          const [metadataBytes, bytes] = await Promise.all([
            readFile(paths.metadata),
            readFile(paths.png),
          ]);
          const metadata = JSON.parse(metadataBytes.toString("utf8"));
          const page = metadata?.page;
          if (!preparedLightingCacheEntryMatches({
            metadata,
            bytes,
            binding,
            expectedPage,
          })) {
            continue;
          }
          pagePaths.set(page.index, paths.png);
          if (page.index === 0) await writeAtomic(generatedLightingPagePath(page.index), bytes);
          hitCount += 1;
          if (root !== cacheRoot) migratedHitCount += 1;
          return Object.freeze(page);
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      }
      missCount += 1;
      return null;
    },
    async write(page) {
      if (!validPageWithBytes(page)) {
        throw new TypeError("Prepared cssFlower streaming lighting page is invalid");
      }
      const paths = cachePaths(cacheRoot, page.index);
      const { bytes, ...descriptor } = page;
      const metadata = Buffer.from(`${JSON.stringify({
        schema: "cssflower-prepared-leaf-lighting-cache@1",
        binding,
        page: descriptor,
      }, null, 2)}\n`);
      await Promise.all([
        ...(page.index === 0 ? [writeAtomic(generatedLightingPagePath(page.index), bytes)] : []),
        writeAtomic(paths.png, bytes),
        writeAtomic(paths.metadata, metadata),
      ]);
      pagePaths.set(page.index, paths.png);
      writeCount += 1;
    },
    pathFor(pageIndex) {
      const path = pagePaths.get(pageIndex);
      if (!path) throw new Error(`Prepared cssFlower lighting page ${pageIndex} has no verified cache path`);
      return path;
    },
    stats() {
      return Object.freeze({ binding, hitCount, migratedHitCount, missCount, writeCount });
    },
  });
}

async function legacyLightingCacheRoots(cacheParent, currentRoot) {
  try {
    const entries = await readdir(cacheParent, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(cacheParent, entry.name))
      .filter((root) => root !== currentRoot)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function pruneLegacyLightingPages() {
  await mkdir(generatedAssetDir, { recursive: true });
  const entries = await readdir(generatedAssetDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !/^flower-box-space-texels-page-\d{3}\.png$/u.test(entry.name)) return;
    await unlink(join(generatedAssetDir, entry.name));
  }));
}

async function prunePublicOracleProofAssets() {
  await mkdir(generatedAssetDir, { recursive: true });
  const entries = await readdir(generatedAssetDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !/^projected-(?:pixel-proof|spike|transition)-/u.test(entry.name)) return;
    await unlink(join(generatedAssetDir, entry.name));
  }));
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function lightingCacheBinding(repoRoot) {
  const paths = [
    "pnpm-lock.yaml",
    "src/adapters/flowerbox/src/cssflower/renderContract.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/bloomCycle.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/compilePreparedCycle.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/cubeTopology.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/leafRasterLighting.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/sourceProfile.mjs",
  ];
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(repoRoot, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function cachePaths(cacheRoot, index) {
  const stem = `page-${String(index).padStart(3, "0")}`;
  return Object.freeze({
    png: join(cacheRoot, `${stem}.png`),
    metadata: join(cacheRoot, `${stem}.json`),
  });
}

function sameExpectedPage(actual, expected) {
  if (!actual || !Number.isSafeInteger(actual.byteLength) || actual.byteLength < 1 ||
      !/^[a-f0-9]{64}$/u.test(actual.sha256 ?? "")) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export function preparedLightingCacheEntryMatches({ metadata, bytes, binding, expectedPage }) {
  const page = metadata?.page;
  return metadata?.schema === "cssflower-prepared-leaf-lighting-cache@1" &&
    metadata.binding === binding &&
    sameExpectedPage(page, expectedPage) &&
    bytes instanceof Uint8Array &&
    bytes.length === page.byteLength &&
    sha256(bytes) === page.sha256;
}

function validPageWithBytes(page) {
  return Number.isSafeInteger(page?.index) && page.index >= 0 &&
    page?.bytes instanceof Uint8Array && page.bytes.length === page.byteLength &&
    sha256(page.bytes) === page.sha256;
}

async function executableIdentity(path, versionArgs) {
  const [bytes, fileStat, version] = await Promise.all([
    readFile(path),
    stat(path),
    execFileAsync(path, versionArgs, { maxBuffer: 1024 * 1024 }),
  ]);
  return Object.freeze({
    path,
    byteLength: fileStat.size,
    sha256: sha256(bytes),
    version: `${version.stdout}${version.stderr}`.trim(),
    flags: Object.freeze([
      "--qcolor", String(CSSFLOWER_LIGHTING_ATLAS_QUALITY),
      "--speed", "6",
      "--jobs", "2",
      "--yuv", "444",
      "--ignore-exif",
      "--ignore-xmp",
      "--ignore-icc",
    ]),
  });
}

function formatCssNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}
