// SPDX-License-Identifier: MIT
import {
  CSSBLACKHOLE_BANK_ENCODING,
  CSSBLACKHOLE_COORDINATE_SCALE,
  CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
  CSSBLACKHOLE_OPACITY_ENCODING,
  CSSBLACKHOLE_OPACITY_PALETTE,
} from "../shared/cssblackhole/preparedBlockTransport.mjs";
import {
  CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS,
  CSSBLACKHOLE_GALACTIC_DOT_COLORS,
  CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS,
} from "../shared/cssblackhole/preparedColorPresentation.mjs";

const TRANSFORM_RESPONSE_CHUNK_SIZE = 4_096;
const EXPECTED_PERIODIC_ORBIT_COUNTS = Object.freeze([
  9, 10, 11, 12, 13, 14, 16, 19, 22, 25, 29, 35, 43, 54, 70, 97,
]);
const EXPECTED_PRESENTATION_SLOT_HOLD_SECONDS = Object.freeze([6, 2.5, 1, 2.5]);
const EXPECTED_PRESENTATION_SLOT_DURATION_SECONDS = Object.freeze([8, 4.5, 3, 4.5]);
const EXPECTED_PRESENTATION_SLOT_FRAME_COUNTS = Object.freeze([480, 270, 180, 270]);
const EXPECTED_PRESENTATION_SLOT_START_FRAME_INDICES = Object.freeze([0, 480, 750, 930]);
const EXPECTED_TRANSITION_START_FRAME_INDICES = Object.freeze([360, 150, 60, 150]);

export async function loadBlackHolePreparedCatalog(descriptor) {
  validateCatalogDescriptor(descriptor);
  const bytes = await fetchVerifiedBytes(descriptor.url, descriptor.byteLength,
    descriptor.sha256, "catalog", "no-store");
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  validateCatalog(catalog);
  return Object.freeze(catalog);
}

export async function loadBlackHolePreparedSnapshot(catalog) {
  const bytes = await fetchVerifiedBytes(catalog.snapshot.url, catalog.snapshot.byteLength,
    catalog.snapshot.sha256, "prepared snapshot", "force-cache");
  return new TextDecoder().decode(bytes);
}

export function createBlackHolePreparedBankWindow(catalog, activeBankIndex) {
  if (!Number.isSafeInteger(activeBankIndex) || activeBankIndex < 0 ||
      activeBankIndex >= catalog.bankCount || catalog.runtimeLookaheadBankCount !== 1) {
    throw new RangeError("BlackHole bank window drifted");
  }
  return Object.freeze([activeBankIndex, (activeBankIndex + 1) % catalog.bankCount]);
}

export function createBlackHolePreparedBlockWindow(catalog, activeBlockIndex) {
  if (!Number.isSafeInteger(activeBlockIndex) || activeBlockIndex < 0 ||
      activeBlockIndex >= catalog.blockCount || catalog.runtimeMaterializedLookaheadBlockCount !== 1) {
    throw new RangeError("BlackHole block window drifted");
  }
  return Object.freeze([activeBlockIndex, (activeBlockIndex + 1) % catalog.blockCount]);
}

