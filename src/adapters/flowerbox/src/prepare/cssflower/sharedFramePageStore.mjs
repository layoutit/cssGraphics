import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { constants as zlibConstants, gzipSync } from "node:zlib";
import { CSSFLOWER_PROJECTED_ATLAS_QUALITY } from "../../cssflower/renderContract.mjs";
import {
  CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT,
  buildCssflowerSharedFramePagePlan,
} from "./sharedFramePages.mjs";
import { repoRoot } from "./paths.mjs";

const CACHE_SCHEMA = "cssflower-prepared-shared-frame-page-cache@1";
const DEFAULT_AVIFENC = "/opt/homebrew/bin/avifenc";

export async function prepareCssflowerSharedFrameWindowPages({
  avifenc = process.env.CSSFLOWER_AVIFENC || DEFAULT_AVIFENC,
  concurrency = Math.min(4, availableParallelism()),
  onProgress,
} = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Shared-frame preparation concurrency must be a positive integer");
  }
  const encoder = await avifencIdentity(avifenc);
  const binding = await cacheBinding(repoRoot, encoder);
  const plan = buildCssflowerSharedFramePagePlan();
  const cacheRoot = cacheRootFor(repoRoot, binding);
  const descriptors = new Array(plan.pages.length);
  const misses = [];
  let hitCount = 0;
  let completedCount = 0;

  for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex += 1) {
    const page = plan.pages[pageIndex];
    const cached = await readCachedPage(cacheRoot, binding, page);
    if (cached) {
      descriptors[pageIndex] = cached;
      hitCount += 1;
      completedCount += 1;
      onProgress?.({ completedCount, totalCount: plan.pages.length, hitCount, missCount: misses.length, pageIndex, source: "cache" });
    } else {
      misses.push({ page });
    }
  }

  await runWorkerPool({
    tasks: misses,
    concurrency: Math.min(concurrency, Math.max(1, misses.length)),
    avifenc,
    async accept(task, result) {
      await writeCachedPage(cacheRoot, binding, task.page, result);
      descriptors[task.page.index] = result.descriptor;
      completedCount += 1;
      onProgress?.({ completedCount, totalCount: plan.pages.length, hitCount, missCount: misses.length, pageIndex: task.page.index, source: "prepared" });
    },
  });

  const packed = await packLayoutBlocks(cacheRoot, descriptors);
  const pages = Object.freeze(descriptors.map((descriptor, pageIndex) => Object.freeze({
    ...descriptor,
    index: pageIndex,
    frameCount: plan.frameCount,
    layout: Object.freeze({
      ...descriptor.layout,
      blockIndex: Math.floor(pageIndex / CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT),
      blockByteOffset: (pageIndex % CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT) * descriptor.layout.byteLength,
    }),
  })));
  const statePageIndices = new Uint16Array(plan.stateCount);
  const stateFrameIndices = new Uint8Array(plan.stateCount);
  for (const page of pages) {
    for (let frameIndex = 0; frameIndex < page.usedFrameCount; frameIndex += 1) {
      const stateIndex = page.startStateIndex + frameIndex;
      statePageIndices[stateIndex] = page.index;
      stateFrameIndices[stateIndex] = frameIndex;
    }
  }
  const atlasContent = contentAddressSummary(pages, "atlas");
  const maximumDecodedPageBytes = Math.max(...pages.map((page) => page.atlas.decodedBytes));
  const maximumAdjacentTwoPageBytes = Math.max(...pages.map((page, pageIndex) => (
    page.atlas.decodedBytes + (pages[pageIndex + 1]?.atlas.decodedBytes ?? 0)
  )));
  return Object.freeze({
    schema: "cssflower-prepared-shared-frame-window-pages@1",
    binding,
    encoder,
    layout: plan.layout,
    stateCount: plan.stateCount,
    cycleStartState: plan.cycleStartState,
    cycleLength: plan.cycleLength,
    retainedLeafCount: plan.retainedLeafCount,
    frameCount: plan.frameCount,
    pageCount: pages.length,
    decodedResidentPageBudget: 2,
    decodedPeakPageBudget: 2,
    maximumDecodedPageBytes,
    maximumAdjacentTwoPageBytes,
    encodedAtlasBytes: pages.reduce((sum, page) => sum + page.atlas.byteLength, 0),
    contentAddressedAtlasBytes: atlasContent.byteLength,
    atlasAliasCount: atlasContent.aliasCount,
    rawLayoutBytes: pages.reduce((sum, page) => sum + page.layout.byteLength, 0),
    compressedLayoutBytes: packed.blocks.reduce((sum, block) => sum + block.byteLength, 0),
    layoutBlockPageCount: CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT,
    layoutBlocks: packed.blocks,
    inverseRootTransforms: plan.inverseRootTransforms,
    statePageIndices,
    stateFrameIndices,
    pages,
    cache: Object.freeze({
      hitCount,
      missCount: misses.length,
      writeCount: misses.length,
    }),
    authority: plan.authority,
  });
}

