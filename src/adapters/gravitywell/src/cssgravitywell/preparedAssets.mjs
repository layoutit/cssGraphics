import {
  CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES,
  CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS,
  CSSGRAVITYWELL_VISIBILITY_ENCODING,
  CSSGRAVITYWELL_VISIBILITY_SCHEMA,
} from "../prepare/cssgravitywell/visibilitySchedule.mjs";
import { CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT } from "./renderContract.mjs";

const MATRIX_DECIMAL_PLACES = 2;
const MATRIX_COMPONENTS = Object.freeze([0, 1, 2, 4, 5, 8, 9, 10, 12, 13, 14]);
const MATRIX_DATA_STREAM_COUNT = MATRIX_COMPONENTS.length * 2 + 1;
const MATRIX_STREAM_COUNT = MATRIX_DATA_STREAM_COUNT + 3;
const COLOR_ROWS_STREAM_INDEX = MATRIX_DATA_STREAM_COUNT;
const TRANSFORM_INDICES_STREAM_INDEX = COLOR_ROWS_STREAM_INDEX + 1;
const COLOR_INDICES_STREAM_INDEX = TRANSFORM_INDICES_STREAM_INDEX + 1;
const MATRIX_BLOCK_HEADER_BYTES = 8 + MATRIX_STREAM_COUNT * Uint32Array.BYTES_PER_ELEMENT;

export async function loadPreparedGravityWellCatalog() {
  const response = await fetch("/cssgravitywell/catalog.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Gravity Well catalog load failed (${response.status})`);
  const catalog = await response.json();
  if (catalog?.schema !== "cssgravitywell-prepared-bank-catalog@1" ||
      catalog.bankCount !== 24 || catalog.entries?.length !== catalog.bankCount ||
      catalog.colorPaletteAsset?.distribution !== "embedded-prepared-bank-catalog" ||
      catalog.colorPaletteAsset.encoding !== "gzip-newline-utf8-prepared-css-colors" ||
      catalog.colorPaletteAsset.entryCount !== 4_096 ||
      catalog.entries.some((entry, index) => entry.index !== index ||
        !Number.isSafeInteger(entry.seed) || entry.seed <= 0 || typeof entry.sceneUrl !== "string" ||
        entry.flatStateSha256 !== catalog.flatStateSha256)) {
    throw new Error("Gravity Well prepared bank catalog drifted");
  }
  const descriptor = catalog.colorPaletteAsset;
  const encoded = decodeBase64(descriptor.encodedBase64);
  await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, "prepared color palette");
  const decoded = await decompressGzip(encoded);
  if (decoded.byteLength !== descriptor.decodedByteLength) {
    throw new Error("Gravity Well prepared color palette byte length drifted");
  }
  const text = new TextDecoder().decode(decoded);
  const colorPalette = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
  if (colorPalette.length !== descriptor.entryCount) {
    throw new Error("Gravity Well prepared color palette rows drifted");
  }
  return Object.freeze({ ...catalog, colorPalette: Object.freeze(colorPalette) });
}

export function selectInitialGravityWellBank(catalog, {
  search = globalThis.location?.search ?? "",
  randomUint32 = cryptoRandomUint32,
} = {}) {
  const requested = new URLSearchParams(search).get("bank");
  if (requested !== null) {
    const bankIndex = Number(requested);
    if (!Number.isSafeInteger(bankIndex) || bankIndex < 0 || bankIndex >= catalog.bankCount) {
      throw new RangeError("Gravity Well requested bank is invalid");
    }
    return Object.freeze({ bankIndex, mode: "explicit" });
  }
  const value = randomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("Gravity Well initial-bank random value must be uint32");
  }
  return Object.freeze({ bankIndex: value % catalog.bankCount, mode: "crypto-random" });
}

export async function loadPreparedGravityWellBankScene(catalog, bankIndex) {
  const entry = catalog.entries[bankIndex];
  if (!entry || entry.index !== bankIndex) throw new RangeError(`Missing Gravity Well bank ${bankIndex}`);
  const encoded = new Uint8Array(await fetchBytes(entry.sceneUrl));
  await verifyBytes(encoded, entry.sceneByteLength, entry.sceneSha256, `bank scene ${bankIndex}`);
  const sourceScene = JSON.parse(new TextDecoder().decode(encoded));
  const visibilitySchedule = await decodePreparedViewportVisibility(sourceScene.playback?.visibilityAsset);
  const playback = Object.freeze({
    ...sourceScene.playback,
    colorAsset: Object.freeze({
      ...sourceScene.playback?.colorAsset,
      palette: catalog.colorPalette,
    }),
    visibilitySchedule,
  });
  const scene = Object.freeze({ ...sourceScene, playback });
  if (scene?.schema !== "cssgravitywell-prepared-bank@1" || scene.bankIndex !== bankIndex ||
      scene.seed !== entry.seed || scene.playback?.schema !== "cssgravitywell-sparse-transform-block-playback@1" ||
      scene.playback.leafCount !== scene.metrics?.preparedLeafCount || scene.playback.loop !== false ||
      scene.playback.blockCount !== CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT ||
      scene.playback.blocks?.length !== CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT ||
      scene.playback.visibilitySchedule?.schema !== CSSGRAVITYWELL_VISIBILITY_SCHEMA ||
      scene.playback.runtimeLookaheadBlockCount !== 1 ||
      scene.timeline?.firstAndLastGroundFlat !== true ||
      scene.timeline?.allWellsCompleteBeforeSwitch !== true ||
      scene.timeline.allWellsCompleteFrameIndex >= scene.timeline.terminalFlatFrameIndex ||
      scene.timeline.drainFrameStartIndex !== scene.timeline.sourceFrameEndIndex + 1 ||
      scene.timeline.terminalFlatFrameIndex !== scene.playback.frameCount - 1 ||
      scene.timeline.switchPreparedBankAtEnd !== true ||
      scene.timeline.flatStateSha256 !== catalog.flatStateSha256) {
    throw new Error(`Gravity Well prepared bank ${bankIndex} drifted`);
  }
  return Object.freeze(scene);
}

