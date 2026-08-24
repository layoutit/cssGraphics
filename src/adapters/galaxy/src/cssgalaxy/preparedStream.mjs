// SPDX-License-Identifier: HPND
import {
  CSSGALAXY_BANK_ENCODING,
  CSSGALAXY_COORDINATE_SCALE,
  CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
} from "../shared/cssgalaxy/preparedBlockTransport.mjs";

const TRANSFORM_RESPONSE_CHUNK_SIZE = 60_000;

export async function loadGalaxyPreparedCatalog(descriptor, seed, profile) {
  validateCatalogDescriptor(descriptor, profile);
  const bytes = await fetchVerifiedBytes(descriptor.url, descriptor.byteLength,
    descriptor.sha256, "catalog", "no-store");
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  validateCatalog(catalog, profile);
  if (!catalog.curatedSeeds.includes(seed)) throw new RangeError("Galaxy seed is not curated");
  return Object.freeze({ ...catalog, selectedSeed: seed, banks: catalog.seeds[String(seed)].banks });
}

export async function loadGalaxyPreparedSnapshot(catalog) {
  const bytes = await fetchVerifiedBytes(catalog.snapshot.url, catalog.snapshot.byteLength,
    catalog.snapshot.sha256, "prepared snapshot", "force-cache");
  return new TextDecoder().decode(bytes);
}

export function createGalaxyPreparedBankWindow(catalog, activeBankIndex) {
  if (!Number.isSafeInteger(activeBankIndex) || activeBankIndex < 0 ||
      activeBankIndex >= catalog.bankCount || catalog.runtimeLookaheadBankCount !== 1) {
    throw new RangeError("Galaxy bank window drifted");
  }
  return Object.freeze([activeBankIndex, (activeBankIndex + 1) % catalog.bankCount]);
}

export function createGalaxyPreparedBlockWindow(catalog, activeBlockIndex) {
  if (!Number.isSafeInteger(activeBlockIndex) || activeBlockIndex < 0 ||
      activeBlockIndex >= catalog.blockCount || catalog.runtimeMaterializedLookaheadBlockCount !== 1) {
    throw new RangeError("Galaxy block window drifted");
  }
  return Object.freeze([activeBlockIndex, (activeBlockIndex + 1) % catalog.blockCount]);
}

