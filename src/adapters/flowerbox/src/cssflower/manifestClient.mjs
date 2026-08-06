import {
  sceneEntryForRoute,
  routeSceneLabel,
} from "./routeState.mjs";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_LIGHTING_ATLAS_HEIGHT,
  CSSFLOWER_LIGHTING_ATLAS_WIDTH,
  CSSFLOWER_LIGHTING_GUTTER,
  CSSFLOWER_LIGHTING_LAYOUT,
  CSSFLOWER_LIGHTING_PAGE_COUNT,
  CSSFLOWER_LIGHTING_PAGE_ROWS,
  CSSFLOWER_LIGHTING_SCHEMA,
  CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT,
  CSSFLOWER_PROJECTED_ATLAS_ENCODING,
  CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE,
  CSSFLOWER_PROJECTED_ATLAS_QUALITY,
  CSSFLOWER_SEAM_BLEED,
  CSSFLOWER_SEAM_BLEED_POLICY,
} from "./renderContract.mjs";

export async function loadPreparedManifest(routeState) {
  const manifest = await fetchJson(routeState.manifestUrl, {
    notFoundMessage: "Missing prepared Flower Box manifest at " + routeState.manifestUrl + ". Run pnpm prepare:flowerbox:artifact first.",
  });
  if (manifest?.schema !== "cssflower-manifest@1" || manifest?.status !== "ready") {
    throw new Error("Prepared Flower Box manifest is not ready (" + (manifest?.status ?? "missing status") + "). Run pnpm prepare:flowerbox:artifact first.");
  }
  return manifest;
}

