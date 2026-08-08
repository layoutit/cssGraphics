import {
  CSSFLOWER_LIGHTING_ATLAS_ENCODING,
  CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE,
  CSSFLOWER_LIGHTING_ATLAS_QUALITY,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_LIGHTING_PAGE_COUNT,
  CSSFLOWER_FRONT_FACE_DILATION_TICKS,
  CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING,
  CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA,
  CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES,
  CSSFLOWER_TRANSFORM_BLOCK_SCHEMA,
  CSSFLOWER_VISIBILITY_POLICY,
} from "./renderContract.mjs";

export function validatePreparedMorphAssets(playback, lighting) {
  const transforms = playback?.transformAsset;
  const frontFacing = playback?.frontFacingSchedule;
  if (frontFacing?.schema !== CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA ||
      frontFacing.stateCount !== playback?.cycle?.stateCount || frontFacing.stateCount !== 360 ||
      frontFacing.faceCount !== 1_200 ||
      frontFacing.dilationTicks !== CSSFLOWER_FRONT_FACE_DILATION_TICKS ||
      frontFacing.selectionDomain !== CSSFLOWER_VISIBILITY_POLICY.selectionDomain ||
      frontFacing.depthComparison !== CSSFLOWER_VISIBILITY_POLICY.depthComparison ||
      frontFacing.minimumOwnedPixels !== CSSFLOWER_VISIBILITY_POLICY.minimumOwnedPixels ||
      frontFacing.sampleGrid !== CSSFLOWER_VISIBILITY_POLICY.sampleGrid ||
      frontFacing.adjacency !== CSSFLOWER_VISIBILITY_POLICY.adjacency ||
      frontFacing.adjacencyRings !== CSSFLOWER_VISIBILITY_POLICY.adjacencyRings ||
      frontFacing.dilationPolicy !== CSSFLOWER_VISIBILITY_POLICY.dilationPolicy ||
      frontFacing.encoding !== CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING ||
      frontFacing.bytesPerState !== Math.ceil(frontFacing.faceCount / 8) ||
      frontFacing.byteLength !== frontFacing.stateCount * frontFacing.bytesPerState ||
      !Number.isSafeInteger(frontFacing.selectedFaceCount) || frontFacing.selectedFaceCount < 1 ||
      frontFacing.selectedFaceCount >= frontFacing.stateCount * frontFacing.faceCount ||
      frontFacing.suppressedFaceCount !== frontFacing.stateCount * frontFacing.faceCount - frontFacing.selectedFaceCount ||
      frontFacing.meanSelectedFacesPerState !== frontFacing.selectedFaceCount / frontFacing.stateCount ||
      !Number.isSafeInteger(frontFacing.minimumSelectedFacesPerState) || frontFacing.minimumSelectedFacesPerState < 1 ||
      !Number.isSafeInteger(frontFacing.maximumSelectedFacesPerState) ||
      frontFacing.maximumSelectedFacesPerState > frontFacing.faceCount ||
      frontFacing.maximumSelectedFacesPerState < frontFacing.minimumSelectedFacesPerState ||
      frontFacing.initialVisibilitySelectionCount !== frontFacing.faceCount ||
      !Number.isSafeInteger(frontFacing.visibilityChangeCount) || frontFacing.visibilityChangeCount < 1 ||
      !/^[a-f0-9]{64}$/u.test(frontFacing.dataSha256 ?? "") ||
      typeof frontFacing.dataBase64 !== "string" || frontFacing.dataBase64.length < 1 ||
      frontFacing.runtimeSelection !== "prepared-bit-test-only-no-geometry-projection-normal-or-lighting-calculation") {
    throw new Error("Complete prepared cssFlower owned-pixel visibility transform schedule is required");
  }
  if (transforms?.schema !== CSSFLOWER_TRANSFORM_BLOCK_SCHEMA ||
      transforms.distribution !== "public-independent-prepared-transform-blocks" ||
      transforms.encoding !== "gzip-newline-utf8-geometry-state-major-triangle-major-matrix3d" ||
      transforms.componentCount !== 16 || transforms.triangleCount !== 1_200 ||
      transforms.geometryStateCount !== playback?.cycle?.geometryStateCount ||
      transforms.blockGeometryStateCount !== CSSFLOWER_TRANSFORM_BLOCK_GEOMETRY_STATES ||
      transforms.blockCount !== Math.ceil(transforms.geometryStateCount / transforms.blockGeometryStateCount) ||
      transforms.blocks?.length !== transforms.blockCount) {
    throw new Error("Complete prepared cssFlower Morph transform blocks are required");
  }
  let coveredGeometryStates = 0;
  for (let blockIndex = 0; blockIndex < transforms.blocks.length; blockIndex += 1) {
    const block = transforms.blocks[blockIndex];
    const expectedStateCount = Math.min(
      transforms.blockGeometryStateCount,
      transforms.geometryStateCount - coveredGeometryStates,
    );
    if (block?.index !== blockIndex || block.startGeometryStateIndex !== coveredGeometryStates ||
        block.geometryStateCount !== expectedStateCount || block.triangleCount !== 1_200 ||
        block.transformCount !== expectedStateCount * 1_200 ||
        !validAssetDescriptor(block, "/cssflower/assets/transforms/")) {
      throw new Error(`Prepared cssFlower transform block ${blockIndex} is invalid`);
    }
    coveredGeometryStates += expectedStateCount;
  }
  if (coveredGeometryStates !== transforms.geometryStateCount ||
      transforms.byteLength !== transforms.blocks.reduce((sum, block) => sum + block.byteLength, 0) ||
      transforms.decodedByteLength !== transforms.blocks.reduce((sum, block) => sum + block.decodedByteLength, 0)) {
    throw new Error("Prepared cssFlower transform block coverage is incomplete");
  }

  if (lighting?.visualEncoding?.encoding !== CSSFLOWER_LIGHTING_ATLAS_ENCODING ||
      lighting.visualEncoding.mimeType !== CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE ||
      lighting.visualEncoding.quality !== CSSFLOWER_LIGHTING_ATLAS_QUALITY ||
      lighting.visualEncoding.exactGeometry !== true ||
      lighting.visualEncoding.exactPreparedPixels !== false ||
      lighting.pageCount !== CSSFLOWER_LIGHTING_PAGE_COUNT || lighting.pages?.length !== lighting.pageCount ||
      lighting.grid?.schema !== "cssflower-prepared-leaf-lighting-grid@1" ||
      lighting.grid.encoding !== CSSFLOWER_LIGHTING_ATLAS_ENCODING ||
      lighting.grid.mimeType !== CSSFLOWER_LIGHTING_ATLAS_MIME_TYPE ||
      lighting.grid.quality !== CSSFLOWER_LIGHTING_ATLAS_QUALITY ||
      lighting.grid.columns !== CSSFLOWER_LIGHTING_GRID_COLUMNS ||
      lighting.grid.rows !== CSSFLOWER_LIGHTING_GRID_ROWS ||
      lighting.grid.width !== CSSFLOWER_LIGHTING_GRID_WIDTH ||
      lighting.grid.height !== CSSFLOWER_LIGHTING_GRID_HEIGHT ||
      lighting.grid.decodedBytes !== CSSFLOWER_LIGHTING_GRID_DECODED_BYTES ||
      !validAssetDescriptor(lighting.grid, "/cssflower/assets/lighting/grid-")) {
    throw new Error("Complete prepared cssFlower leaf-lighting grid is required");
  }
  let coveredTimelineStates = 0;
  for (let pageIndex = 0; pageIndex < lighting.pages.length; pageIndex += 1) {
    const page = lighting.pages[pageIndex];
    const expectedRows = Math.min(lighting.pageRowCount, lighting.timelineRowCount - coveredTimelineStates);
    if (page?.index !== pageIndex || page.startStateIndex !== coveredTimelineStates ||
        page.usedRowCount !== expectedRows || page.rowCount !== lighting.pageRowCount ||
        page.width !== lighting.atlasWidth || page.height !== lighting.atlasHeight ||
        page.decodedBytes !== page.width * page.height * 4 ||
        page.gridColumn !== pageIndex || page.gridRow !== 0 ||
        page.gridOffsetX !== pageIndex * lighting.atlasWidth || page.gridOffsetY !== 0 ||
        page.sourceEncoding !== "PNG-RGBA8" ||
        !Number.isSafeInteger(page.sourcePngByteLength) || page.sourcePngByteLength < 1 ||
        !/^[a-f0-9]{64}$/u.test(page.sourcePngSha256 ?? "")) {
      throw new Error(`Prepared cssFlower lighting page ${pageIndex} is invalid`);
    }
    coveredTimelineStates += expectedRows;
  }
  if (coveredTimelineStates !== lighting.timelineRowCount) {
    throw new Error("Prepared cssFlower lighting page coverage is incomplete");
  }
  if (playback.cycle.states.some((state) => {
    const expectedBlockIndex = Math.floor(
      state.geometryStateIndex / transforms.blockGeometryStateCount,
    );
    const nextBlockIndex = Math.floor(
      state.nextTransformBlockGeometryStateIndex / transforms.blockGeometryStateCount,
    );
    return state.transformBlockIndex !== expectedBlockIndex ||
      !Number.isSafeInteger(state.nextTransformBlockGeometryStateIndex) ||
      state.nextTransformBlockGeometryStateIndex < 0 ||
      state.nextTransformBlockGeometryStateIndex >= transforms.geometryStateCount ||
      nextBlockIndex === expectedBlockIndex ||
      !Number.isSafeInteger(state.lightingPageIndex) || state.lightingPageIndex < 0 ||
      state.lightingPageIndex >= lighting.pageCount ||
      !Number.isSafeInteger(state.lightingPageRowIndex) || state.lightingPageRowIndex < 0 ||
      state.lightingPageRowIndex >= lighting.pageRowCount ||
      !Number.isSafeInteger(state.nextLightingPageIndex) || state.nextLightingPageIndex < 0 ||
      state.nextLightingPageIndex >= lighting.pageCount ||
      state.nextLightingPageIndex === state.lightingPageIndex;
  })) {
    throw new Error("Prepared cssFlower asset prefetch schedule is incomplete");
  }
}