export function createGalaxyPreparedStreamLoader(catalog) {
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

  worker.addEventListener("message", ({ data }) => {
    if (data?.type === "initialized") {
      initializedResolve();
      return;
    }
    if (data?.type === "error") {
      const request = requests.get(data.requestId);
      const error = new Error(data.stack || data.message || "Galaxy worker failed");
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
        rejectAll(new Error("Galaxy worker bank registration response drifted"));
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
          data.assignmentCount > catalog.blockFrameCount * catalog.starCount ||
          !Number.isSafeInteger(data.chunkCount) || data.chunkCount < 1 ||
          !(data.frameOffsets instanceof Uint32Array) ||
          data.frameOffsets.length !== catalog.blockFrameCount + 1 ||
          data.frameOffsets[1] !== catalog.starCount ||
          data.frameOffsets[data.frameOffsets.length - 1] !== data.assignmentCount ||
          !(data.assignmentLeafIndices instanceof Uint16Array) ||
          data.assignmentLeafIndices.length !== data.assignmentCount ||
          data.decodedCoordinateByteLength !== catalog.blockFrameCount * catalog.starCount * 8) {
        rejectAll(new Error("Galaxy worker prepared transform start drifted"));
        return;
      }
      request.response = {
        descriptor: data.descriptor,
        assignmentCount: data.assignmentCount,
        chunkCount: data.chunkCount,
        receivedChunkCount: 0,
        receivedTransformCount: 0,
        receivedTransformCharacterCount: 0,
        frameOffsets: data.frameOffsets,
        assignmentLeafIndices: data.assignmentLeafIndices,
        decodedCoordinateByteLength: data.decodedCoordinateByteLength,
        transformChunks: new Array(data.chunkCount),
      };
      return;
    }
    const response = request.response;
    if (data.type === "materialized-transform-chunk") {
      if (!response || !Number.isSafeInteger(data.chunkIndex) ||
          data.chunkIndex !== response.receivedChunkCount || data.chunkCount !== response.chunkCount ||
          data.transformOffset !== data.chunkIndex * TRANSFORM_RESPONSE_CHUNK_SIZE ||
          !Array.isArray(data.values) || data.values.length < 1 ||
          data.values.length > TRANSFORM_RESPONSE_CHUNK_SIZE ||
          data.transformOffset + data.values.length > response.assignmentCount ||
          !Number.isSafeInteger(data.chunkCharacterCount) || data.chunkCharacterCount < 1) {
        rejectAll(new Error("Galaxy worker prepared transform chunk drifted"));
        return;
      }
      const adoptionStartedAt = performance.now();
      response.transformChunks[data.chunkIndex] = Object.freeze(data.values);
      response.receivedChunkCount += 1;
      response.receivedTransformCount += data.values.length;
      response.receivedTransformCharacterCount += data.chunkCharacterCount;
      mainThreadPreparedBlockAdoptionMilliseconds += performance.now() - adoptionStartedAt;
      workerMaterializationMaximumResponseChunkCharacters = Math.max(
        workerMaterializationMaximumResponseChunkCharacters, data.chunkCharacterCount);
      return;
    }
    if (data.type !== "materialized-end" || !response ||
        response.receivedChunkCount !== response.chunkCount ||
        response.receivedTransformCount !== response.assignmentCount ||
        data.transformCharacterCount !== response.receivedTransformCharacterCount ||
        !Number.isFinite(data.workerDurationMilliseconds) || data.workerDurationMilliseconds < 0 ||
        !Number.isFinite(data.workerMaximumSliceMilliseconds) ||
        data.workerMaximumSliceMilliseconds < 0 ||
        !Number.isSafeInteger(data.workerSliceCount) || data.workerSliceCount < 1) {
      rejectAll(new Error("Galaxy worker prepared transform end drifted"));
      return;
    }
    const adoptionStartedAt = performance.now();
    const block = Object.freeze({
      descriptor: response.descriptor,
      frameOffsets: response.frameOffsets,
      assignmentLeafIndices: response.assignmentLeafIndices,
      assignmentCount: response.assignmentCount,
      transformChunks: Object.freeze(response.transformChunks),
      transformChunkSize: TRANSFORM_RESPONSE_CHUNK_SIZE,
      transformCharacterCount: data.transformCharacterCount,
      decodedCoordinateByteLength: response.decodedCoordinateByteLength,
      scheduleByteLength: response.frameOffsets.byteLength + response.assignmentLeafIndices.byteLength,
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
    materializedBlocks.set(request.index, block);
    materializePending.delete(request.index);
    requests.delete(data.requestId);
    request.resolve(block);
    trim();
  });
  worker.addEventListener("error", (event) =>
    rejectAll(event.error ?? new Error(event.message || "Galaxy worker failed")));
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
    if (destroyed) throw new Error("Galaxy loader is destroyed");
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

  async function load(blockIndex) {
    if (destroyed) throw new Error("Galaxy loader is destroyed");
    const descriptor = blockDescriptorAt(blockIndex);
    if (materializedBlocks.has(descriptor.index)) return materializedBlocks.get(descriptor.index);
    if (materializePending.has(descriptor.index)) return materializePending.get(descriptor.index);
    const pending = (async () => {
      await prefetchBank(descriptor.bankIndex);
      const id = ++requestId;
      const response = new Promise((resolve, reject) => {
        requests.set(id, { kind: "block", index: descriptor.index, resolve, reject });
      });
      worker.postMessage({ type: "materialize-block", requestId: id, blockIndex: descriptor.index });
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
        throw new RangeError("Galaxy retained bank index drifted");
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
        throw new RangeError("Galaxy retained block index drifted");
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
    if (!descriptor || descriptor.index !== normalized) throw new RangeError("Galaxy bank index drifted");
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
        workerMaterializationResponseIdleSliceCount: 0,
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
      rejectAll(new Error("Galaxy loader is destroyed"));
      worker.terminate();
      registeredBanks.clear();
      materializedBlocks.clear();
    },
  });
}

function validateCatalog(catalog, profile) {
  const snapshot = catalog?.snapshot;
  if (catalog?.schema !== "cssgalaxy-prepared-stream-catalog@4" ||
      (profile?.id !== "desktop" && profile?.id !== "mobile") ||
      profile.id !== (profile.galaxyCount === 3 ? "desktop" : "mobile") ||
      catalog.starCount !== profile?.starCount || catalog.galaxyCount !== profile?.galaxyCount ||
      catalog.relativeRoot !== `g${profile?.galaxyCount}/${profile?.starCount}` ||
      catalog.colorFamilyVariantCount !== 5 ||
      catalog.colorPropertyCount !== catalog.galaxyCount * catalog.colorFamilyVariantCount ||
      catalog.presentationColors?.mode !==
        "native-source-hues-with-prepared-perceptual-variance-and-balanced-three-role-lightness" ||
      !Array.isArray(catalog.presentationColors.signedOklabDistanceSteps) ||
      catalog.presentationColors.signedOklabDistanceSteps.length !== catalog.colorFamilyVariantCount ||
      !Array.isArray(catalog.prefixStarCounts) || catalog.prefixStarCounts.length !== catalog.galaxyCount ||
      catalog.prefixStarCounts.some((count) => !Number.isSafeInteger(count) || count < 1) ||
      catalog.prefixStarCounts.reduce((sum, count) => sum + count, 0) !== catalog.starCount ||
      catalog.sourceFramesPerSecond !== 50 || catalog.framesPerSecond !== 60 ||
      Math.abs(catalog.frameMilliseconds - 1000 / 60) > 1e-9 ||
      catalog.blockFrameCount !== 240 || catalog.blocksPerBank !== 6 || catalog.bankFrameCount !== 1440 ||
      catalog.bankSeconds !== 24 || catalog.bankCount !== 5 || catalog.blockCount !== 30 ||
      catalog.streamFrameCount !== 7200 ||
      catalog.transport?.schema !== "cssgalaxy-prepared-bank-transport@6" ||
      catalog.transport.encoding !== CSSGALAXY_BANK_ENCODING ||
      catalog.transport.contentEncoding !== "br" ||
      catalog.transport.bankSeconds !== 24 ||
      catalog.transport.coordinateScale !== CSSGALAXY_COORDINATE_SCALE ||
      catalog.transport.maximumCoordinateQuantizationErrorPixels !==
        CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS ||
      catalog.transport.predictor !==
        "independent-four-second-leaf-major-axis-split-second-difference-zigzag-varint" ||
      catalog.encounterReel?.schema !== "cssgalaxy-prepared-encounter-reel@5" ||
      catalog.encounterReel.sourceFramesPerSecond !== 50 ||
      catalog.encounterReel.presentationFramesPerSecond !== 60 ||
      catalog.encounterReel.nativeProjectionFrameCount !== 410 ||
      catalog.encounterReel.nativeMotionStartFrameIndex !== 0 ||
      catalog.encounterReel.nativeMotionFrameSpan !== 409 ||
      catalog.encounterReel.nativeMotionFrameStepNumerator !== 409 ||
      catalog.encounterReel.nativeMotionFrameStepDenominator !== 540 ||
      catalog.encounterReel.nativeMotionFrameCount !== 540 ||
      catalog.encounterReel.reformationFrameCount !== 180 ||
      catalog.encounterReel.reformationStartFrameIndex !== 540 ||
      catalog.encounterReel.reformationTargetNativeFrameIndex !== 0 ||
      catalog.encounterReel.reformationControlFrameScale !== 60 ||
      catalog.encounterReel.reformationMaximumControlDisplacement !== 560 ||
      catalog.encounterReel.encounterFrameCount !== 720 || catalog.encounterReel.bankCount !== 5 ||
      catalog.encounterReel.encounterCount !== 10 ||
      catalog.camera?.mode !== "fixed-retained-camera-source-projection-in-point-transforms" ||
      catalog.runtimeLookaheadBankCount !== 1 || catalog.runtimeMaterializedLookaheadBlockCount !== 1 ||
      catalog.startupMaterializedLookaheadBlockCount !== 0 ||
      (catalog.galaxyCount === 3
        ? catalog.threeGalaxyRolePalette?.schema !== "cssgalaxy-prepared-three-role-palette@1"
        : catalog.threeGalaxyRolePalette !== null) ||
      !Array.isArray(catalog.particleCohortRoles) ||
      catalog.particleCohortRoles.length !== catalog.galaxyCount ||
      !Array.isArray(catalog.particleCohortColors) ||
      catalog.particleCohortColors.length !== catalog.colorPropertyCount ||
      snapshot?.schema !== "cssgalaxy-prepared-polycss-snapshot@1" ||
      snapshot.url !== `/cssgalaxy/${catalog.relativeRoot}/snapshot.html?sha256=${snapshot.sha256}` ||
      !/^[a-f0-9]{64}$/u.test(snapshot.sha256 ?? "") || snapshot.encoding !== "identity" ||
      !Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < catalog.starCount * 7 ||
      snapshot.retainedPointLeafCount !== catalog.starCount || snapshot.retainedPerPointWrapperCount !== 0 ||
      !Array.isArray(catalog.curatedSeeds) || catalog.curatedSeeds.length !== 1 ||
      catalog.curatedSeeds[0] !== profile?.comparisonSeed ||
      catalog.comparisonSeed !== profile?.comparisonSeed ||
      catalog.selection !== "session-shuffled-qualified-encounter-start-without-replacement" ||
      !Array.isArray(catalog.curatedEncounterSeeds) ||
      catalog.curatedEncounterSeeds.length !== catalog.encounterReel.encounterCount ||
      new Set(catalog.curatedEncounterSeeds).size !== catalog.curatedEncounterSeeds.length ||
      catalog.curatedEncounterSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 1) ||
      Object.keys(catalog.seeds ?? {}).length !== 1 ||
      catalog.curatedSeeds.some((seed) => !catalog.seeds?.[String(seed)] ||
        catalog.seeds[String(seed)].banks?.length !== catalog.bankCount ||
        catalog.seeds[String(seed)].encounterOrder?.length !== catalog.encounterReel.encounterCount ||
        catalog.seeds[String(seed)].encounterEvents?.length !== catalog.encounterReel.encounterCount ||
        catalog.seeds[String(seed)].encounterOrder.some((encounterSeed, index) =>
          encounterSeed !== catalog.curatedEncounterSeeds[index]))) {
    throw new Error("Galaxy prepared catalog drifted");
  }
  for (const seed of catalog.curatedSeeds) validateTransport(catalog, catalog.seeds[String(seed)]);
}