export function createTransformBlockLoader(playback, scheduling = {}) {
  const records = new Map();
  const frameView = { transforms: null, start: 0, count: 0, mode: "full" };
  const colorFrameView = { values: null, start: 0, count: 0, mode: "full" };
  const fullFrameTransforms = new Array(playback.leafCount);
  const fullFrameColors = new Uint16Array(playback.leafCount);
  const transformOffsets = playback.changeAsset?.transformOffsets;
  let transformIndices = null;
  let changeSchedule = null;
  if (playback?.schema !== "cssgravitywell-sparse-transform-block-playback@1" ||
      playback.blocks?.length !== playback.blockCount || playback.runtimeLookaheadBlockCount !== 1 ||
      playback.colorAsset?.distribution !== "prepared-transform-blocks" ||
      playback.changeAsset?.distribution !== "prepared-transform-block-0" ||
      !Array.isArray(transformOffsets)) {
    throw new Error("Gravity Well sparse transform loader contract drifted");
  }
  for (const [blockIndex, descriptor] of playback.blocks.entries()) {
    const expectedStart = blockIndex * playback.blockFrameCount;
    const expectedFrameCount = Math.min(playback.blockFrameCount, playback.frameCount - expectedStart);
    if (descriptor?.schema !== "cssgravitywell-sparse-transform-block@1" ||
        descriptor.index !== blockIndex || descriptor.startFrameIndex !== expectedStart ||
        descriptor.frameCount !== expectedFrameCount || descriptor.keyframeTransformCount !== playback.leafCount ||
        descriptor.transformChangeStart !== transformOffsets[expectedStart] ||
        descriptor.transformChangeEnd !== transformOffsets[expectedStart + expectedFrameCount] ||
        descriptor.deltaTransformCount !== descriptor.transformChangeEnd - descriptor.transformChangeStart ||
        descriptor.transformCount !== descriptor.keyframeTransformCount + descriptor.deltaTransformCount ||
        descriptor.colorChangeStart !== playback.changeAsset.colorOffsets[expectedStart] ||
        descriptor.colorChangeEnd !== playback.changeAsset.colorOffsets[expectedStart + expectedFrameCount] ||
        descriptor.colorValueCount !== playback.leafCount + descriptor.colorChangeEnd - descriptor.colorChangeStart ||
        descriptor.preparedCssStringByteLength < descriptor.transformCount ||
        descriptor.matrixDecimalPlaces !== MATRIX_DECIMAL_PLACES ||
        !sameNumbers(descriptor.matrixVariableComponents, MATRIX_COMPONENTS) ||
        descriptor.encoding !== "gzip-field-major-delta-varint-fixed2-matrix-and-bank-schedule@2") {
      throw new Error(`Gravity Well sparse transform block ${blockIndex} drifted`);
    }
  }
  let desiredCurrent = -1;
  let desiredNext = -1;
  let activeBlockIndex = -1;
  let activeRecord = null;
  let loadCount = 0;
  let releaseCount = 0;
  let residentDecodedBytes = 0;
  let peakResidentDecodedBytes = 0;
  let randomAccessReconstructionCount = 0;
  let randomAccessTransformAssignmentCount = 0;
  let randomAccessColorAssignmentCount = 0;
  let activationWaitCount = 0;
  let incrementalDecodeRequestCount = 0;
  let incrementalDecodeCompletedBlockCount = 0;
  let incrementalDecodeSliceCount = 0;
  let incrementalDecodeOperationCount = 0;
  let incrementalDecodeMaximumSliceMilliseconds = 0;
  let destroyed = false;
  const requestIdle = scheduling.requestIdle ?? defaultRequestIdle;
  const setDelay = scheduling.setDelay ?? globalThis.setTimeout.bind(globalThis);
  const readNow = scheduling.readNow ?? defaultReadNow;
  const incrementalSliceBudgetMilliseconds = scheduling.incrementalSliceBudgetMilliseconds ?? 2;
  if (typeof requestIdle !== "function" || typeof setDelay !== "function" ||
      typeof readNow !== "function" ||
      !Number.isFinite(incrementalSliceBudgetMilliseconds) ||
      incrementalSliceBudgetMilliseconds <= 0 || incrementalSliceBudgetMilliseconds > 4) {
    throw new TypeError("Gravity Well incremental transform decoder scheduling is invalid");
  }
  function nextBlockIndex(blockIndex) {
    const next = blockIndex + 1;
    return next < playback.blocks.length ? next : -1;
  }

  async function ensure(blockIndex, { incremental = false } = {}) {
    if (destroyed) throw new Error("Gravity Well transform loader is destroyed");
    const descriptor = playback.blocks[blockIndex];
    if (!descriptor || descriptor.index !== blockIndex) throw new RangeError(`Missing transform block ${blockIndex}`);
    const existing = records.get(blockIndex);
    if (existing?.transforms) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      const encoded = new Uint8Array(await fetchBytes(descriptor.assetUrl));
      await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, `transform block ${blockIndex}`);
      const decoded = await decompressGzip(encoded);
      if (decoded.byteLength !== descriptor.decodedByteLength) {
        throw new Error(`Decoded transform block ${blockIndex} byte length drifted`);
      }
      const prepared = incremental
        ? await decodePreparedTransformBlockIncrementally(
          decoded,
          descriptor,
          playback,
          transformIndices,
          {
            requestIdle,
            setDelay,
            readNow,
            sliceBudgetMilliseconds: incrementalSliceBudgetMilliseconds,
            isCurrent: () => !destroyed && (blockIndex === desiredCurrent || blockIndex === desiredNext),
            onSlice(operationCount, durationMilliseconds) {
              incrementalDecodeSliceCount += 1;
              incrementalDecodeOperationCount += operationCount;
              incrementalDecodeMaximumSliceMilliseconds = Math.max(
                incrementalDecodeMaximumSliceMilliseconds,
                durationMilliseconds,
              );
            },
          },
        )
        : decodePreparedTransformBlock(decoded, descriptor, playback, transformIndices);
      if (prepared === null) throw new Error(`Transform block ${blockIndex} incremental decode was cancelled`);
      if (prepared.bankSchedule && transformIndices === null) {
        transformIndices = prepared.bankSchedule.transformIndices;
        changeSchedule = createPreparedChangeSchedule(
          playback,
          transformIndices,
          prepared.bankSchedule.colorIndices,
        );
      }
      const transforms = prepared.transforms;
      if (transforms.length !== descriptor.transformCount) {
        throw new Error(`Transform block ${blockIndex} rows are invalid`);
      }
      const record = Object.freeze({
        blockIndex,
        transforms: Object.freeze(transforms),
        colorValues: prepared.colorValues,
      });
      records.set(blockIndex, record);
      loadCount += 1;
      if (incremental) incrementalDecodeCompletedBlockCount += 1;
      residentDecodedBytes += descriptor.preparedCssStringByteLength;
      peakResidentDecodedBytes = Math.max(peakResidentDecodedBytes, residentDecodedBytes);
      if (blockIndex !== desiredCurrent && blockIndex !== desiredNext) release(blockIndex);
      return record;
    })();
    records.set(blockIndex, { promise });
    try {
      return await promise;
    } catch (error) {
      if (records.get(blockIndex)?.promise === promise) records.delete(blockIndex);
      throw error;
    }
  }

  function release(blockIndex) {
    const record = records.get(blockIndex);
    if (!record?.transforms) return;
    records.delete(blockIndex);
    residentDecodedBytes -= playback.blocks[blockIndex].preparedCssStringByteLength;
    releaseCount += 1;
  }

  function adopt(current, next, record) {
    desiredCurrent = current;
    desiredNext = next;
    activeBlockIndex = current;
    activeRecord = record;
    if (next >= 0 && !records.has(next)) {
      incrementalDecodeRequestCount += 1;
      void ensure(next, { incremental: true }).catch(() => undefined);
    }
    for (const blockIndex of records.keys()) {
      if (blockIndex !== current && blockIndex !== next) release(blockIndex);
    }
  }

  return Object.freeze({
    async prime(frameIndex = 0, { lookahead = false, incremental = false } = {}) {
      const current = Math.trunc(frameIndex / playback.blockFrameCount);
      if (current !== 0) throw new Error("Gravity Well prepared bank must prime from block zero");
      const next = lookahead ? nextBlockIndex(current) : -1;
      desiredCurrent = current;
      desiredNext = next;
      const record = await ensure(current, { incremental });
      if (next >= 0) await ensure(next, { incremental });
      activeBlockIndex = current;
      activeRecord = record;
    },
    bankData() {
      if (!changeSchedule || !(transformIndices instanceof Uint16Array)) {
        throw new Error("Gravity Well prepared bank schedule is not loaded");
      }
      return Object.freeze({ changeSchedule });
    },
    prefetchLookahead() {
      const next = nextBlockIndex(activeBlockIndex);
      desiredNext = next;
      if (next < 0 || records.has(next)) return null;
      incrementalDecodeRequestCount += 1;
      return ensure(next, { incremental: true });
    },
    activate(frameIndex) {
      const current = Math.trunc(frameIndex / playback.blockFrameCount);
      if (current === activeBlockIndex && activeRecord?.transforms) return null;
      const next = nextBlockIndex(current);
      desiredCurrent = current;
      desiredNext = next;
      const existing = records.get(current);
      if (existing?.transforms) {
        adopt(current, next, existing);
        return null;
      }
      activationWaitCount += 1;
      return ensure(current, { incremental: true }).then((record) => adopt(current, next, record));
    },
    selectFrame(frameIndex, sequential = false) {
      const current = Math.trunc(frameIndex / playback.blockFrameCount);
      if (current !== activeBlockIndex || !activeRecord?.transforms) {
        throw new Error(`Transform block ${current} is not active`);
      }
      const descriptor = playback.blocks[activeBlockIndex];
      const changeStart = transformOffsets[frameIndex];
      const changeEnd = transformOffsets[frameIndex + 1];
      if (sequential) {
        frameView.transforms = activeRecord.transforms;
        frameView.start = playback.leafCount + changeStart - descriptor.transformChangeStart;
        frameView.count = changeEnd - changeStart;
        frameView.mode = "delta";
        return frameView;
      }
      if (frameIndex === descriptor.startFrameIndex) {
        frameView.transforms = activeRecord.transforms;
        frameView.start = 0;
        frameView.count = playback.leafCount;
        frameView.mode = "keyframe";
        return frameView;
      }
      for (let leafIndex = 0; leafIndex < playback.leafCount; leafIndex += 1) {
        fullFrameTransforms[leafIndex] = activeRecord.transforms[leafIndex];
      }
      let assignmentCount = playback.leafCount;
      for (let reconstructionFrame = descriptor.startFrameIndex + 1;
        reconstructionFrame <= frameIndex; reconstructionFrame += 1) {
        const reconstructionStart = transformOffsets[reconstructionFrame];
        const reconstructionEnd = transformOffsets[reconstructionFrame + 1];
        const rowStart = playback.leafCount + reconstructionStart - descriptor.transformChangeStart;
        for (let changeIndex = reconstructionStart; changeIndex < reconstructionEnd; changeIndex += 1) {
          fullFrameTransforms[transformIndices[changeIndex]] =
            activeRecord.transforms[rowStart + changeIndex - reconstructionStart];
        }
        assignmentCount += reconstructionEnd - reconstructionStart;
      }
      randomAccessReconstructionCount += 1;
      randomAccessTransformAssignmentCount += assignmentCount;
      frameView.transforms = fullFrameTransforms;
      frameView.start = 0;
      frameView.count = playback.leafCount;
      frameView.mode = "full";
      return frameView;
    },
    selectColorFrame(frameIndex, sequential = false) {
      const current = Math.trunc(frameIndex / playback.blockFrameCount);
      if (current !== activeBlockIndex || !(activeRecord?.colorValues instanceof Uint16Array)) {
        throw new Error(`Color block ${current} is not active`);
      }
      const descriptor = playback.blocks[activeBlockIndex];
      const colorOffsets = playback.changeAsset.colorOffsets;
      const changeStart = colorOffsets[frameIndex];
      const changeEnd = colorOffsets[frameIndex + 1];
      if (sequential) {
        colorFrameView.values = activeRecord.colorValues;
        colorFrameView.start = playback.leafCount + changeStart - descriptor.colorChangeStart;
        colorFrameView.count = changeEnd - changeStart;
        colorFrameView.mode = "delta";
        return colorFrameView;
      }
      if (frameIndex === descriptor.startFrameIndex) {
        colorFrameView.values = activeRecord.colorValues;
        colorFrameView.start = 0;
        colorFrameView.count = playback.leafCount;
        colorFrameView.mode = "keyframe";
        return colorFrameView;
      }
      fullFrameColors.set(activeRecord.colorValues.subarray(0, playback.leafCount));
      let assignmentCount = playback.leafCount;
      for (let reconstructionFrame = descriptor.startFrameIndex + 1;
        reconstructionFrame <= frameIndex; reconstructionFrame += 1) {
        const reconstructionStart = colorOffsets[reconstructionFrame];
        const reconstructionEnd = colorOffsets[reconstructionFrame + 1];
        const rowStart = playback.leafCount + reconstructionStart - descriptor.colorChangeStart;
        for (let changeIndex = reconstructionStart; changeIndex < reconstructionEnd; changeIndex += 1) {
          fullFrameColors[changeSchedule.colorIndices[changeIndex]] =
            activeRecord.colorValues[rowStart + changeIndex - reconstructionStart];
        }
        assignmentCount += reconstructionEnd - reconstructionStart;
      }
      randomAccessColorAssignmentCount += assignmentCount;
      colorFrameView.values = fullFrameColors;
      colorFrameView.start = 0;
      colorFrameView.count = playback.leafCount;
      colorFrameView.mode = "full";
      return colorFrameView;
    },
    stats() {
      return Object.freeze({
        loadCount,
        releaseCount,
        activeBlockIndex,
        residentBlockCount: [...records.values()].filter((record) => record?.transforms).length,
        residentDecodedBytes,
        peakResidentDecodedBytes,
        randomAccessReconstructionCount,
        randomAccessTransformAssignmentCount,
        randomAccessColorAssignmentCount,
        activationWaitCount,
        incrementalDecodeRequestCount,
        incrementalDecodeCompletedBlockCount,
        incrementalDecodeSliceCount,
        incrementalDecodeOperationCount,
        incrementalDecodeMaximumSliceMilliseconds,
      });
    },
    destroy() {
      destroyed = true;
      for (const blockIndex of [...records.keys()]) release(blockIndex);
    },
  });
}