export function cssflowerSharedFramePageCachePaths({ binding, pageIndex }) {
  if (!/^[a-f0-9]{64}$/u.test(binding ?? "") || !Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new TypeError("Prepared shared-frame cache locator is invalid");
  }
  return cachePaths(cacheRootFor(repoRoot, binding), pageIndex);
}

export function cssflowerSharedLayoutBlockCachePath({ binding, sha256 }) {
  if (!/^[a-f0-9]{64}$/u.test(binding ?? "") || !/^[a-f0-9]{64}$/u.test(sha256 ?? "")) {
    throw new TypeError("Prepared shared layout-block cache locator is invalid");
  }
  return join(cacheRootFor(repoRoot, binding), "layout-blocks", `block-${sha256}.i16.gz`);
}

async function packLayoutBlocks(cacheRoot, pages) {
  const blocks = [];
  for (let startPageIndex = 0; startPageIndex < pages.length; startPageIndex += CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT) {
    const blockPages = pages.slice(startPageIndex, startPageIndex + CSSFLOWER_SHARED_LAYOUT_BLOCK_PAGE_COUNT);
    const decoded = Buffer.concat(await Promise.all(blockPages.map((page) => (
      readFile(cachePaths(cacheRoot, page.index).layout)
    ))));
    const bytes = gzipSync(decoded, {
      level: 9,
      mtime: 0,
      strategy: zlibConstants.Z_DEFAULT_STRATEGY,
    });
    const block = Object.freeze({
      schema: "cssflower-prepared-shared-layout-block@1",
      index: blocks.length,
      startPageIndex,
      pageCount: blockPages.length,
      encoding: "gzip-concatenated-int16-page-layouts",
      byteLength: bytes.length,
      decodedByteLength: decoded.length,
      sha256: sha256(bytes),
      decodedSha256: sha256(decoded),
    });
    await writeAtomic(join(cacheRoot, "layout-blocks", `block-${block.sha256}.i16.gz`), bytes);
    blocks.push(block);
  }
  return Object.freeze({ blocks: Object.freeze(blocks) });
}

async function readCachedPage(cacheRoot, binding, page) {
  const paths = cachePaths(cacheRoot, page.index);
  try {
    const [metadataBytes, atlasBytes, layoutBytes] = await Promise.all([
      readFile(paths.metadata),
      readFile(paths.atlas),
      readFile(paths.layout),
    ]);
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    const descriptor = metadata?.page;
    if (metadata?.schema !== CACHE_SCHEMA || metadata.binding !== binding ||
        !matchesRequest(descriptor, page) || !validCachedAsset(descriptor.atlas, atlasBytes) ||
        !validCachedAsset(descriptor.layout, layoutBytes)) return null;
    return descriptor;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeCachedPage(cacheRoot, binding, request, result) {
  const { descriptor, atlasBytes, layoutBytes } = result;
  if (!matchesRequest(descriptor, request) || !validCachedAsset(descriptor.atlas, atlasBytes) ||
      !validCachedAsset(descriptor.layout, layoutBytes)) {
    throw new Error(`Prepared shared-frame page ${request.index} failed cache validation`);
  }
  const paths = cachePaths(cacheRoot, request.index);
  const metadata = Buffer.from(`${JSON.stringify({
    schema: CACHE_SCHEMA,
    binding,
    page: descriptor,
  }, null, 2)}\n`);
  await Promise.all([
    writeAtomic(paths.atlas, atlasBytes),
    writeAtomic(paths.layout, layoutBytes),
    writeAtomic(paths.metadata, metadata),
  ]);
}

async function runWorkerPool({ tasks, concurrency, avifenc, accept }) {
  if (tasks.length === 0) return;
  const workerUrl = new URL("./sharedFramePageWorker.mjs", import.meta.url);
  let nextTaskIndex = 0;
  let settledCount = 0;
  let failed = false;
  const workers = [];
  await new Promise((resolvePromise, rejectPromise) => {
    const fail = async (error) => {
      if (failed) return;
      failed = true;
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
      rejectPromise(error);
    };
    const dispatch = (worker) => {
      if (failed) return;
      if (nextTaskIndex >= tasks.length) {
        if (settledCount === tasks.length) resolvePromise();
        return;
      }
      const task = tasks[nextTaskIndex];
      nextTaskIndex += 1;
      worker.currentTask = task;
      worker.postMessage({ taskId: task.page.index, page: task.page, avifenc });
    };
    for (let workerIndex = 0; workerIndex < concurrency; workerIndex += 1) {
      const worker = new Worker(workerUrl);
      workers.push(worker);
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (!failed && code !== 0 && settledCount < tasks.length) {
          void fail(new Error(`Shared-frame worker exited ${code}`));
        }
      });
      worker.on("message", async (message) => {
        if (failed) return;
        const task = worker.currentTask;
        if (!task || message.taskId !== task.page.index) {
          return void fail(new Error("Shared-frame worker response drifted"));
        }
        if (message.error) return void fail(new Error(message.error));
        try {
          await accept(task, message.result);
          settledCount += 1;
          worker.currentTask = null;
          if (settledCount === tasks.length) resolvePromise();
          else dispatch(worker);
        } catch (error) {
          void fail(error);
        }
      });
      dispatch(worker);
    }
  });
  await Promise.all(workers.map((worker) => worker.terminate()));
}

