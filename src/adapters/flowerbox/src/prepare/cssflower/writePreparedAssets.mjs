import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  generatedLightingPagePath,
  generatedAssetDir,
  generatedProjectedAtlasPath,
  generatedProjectedAssetDir,
  generatedSharedLayoutBlockPath,
  generatedStateEvidencePath,
  generatedTransformsPath,
  localPreparedTransformsPath,
  repoRoot,
} from "./paths.mjs";
import {
  cssflowerSharedFramePageCachePaths,
  cssflowerSharedLayoutBlockCachePath,
} from "./sharedFramePageStore.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";

export async function writeCssflowerPreparedAssets(compiled, projectedPixels) {
  await writeAtomic(localPreparedTransformsPath, compiled.transformBytes);
  await unlinkIfPresent(generatedTransformsPath);
  await pruneLegacyLightingPages();
  await prunePublicOracleProofAssets();
  if (!Array.isArray(compiled.lightingPages) || compiled.lightingPages.length !== compiled.lighting.pageCount) {
    throw new Error("Prepared cssFlower lighting pages are incomplete");
  }
  assertNoBrowserPathLeaks(compiled.evidence);
  await writeAtomic(generatedStateEvidencePath, Buffer.from(JSON.stringify(compiled.evidence, null, 2) + "\n"));
  const projected = await materializeProjectedPixels(projectedPixels);
  return Object.freeze({
    transformBytes: compiled.transformBytes.length,
    transformSha256: compiled.transformSha256,
    lightingBytes: compiled.lightingPages.reduce((sum, page) => sum + page.byteLength, 0),
    lightingSha256: compiled.lightingSha256,
    lightingPageCount: compiled.lightingPages.length,
    decodedResidentPageBudgetBytes: compiled.lighting.decodedBytesPerFullPage * compiled.lighting.decodedResidentPageBudget,
    decodedPeakPageBudgetBytes: compiled.lighting.decodedBytesPerFullPage * compiled.lighting.decodedPeakPageBudget,
    projected,
  });
}

async function materializeProjectedPixels(projected) {
  if (projected?.schema !== "cssflower-prepared-shared-frame-window-pages@1" ||
      projected.pages?.length !== projected.pageCount || projected.retainedLeafCount !== 1_200) {
    throw new TypeError("Complete shared-frame projected-pixel preparation is required");
  }
  const atlasAssets = new Map();
  for (const page of projected.pages) {
    const cache = cssflowerSharedFramePageCachePaths({
      binding: projected.binding,
      pageIndex: page.index,
    });
    atlasAssets.set(page.atlas.sha256, { source: cache.atlas, target: generatedProjectedAtlasPath(page.atlas.sha256) });
  }
  const layoutBlockAssets = projected.layoutBlocks.map((block) => ({
    source: cssflowerSharedLayoutBlockCachePath({ binding: projected.binding, sha256: block.sha256 }),
    target: generatedSharedLayoutBlockPath(block.sha256),
  }));
  const assets = [...atlasAssets.values(), ...layoutBlockAssets];
  await pruneGeneratedProjectedAssets(new Set(assets.map((asset) => asset.target)));
  await materializeContentAddressedAssets(assets, 16);
  return Object.freeze({
    pageCount: projected.pageCount,
    atlasAssetCount: atlasAssets.size,
    layoutAssetCount: layoutBlockAssets.length,
    atlasAliasCount: projected.atlasAliasCount,
    encodedAtlasBytes: projected.encodedAtlasBytes,
    rawLayoutBytes: projected.rawLayoutBytes,
    compressedLayoutBytes: projected.compressedLayoutBytes,
    contentAddressedAtlasBytes: projected.contentAddressedAtlasBytes,
    maximumDecodedPageBytes: projected.maximumDecodedPageBytes,
    maximumAdjacentTwoPageBytes: projected.maximumAdjacentTwoPageBytes,
  });
}

async function pruneGeneratedProjectedAssets(keepPaths) {
  await mkdir(generatedProjectedAssetDir, { recursive: true });
  const entries = await readdir(generatedProjectedAssetDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const path = join(generatedProjectedAssetDir, entry.name);
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
  const cacheRoot = join(repoRoot, ".local", "cache", "cssflower", "prepared-leaf-lighting", binding);
  let hitCount = 0;
  let missCount = 0;
  let writeCount = 0;
  return Object.freeze({
    binding,
    async read(expectedPage) {
      const paths = cachePaths(cacheRoot, expectedPage.index);
      try {
        const [metadataBytes, bytes] = await Promise.all([
          readFile(paths.metadata),
          readFile(paths.png),
        ]);
        const metadata = JSON.parse(metadataBytes.toString("utf8"));
        const page = metadata?.page;
        if (metadata?.schema !== "cssflower-prepared-leaf-lighting-cache@1" ||
            metadata.binding !== binding || !sameExpectedPage(page, expectedPage) ||
            bytes.length !== page.byteLength || sha256(bytes) !== page.sha256) {
          missCount += 1;
          return null;
        }
        if (page.index === 0) await writeAtomic(generatedLightingPagePath(page.index), bytes);
        hitCount += 1;
        return Object.freeze(page);
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        missCount += 1;
        return null;
      }
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
      writeCount += 1;
    },
    stats() {
      return Object.freeze({ binding, hitCount, missCount, writeCount });
    },
  });
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

function validPageWithBytes(page) {
  return Number.isSafeInteger(page?.index) && page.index >= 0 &&
    page?.bytes instanceof Uint8Array && page.bytes.length === page.byteLength &&
    sha256(page.bytes) === page.sha256;
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