function createPreparedChangeSchedule(playback, transformIndices, colorIndices) {
  const descriptor = playback.changeAsset;
  if (descriptor?.distribution !== "prepared-transform-block-0" ||
      descriptor.encoding !== "frame-major-reset-delta-varint-transform-indices-then-color-indices" ||
      !Array.isArray(descriptor.transformOffsets) || descriptor.transformOffsets.length !== playback.frameCount + 1 ||
      !Array.isArray(descriptor.colorOffsets) || descriptor.colorOffsets.length !== playback.frameCount + 1 ||
      descriptor.transformOffsets[0] !== 0 ||
      descriptor.transformOffsets.at(-1) !== descriptor.transformChangedLeafIndexCount ||
      descriptor.colorOffsets[0] !== 0 ||
      descriptor.colorOffsets.at(-1) !== descriptor.colorChangedLeafIndexCount ||
      !(transformIndices instanceof Uint16Array) ||
      transformIndices.length !== descriptor.transformChangedLeafIndexCount ||
      !(colorIndices instanceof Uint16Array) ||
      colorIndices.length !== descriptor.colorChangedLeafIndexCount ||
      descriptor.decodedByteLength !== (transformIndices.length + colorIndices.length) * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Gravity Well prepared change schedule drifted");
  }
  const frameView = {
    transformIndices,
    transformStart: 0,
    transformEnd: 0,
    colorIndices,
    colorStart: 0,
    colorEnd: 0,
  };
  return Object.freeze({
    selectFrame(frameIndex, previousFrameIndex) {
      if (previousFrameIndex < 0 || frameIndex !== (previousFrameIndex + 1) % playback.frameCount) return null;
      frameView.transformStart = descriptor.transformOffsets[frameIndex];
      frameView.transformEnd = descriptor.transformOffsets[frameIndex + 1];
      frameView.colorStart = descriptor.colorOffsets[frameIndex];
      frameView.colorEnd = descriptor.colorOffsets[frameIndex + 1];
      return frameView;
    },
    transformCount: transformIndices.length,
    colorCount: colorIndices.length,
    transformOffsets: descriptor.transformOffsets,
    transformIndices,
    colorOffsets: descriptor.colorOffsets,
    colorIndices,
  });
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length < 1) {
    throw new Error("Gravity Well embedded prepared asset is missing");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodePreparedViewportVisibility(descriptor) {
  const legacySquare = descriptor?.schema === "cssgravitywell-prepared-viewport-visibility@1";
  const dimensions = legacySquare
    ? descriptor.profileSizes?.map((size) => ({ width: size, height: size }))
    : descriptor?.profileDimensions;
  if ((!legacySquare && descriptor?.schema !== CSSGRAVITYWELL_VISIBILITY_SCHEMA) ||
      descriptor.distribution !== "embedded-prepared-bank-scene" ||
      descriptor.encoding !== (legacySquare
        ? "gzip-cgwv1-square-profile-sparse-visibility-assignments"
        : CSSGRAVITYWELL_VISIBILITY_ENCODING) ||
      descriptor.selection !== (legacySquare
        ? "smallest-square-profile-covering-maximum-css-viewport-axis-or-disabled"
        : "smallest-area-rectangular-profile-covering-css-viewport-or-disabled") ||
      descriptor.marginPixels !== CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS ||
      descriptor.dilationFrames !== CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES ||
      !Array.isArray(dimensions) || dimensions.length < 1 ||
      descriptor.profiles?.length !== dimensions.length) {
    throw new Error("Gravity Well prepared viewport visibility descriptor drifted");
  }
  const encoded = decodeBase64(descriptor.encodedBase64);
  await verifyBytes(encoded, descriptor.byteLength, descriptor.sha256, "prepared viewport visibility");
  const bytes = await decompressGzip(encoded);
  if (bytes.byteLength !== descriptor.decodedByteLength || bytes.byteLength < 8 ||
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "CGWV" ||
      bytes[4] !== (legacySquare ? 1 : 2) || bytes[5] !== dimensions.length || bytes[6] !== 0 || bytes[7] !== 0) {
    throw new Error("Gravity Well prepared viewport visibility header drifted");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const profiles = [];
  let offset = 8;
  for (let profileIndex = 0; profileIndex < dimensions.length; profileIndex += 1) {
    const headerBytes = legacySquare ? 16 : 18;
    if (offset + headerBytes > bytes.byteLength) throw new Error("Gravity Well viewport visibility profile is truncated");
    const profileDimensions = dimensions[profileIndex];
    const width = legacySquare ? view.getUint16(offset, true) : view.getUint16(offset, true);
    const height = legacySquare ? width : view.getUint16(offset + 2, true);
    const marginPixels = view.getUint16(offset + (legacySquare ? 2 : 4), true);
    const dilationFrames = bytes[offset + (legacySquare ? 4 : 6)];
    const reserved = bytes[offset + (legacySquare ? 5 : 7)];
    const frameCount = view.getUint16(offset + (legacySquare ? 6 : 8), true);
    const leafCount = view.getUint16(offset + (legacySquare ? 8 : 10), true);
    const initialVisibleCount = view.getUint16(offset + (legacySquare ? 10 : 12), true);
    const visibilityChangeCount = view.getUint32(offset + (legacySquare ? 12 : 14), true);
    offset += headerBytes;
    if (width !== profileDimensions.width || height !== profileDimensions.height || marginPixels !== descriptor.marginPixels ||
        dilationFrames !== descriptor.dilationFrames || reserved !== 0 ||
        frameCount !== descriptor.frameCount || leafCount !== descriptor.leafCount ||
        initialVisibleCount !== descriptor.profiles[profileIndex].initialVisibleCount ||
        visibilityChangeCount !== descriptor.profiles[profileIndex].visibilityChangeCount) {
      throw new Error(`Gravity Well viewport visibility profile ${profileIndex} drifted`);
    }
    const initialVisibleIndices = readPreparedUint16Rows(bytes, offset, initialVisibleCount);
    offset += initialVisibleIndices.byteLength;
    const changeOffsets = new Uint32Array(frameCount + 1);
    for (let frameIndex = 0; frameIndex <= frameCount; frameIndex += 1) {
      if (offset + Uint32Array.BYTES_PER_ELEMENT > bytes.byteLength) {
        throw new Error(`Gravity Well viewport visibility offsets ${profileIndex} are truncated`);
      }
      changeOffsets[frameIndex] = view.getUint32(offset, true);
      offset += Uint32Array.BYTES_PER_ELEMENT;
    }
    const assignments = readPreparedUint16Rows(bytes, offset, visibilityChangeCount);
    offset += assignments.byteLength;
    validatePreparedVisibilityProfile({
      width,
      height,
      frameCount,
      leafCount,
      initialVisibleIndices,
      changeOffsets,
      assignments,
    });
    profiles.push(Object.freeze({
      width,
      height,
      frameCount,
      leafCount,
      initialVisibleIndices,
      changeOffsets,
      assignments,
    }));
  }
  if (offset !== bytes.byteLength) throw new Error("Gravity Well viewport visibility payload has trailing bytes");
  return Object.freeze({
    schema: CSSGRAVITYWELL_VISIBILITY_SCHEMA,
    selection: "smallest-area-rectangular-profile-covering-css-viewport-or-disabled",
    frameCount: descriptor.frameCount,
    leafCount: descriptor.leafCount,
    marginPixels: descriptor.marginPixels,
    dilationFrames: descriptor.dilationFrames,
    profiles: Object.freeze(profiles),
  });
}

function readPreparedUint16Rows(bytes, offset, count) {
  const byteLength = count * Uint16Array.BYTES_PER_ELEMENT;
  if (offset + byteLength > bytes.byteLength) throw new Error("Gravity Well viewport visibility rows are truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, byteLength);
  const values = new Uint16Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = view.getUint16(index * Uint16Array.BYTES_PER_ELEMENT, true);
  }
  return values;
}

function validatePreparedVisibilityProfile(profile) {
  const selected = new Uint8Array(profile.leafCount);
  let previous = -1;
  for (const leafIndex of profile.initialVisibleIndices) {
    if (leafIndex <= previous || leafIndex >= profile.leafCount) {
      throw new Error("Gravity Well viewport initial visibility is outside source order");
    }
    selected[leafIndex] = 1;
    previous = leafIndex;
  }
  const initialSelected = selected.slice();
  if (profile.changeOffsets[0] !== 0 || profile.changeOffsets.at(-1) !== profile.assignments.length) {
    throw new Error("Gravity Well viewport visibility offsets drifted");
  }
  for (let frameIndex = 0; frameIndex < profile.frameCount; frameIndex += 1) {
    const start = profile.changeOffsets[frameIndex];
    const end = profile.changeOffsets[frameIndex + 1];
    if (start > end || end > profile.assignments.length || (frameIndex === 0 && end !== 0)) {
      throw new Error("Gravity Well viewport visibility frame range drifted");
    }
    previous = -1;
    for (let index = start; index < end; index += 1) {
      const assignment = profile.assignments[index];
      const leafIndex = assignment >> 1;
      const visible = assignment & 1;
      if (leafIndex <= previous || leafIndex >= profile.leafCount || selected[leafIndex] === visible) {
        throw new Error("Gravity Well viewport visibility assignment drifted");
      }
      selected[leafIndex] = visible;
      previous = leafIndex;
    }
  }
  for (let leafIndex = 0; leafIndex < profile.leafCount; leafIndex += 1) {
    if (selected[leafIndex] !== initialSelected[leafIndex]) {
      throw new Error("Gravity Well terminal viewport visibility is not cyclic");
    }
  }
}

async function decompressGzip(encoded) {
  return new Uint8Array(await new Response(
    new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer());
}

function defaultRequestIdle(callback, options) {
  if (typeof globalThis.requestIdleCallback === "function") {
    return globalThis.requestIdleCallback(callback, options);
  }
  return globalThis.setTimeout(() => callback(Object.freeze({
    didTimeout: true,
    timeRemaining: () => 0,
  })), 0);
}

function defaultReadNow() {
  return globalThis.performance.now();
}

function decodePreparedTransformBlock(bytes, descriptor, playback, loadedTransformIndices) {
  const decoder = createPreparedTransformBlockDecoder(bytes, descriptor, playback, loadedTransformIndices);
  while (!decoder.done()) decoder.step(Number.MAX_SAFE_INTEGER, () => false);
  return decoder.result();
}

async function decodePreparedTransformBlockIncrementally(
  bytes,
  descriptor,
  playback,
  loadedTransformIndices,
  {
    requestIdle,
    setDelay,
    readNow,
    sliceBudgetMilliseconds,
    isCurrent,
    onSlice,
  },
) {
  const decoder = createPreparedTransformBlockDecoder(bytes, descriptor, playback, loadedTransformIndices);
  let firstSlice = true;
  while (!decoder.done()) {
    if (!firstSlice) {
      await new Promise((resolveDelay) => setDelay(resolveDelay, playback.frameMilliseconds));
      if (!isCurrent()) return null;
    }
    firstSlice = false;
    const deadline = await new Promise((resolveIdle) => requestIdle(resolveIdle, {
      timeout: Math.max(50, Math.ceil(playback.frameMilliseconds * 4)),
    }));
    if (!isCurrent()) return null;
    const startedAt = readNow();
    const operationCount = decoder.step(8_192, (processed) =>
      processed >= 64 && processed % 64 === 0 &&
      ((typeof deadline?.timeRemaining === "function" && deadline.timeRemaining() <= 1) ||
        readNow() - startedAt >= sliceBudgetMilliseconds));
    onSlice(operationCount, readNow() - startedAt);
  }
  return decoder.result();
}

function createPreparedTransformBlockDecoder(bytes, descriptor, playback, loadedTransformIndices) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < MATRIX_BLOCK_HEADER_BYTES ||
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "CGWM" ||
      bytes[4] !== 2 || bytes[5] !== MATRIX_DECIMAL_PLACES ||
      bytes[6] !== MATRIX_COMPONENTS.length || bytes[7] !== MATRIX_STREAM_COUNT) {
    throw new Error(`Transform block ${descriptor.index} binary header drifted`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const streams = [];
  let streamOffset = MATRIX_BLOCK_HEADER_BYTES;
  for (let streamIndex = 0; streamIndex < MATRIX_STREAM_COUNT; streamIndex += 1) {
    const length = view.getUint32(8 + streamIndex * Uint32Array.BYTES_PER_ELEMENT, true);
    const end = streamOffset + length;
    if (end > bytes.byteLength) throw new Error(`Transform block ${descriptor.index} stream is truncated`);
    streams.push({ offset: streamOffset, end });
    streamOffset = end;
  }
  if (streamOffset !== bytes.byteLength) {
    throw new Error(`Transform block ${descriptor.index} binary byte length drifted`);
  }
  const colorValues = readUint16LeStream(bytes, streams[COLOR_ROWS_STREAM_INDEX]);
  if (playback.colorAsset.distribution !== "prepared-transform-blocks" ||
      playback.colorAsset.encoding !== "uint16le-block-keyframe-then-frame-major-sparse-fogged-palette-index" ||
      playback.colorAsset.paletteSource !== "prepared-bank-catalog" ||
      playback.colorAsset.palette?.length !== 4_096 ||
      colorValues.length !== descriptor.colorValueCount) {
    throw new Error(`Transform block ${descriptor.index} prepared color values drifted`);
  }
  let bankSchedule = null;
  let transformIndices = loadedTransformIndices;
  if (descriptor.index === 0) {
    transformIndices = readPreparedIndexRows(
      bytes,
      streams[TRANSFORM_INDICES_STREAM_INDEX],
      playback.changeAsset.transformOffsets,
    );
    const colorIndices = readPreparedIndexRows(
      bytes,
      streams[COLOR_INDICES_STREAM_INDEX],
      playback.changeAsset.colorOffsets,
    );
    if (transformIndices.length !== playback.changeAsset.transformChangedLeafIndexCount ||
        colorIndices.length !== playback.changeAsset.colorChangedLeafIndexCount) {
      throw new Error("Gravity Well prepared bank schedule counts drifted");
    }
    bankSchedule = Object.freeze({ transformIndices, colorIndices });
  } else {
    if (!(transformIndices instanceof Uint16Array)) {
      throw new Error(`Transform block ${descriptor.index} loaded before its prepared bank schedule`);
    }
    for (let streamIndex = TRANSFORM_INDICES_STREAM_INDEX; streamIndex < MATRIX_STREAM_COUNT; streamIndex += 1) {
      assertStreamConsumed(streams[streamIndex], descriptor.index);
    }
  }
  const componentCount = MATRIX_COMPONENTS.length;
  const state = new Int32Array(descriptor.keyframeTransformCount * componentCount);
  const transforms = new Array(descriptor.transformCount);
  let preparedCssStringByteLength = 0;
  const maskStream = streams[componentCount];
  if (maskStream.end - maskStream.offset !== descriptor.deltaTransformCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error(`Transform block ${descriptor.index} mask stream drifted`);
  }
  const componentStreams = streams.slice(componentCount + 1, MATRIX_DATA_STREAM_COUNT);
  let stage = "components";
  let component = 0;
  let leafIndex = 0;
  let previous = 0;
  let rowIndex = 0;

  function finish() {
    assertStreamConsumed(maskStream, descriptor.index);
    for (const stream of componentStreams) assertStreamConsumed(stream, descriptor.index);
    if (preparedCssStringByteLength !== descriptor.preparedCssStringByteLength) {
      throw new Error(`Transform block ${descriptor.index} prepared CSS byte length drifted`);
    }
    stage = "done";
  }

  return Object.freeze({
    done() {
      return stage === "done";
    },
    step(maximumOperations, shouldYield) {
      let processed = 0;
      while (stage !== "done" && processed < maximumOperations && !shouldYield(processed)) {
        if (stage === "components") {
          const stream = streams[component];
          previous = checkedInt32(previous + readSignedVarint(bytes, stream), descriptor.index);
          state[leafIndex * componentCount + component] = previous;
          leafIndex += 1;
          if (leafIndex === descriptor.keyframeTransformCount) {
            assertStreamConsumed(stream, descriptor.index);
            component += 1;
            leafIndex = 0;
            previous = 0;
            if (component === componentCount) stage = "keyframes";
          }
        } else if (stage === "keyframes") {
          const transform = formatPreparedMatrix(state, leafIndex * componentCount);
          transforms[leafIndex] = transform;
          preparedCssStringByteLength += transform.length;
          leafIndex += 1;
          if (leafIndex === descriptor.keyframeTransformCount) {
            leafIndex = 0;
            stage = descriptor.deltaTransformCount === 0 ? "done" : "deltas";
            if (stage === "done") finish();
          }
        } else {
          const mask = bytes[maskStream.offset] | (bytes[maskStream.offset + 1] << 8);
          maskStream.offset += Uint16Array.BYTES_PER_ELEMENT;
          if ((mask >>> componentCount) !== 0) {
            throw new Error(`Transform block ${descriptor.index} component mask drifted`);
          }
          const changeIndex = descriptor.transformChangeStart + rowIndex;
          const changedLeafIndex = transformIndices[changeIndex];
          if (!Number.isSafeInteger(changedLeafIndex) || changedLeafIndex < 0 ||
              changedLeafIndex >= descriptor.keyframeTransformCount) {
            throw new Error(`Transform block ${descriptor.index} prepared leaf index drifted`);
          }
          const stateOffset = changedLeafIndex * componentCount;
          for (let changedComponent = 0; changedComponent < componentCount; changedComponent += 1) {
            if ((mask & (1 << changedComponent)) === 0) continue;
            state[stateOffset + changedComponent] = checkedInt32(
              state[stateOffset + changedComponent] +
                readSignedVarint(bytes, componentStreams[changedComponent]),
              descriptor.index,
            );
          }
          const transform = formatPreparedMatrix(state, stateOffset);
          transforms[descriptor.keyframeTransformCount + rowIndex] = transform;
          preparedCssStringByteLength += transform.length;
          rowIndex += 1;
          if (rowIndex === descriptor.deltaTransformCount) finish();
        }
        processed += 1;
      }
      return processed;
    },
    result() {
      if (stage !== "done") throw new Error(`Transform block ${descriptor.index} decode is incomplete`);
      return Object.freeze({ transforms, colorValues, bankSchedule });
    },
  });
}

function readPreparedIndexRows(bytes, stream, offsets) {
  const values = new Uint16Array(offsets.at(-1));
  for (let frameIndex = 0; frameIndex < offsets.length - 1; frameIndex += 1) {
    let previous = 0;
    for (let index = offsets[frameIndex]; index < offsets[frameIndex + 1]; index += 1) {
      const value = previous + readUnsignedVarint(bytes, stream);
      if (value < previous || value > 0xffff) {
        throw new Error("Gravity Well prepared leaf-index row drifted");
      }
      values[index] = value;
      previous = value;
    }
  }
  assertStreamConsumed(stream, 0);
  return values;
}

function readUint16LeStream(bytes, stream) {
  const byteLength = stream.end - stream.offset;
  if (byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Gravity Well prepared uint16 stream is not aligned");
  }
  const values = new Uint16Array(byteLength / Uint16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = bytes[stream.offset] | (bytes[stream.offset + 1] << 8);
    stream.offset += Uint16Array.BYTES_PER_ELEMENT;
  }
  assertStreamConsumed(stream, 0);
  return values;
}

function readSignedVarint(bytes, stream) {
  let value = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
    if (stream.offset >= stream.end) throw new Error("Gravity Well prepared varint is truncated");
    const byte = bytes[stream.offset];
    stream.offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
    multiplier *= 0x80;
  }
  throw new Error("Gravity Well prepared varint exceeds uint32");
}

function readUnsignedVarint(bytes, stream) {
  let value = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 3; byteIndex += 1) {
    if (stream.offset >= stream.end) throw new Error("Gravity Well prepared index varint is truncated");
    const byte = bytes[stream.offset];
    stream.offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
  }
  throw new Error("Gravity Well prepared index varint exceeds uint16");
}

function checkedInt32(value, blockIndex) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`Transform block ${blockIndex} fixed-point matrix exceeds int32`);
  }
  return value;
}