export async function loadPreparedScene(manifest, routeState) {
  const entry = sceneEntryForRoute(manifest, routeState);
  if (!entry || typeof entry.sceneUrl !== "string") {
    throw new Error("Prepared Flower Box manifest does not include " + routeSceneLabel(routeState) + ". Run pnpm prepare:flowerbox:artifact first.");
  }
  const sceneData = await fetchJson(entry.sceneUrl, {
    notFoundMessage: "Missing prepared Flower Box scene at " + entry.sceneUrl + ". Run pnpm prepare:flowerbox:artifact first.",
  });
  const snapshotHtml = typeof entry.snapshotUrl === "string" && entry.snapshotUrl
    ? await fetchText(entry.snapshotUrl, {
      notFoundMessage: "Missing prepared Flower Box PolyCSS snapshot at " + entry.snapshotUrl + ". Run pnpm prepare:flowerbox:artifact first.",
    })
    : null;
  if (sceneData?.schema !== "cssflower-prepared-scene@1" ||
      sceneData?.playback?.schema !== "cssflower-prepared-playback@1" ||
      sceneData?.renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      sceneData?.renderer?.stableDom !== true ||
      sceneData?.renderer?.seamBleed !== CSSFLOWER_SEAM_BLEED ||
      sceneData?.renderer?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData?.renderer?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData?.renderer?.seamBleedSharedEdgeCount !== 1680 ||
      sceneData?.renderer?.seamBleedBoundaryEdgeCount !== 240 ||
      sceneData?.renderer?.seamBleedBoundaryVertexCount !== 240 ||
      sceneData?.renderer?.seamBleedBoundaryAdjacentTriangleCount !== 432 ||
      sceneData?.renderer?.merge !== false ||
      sceneData?.lighting?.schema !== CSSFLOWER_LIGHTING_SCHEMA ||
      sceneData?.lighting?.physicalLayout !== CSSFLOWER_LIGHTING_LAYOUT ||
      sceneData?.lighting?.rasterMode !== "leaf-resolution" ||
      sceneData?.lighting?.sampling !== "endpoint-aligned-pixel-centers" ||
      sceneData?.lighting?.gutter !== CSSFLOWER_LIGHTING_GUTTER ||
      sceneData?.lighting?.stateSliceHeight !== CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT ||
      sceneData?.lighting?.atlasWidth !== CSSFLOWER_LIGHTING_ATLAS_WIDTH ||
      sceneData?.lighting?.atlasHeight !== CSSFLOWER_LIGHTING_ATLAS_HEIGHT ||
      sceneData?.lighting?.faceCount !== 1200 ||
      sceneData?.lighting?.timelineRowCount !== 9_331 ||
      sceneData?.lighting?.pageRowCount !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData?.lighting?.pageCount !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData?.lighting?.pages?.length !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData?.lighting?.leafSizing !== "raster" ||
      sceneData?.lighting?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData?.lighting?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData?.lighting?.boundaryVertexCount !== 240 ||
      sceneData?.lighting?.boundaryAdjacentTriangleCount !== 432 ||
      sceneData?.lighting?.sharedEdgeIncidenceCount !== 3360 ||
      sceneData?.lighting?.boundaryEdgeIncidenceCount !== 240 ||
      sceneData?.lighting?.faces?.length !== 1200 ||
      !sceneData?.lighting?.faces?.every((face, index) =>
        face?.sourceOrder === index &&
        face.tileWidth === face.leafWidth && face.tileHeight === face.leafHeight &&
        Number.isSafeInteger(face.contentX) && Number.isSafeInteger(face.contentY) &&
        face.contentX >= CSSFLOWER_LIGHTING_GUTTER && face.contentX + face.leafWidth < CSSFLOWER_LIGHTING_ATLAS_WIDTH &&
        face.contentY >= CSSFLOWER_LIGHTING_GUTTER && face.contentY + face.leafHeight < CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT &&
        Number.isSafeInteger(face?.seamEdgeMask) && face.seamEdgeMask >= 1 && face.seamEdgeMask <= 7 &&
        (face.boundaryAdjacent === true
          ? face.seamBleed === CSSFLOWER_BOUNDARY_SEAM_BLEED
          : face.boundaryAdjacent === false && face.seamBleed === CSSFLOWER_SEAM_BLEED)) ||
      sceneData?.lighting?.backgroundPositionYs?.length !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData?.lighting?.rowSelection !== "prepared-timeline-state-page-and-row-index" ||
      sceneData?.lighting?.temporalInterpolation !== false ||
      sceneData?.metrics?.preparedLeafCount !== 1200 ||
      sceneData?.metrics?.preparedRootCount !== 1 ||
      sceneData?.metrics?.runtimePolygonConstructionCount !== 0 ||
      sceneData?.metrics?.runtimeRadialProjectionCount !== 0 ||
      sceneData?.metrics?.runtimeNormalCalculationCount !== 0 ||
      sceneData?.metrics?.runtimeLightingCalculationCount !== 0 ||
      sceneData?.metrics?.runtimeDomGrowth !== false) {
    throw new Error("Generated cssFlower scene is not the retained default-cube contract.");
  }
  if (!snapshotHtml || entry.snapshot?.schema !== "cssflower-retained-snapshot-contract@1") {
    throw new Error("Prepared Flower Box retained snapshot binding is missing. Run pnpm prepare:flowerbox:artifact first.");
  }
  await assertSha256(new TextEncoder().encode(snapshotHtml), entry.snapshot.sha256, "snapshot");
  validateProjectedPixels(sceneData.playback);
  const projectedPages = createPreparedProjectedPageLoader(sceneData.playback.projectedPixels);
  await projectedPages.prime(0, 1);
  return {
    entry,
    sceneData,
    snapshotHtml,
    projectedPages,
  };
}