export function createBlackHolePreparedStreamLoader(catalog) {
  const worker = new Worker(new URL("./preparedBlockWorker.mjs", import.meta.url), { type: "module" });
  const bankPending = new Map();
  const registerPending = new Map();
  const registeredBanks = new Set();
  const materializedBlocks = new Map();
  const materializePending = new Map();
  const requests = new Map();
  const retainedBanks = new Uint8Array(catalog.bankCount);
  const retainedBlocks = new Uint8Array(catalog.blockCount);
  let requestId = 0;
  let destroyed = false;
  let transportBankFetchCount = 0;
  let transportBankFetchBytes = 0;
  let registeredBankCount = 0;
  let materializedBlockCount = 0;
  let workerBankRegistrationMilliseconds = 0;
  let workerMaterializationMilliseconds = 0;
  let workerMaximumSliceMilliseconds = 0;
  let workerMaterializationSliceCount = 0;
  let mainThreadPreparedBlockAdoptionMilliseconds = 0;
  let workerMaterializationResponseCount = 0;
  let workerMaterializationResponseChunkCount = 0;
  let workerMaterializationResponseIdleSliceCount = 0;
  let workerMaterializationMaximumResponseChunkCharacters = 0;
  let runtimeLoaderAllocationCount = 0;
  let decodedBankTransferCount = 0;
  let decodedBankTransferCopyCount = 0;
  let initializedResolve;
  let initializedReject;
  const initialized = new Promise((resolve, reject) => {
    initializedResolve = resolve;
    initializedReject = reject;
  });

  function rejectAll(error) {
    initializedReject(error);
    for (const request of requests.values()) request.reject(error);
    requests.clear();
    registerPending.clear();
    materializePending.clear();
  }

  function acceptTransformChunk(data, request, response, idleSlice) {
    const adoptionStartedAt = performance.now();
    response.transformChunks[data.chunkIndex] = Object.freeze(data.values);
    response.receivedChunkCount += 1;
    response.receivedTransformCount += data.values.length;
    response.receivedTransformCharacterCount += data.chunkCharacterCount;
    response.idleSliceCount += Number(idleSlice);
    mainThreadPreparedBlockAdoptionMilliseconds += performance.now() - adoptionStartedAt;
    workerMaterializationMaximumResponseChunkCharacters = Math.max(
      workerMaterializationMaximumResponseChunkCharacters, data.chunkCharacterCount);
    if (response.receivedChunkCount === response.chunkCount && response.endData) {
      completeMaterializedResponse(response.endData, request, response);
    }
  }

  function completeMaterializedResponse(data, request, response) {
    const scheduleByteLength = response.frameOffsets.byteLength +
      response.assignmentLeafIndices.byteLength + response.opacityFrameOffsets.byteLength +
      response.opacityLeafIndices.byteLength + response.opacityIndices.byteLength;
    if (response.receivedChunkCount !== response.chunkCount ||
        response.receivedTransformCount !== response.assignmentCount ||
        data.transformCharacterCount !== response.receivedTransformCharacterCount ||
        data.transformCharacterCount > catalog.materialization.maximumTransformCharacters ||
        data.transformCharacterCount > catalog.materialization.transformCharacterLimit ||
        scheduleByteLength > catalog.materialization.maximumScheduleBytes ||
        scheduleByteLength > catalog.materialization.scheduleByteLimit) {
      rejectAll(new Error("BlackHole worker prepared transform completion drifted"));
      return;
    }
    const adoptionStartedAt = performance.now();
    const block = Object.freeze({
      descriptor: response.descriptor,
      frameOffsets: response.frameOffsets,
      assignmentLeafIndices: response.assignmentLeafIndices,
      assignmentCount: response.assignmentCount,
      opacityAssignmentCount: response.opacityAssignmentCount,
      transformChunks: Object.freeze(response.transformChunks),
      transformChunkSize: TRANSFORM_RESPONSE_CHUNK_SIZE,
      transformCharacterCount: data.transformCharacterCount,
      decodedCoordinateByteLength: response.decodedCoordinateByteLength,
      opacityFrameOffsets: response.opacityFrameOffsets,
      opacityLeafIndices: response.opacityLeafIndices,
      opacityIndices: response.opacityIndices,
      scheduleByteLength,
      workerDurationMilliseconds: data.workerDurationMilliseconds,
      workerMaximumSliceMilliseconds: data.workerMaximumSliceMilliseconds,
      workerSliceCount: data.workerSliceCount,
    });
    mainThreadPreparedBlockAdoptionMilliseconds += performance.now() - adoptionStartedAt;
    runtimeLoaderAllocationCount += 1;
    materializedBlockCount += 1;
    workerMaterializationMilliseconds += block.workerDurationMilliseconds;
    workerMaximumSliceMilliseconds = Math.max(
      workerMaximumSliceMilliseconds, block.workerMaximumSliceMilliseconds);
    workerMaterializationSliceCount += block.workerSliceCount;
    workerMaterializationResponseCount += 1;
    workerMaterializationResponseChunkCount += response.chunkCount;
    workerMaterializationResponseIdleSliceCount += response.idleSliceCount;
    materializedBlocks.set(request.index, block);
    materializePending.delete(request.index);
    requests.delete(data.requestId);
    request.resolve(block);
    trim();
  }

  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "initialized") {
      initializedResolve();
      return;
    }
    if (data?.type === "error") {
      const request = requests.get(data.requestId);
      const error = new Error(data.stack || data.message || "BlackHole worker failed");
      if (!request) {
        initializedReject(error);
        return;
      }
      requests.delete(data.requestId);
      if (request.kind === "register") registerPending.delete(request.index);
      else materializePending.delete(request.index);
      request.reject(error);
      return;
    }
    const request = requests.get(data?.requestId);
    if (!request) return;
    if (data.type === "registered-bank") {
      if (request.kind !== "register" || data.bankIndex !== request.index ||
          !Number.isFinite(data.workerDurationMilliseconds) ||
          !Number.isFinite(data.workerMaximumSliceMilliseconds) ||
          data.decodedByteLength !== catalog.banks[request.index].decodedByteLength) {
        rejectAll(new Error("BlackHole worker bank registration response drifted"));
        return;
      }
      registeredBanks.add(request.index);
      registeredBankCount += 1;
      workerBankRegistrationMilliseconds += data.workerDurationMilliseconds;
      workerMaximumSliceMilliseconds = Math.max(
        workerMaximumSliceMilliseconds, data.workerMaximumSliceMilliseconds);
      registerPending.delete(request.index);
      requests.delete(data.requestId);
      request.resolve(request.index);
      trim();
      return;
    }
    if (data.type === "materialized-start") {
      if (request.kind !== "block" || request.response !== undefined ||
          data.descriptor?.index !== request.index ||
          data.descriptor.frameCount !== catalog.blockFrameCount ||
          !Number.isSafeInteger(data.assignmentCount) || data.assignmentCount < catalog.starCount ||
          data.assignmentCount > catalog.materialization.maximumTransformAssignmentCount ||
          data.assignmentCount > catalog.blockFrameCount * catalog.starCount ||
          !Number.isSafeInteger(data.chunkCount) || data.chunkCount < 1 ||
          !(data.frameOffsets instanceof Uint32Array) ||
          data.frameOffsets.length !== catalog.blockFrameCount + 1 ||
          data.frameOffsets[1] !== catalog.starCount ||
          data.frameOffsets[data.frameOffsets.length - 1] !== data.assignmentCount ||
          !(data.assignmentLeafIndices instanceof Uint16Array) ||
          data.assignmentLeafIndices.length !== data.assignmentCount ||
          !Number.isSafeInteger(data.opacityAssignmentCount) ||
          data.opacityAssignmentCount < catalog.starCount ||
          data.opacityAssignmentCount > catalog.materialization.maximumOpacityAssignmentCount ||
          data.opacityAssignmentCount > catalog.blockFrameCount * catalog.starCount ||
          !(data.opacityFrameOffsets instanceof Uint32Array) ||
          data.opacityFrameOffsets.length !== catalog.blockFrameCount + 1 ||
          data.opacityFrameOffsets[0] !== 0 ||
          data.opacityFrameOffsets[1] !== catalog.starCount ||
          data.opacityFrameOffsets.at(-1) !== data.opacityAssignmentCount ||
          !(data.opacityLeafIndices instanceof Uint16Array) ||
          data.opacityLeafIndices.length !== data.opacityAssignmentCount ||
          !(data.opacityIndices instanceof Uint8Array) ||
          data.opacityIndices.length !== data.opacityAssignmentCount ||
          data.decodedCoordinateByteLength !== catalog.blockFrameCount * catalog.starCount * 8) {
        rejectAll(new Error("BlackHole worker prepared transform start drifted"));
        return;
      }
      request.response = {
        descriptor: data.descriptor,
        assignmentCount: data.assignmentCount,
        chunkCount: data.chunkCount,
        receivedChunkCount: 0,
        receivedTransformCount: 0,
        receivedTransformCharacterCount: 0,
        queuedChunkCount: 0,
        idleSliceCount: 0,
        endData: null,
        frameOffsets: data.frameOffsets,
        assignmentLeafIndices: data.assignmentLeafIndices,
        opacityAssignmentCount: data.opacityAssignmentCount,
        opacityFrameOffsets: data.opacityFrameOffsets,
        opacityLeafIndices: data.opacityLeafIndices,
        opacityIndices: data.opacityIndices,
        decodedCoordinateByteLength: data.decodedCoordinateByteLength,
        transformChunks: new Array(data.chunkCount),
      };
      return;
    }
    const response = request.response;
    if (data.type === "materialized-transform-chunk") {
      if (!response || !Number.isSafeInteger(data.chunkIndex) ||
          data.chunkIndex !== response.queuedChunkCount || data.chunkCount !== response.chunkCount ||
          data.transformOffset !== data.chunkIndex * TRANSFORM_RESPONSE_CHUNK_SIZE ||
          !Array.isArray(data.values) || data.values.length < 1 ||
          data.values.length > TRANSFORM_RESPONSE_CHUNK_SIZE ||
          data.transformOffset + data.values.length > response.assignmentCount ||
          !Number.isSafeInteger(data.chunkCharacterCount) || data.chunkCharacterCount < 1) {
        rejectAll(new Error("BlackHole worker prepared transform chunk drifted"));
        return;
      }
      response.queuedChunkCount += 1;
      acceptTransformChunk(data, request, response, false);
      return;
    }
    if (data.type !== "materialized-end" || !response ||
        response.queuedChunkCount !== response.chunkCount || response.endData !== null ||
        !Number.isFinite(data.workerDurationMilliseconds) || data.workerDurationMilliseconds < 0 ||
        !Number.isFinite(data.workerMaximumSliceMilliseconds) ||
        data.workerMaximumSliceMilliseconds < 0 ||
        !Number.isSafeInteger(data.workerSliceCount) || data.workerSliceCount < 1) {
      rejectAll(new Error("BlackHole worker prepared transform end drifted"));
      return;
    }
    response.endData = data;
    if (response.receivedChunkCount === response.chunkCount) {
      completeMaterializedResponse(data, request, response);
    }
  });
  worker.addEventListener("error", (event) =>
    rejectAll(event.error ?? new Error(event.message || "BlackHole worker failed")));
  worker.postMessage({ type: "initialize", catalog });

  async function fetchExpandedBank(index) {
    const descriptor = bankDescriptorAt(index);
    if (bankPending.has(descriptor.index)) return bankPending.get(descriptor.index);
    const pending = fetchHttpExpandedBank(descriptor).then((bytes) => {
      transportBankFetchCount += 1;
      transportBankFetchBytes += descriptor.byteLength;
      bankPending.delete(descriptor.index);
      return bytes;
    }).catch((error) => {
      bankPending.delete(descriptor.index);
      throw error;
    });
    bankPending.set(descriptor.index, pending);
    return pending;
  }

  async function prefetchBank(index) {
    if (destroyed) throw new Error("BlackHole loader is destroyed");
    const descriptor = bankDescriptorAt(index);
    if (registeredBanks.has(descriptor.index)) return descriptor.index;
    if (registerPending.has(descriptor.index)) return registerPending.get(descriptor.index);
    const pending = (async () => {
      await initialized;
      if (registeredBanks.has(descriptor.index)) return descriptor.index;
      const bytes = await fetchExpandedBank(descriptor.index);
      const id = ++requestId;
      const response = new Promise((resolve, reject) => {
        requests.set(id, { kind: "register", index: descriptor.index, resolve, reject });
      });
      let workerBytes = bytes;
      if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
        workerBytes = bytes.slice();
        decodedBankTransferCopyCount += 1;
      }
      decodedBankTransferCount += 1;
      worker.postMessage({
        type: "register-bank", requestId: id, bankIndex: descriptor.index,
        descriptor, bytes: workerBytes,
      }, [workerBytes.buffer]);
      return response;
    })();
    // Claim the bank synchronously, before the first await, so a lookahead request and a
    // boundary load cannot transfer the same ArrayBuffer twice.
    registerPending.set(descriptor.index, pending);
    return pending.catch((error) => {
      if (registerPending.get(descriptor.index) === pending) registerPending.delete(descriptor.index);
      throw error;
    });
  }

  async function load(blockIndex, { eager = false } = {}) {
    if (destroyed) throw new Error("BlackHole loader is destroyed");
    const descriptor = blockDescriptorAt(blockIndex);
    if (materializedBlocks.has(descriptor.index)) return materializedBlocks.get(descriptor.index);
    if (materializePending.has(descriptor.index)) return materializePending.get(descriptor.index);
    const pending = (async () => {
      await prefetchBank(descriptor.bankIndex);
      const id = ++requestId;
      const response = new Promise((resolve, reject) => {
        requests.set(id, { kind: "block", index: descriptor.index, resolve, reject, eager });
      });
      worker.postMessage({
        type: "materialize-block", requestId: id, blockIndex: descriptor.index, eager,
      });
      return response;
    })();
    materializePending.set(descriptor.index, pending);
    return pending.catch((error) => {
      if (materializePending.get(descriptor.index) === pending) materializePending.delete(descriptor.index);
      throw error;
    });
  }

  function retainBankWindow(indices) {
    retainedBanks.fill(0);
    for (const index of indices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.bankCount) {
        throw new RangeError("BlackHole retained bank index drifted");
      }
      retainedBanks[index] = 1;
    }
    const workerIndices = Uint16Array.from(indices);
    worker.postMessage({ type: "retain-banks", indices: workerIndices }, [workerIndices.buffer]);
    trim();
  }

  function retainBlockWindow(indices) {
    retainedBlocks.fill(0);
    for (const index of indices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.blockCount) {
        throw new RangeError("BlackHole retained block index drifted");
      }
      retainedBlocks[index] = 1;
    }
    trim();
  }

  function trim() {
    for (const index of registeredBanks) if (retainedBanks[index] === 0) registeredBanks.delete(index);
    for (const index of materializedBlocks.keys()) {
      if (retainedBlocks[index] === 0) materializedBlocks.delete(index);
    }
  }

  function bankDescriptorAt(index) {
    const normalized = normalize(index, catalog.bankCount);
    const descriptor = catalog.banks[normalized];
    if (!descriptor || descriptor.index !== normalized) throw new RangeError("BlackHole bank index drifted");
    return descriptor;
  }

  function blockDescriptorAt(index) {
    const normalized = normalize(index, catalog.blockCount);
    return Object.freeze({
      index: normalized,
      bankIndex: Math.floor(normalized / catalog.blocksPerBank),
      bankBlockIndex: normalized % catalog.blocksPerBank,
      startFrameIndex: normalized * catalog.blockFrameCount,
      frameCount: catalog.blockFrameCount,
    });
  }

  return Object.freeze({
    load,
    prefetchBank,
    retainBankWindow,
    retainBlockWindow,
    peek(index) { return materializedBlocks.get(index) ?? null; },
    stats() {
      let retainedScheduleBytes = 0;
      let retainedTransformCharacters = 0;
      for (const block of materializedBlocks.values()) {
        retainedScheduleBytes += block.scheduleByteLength;
        retainedTransformCharacters += block.transformCharacterCount;
      }
      return Object.freeze({
        retainedEncodedBankCount: 0,
        retainedRegisteredBankCount: registeredBanks.size,
        retainedMaterializedBlockCount: materializedBlocks.size,
        retainedMaterializedScheduleBytes: retainedScheduleBytes,
        retainedMaterializedPositionCharacters: 0,
        retainedMaterializedPackedCoordinateBytes: 0,
        retainedMaterializedTransformBytes: retainedTransformCharacters,
        retainedDecodedDictionaryBytes: 0,
        materializedBlockTransformCharacterLimit:
          catalog.materialization.transformCharacterLimit,
        materializedBlockScheduleByteLimit: catalog.materialization.scheduleByteLimit,
        maximumPreparedBlockTransformCharacters:
          catalog.materialization.maximumTransformCharacters,
        maximumPreparedBlockScheduleBytes: catalog.materialization.maximumScheduleBytes,
        pendingTransportBankCount: bankPending.size,
        pendingRegisteredBankCount: registerPending.size,
        pendingMaterializedBlockCount: materializePending.size,
        transportBankFetchCount,
        transportBankFetchBytes,
        registeredBankCount,
        materializedBlockCount,
        workerBankRegistrationMilliseconds:
          Number(workerBankRegistrationMilliseconds.toFixed(3)),
        workerMaterializationMilliseconds: Number(workerMaterializationMilliseconds.toFixed(3)),
        workerMaximumSliceMilliseconds: Number(workerMaximumSliceMilliseconds.toFixed(3)),
        workerMaterializationSliceCount,
        mainThreadPreparedBlockAdoptionMilliseconds:
          Number(mainThreadPreparedBlockAdoptionMilliseconds.toFixed(3)),
        mainThreadTransformAdoptionMilliseconds: 0,
        workerMaterializationResponseCount,
        workerMaterializationResponseChunkCount,
        workerMaterializationResponseIdleSliceCount,
        workerMaterializationMaximumResponseChunkCharacters,
        workerMaterializationMaximumResponseBytes: 0,
        workerMaterializationMaximumResponseChunkBytes: 0,
        runtimeLoaderAllocationCount,
        decodedBankTransferCount,
        decodedBankTransferCopyCount,
        mainThreadDictionaryEntryCopyCount: 0,
      });
    },
    destroy() {
      destroyed = true;
      rejectAll(new Error("BlackHole loader is destroyed"));
      worker.terminate();
      registeredBanks.clear();
      materializedBlocks.clear();
    },
  });
}