function validateTransport(catalog, seed) {
  for (let bankIndex = 0; bankIndex < seed.banks.length; bankIndex += 1) {
    const bank = seed.banks[bankIndex];
    if (!bank || bank.index !== bankIndex || bank.startFrameIndex !== bankIndex * catalog.bankFrameCount ||
        bank.frameCount !== catalog.bankFrameCount || typeof bank.sourceContinuousFromPrevious !== "boolean" ||
        bank.presentationContinuousFromPrevious !== true ||
        !Number.isSafeInteger(bank.byteLength) || bank.byteLength < 1 ||
        !Number.isSafeInteger(bank.decodedByteLength) || bank.decodedByteLength < bank.byteLength ||
        bank.blockCount !== catalog.blocksPerBank ||
        !Number.isSafeInteger(bank.visibleSampleCount) || bank.visibleSampleCount < 1 ||
        bank.visibleSampleCount > bank.sourceSampleCount ||
        bank.sourceSampleCount !== catalog.bankFrameCount * catalog.starCount ||
        bank.contentEncoding !== "br" ||
        !Number.isFinite(bank.maximumCoordinateQuantizationErrorPixels) ||
        bank.maximumCoordinateQuantizationErrorPixels < 0 ||
        bank.maximumCoordinateQuantizationErrorPixels >
          CSSGALAXY_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS ||
        bank.coordinateEncoding !==
          "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1" ||
        !/^[a-f0-9]{64}$/u.test(bank.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/u.test(bank.decodedSha256 ?? "") ||
        typeof bank.assetUrl !== "string" ||
        !bank.assetUrl.startsWith(
          `/cssgalaxy/${catalog.relativeRoot}/seed-${catalog.comparisonSeed}/`) ||
        !/^bank-\d{2}-[a-f0-9]{64}\.bin\.br$/u.test(bank.assetUrl.split("/").at(-1))) {
      throw new Error(`Galaxy transport bank ${bankIndex} drifted`);
    }
  }
}

function validateCatalogDescriptor(descriptor, profile) {
  if (descriptor?.schema !== "cssgalaxy-prepared-catalog-descriptor@1" ||
      !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1 ||
      !/^[a-f0-9]{64}$/u.test(descriptor.sha256 ?? "") || typeof descriptor.url !== "string" ||
      descriptor.url !== `/cssgalaxy/g${profile?.galaxyCount}/${profile?.starCount}/catalog.json` +
        `?sha256=${descriptor.sha256}` ||
      new URLSearchParams(descriptor.url.split("?")[1]).get("sha256") !== descriptor.sha256) {
    throw new Error("Galaxy catalog descriptor drifted");
  }
}

async function fetchVerifiedBytes(url, expectedLength, expectedSha256, label, cache) {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`Galaxy ${label} failed: ${response.status} ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedLength) throw new Error(`Galaxy ${label} length drifted`);
  const actualSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== expectedSha256) throw new Error(`Galaxy ${label} hash drifted`);
  return bytes;
}

async function fetchHttpExpandedBank(descriptor) {
  const response = await fetch(descriptor.assetUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(
      `Galaxy bank ${descriptor.index} failed: ${response.status} ${descriptor.assetUrl}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyByteIdentity(bytes, descriptor.decodedByteLength, descriptor.decodedSha256,
    `bank ${descriptor.index} HTTP expansion`);
  return bytes;
}

async function verifyByteIdentity(bytes, expectedLength, expectedSha256, label) {
  if (bytes.byteLength !== expectedLength) throw new Error(`Galaxy ${label} length drifted`);
  const actualSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== expectedSha256) throw new Error(`Galaxy ${label} hash drifted`);
}

function normalize(index, count) {
  return (index % count + count) % count;
}