async function avifencIdentity(path) {
  const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
  const versionRun = spawnSync(path, ["--version"], { encoding: "utf8" });
  if (versionRun.error) throw versionRun.error;
  if (versionRun.status !== 0) throw new Error(`avifenc --version exited ${versionRun.status}`);
  return Object.freeze({
    name: "avifenc",
    version: `${versionRun.stdout}${versionRun.stderr}`.trim(),
    byteLength: info.size,
    sha256: sha256(bytes),
    flags: Object.freeze([
      "--qcolor", String(CSSFLOWER_PROJECTED_ATLAS_QUALITY), "--speed", "6", "--yuv", "444",
      "--ignore-exif", "--ignore-xmp", "--ignore-icc",
    ]),
  });
}

async function cacheBinding(repoRoot, encoder) {
  const files = [
    "pnpm-lock.yaml",
    "src/adapters/flowerbox/src/prepare/cssflower/bloomCycle.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/compilePreparedCycle.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/cubeTopology.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/projectedPixels.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/sharedFramePages.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/sharedFramePacking.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/sharedFramePageWorker.mjs",
    "src/adapters/flowerbox/src/prepare/cssflower/sourceProfile.mjs",
  ];
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(repoRoot, path)));
    hash.update("\0");
  }
  hash.update(JSON.stringify(encoder));
  return hash.digest("hex");
}

function cacheRootFor(repoRoot, binding) {
  return join(repoRoot, ".local", "cache", "cssflower", "prepared-shared-frame-windows", binding);
}

function cachePaths(cacheRoot, pageIndex) {
  const stem = `page-${String(pageIndex).padStart(4, "0")}`;
  return Object.freeze({
    atlas: join(cacheRoot, `${stem}.avif`),
    layout: join(cacheRoot, `${stem}.i16`),
    metadata: join(cacheRoot, `${stem}.json`),
  });
}

function matchesRequest(descriptor, request) {
  const atlas = descriptor?.atlas;
  const horizontal = atlas?.packing === "horizontal-union";
  const vertical = atlas?.packing === "vertical-union";
  const expectedOffsets = Array.from(
    { length: request.usedFrameCount },
    (_, frameIndex) => frameIndex === 0 ? 0 : horizontal
      ? -frameIndex * atlas.frameWidth
      : -frameIndex * atlas.frameHeight,
  );
  return descriptor?.schema === "cssflower-prepared-shared-frame-window-page@1" &&
    descriptor.index === request.index && descriptor.startStateIndex === request.startStateIndex &&
    descriptor.usedFrameCount === request.usedFrameCount && descriptor.retainedLeafCount === 1_200 &&
    (horizontal || vertical) &&
    atlas.width === atlas.frameWidth * (horizontal ? descriptor.usedFrameCount : 1) &&
    atlas.height === atlas.frameHeight * (vertical ? descriptor.usedFrameCount : 1) &&
    arraysEqual(atlas.frameBackgroundOffsets, expectedOffsets) &&
    descriptor.authority?.nativeStateIngestion === false && descriptor.authority?.nativePixelIngestion === false &&
    descriptor.authority?.runtimeProjection === false && descriptor.authority?.runtimeRasterization === false;
}

function arraysEqual(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function validCachedAsset(descriptor, bytes) {
  return Number.isSafeInteger(descriptor?.byteLength) && descriptor.byteLength === bytes.length &&
    /^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? "") && sha256(bytes) === descriptor.sha256;
}

function contentAddressSummary(pages, field) {
  const unique = new Map();
  for (const page of pages) unique.set(page[field].sha256, page[field].byteLength);
  return Object.freeze({
    uniqueCount: unique.size,
    aliasCount: pages.length - unique.size,
    byteLength: [...unique.values()].reduce((sum, byteLength) => sum + byteLength, 0),
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}