function validateCatalog(catalog) {
  const snapshot = catalog?.snapshot;
  if (catalog?.schema !== "cssblackhole-prepared-stream-catalog@1" ||
      catalog.starCount !== 1979 || catalog.configurationCount !== 3 ||
      catalog.presentationConfigurationCount !== 4 ||
      catalog.transportSeed !== 6477 ||
      !validPointSelection(catalog.pointSelection) ||
      catalog.presentationColors?.schema !== "cssblackhole-galactic-color-source-luminance@4" ||
      catalog.presentationColors?.mode !==
        "prepared-source-image-color-with-source-luminance-opacity" ||
      JSON.stringify(catalog.presentationColors.palette) !==
        JSON.stringify(CSSBLACKHOLE_GALACTIC_DOT_COLORS) ||
      JSON.stringify(catalog.presentationColors.directImagePalette) !==
        JSON.stringify(CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS) ||
      JSON.stringify(catalog.presentationColors.ghostImagePalette) !==
        JSON.stringify(CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS) ||
      catalog.presentationColors.paletteIntent !==
        "direct-image-white-lavender-and-ghost-image-lavender-purple" ||
      catalog.presentationColors.colorAssignment !==
        "source-image-class-palettes-across-stable-retained-leaf-identity" ||
      catalog.presentationColors.runtimeColorWrites !== false ||
      catalog.presentationColors.opacityPaletteEntryCount !== CSSBLACKHOLE_OPACITY_PALETTE.length ||
      catalog.presentationColors.opacityDecimalPlaces !== 1 ||
      catalog.presentationColors.opacityQuantization !== "nearest-decile-at-prepare-time" ||
      catalog.presentationColors.dynamicObservedFluxParity !== true ||
      catalog.presentationColors.allConfigurationsObservedFluxParity !== true ||
      catalog.presentationColors.sourceDefaultExposureParity !== false ||
      catalog.presentationColors.colormap !== "Greys_r" ||
      catalog.presentationColors.sourceDefaultNormalization !== "linear-zero-to-maximum" ||
      catalog.presentationColors.displayNormalization !== "matplotlib-colors-PowerNorm" ||
      catalog.presentationColors.displayPowerGamma !== 0.35 ||
      catalog.presentationColors.displayOpacityFloor !== 0.22 ||
      catalog.presentationColors.exposureBounds !==
        "fixed-zero-to-global-maximum-over-all-moving-source-configurations" ||
      !validSpaceContext(catalog.spaceContext) ||
      !validPreparedOpacityPalette(catalog.preparedOpacityPalette) ||
      !validMaterialization(catalog.materialization) ||
      catalog.sourceFramesPerSecond !== 60 || catalog.framesPerSecond !== 60 ||
      Math.abs(catalog.frameMilliseconds - 1000 / 60) > 1e-9 ||
      catalog.blockFrameCount !== 60 || catalog.blocksPerBank !== 5 ||
      catalog.bankFrameCount !== 300 || catalog.bankSeconds !== 5 ||
      catalog.bankCount !== 36 || catalog.blockCount !== 180 ||
      catalog.streamFrameCount !== 10800 || catalog.streamDurationMilliseconds !== 180000 ||
      catalog.publication?.schema !== "cssblackhole-prepared-useful-publication@1" ||
      catalog.publication.mode !== "complete-1979-point-state-at-sixty-hertz" ||
      catalog.publication.sourceFrameStep !== 1 ||
      catalog.publication.snapshotOwnsInitialFrame !== true ||
      catalog.publication.runtimeIntermediateFrameGeneration !== false ||
      catalog.publication.runtimeCatchupPublication !== false ||
      catalog.transport?.schema !== "cssblackhole-prepared-bank-transport@1" ||
      catalog.transport.encoding !== CSSBLACKHOLE_BANK_ENCODING ||
      catalog.transport.contentEncoding !== "br" ||
      catalog.transport.bankSeconds !== 5 ||
      catalog.transport.coordinateScale !== CSSBLACKHOLE_COORDINATE_SCALE ||
      catalog.transport.maximumCoordinateQuantizationErrorPixels !==
        CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS ||
      catalog.transport.predictor !==
        "independent-five-second-bank-one-second-block-coordinate-second-difference-plus-prepared-sparse-opacity-ranges" ||
      catalog.configurationLoop?.schema !==
        "cssblackhole-luminet-moving-configuration-loop@4" ||
      catalog.configurationLoop.mode !==
        "prepared-variable-dwell-side-angled-top-angled-luminet-photon-configuration-loop" ||
      catalog.configurationLoop.sourceFrameStep !== 1 ||
      catalog.configurationLoop.presentationSequenceSeconds !== 20 ||
      catalog.configurationLoop.presentationSequenceFrameCount !== 1200 ||
      JSON.stringify(catalog.configurationLoop.presentationSlotHoldSeconds) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_HOLD_SECONDS) ||
      JSON.stringify(catalog.configurationLoop.presentationSlotDurationSeconds) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_DURATION_SECONDS) ||
      JSON.stringify(catalog.configurationLoop.presentationSlotFrameCounts) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_FRAME_COUNTS) ||
      JSON.stringify(catalog.configurationLoop.presentationSlotStartFrameIndices) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_START_FRAME_INDICES) ||
      JSON.stringify(catalog.configurationLoop.transitionStartFrameIndices) !==
        JSON.stringify(EXPECTED_TRANSITION_START_FRAME_INDICES) ||
      catalog.configurationLoop.transitionFrameCount !== 120 ||
      catalog.configurationLoop.transitionSeconds !== 2 ||
      catalog.configurationLoop.configurationTransitionCount !== 36 ||
      JSON.stringify(catalog.configurationLoop.transitionCadenceSecondsBySlot) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_DURATION_SECONDS) ||
      JSON.stringify(catalog.configurationLoop.sourceMotionSecondsBeforeTransitionBySlot) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_HOLD_SECONDS) ||
      catalog.configurationLoop.orbitalSpeedScale !== 0.5 ||
      catalog.configurationLoop.sourceMotionReferenceSeconds !== 10 ||
      catalog.configurationLoop.sourceLoopSeconds !== 90 ||
      catalog.configurationLoop.sourceLoopFrameCount !== 5400 ||
      catalog.configurationLoop.combinedLoopSeconds !== 180 ||
      catalog.configurationLoop.combinedLoopFrameCount !== 10800 ||
      catalog.configurationLoop.combinedSourceFrameCount !== 10800 ||
      JSON.stringify(catalog.configurationLoop.configurationSequence) !== JSON.stringify([
        "luminet-inclination-85deg",
        "luminet-inclination-60deg",
        "luminet-inclination-0deg",
        "luminet-inclination-60deg",
      ]) ||
      catalog.configurationLoop.transitionMotion !==
        "prepared-smoothstep-between-concurrently-moving-source-geodesic-fields" ||
      catalog.configurationLoop.opacityOwner !==
        "prepared-decile-quantized-source-observed-flux-for-all-moving-configurations" ||
      catalog.camera?.mode !== "fixed-retained-camera-prepared-point-transforms" ||
      !validPresentationBounds(
        catalog.luminetPreparedState?.bounds, catalog.camera?.viewport) ||
      catalog.runtimeLookaheadBankCount !== 1 || catalog.runtimeMaterializedLookaheadBlockCount !== 1 ||
      catalog.startupMaterializedLookaheadBlockCount !== 0 ||
      catalog.luminetPreparedState?.schema !== "cssblackhole-luminet-prepared-state@9" ||
      catalog.luminetPreparedState.orbitalSpeedScale !== 0.5 ||
      catalog.luminetPreparedState.sourceMotionReferenceSeconds !== 10 ||
      catalog.luminetPreparedState.naturalTimePerSourceMotionReference !== 1000 ||
      JSON.stringify(catalog.luminetPreparedState.naturalTimePerPresentationSlot) !==
        JSON.stringify([800, 450, 300, 450]) ||
      JSON.stringify(catalog.luminetPreparedState.naturalTimePerPresentationHold) !==
        JSON.stringify([600, 250, 100, 250]) ||
      catalog.luminetPreparedState.naturalTimePerSourceLoop !== 9000 ||
      catalog.luminetPreparedState.sourceLoopSeconds !== 90 ||
      catalog.luminetPreparedState.sourceLoopFrameCount !== 5400 ||
      catalog.luminetPreparedState.combinedLoopSeconds !== 180 ||
      catalog.luminetPreparedState.combinedLoopFrameCount !== 10800 ||
      catalog.luminetPreparedState.availablePeriodicRadiusCount !== 89 ||
      catalog.luminetPreparedState.periodicRadiusCount !== EXPECTED_PERIODIC_ORBIT_COUNTS.length ||
      JSON.stringify(catalog.luminetPreparedState.periodicOrbitCounts) !==
        JSON.stringify(EXPECTED_PERIODIC_ORBIT_COUNTS) ||
      catalog.luminetPreparedState.periodicRadiusSelection !==
        "source-valid-greedy-maximin-radius-coverage" ||
      catalog.luminetPreparedState.particlePeriodicOrbitCounts?.length !== 3000 ||
      catalog.luminetPreparedState.radialSampling !==
        "deterministic-jittered-uniform-radius-then-nearest-selected-periodic-source-loop-radius" ||
      catalog.luminetPreparedState.emitterPhaseCount !== 5400 ||
      catalog.luminetPreparedState.emitterPhaseQuantization !==
        "one-prepared-source-loop-frame" ||
      catalog.luminetPreparedState.photometry?.colormap !== "Greys_r" ||
      catalog.luminetPreparedState.photometry?.displayPowerGamma !== 0.35 ||
      catalog.luminetPreparedState.photometry?.displayOpacityFloor !== 0.22 ||
      catalog.luminetPreparedState.photometry?.output !==
        "prepared-source-luminance-used-as-colored-dot-opacity-over-black" ||
      catalog.luminetPreparedState.configurationSequence?.schema !==
        "cssblackhole-luminet-moving-configuration-sequence@3" ||
      catalog.luminetPreparedState.configurationSequence.distinctConfigurationCount !== 3 ||
      catalog.luminetPreparedState.configurationSequence.presentationConfigurationCount !== 4 ||
      catalog.luminetPreparedState.configurationSequence.presentationSequenceSeconds !== 20 ||
      catalog.luminetPreparedState.configurationSequence.presentationSequenceFrameCount !== 1200 ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.presentationSlotHoldSeconds) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_HOLD_SECONDS) ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.presentationSlotDurationSeconds) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_DURATION_SECONDS) ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.presentationSlotFrameCounts) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_FRAME_COUNTS) ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.presentationSlotStartFrameIndices) !==
        JSON.stringify(EXPECTED_PRESENTATION_SLOT_START_FRAME_INDICES) ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.transitionStartFrameIndices) !==
        JSON.stringify(EXPECTED_TRANSITION_START_FRAME_INDICES) ||
      JSON.stringify(
        catalog.luminetPreparedState.configurationSequence.presentationStateIndices) !==
        JSON.stringify([0, 1, 2, 1]) ||
      JSON.stringify(catalog.luminetPreparedState.configurationSequence.states?.map(
        ({ id, view, inclinationDegrees }) => ({ id, view, inclinationDegrees }))) !==
        JSON.stringify([
          { id: "luminet-inclination-85deg", view: "side", inclinationDegrees: 85 },
          { id: "luminet-inclination-60deg", view: "angled", inclinationDegrees: 60 },
          { id: "luminet-inclination-0deg", view: "top", inclinationDegrees: 0 },
        ]) ||
      snapshot?.schema !== "cssblackhole-prepared-polycss-snapshot@1" ||
      snapshot.url !== `/cssblackhole/snapshot.html?sha256=${snapshot.sha256}` ||
      !/^[a-f0-9]{64}$/u.test(snapshot.sha256 ?? "") || snapshot.encoding !== "identity" ||
      !Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < catalog.starCount * 7 ||
      snapshot.initialStreamFrame !== 0 || snapshot.preparedTransformCount !== catalog.starCount ||
      snapshot.preparedOpacityCount !== catalog.starCount ||
      snapshot.retainedPointLeafCount !== catalog.starCount ||
      snapshot.retainedPerPointWrapperCount !== 0 ||
      !Array.isArray(catalog.banks) || catalog.banks.length !== catalog.bankCount) {
    throw new Error("BlackHole prepared catalog drifted");
  }
  validateTransport(catalog);
}