function createPreparedProjectedPageLoader(projected) {
  const transport = projected.transport;
  const cycleStartPageIndex = projected.pages.findIndex((page) =>
    projected.cycleStartState >= page.startStateIndex &&
    projected.cycleStartState < page.startStateIndex + page.usedFrameCount);
  if (cycleStartPageIndex < 0) throw new Error("Prepared cssFlower cycle-start page is missing");
  const records = new Map();
  const packRecords = new Map();
  const errors = [];
  let currentPageIndex = 0;
  let pageLoadCount = 0;
  let pageReleaseCount = 0;
  let packLoadCount = 0;
  let packReleaseCount = 0;
  let earlyPackPrefetchCount = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let residentEncodedPackBytes = 0;
  let peakResidentEncodedPackBytes = 0;
  let peakResidentPackCount = 0;
  let desiredPageIndices = new Set();
  let desiredPackIndices = new Set();
  let earlyPrefetchPackIndex = null;
  let destroyed = false;

  async function ensure(pageIndex) {
    if (destroyed) throw new Error("Prepared cssFlower projected page loader is destroyed");
    const page = projected.pages[pageIndex];
    if (!page || page.index !== pageIndex) throw new RangeError(`Prepared cssFlower projected page ${pageIndex} is missing`);
    const existing = records.get(pageIndex);
    if (existing?.url) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const pack = transport.packs[page.layout.blockIndex];
      const packRecord = await ensurePack(pack.index);
      const atlasSlice = pack.atlasSlices[pageIndex - pack.startPageIndex];
      const atlasBytes = packRecord.bytes.subarray(
        atlasSlice.byteOffset,
        atlasSlice.byteOffset + atlasSlice.byteLength,
      );
      if (atlasBytes.byteLength !== page.atlas.byteLength || atlasSlice.sha256 !== page.atlas.sha256) {
        throw new Error(`Generated cssFlower projected atlas ${pageIndex} byte length is invalid.`);
      }
      const layoutBytes = packRecord.layoutBytes.subarray(
        page.layout.blockByteOffset,
        page.layout.blockByteOffset + page.layout.byteLength,
      );
      if (layoutBytes.byteLength !== page.layout.byteLength || layoutBytes.byteLength % 2 !== 0) {
        throw new Error(`Generated cssFlower projected layout ${pageIndex} byte length is invalid.`);
      }
      await Promise.all([
        assertSha256(atlasBytes, page.atlas.sha256, `projected atlas ${pageIndex}`),
        assertSha256(layoutBytes, page.layout.sha256, `projected layout ${pageIndex}`),
      ]);
      const url = URL.createObjectURL(new Blob([atlasBytes], { type: page.atlas.mimeType }));
      let image;
      try {
        image = await decodeImage(url);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      const record = Object.freeze({
        pageIndex,
        url,
        image,
        layoutBlockIndex: pack.index,
        layoutValues: new Int16Array(
          layoutBytes.buffer,
          layoutBytes.byteOffset,
          layoutBytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
        ),
        decodedBytes: page.atlas.decodedBytes,
      });
      records.set(pageIndex, record);
      pageLoadCount += 1;
      residentDecodedBytes += page.atlas.decodedBytes;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (destroyed || !desiredPageIndices.has(pageIndex)) releaseRecord(pageIndex, record);
      return record;
    })();
    records.set(pageIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (records.get(pageIndex)?.promise === promise) records.delete(pageIndex);
      errors.push(String(error?.message || error));
      throw error;
    }
  }

  async function ensurePack(packIndex) {
    const pack = transport.packs[packIndex];
    if (!pack || pack.index !== packIndex) throw new Error("Prepared cssFlower visual pack is missing");
    const existing = packRecords.get(packIndex);
    if (existing?.bytes) return existing;
    if (existing?.promise) return existing.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const bytes = new Uint8Array(await fetchBytes(pack.assetUrl, {
        notFoundMessage: `Missing prepared Flower Box visual pack ${packIndex}. Run pnpm prepare:flowerbox:artifact first.`,
        signal: controller.signal,
      }));
      if (bytes.byteLength !== pack.byteLength) {
        throw new Error(`Generated cssFlower visual pack ${packIndex} byte length is invalid.`);
      }
      await assertSha256(bytes, pack.sha256, `visual pack ${packIndex}`);
      const compressedLayout = bytes.subarray(
        pack.layout.byteOffset,
        pack.layout.byteOffset + pack.layout.byteLength,
      );
      if (compressedLayout.byteLength !== pack.layout.byteLength) {
        throw new Error(`Generated cssFlower visual pack ${packIndex} layout slice is invalid.`);
      }
      await assertSha256(compressedLayout, pack.layout.sha256, `visual pack ${packIndex} layout`);
      const layoutBytes = await decompressGzip(compressedLayout);
      if (layoutBytes.byteLength !== pack.layout.decodedByteLength) {
        throw new Error(`Generated cssFlower visual pack ${packIndex} decoded layout byte length is invalid.`);
      }
      await assertSha256(
        layoutBytes,
        pack.layout.decodedSha256,
        `decoded visual pack ${packIndex} layout`,
      );
      const record = Object.freeze({ index: packIndex, bytes, layoutBytes });
      packRecords.set(packIndex, record);
      packLoadCount += 1;
      residentEncodedPackBytes += bytes.byteLength;
      peakResidentEncodedPackBytes = Math.max(peakResidentEncodedPackBytes, residentEncodedPackBytes);
      peakResidentPackCount = Math.max(peakResidentPackCount, residentPackCount());
      if (destroyed || !desiredPackIndices.has(packIndex)) releasePack(packIndex, record);
      return record;
    })();
    packRecords.set(packIndex, { promise, controller });
    try {
      return await promise;
    } catch (error) {
      if (packRecords.get(packIndex)?.promise === promise) packRecords.delete(packIndex);
      if (error?.name !== "AbortError") errors.push(String(error?.message || error));
      throw error;
    }
  }

  function releasePack(packIndex, record) {
    if (!record?.bytes || packRecords.get(packIndex) !== record) return;
    packRecords.delete(packIndex);
    packReleaseCount += 1;
    residentEncodedPackBytes -= record.bytes.byteLength;
  }

  function reconcilePackResidency() {
    const keepPacks = new Set([...desiredPageIndices].map(packIndexForPage));
    if (earlyPrefetchPackIndex !== null) keepPacks.add(earlyPrefetchPackIndex);
    if (keepPacks.size > transport.compressedResidentPackBudget) {
      throw new Error("Prepared cssFlower visual pack residency exceeds its bound");
    }
    desiredPackIndices = keepPacks;
    for (const [packIndex, record] of packRecords) {
      if (keepPacks.has(packIndex)) continue;
      if (record?.bytes) releasePack(packIndex, record);
      else if (record?.controller) {
        record.controller.abort();
        packRecords.delete(packIndex);
      }
    }
  }

  function residentPackCount() {
    return [...packRecords.values()].filter((record) => record?.bytes).length;
  }

  function packIndexForPage(pageIndex) {
    const page = projected.pages[pageIndex];
    if (!page) throw new RangeError(`Prepared cssFlower projected page ${pageIndex} is missing`);
    return page.layout.blockIndex;
  }

  function nextPackIndex(packIndex) {
    if (packIndex + 1 < transport.packCount) return packIndex + 1;
    return packIndexForPage(cycleStartPageIndex);
  }

  function pageAfter(pageIndex) {
    if (pageIndex + 1 < projected.pageCount) return pageIndex + 1;
    return cycleStartPageIndex;
  }

  function maybePrefetchPack(pageIndex) {
    const packIndex = packIndexForPage(pageIndex);
    const pack = transport.packs[packIndex];
    const offset = pageIndex - pack.startPageIndex;
    earlyPrefetchPackIndex = offset >= transport.earlyPrefetchPageOffset
      ? nextPackIndex(packIndex)
      : null;
    reconcilePackResidency();
    if (earlyPrefetchPackIndex === null) return;
    if (!packRecords.has(earlyPrefetchPackIndex)) earlyPackPrefetchCount += 1;
    void ensurePack(earlyPrefetchPackIndex).catch(() => undefined);
  }

  function releaseRecord(pageIndex, record) {
    if (!record?.url || records.get(pageIndex) !== record) return;
    record.image.removeAttribute("src");
    URL.revokeObjectURL(record.url);
    records.delete(pageIndex);
    pageReleaseCount += 1;
    residentDecodedBytes -= record.decodedBytes;
  }

  function releaseExcept(keep) {
    desiredPageIndices = new Set(keep);
    for (const [pageIndex, record] of records) {
      if (keep.has(pageIndex) || !record?.url) continue;
      releaseRecord(pageIndex, record);
    }
    reconcilePackResidency();
  }

  function prefetch(pageIndex) {
    if (pageIndex === currentPageIndex || records.get(pageIndex)?.url) return;
    void ensure(pageIndex).catch(() => undefined);
  }

  return Object.freeze({
    async prime(pageIndex, nextPageIndex) {
      currentPageIndex = pageIndex;
      earlyPrefetchPackIndex = null;
      releaseExcept(new Set([pageIndex, nextPageIndex]));
      await Promise.all([ensure(pageIndex), ensure(nextPageIndex)]);
    },
    urlFor(pageIndex) {
      const record = records.get(pageIndex);
      if (!record?.url) throw new Error(`Prepared cssFlower projected page ${pageIndex} is not decoded`);
      return record.url;
    },
    layoutFor(pageIndex) {
      const record = records.get(pageIndex);
      if (!(record?.layoutValues instanceof Int16Array)) {
        throw new Error(`Prepared cssFlower projected layout ${pageIndex} is not decoded`);
      }
      return record.layoutValues;
    },
    async activate(pageIndex, nextPageIndex) {
      if (pageIndex !== pageAfter(currentPageIndex)) earlyPrefetchPackIndex = null;
      releaseExcept(new Set([currentPageIndex, pageIndex]));
      const record = await ensure(pageIndex);
      currentPageIndex = pageIndex;
      return record;
    },
    commitPresented(pageIndex, nextPageIndex) {
      if (pageIndex !== currentPageIndex || !records.get(pageIndex)?.url) {
        throw new Error(`Prepared cssFlower projected page ${pageIndex} cannot be committed before presentation`);
      }
      releaseExcept(new Set([pageIndex, nextPageIndex]));
      prefetch(nextPageIndex);
      maybePrefetchPack(pageIndex);
    },
    stats() {
      return Object.freeze({
        schema: "cssflower-prepared-projected-page-loader@2",
        currentPageIndex,
        pageLoadCount,
        pageReleaseCount,
        residentPageCount: [...records.values()].filter((record) => record?.url).length,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        residentPageBudget: projected.decodedResidentPageBudget,
        peakPageBudget: projected.decodedPeakPageBudget,
        desiredPageIndices: Object.freeze([...desiredPageIndices].sort((left, right) => left - right)),
        packLoadCount,
        packReleaseCount,
        earlyPackPrefetchCount,
        residentPackCount: residentPackCount(),
        residentEncodedPackBytes,
        peakResidentEncodedPackBytes,
        peakResidentPackCount,
        residentPackBudget: transport.compressedResidentPackBudget,
        desiredPackIndices: Object.freeze([...desiredPackIndices].sort((left, right) => left - right)),
        earlyPrefetchPackIndex,
        residentLayoutBlockCount: residentPackCount(),
        residentDecodedLayoutBytes: [...packRecords.values()].reduce(
          (sum, record) => sum + (record?.layoutBytes?.byteLength ?? 0),
          0,
        ),
        errors: Object.freeze([...errors]),
      });
    },
    destroy() {
      destroyed = true;
      earlyPrefetchPackIndex = null;
      releaseExcept(new Set());
    },
  });
}