function assertStreamConsumed(stream, blockIndex) {
  if (stream.offset !== stream.end) throw new Error(`Transform block ${blockIndex} stream has trailing bytes`);
}

function formatPreparedMatrix(state, offset) {
  return `matrix3d(${formatFixed2(state[offset])},${formatFixed2(state[offset + 1])},${formatFixed2(state[offset + 2])},0,` +
    `${formatFixed2(state[offset + 3])},${formatFixed2(state[offset + 4])},0,0,` +
    `${formatFixed2(state[offset + 5])},${formatFixed2(state[offset + 6])},${formatFixed2(state[offset + 7])},0,` +
    `${formatFixed2(state[offset + 8])},${formatFixed2(state[offset + 9])},${formatFixed2(state[offset + 10])},1)`;
}

function formatFixed2(value) {
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const integer = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  if (fraction === 0) return `${sign}${integer}`;
  if (fraction % 10 === 0) return `${sign}${integer}.${fraction / 10}`;
  return `${sign}${integer}.${String(fraction).padStart(2, "0")}`;
}

function sameNumbers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prepared asset load failed (${response.status} ${url})`);
  return response.arrayBuffer();
}

async function verifyBytes(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) throw new Error(`${label} byte length drifted`);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== expectedSha256) throw new Error(`${label} hash drifted`);
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