function validateTransport(catalog) {
  for (let bankIndex = 0; bankIndex < catalog.banks.length; bankIndex += 1) {
    const bank = catalog.banks[bankIndex];
    if (!bank || bank.index !== bankIndex || bank.startFrameIndex !== bankIndex * catalog.bankFrameCount ||
        bank.sourceLoopStartFrameIndex !== bankIndex * catalog.bankFrameCount *
          catalog.configurationLoop.sourceFrameStep %
          catalog.configurationLoop.combinedSourceFrameCount ||
        bank.frameCount !== catalog.bankFrameCount || typeof bank.sourceContinuousFromPrevious !== "boolean" ||
        bank.presentationContinuousFromPrevious !== true ||
        !Number.isSafeInteger(bank.byteLength) || bank.byteLength < 1 ||
        !Number.isSafeInteger(bank.decodedByteLength) || bank.decodedByteLength < bank.byteLength ||
        bank.blockCount !== catalog.blocksPerBank ||
        !Number.isSafeInteger(bank.visibleSampleCount) || bank.visibleSampleCount < 1 ||
        bank.visibleSampleCount > bank.sourceSampleCount ||
        bank.sourceSampleCount !== catalog.bankFrameCount * catalog.starCount ||
        !Number.isSafeInteger(bank.opacityAssignmentCount) ||
        bank.opacityAssignmentCount < catalog.blocksPerBank * catalog.starCount ||
        bank.opacityAssignmentCount > 0xffff ||
        bank.opacityAssignmentCount > bank.sourceSampleCount ||
        bank.sourceLuminanceSampleCount !== bank.sourceSampleCount ||
        bank.contentEncoding !== "br" ||
        !Number.isFinite(bank.maximumCoordinateQuantizationErrorPixels) ||
        bank.maximumCoordinateQuantizationErrorPixels < 0 ||
        bank.maximumCoordinateQuantizationErrorPixels >
          CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS ||
        bank.coordinateEncoding !==
          "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1" ||
        bank.opacityEncoding !== CSSBLACKHOLE_OPACITY_ENCODING ||
        !/^[a-f0-9]{64}$/u.test(bank.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/u.test(bank.decodedSha256 ?? "") ||
        typeof bank.assetUrl !== "string" ||
        !bank.assetUrl.startsWith("/cssblackhole/banks/") ||
        !/^bank-\d{2}-[a-f0-9]{64}\.bin\.br$/u.test(bank.assetUrl.split("/").at(-1))) {
      throw new Error(`BlackHole transport bank ${bankIndex} drifted`);
    }
  }
}

function validPreparedOpacityPalette(palette) {
  return Array.isArray(palette) &&
    JSON.stringify(palette) === JSON.stringify(CSSBLACKHOLE_OPACITY_PALETTE);
}

function validMaterialization(materialization) {
  return materialization?.schema === "cssblackhole-bounded-materialized-block@1" &&
    materialization.policy === "galaxy-style-multiple-playback-blocks-per-transport-bank" &&
    materialization.maximumRetainedBlockCount === 2 &&
    materialization.transformCharacterLimit === 3_200_000 &&
    materialization.scheduleByteLimit === 260_000 &&
    Number.isSafeInteger(materialization.maximumTransformAssignmentCount) &&
    materialization.maximumTransformAssignmentCount >= 1979 &&
    materialization.maximumTransformAssignmentCount <= 60 * 1979 &&
    Number.isSafeInteger(materialization.maximumOpacityAssignmentCount) &&
    materialization.maximumOpacityAssignmentCount >= 1979 &&
    materialization.maximumOpacityAssignmentCount <= 60 * 1979 &&
    Number.isSafeInteger(materialization.maximumTransformCharacters) &&
    materialization.maximumTransformCharacters > 0 &&
    materialization.maximumTransformCharacters <= materialization.transformCharacterLimit &&
    Number.isSafeInteger(materialization.maximumScheduleBytes) &&
    materialization.maximumScheduleBytes > 0 &&
    materialization.maximumScheduleBytes <= materialization.scheduleByteLimit &&
    Number.isSafeInteger(materialization.maximumTransformCharacterBlockIndex) &&
    materialization.maximumTransformCharacterBlockIndex >= 0 &&
    materialization.maximumTransformCharacterBlockIndex < 180;
}

function validSpaceContext(context) {
  const expectedPlates = [
    { id: "landscape", logicalWidth: 2560, logicalHeight: 1440 },
    { id: "portrait", logicalWidth: 1440, logicalHeight: 2560 },
  ];
  if (context?.schema !== "cssblackhole-prepared-space-context@1" ||
      context.classification !==
        "decorative-static-deep-space-context-not-luminet-source-state" ||
      context.mode !==
        "prepared-resolution-aware-luminet-dot-primitive-plates" ||
      context.seed !== 1979 || context.sourceStarCountPerPlate !== 1000 ||
      JSON.stringify(context.palette) !== JSON.stringify(CSSBLACKHOLE_GALACTIC_DOT_COLORS) ||
      JSON.stringify(context.opacityPalette) !==
        JSON.stringify(["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]) ||
      context.opacityDecimalPlaces !== 1 ||
      context.maximumBaseOpacity !== 0.8 ||
      context.layerOpacity !== 0.5 ||
      context.maximumEffectiveOpacity !== 0.4 ||
      context.opacitySamplingBucketCount !== 9 ||
      context.opacityMode !==
        "prepared-original-dot-opacity-palette" ||
      context.opacityComposition !==
        "prepared-srgb-base-opacity-times-layer-opacity-over-opaque-black" ||
      context.pointPrimitive?.shape !== "axis-aligned-square" ||
      context.pointPrimitive.foregroundReference !== ".polycss-scene > b" ||
      context.pointPrimitive.cssPixelsAt1dppx !== 2 ||
      context.pointPrimitive.cssPixelsAtMinimum2dppx !== 2 ||
      context.pointPrimitive.devicePixelsAt1dppx !== 2 ||
      context.pointPrimitive.devicePixelsAt2dppx !== 4 ||
      context.pointPrimitive.minimumLogicalChebyshevSeparationPixels !== 2 ||
      context.pointPrimitive.overlappingPreparedPointCount !== 0 ||
      context.distribution?.uniformPointCount !== 600 ||
      context.distribution.broadGalacticBandPointCount !== 400 ||
      context.distribution.centerDensityMode !==
        "uniform-sparse-no-static-center-hole" ||
      context.distribution.minimumCenterDensity !== 1 ||
      context.lensing?.classification !==
        "thin-lens-compositional-context-not-luminet-source-parity" ||
      context.lensing.einsteinRadiusLogicalPixels !== 96 ||
      context.lensing.influenceRadiusLogicalPixels !== 440 ||
      context.lensing.centralShadowRadiusLogicalPixels !== 0 ||
      context.runtimeDomNodeCount !== 0 || context.runtimeAnimationCount !== 0 ||
      context.runtimeStyleWriteCount !== 0 || context.runtimeRasterizationCount !== 0 ||
      !Array.isArray(context.plates) || context.plates.length !== expectedPlates.length) {
    return false;
  }
  return context.plates.every((plate, plateIndex) => {
    const expected = expectedPlates[plateIndex];
    return plate?.id === expected.id && plate.logicalWidth === expected.logicalWidth &&
      plate.logicalHeight === expected.logicalHeight && plate.sourceStarCount === 1000 &&
      plate.centerDensityFalloff === undefined &&
      Array.isArray(plate.variants) && plate.variants.length === 2 &&
      plate.variants.every((variant, variantIndex) => {
        const deviceScaleFactor = variantIndex + 1;
        const suffix = deviceScaleFactor === 1 ? "" : "@2x";
        return variant?.deviceScaleFactor === deviceScaleFactor &&
          variant.assetUrl === `/cssblackhole/space-context-${plate.id}${suffix}.webp` &&
          variant.width === plate.logicalWidth * deviceScaleFactor &&
          variant.height === plate.logicalHeight * deviceScaleFactor &&
          Number.isSafeInteger(variant.byteLength) && variant.byteLength > 0 &&
          /^[a-f0-9]{64}$/u.test(variant.sha256 ?? "");
      });
  });
}

function validPresentationBounds(bounds, viewport) {
  return [
    bounds?.minimumX,
    bounds?.maximumX,
    bounds?.minimumY,
    bounds?.maximumY,
    viewport?.width,
    viewport?.height,
  ].every(Number.isFinite) && viewport.width > 0 && viewport.height > 0 &&
    bounds.minimumX >= 0 && bounds.maximumX <= viewport.width &&
    bounds.minimumY >= 0 && bounds.maximumY <= viewport.height &&
    bounds.minimumX < bounds.maximumX && bounds.minimumY < bounds.maximumY;
}

function validPointSelection(selection) {
  if (selection?.schema !== "cssblackhole-source-point-selection@3" ||
      selection.mode !==
        "publication-year-count-proportional-non-overlapping-prepared-source-identity-subset" ||
      selection.publicationYear !== 1979 || selection.sourcePointCount !== 3000 ||
      selection.selectedPointCount !== 1979 || selection.sourceDirectPointCount !== 2000 ||
      selection.selectedDirectPointCount !== 1319 || selection.sourceGhostPointCount !== 1000 ||
      selection.selectedGhostPointCount !== 660 ||
      selection.identityOrder !==
        "selected-direct-source-indices-then-selected-ghost-source-indices" ||
      selection.algorithm !==
        "centered-stratified-source-identities-with-sparse-prepared-one-pixel-grid-separation" ||
      selection.collisionDomain !==
        "frame-local-exact-tenth-pixel-coordinate-over-complete-moving-configuration-loop" ||
      selection.identityContinuity !==
        "stable-source-emitter-leaf-identity-with-prepared-separation-only-at-exact-conflicts" ||
      selection.runtimeSourceRepair !== false ||
      selection.sourcePeriodicRadiusCount !== 16 ||
      selection.selectedDirectPeriodicRadiusCount !== 16 ||
      selection.selectedGhostPeriodicRadiusCount !== 16 ||
      selection.selectedDirectMaximumPointsPerRadius !== 110 ||
      selection.selectedGhostMaximumPointsPerRadius !== 55 ||
      selection.analyzedSourceFrameCount !== 10800 ||
      selection.retainedStratifiedPointCount !== 1979 ||
      selection.framesWithPreparedCollisionSeparation !== 10800 ||
      selection.preparedCollisionSeparationCount !== 229107 ||
      selection.maximumPreparedCollisionSeparationCount !== 47 ||
      selection.maximumPreparedCollisionSeparationPixels !== 1.414 ||
      selection.sourceCoordinateSampleCount !== 21373200 ||
      selection.sourceExactCoordinateSampleCount !== 21144093 ||
      selection.selectedExactCoordinateConflictPairCount !== 0 ||
      !Array.isArray(selection.sourcePointIndices) || selection.sourcePointIndices.length !== 1979) {
    return false;
  }
  const uniqueSourceIndices = new Set(selection.sourcePointIndices);
  return uniqueSourceIndices.size === 1979 && selection.sourcePointIndices.every(
    (sourceIndex, selectedIndex) => Number.isSafeInteger(sourceIndex) &&
      sourceIndex >= (selectedIndex < 1319 ? 0 : 2000) &&
      sourceIndex < (selectedIndex < 1319 ? 2000 : 3000) &&
      (selectedIndex === 0 || sourceIndex > selection.sourcePointIndices[selectedIndex - 1]));
}

function validateCatalogDescriptor(descriptor) {
  if (descriptor?.schema !== "cssblackhole-prepared-catalog-descriptor@1" ||
      !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1 ||
      !/^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? "") || typeof descriptor.url !== "string" ||
      descriptor.url !== "/cssblackhole/catalog.json" +
        `?sha256=${descriptor.sha256}` ||
      new URLSearchParams(descriptor.url.split("?")[1]).get("sha256") !== descriptor.sha256) {
    throw new Error("BlackHole catalog descriptor drifted");
  }
}

async function fetchVerifiedBytes(url, expectedLength, expectedSha256, label, cache) {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`BlackHole ${label} failed: ${response.status} ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedLength) throw new Error(`BlackHole ${label} length drifted`);
  const actualSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== expectedSha256) throw new Error(`BlackHole ${label} hash drifted`);
  return bytes;
}

async function fetchHttpExpandedBank(descriptor) {
  const response = await fetch(descriptor.assetUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(
      `BlackHole bank ${descriptor.index} failed: ${response.status} ${descriptor.assetUrl}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyByteIdentity(bytes, descriptor.decodedByteLength, descriptor.decodedSha256,
    `bank ${descriptor.index} HTTP expansion`);
  return bytes;
}

async function verifyByteIdentity(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) throw new Error(`BlackHole ${label} length drifted`);
  const actualSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== expectedSha256) throw new Error(`BlackHole ${label} hash drifted`);
}

function normalize(index, count) {
  return (index % count + count) % count;
}