function validateProjectedPixels(playback) {
  const projected = playback?.projectedPixels;
  if (projected?.schema !== "cssflower-prepared-projected-pixel-playback@1" ||
      projected.representation !== "shared-frame-windows" ||
      projected.physicalLayout !== "source-order-retained-leaf-windows-over-screen-aligned-prepared-frame-pages" ||
      projected.rasterMode !== "source-camera-projected-pixels" ||
      projected.visualEncoding?.codec !== "AVIF" ||
      projected.visualEncoding?.mimeType !== CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE ||
      projected.visualEncoding?.quality !== CSSFLOWER_PROJECTED_ATLAS_QUALITY ||
      projected.visualEncoding?.chromaSubsampling !== "4:4:4" ||
      projected.visualEncoding?.exactStateAndTopology !== true ||
      projected.visualEncoding?.exactPreparedPixels !== false ||
      projected.stateCount !== playback.cycle.stateCount ||
      projected.cycleStartState !== playback.cycle.cycleStartState ||
      projected.cycleLength !== playback.cycle.cycleLength ||
      projected.retainedLeafCount !== 1_200 ||
      !Number.isSafeInteger(projected.pageCount) || projected.pageCount < 1 ||
      projected.pages?.length !== projected.pageCount ||
      !Number.isSafeInteger(projected.layoutBlockPageCount) || projected.layoutBlockPageCount !== 64 ||
      !Array.isArray(projected.layoutBlocks) || projected.layoutBlocks.length < 1 ||
      projected.decodedResidentPageBudget !== 2 ||
      projected.decodedPeakPageBudget !== 2 ||
      projected.maximumDecodedPageBytes > 16 * 1024 * 1024 ||
      projected.inverseRootTransforms?.length !== playback.cycle.rootStateCount ||
      projected.inverseRootTransforms.some((transform) => typeof transform !== "string") ||
      projected.runtimeProjection !== false || projected.runtimeRasterization !== false ||
      projected.runtimeGeometryConstruction !== false || projected.runtimeNormalCalculation !== false ||
      projected.runtimeLightingCalculation !== false || projected.runtimeDomGrowth !== false) {
    throw new Error("Complete prepared cssFlower projected-pixel playback is required");
  }
  validateProjectedTransport(projected);
  let layoutBlockDecodedBytes = 0;
  for (let blockIndex = 0; blockIndex < projected.layoutBlocks.length; blockIndex += 1) {
    const block = projected.layoutBlocks[blockIndex];
    const expectedPageCount = Math.min(
      projected.layoutBlockPageCount,
      projected.pageCount - blockIndex * projected.layoutBlockPageCount,
    );
    if (block?.schema !== "cssflower-prepared-shared-layout-block@1" || block.index !== blockIndex ||
        block.startPageIndex !== blockIndex * projected.layoutBlockPageCount ||
        block.pageCount !== expectedPageCount ||
        block.encoding !== "gzip-concatenated-int16-page-layouts" ||
        !Number.isSafeInteger(block.byteLength) || block.byteLength < 1 ||
        block.decodedByteLength !== block.pageCount * 14_400 ||
        !/^[a-f0-9]{64}$/.test(block.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(block.decodedSha256 ?? "") ||
        typeof block.assetUrl !== "string") {
      throw new Error(`Prepared cssFlower shared layout block ${blockIndex} is invalid`);
    }
    layoutBlockDecodedBytes += block.decodedByteLength;
  }
  if (layoutBlockDecodedBytes !== projected.rawLayoutBytes) {
    throw new Error("Prepared cssFlower shared layout block coverage is incomplete");
  }
  let nextStateIndex = 0;
  for (let pageIndex = 0; pageIndex < projected.pages.length; pageIndex += 1) {
    const page = projected.pages[pageIndex];
    const atlas = page?.atlas;
    const layout = page?.layout;
    const horizontal = atlas?.packing === "horizontal-union";
    const vertical = atlas?.packing === "vertical-union";
    const expectedOffsets = Array.from(
      { length: page?.usedFrameCount ?? 0 },
      (_, frameIndex) => frameIndex === 0 ? 0 : horizontal
        ? -frameIndex * atlas.frameWidth
        : -frameIndex * atlas.frameHeight,
    );
    if (page?.index !== pageIndex || page.startStateIndex !== nextStateIndex ||
        page.frameCount !== 4 || !Number.isSafeInteger(page.usedFrameCount) ||
        page.usedFrameCount < 1 || page.usedFrameCount > page.frameCount ||
        !Number.isSafeInteger(page.activeUnionLeafCount) || page.activeUnionLeafCount < 1 ||
        page.activeUnionLeafCount > 1_200 || atlas?.encoding !== CSSFLOWER_PROJECTED_ATLAS_ENCODING ||
        atlas.mimeType !== CSSFLOWER_PROJECTED_ATLAS_MIME_TYPE ||
        atlas.quality !== CSSFLOWER_PROJECTED_ATLAS_QUALITY ||
        !Number.isSafeInteger(atlas.width) || atlas.width < 1 ||
        !Number.isSafeInteger(atlas.height) || atlas.height < 1 ||
        !Number.isSafeInteger(atlas.frameWidth) || atlas.frameWidth < 1 ||
        !Number.isSafeInteger(atlas.frameHeight) || atlas.frameHeight < 1 ||
        (!horizontal && !vertical) ||
        atlas.width !== atlas.frameWidth * (horizontal ? page.usedFrameCount : 1) ||
        atlas.height !== atlas.frameHeight * (vertical ? page.usedFrameCount : 1) ||
        !arraysEqual(atlas.frameBackgroundOffsets, expectedOffsets) ||
        !Number.isSafeInteger(atlas.byteLength) || atlas.byteLength < 1 ||
        atlas.decodedBytes !== atlas.width * atlas.height * 4 ||
        atlas.decodedBytes > projected.maximumDecodedPageBytes ||
        !/^[a-f0-9]{64}$/.test(atlas.sha256 ?? "") || typeof atlas.assetUrl !== "string" ||
        layout?.schema !== "cssflower-prepared-shared-frame-leaf-layout@1" ||
        layout.encoding !== "int16-little-endian-source-order-width-height-dx-dy-frame-background-x-frame-background-y" ||
        layout.componentCount !== 6 || layout.bytesPerLeaf !== 12 || layout.leafCount !== 1_200 ||
        layout.byteLength !== 14_400 || !/^[a-f0-9]{64}$/.test(layout.sha256 ?? "") ||
        layout.blockIndex !== Math.floor(pageIndex / projected.layoutBlockPageCount) ||
        layout.blockByteOffset !== (pageIndex % projected.layoutBlockPageCount) * layout.byteLength) {
      throw new Error(`Prepared cssFlower projected page ${pageIndex} is invalid`);
    }
    nextStateIndex += page.usedFrameCount;
  }
  if (nextStateIndex !== projected.stateCount || playback.cycle.states.some((state, stateIndex) => {
    const page = projected.pages[state.projectedPageIndex];
    return !page || !Number.isSafeInteger(state.projectedFrameIndex) || state.projectedFrameIndex < 0 ||
      state.projectedFrameIndex >= page.usedFrameCount ||
      page.startStateIndex + state.projectedFrameIndex !== stateIndex;
  })) {
    throw new Error("Prepared cssFlower projected state mapping is incomplete");
  }
}

function validateProjectedTransport(projected) {
  const transport = projected.transport;
  if (transport?.schema !== "cssflower-prepared-visual-pack-transport@1" ||
      transport.representation !== "layout-block-aligned-exact-byte-slices" ||
      transport.packCount !== projected.layoutBlocks.length || transport.packCount !== 37 ||
      transport.blockPageCount !== projected.layoutBlockPageCount ||
      transport.compressedResidentPackBudget !== 2 || transport.earlyPrefetchPageOffset !== 16 ||
      transport.logicalContentAddressedAtlasBytes !== projected.contentAddressedAtlasBytes ||
      transport.logicalCompressedLayoutBytes !== projected.compressedLayoutBytes ||
      transport.runtimeGeometryConstruction !== false || transport.runtimeProjection !== false ||
      transport.runtimeRasterization !== false || transport.runtimeLightingCalculation !== false ||
      transport.packs?.length !== transport.packCount) {
    throw new Error("Complete prepared cssFlower visual-pack transport is required");
  }
  let totalPackBytes = 0;
  let maximumPackBytes = 0;
  for (let packIndex = 0; packIndex < transport.packs.length; packIndex += 1) {
    const pack = transport.packs[packIndex];
    const block = projected.layoutBlocks[packIndex];
    if (pack?.schema !== "cssflower-prepared-visual-pack@1" || pack.index !== packIndex ||
        pack.startPageIndex !== block.startPageIndex || pack.pageCount !== block.pageCount ||
        !Number.isSafeInteger(pack.byteLength) || pack.byteLength < 1 ||
        !/^[a-f0-9]{64}$/.test(pack.sha256 ?? "") ||
        pack.assetUrl !== `/cssflower/assets/projected/visual-pack-${pack.sha256}.bin` ||
        pack.layout?.byteOffset !== 0 || pack.layout.byteLength !== block.byteLength ||
        pack.layout.sha256 !== block.sha256 || pack.layout.decodedByteLength !== block.decodedByteLength ||
        pack.layout.decodedSha256 !== block.decodedSha256 ||
        pack.atlasSlices?.length !== pack.pageCount) {
      throw new Error(`Prepared cssFlower visual pack ${packIndex} is invalid`);
    }
    let expectedOffset = pack.layout.byteLength;
    for (let localPageIndex = 0; localPageIndex < pack.pageCount; localPageIndex += 1) {
      const pageIndex = pack.startPageIndex + localPageIndex;
      const page = projected.pages[pageIndex];
      const slice = pack.atlasSlices[localPageIndex];
      if (slice?.pageIndex !== pageIndex || slice.byteOffset !== expectedOffset ||
          slice.byteLength !== page.atlas.byteLength || slice.sha256 !== page.atlas.sha256 ||
          slice.mimeType !== page.atlas.mimeType) {
        throw new Error(`Prepared cssFlower visual pack ${packIndex} atlas slice ${pageIndex} is invalid`);
      }
      expectedOffset += slice.byteLength;
    }
    if (expectedOffset !== pack.byteLength) {
      throw new Error(`Prepared cssFlower visual pack ${packIndex} byte coverage is incomplete`);
    }
    totalPackBytes += pack.byteLength;
    maximumPackBytes = Math.max(maximumPackBytes, pack.byteLength);
  }
  if (totalPackBytes !== transport.totalPackBytes || maximumPackBytes !== transport.maximumPackBytes) {
    throw new Error("Prepared cssFlower visual-pack aggregate bytes are invalid");
  }
}

function arraysEqual(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

async function fetchJson(url, { notFoundMessage = "" } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  if (url.endsWith(".gz")) {
    const decoded = await decodedGzipResponseBytes(response);
    try {
      return JSON.parse(new TextDecoder().decode(decoded));
    } catch (error) {
      throw new Error(`Prepared cssFlower gzip JSON ${url} is invalid: ${error.message}`);
    }
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(notFoundMessage || ("Expected JSON from " + url + " but got " + (contentType || "unknown content type")));
  }
  return response.json();
}

async function fetchText(url, { notFoundMessage = "" } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  if (url.endsWith(".gz")) {
    return new TextDecoder().decode(await decodedGzipResponseBytes(response));
  }
  return response.text();
}

async function fetchBytes(url, { notFoundMessage = "", signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  return response.arrayBuffer();
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decode prepared cssFlower gzip assets.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodedGzipResponseBytes(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return (response.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip")
    ? bytes
    : decompressGzip(bytes);
}

async function assertSha256(bytes, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error(`Generated cssFlower ${label} hash is missing.`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error(`Generated cssFlower ${label} identity mismatch (${actual}).`);
}

async function decodeImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}