export function createPreparedTransformBlockLoader(transforms) {
  const records = new Map();
  const allBlockIndices = new Set(transforms.blocks.map((block) => block.index));
  const errors = [];
  let currentBlockIndex = 0;
  let loadCount = 0;
  let releaseCount = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let desiredBlockIndices = new Set();
  let destroyed = false;

  async function ensure(blockIndex) {
    if (destroyed) throw new Error("Prepared cssFlower transform loader is destroyed");
    const block = transforms.blocks[blockIndex];
    if (!block || block.index !== blockIndex) throw new RangeError(`Prepared transform block ${blockIndex} is missing`);
    const existing = records.get(blockIndex);
    if (existing?.transforms) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(block.assetUrl));
      if (encoded.byteLength !== block.byteLength) throw new Error(`Prepared transform block ${blockIndex} byte length drifted`);
      await assertSha256(encoded, block.sha256, `transform block ${blockIndex}`);
      const decoded = await decompressGzip(encoded);
      if (decoded.byteLength !== block.decodedByteLength) throw new Error(`Prepared transform block ${blockIndex} decoded length drifted`);
      await assertSha256(decoded, block.decodedSha256, `decoded transform block ${blockIndex}`);
      const text = new TextDecoder().decode(decoded);
      if (!text.endsWith("\n")) throw new Error(`Prepared transform block ${blockIndex} is not newline terminated`);
      const rows = text.slice(0, -1).split("\n");
      if (rows.length !== block.transformCount || rows.some((row) => !/^matrix3d\([^)]+\)$/u.test(row))) {
        throw new Error(`Prepared transform block ${blockIndex} rows are invalid`);
      }
      const record = Object.freeze({ blockIndex, transforms: Object.freeze(rows) });
      records.set(blockIndex, record);
      loadCount += 1;
      residentDecodedBytes += block.decodedByteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (destroyed || !desiredBlockIndices.has(blockIndex)) release(blockIndex, record);
      return record;
    })();
    records.set(blockIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (records.get(blockIndex)?.promise === promise) records.delete(blockIndex);
      errors.push(String(error?.message || error));
      throw error;
    }
  }

  function release(blockIndex, record) {
    if (!record?.transforms || records.get(blockIndex) !== record) return;
    records.delete(blockIndex);
    residentDecodedBytes -= transforms.blocks[blockIndex].decodedByteLength;
    releaseCount += 1;
  }

  function releaseExcept(indices) {
    desiredBlockIndices = new Set(indices);
    for (const [blockIndex, record] of records) {
      if (!indices.has(blockIndex)) release(blockIndex, record);
    }
  }

  function blockIndexForGeometryState(geometryStateIndex) {
    if (!Number.isSafeInteger(geometryStateIndex) || geometryStateIndex < 0 ||
        geometryStateIndex >= transforms.geometryStateCount) {
      throw new RangeError(`Prepared geometry state ${geometryStateIndex} is invalid`);
    }
    return Math.floor(geometryStateIndex / transforms.blockGeometryStateCount);
  }

  function prefetch(blockIndex) {
    if (records.get(blockIndex)?.transforms) return;
    void ensure(blockIndex).catch(() => undefined);
  }

  return Object.freeze({
    async prime(geometryStateIndex, nextGeometryStateIndex) {
      const current = blockIndexForGeometryState(geometryStateIndex);
      blockIndexForGeometryState(nextGeometryStateIndex);
      currentBlockIndex = current;
      desiredBlockIndices = new Set(allBlockIndices);
      await Promise.all([...allBlockIndices].map(ensure));
    },
    async activate(geometryStateIndex, nextGeometryStateIndex) {
      const target = blockIndexForGeometryState(geometryStateIndex);
      const next = blockIndexForGeometryState(nextGeometryStateIndex);
      const record = await ensure(target);
      currentBlockIndex = target;
      prefetch(next);
      return record;
    },
    forEachTransform(geometryStateIndex, visit) {
      if (typeof visit !== "function") throw new TypeError("Prepared transform visitor is required");
      const blockIndex = blockIndexForGeometryState(geometryStateIndex);
      const record = records.get(blockIndex);
      if (!record?.transforms) throw new Error(`Prepared transform block ${blockIndex} is not decoded`);
      const localState = geometryStateIndex - transforms.blocks[blockIndex].startGeometryStateIndex;
      const start = localState * transforms.triangleCount;
      for (let leafIndex = 0; leafIndex < transforms.triangleCount; leafIndex += 1) {
        visit(record.transforms[start + leafIndex], leafIndex);
      }
    },
    transformAt(geometryStateIndex, leafIndex) {
      if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= transforms.triangleCount) {
        throw new RangeError(`Prepared transform leaf ${leafIndex} is invalid`);
      }
      const blockIndex = blockIndexForGeometryState(geometryStateIndex);
      const record = records.get(blockIndex);
      if (!record?.transforms) throw new Error(`Prepared transform block ${blockIndex} is not decoded`);
      const localState = geometryStateIndex - transforms.blocks[blockIndex].startGeometryStateIndex;
      return record.transforms[localState * transforms.triangleCount + leafIndex];
    },
    commitPresented(geometryStateIndex, nextGeometryStateIndex) {
      const current = blockIndexForGeometryState(geometryStateIndex);
      const next = blockIndexForGeometryState(nextGeometryStateIndex);
      currentBlockIndex = current;
      prefetch(next);
    },
    stats() {
      return Object.freeze({
        schema: "cssflower-prepared-transform-block-loader@1",
        currentBlockIndex,
        loadCount,
        releaseCount,
        residentBlockCount: [...records.values()].filter((record) => record?.transforms).length,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        desiredBlockIndices: Object.freeze([...desiredBlockIndices].sort((a, b) => a - b)),
        errors: Object.freeze([...errors]),
      });
    },
    destroy() {
      destroyed = true;
      releaseExcept(new Set());
    },
  });
}

export function createPreparedLightingPageLoader(lighting) {
  const errors = [];
  let record = null;
  let promise = null;
  let currentPageIndex = 0;
  let loadCount = 0;
  let releaseCount = 0;
  let destroyed = false;

  async function ensure() {
    if (destroyed) throw new Error("Prepared cssFlower lighting loader is destroyed");
    if (record?.url) return record;
    if (promise) return promise;
    promise = (async () => {
      const bytes = new Uint8Array(await fetchBytes(lighting.grid.assetUrl));
      if (bytes.byteLength !== lighting.grid.byteLength) throw new Error("Prepared lighting grid byte length drifted");
      await assertSha256(bytes, lighting.grid.sha256, "lighting grid");
      const url = URL.createObjectURL(new Blob([bytes], { type: lighting.grid.mimeType }));
      let image;
      try {
        image = await decodeImage(url);
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      if (image.naturalWidth !== lighting.grid.width || image.naturalHeight !== lighting.grid.height) {
        image.removeAttribute("src");
        URL.revokeObjectURL(url);
        throw new Error(`Prepared lighting grid dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`);
      }
      record = Object.freeze({ gridIndex: 0, url, image });
      loadCount += 1;
      if (destroyed) release();
      return record;
    })();
    try {
      return await promise;
    } catch (error) {
      errors.push(String(error?.message || error));
      throw error;
    } finally {
      promise = null;
    }
  }

  function release() {
    if (!record?.url) return;
    record.image.removeAttribute("src");
    URL.revokeObjectURL(record.url);
    record = null;
    releaseCount += 1;
  }

  function assertPageIndex(pageIndex) {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= lighting.pageCount) {
      throw new RangeError(`Prepared lighting page ${pageIndex} is missing`);
    }
  }

  return Object.freeze({
    async prime(pageIndex, nextPageIndex) {
      assertPageIndex(pageIndex);
      assertPageIndex(nextPageIndex);
      currentPageIndex = pageIndex;
      await ensure();
    },
    urlFor(pageIndex) {
      assertPageIndex(pageIndex);
      if (!record?.url) throw new Error(`Prepared lighting page ${pageIndex} is not decoded`);
      return record.url;
    },
    async activate(pageIndex, nextPageIndex) {
      assertPageIndex(pageIndex);
      assertPageIndex(nextPageIndex);
      await ensure();
      currentPageIndex = pageIndex;
      return record;
    },
    commitPresented(pageIndex, nextPageIndex) {
      assertPageIndex(pageIndex);
      assertPageIndex(nextPageIndex);
      if (pageIndex !== currentPageIndex || !record?.url) {
        throw new Error(`Prepared lighting page ${pageIndex} cannot be committed before presentation`);
      }
    },
    stats() {
      return Object.freeze({
        schema: "cssflower-prepared-lighting-grid-loader@1",
        currentPageIndex,
        loadCount,
        releaseCount,
        residentGridCount: record?.url ? 1 : 0,
        residentDecodedBytes: record?.url ? lighting.grid.decodedBytes : 0,
        peakResidentDecodedBytes: loadCount > 0 ? lighting.grid.decodedBytes : 0,
        errors: Object.freeze([...errors]),
      });
    },
    destroy() {
      destroyed = true;
      release();
    },
  });
}

function validAssetDescriptor(value, prefix) {
  return typeof value?.assetUrl === "string" && value.assetUrl.startsWith(prefix) &&
    Number.isSafeInteger(value.byteLength) && value.byteLength > 0 &&
    /^[a-f0-9]{64}$/u.test(value.sha256 ?? "") &&
    (!Object.hasOwn(value, "decodedByteLength") ||
      Number.isSafeInteger(value.decodedByteLength) && value.decodedByteLength > 0 &&
      /^[a-f0-9]{64}$/u.test(value.decodedSha256 ?? ""));
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decode prepared cssFlower gzip assets");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function assertSha256(bytes, expected, label) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error(`Generated cssFlower ${label} identity mismatch (${actual})`);
}

async function decodeImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}
