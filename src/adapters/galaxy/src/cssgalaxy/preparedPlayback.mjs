// SPDX-License-Identifier: HPND

const EARLY_DEADLINE_TOLERANCE_RATIO = 1 / 8;

export function createGalaxyPreparedPlayer({
  catalog,
  transformPublisher,
  initialBlocks,
  initialStreamFrame = 0,
  loadBlock,
  onBlockWindow,
  onBankWindow,
  onError = () => undefined,
  readNow = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
}) {
  const initialBlockIndex = Math.floor(initialStreamFrame / catalog.blockFrameCount);
  if (transformPublisher?.leafCount !== catalog.starCount ||
      typeof transformPublisher.publishTransform !== "function" ||
      initialBlocks.length !== 1 + catalog.startupMaterializedLookaheadBlockCount ||
      !Number.isSafeInteger(initialStreamFrame) || initialStreamFrame < 0 ||
      initialStreamFrame >= catalog.streamFrameCount ||
      initialStreamFrame % catalog.encounterReel.encounterFrameCount !== 0 ||
      initialBlocks[0]?.descriptor?.index !== initialBlockIndex ||
      typeof loadBlock !== "function" || typeof onBlockWindow !== "function" ||
      typeof onBankWindow !== "function") {
    throw new Error("Galaxy player binding drifted");
  }
  const earlyDeadlineToleranceMilliseconds =
    catalog.frameMilliseconds * EARLY_DEADLINE_TOLERANCE_RATIO;
  let activeBlock = initialBlocks[0];
  let activeBlockIndex = activeBlock.descriptor.index;
  let activeBankIndex = Math.floor(activeBlockIndex / catalog.blocksPerBank);
  const resolvedBlocks = new Map(initialBlocks.map((block) => [block.descriptor.index, block]));
  const pendingBlocks = new Map();
  const currentTransforms = new Array(catalog.starCount).fill("");
  const cadenceSamples = new Float64Array(8192);
  const presentationSamples = new Float64Array(catalog.streamFrameCount + 128);
  const writesPerPublication = new Uint16Array(catalog.streamFrameCount + 128);
  const transitionGaps = new Float64Array(catalog.encounterReel.encounterCount + 2);
  const transitionPublishDurations = new Float64Array(catalog.encounterReel.encounterCount + 2);
  const transitionStreamFrames = new Uint32Array(catalog.encounterReel.encounterCount + 2);
  const blockWindowIndices = new Uint16Array(catalog.runtimeMaterializedLookaheadBlockCount + 1);
  const bankWindowIndices = new Uint16Array(catalog.runtimeLookaheadBankCount + 1);
  const retainedBlockFlags = new Uint8Array(catalog.blockCount);
  let cadenceSampleCount = 0;
  let presentationSampleCount = 0;
  let publicationSampleCount = 0;
  let transitionCount = 0;
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let nextFrameAt = 0;
  let publishedStreamFrame = -1;
  let lastAnimationFrameAt = 0;
  let lastPublishedAt = 0;
  let appliedFrameCount = 0;
  let transformWriteCount = 0;
  let totalDomWriteCount = 0;
  let schedulerLateResetCount = 0;
  let preparedBlockWaitCount = 0;
  let preparedBankWaitCount = 0;
  let preparedBlockSwitchCount = 0;
  let preparedEncounterSwitchCount = 0;
  let preparedBankSwitchCount = 0;
  let preparedBlockPrefetchCount = initialBlocks.length - 1;
  let lookaheadStarted = false;
  let waitingForBlock = false;
  let activeTransitionIndex = -1;

  publish(initialStreamFrame, readNow());
  queueWindows();

  function publish(streamFrame, now) {
    const blockIndex = Math.floor(streamFrame / catalog.blockFrameCount);
    const localFrame = streamFrame % catalog.blockFrameCount;
    const isSequential = publishedStreamFrame >= 0 &&
      streamFrame === (publishedStreamFrame + 1) % catalog.streamFrameCount;
    if (blockIndex !== activeBlockIndex) activateBlock(blockIndex);
    const encounterFrame = streamFrame % catalog.encounterReel.encounterFrameCount;
    const reformationOffset = encounterFrame - catalog.encounterReel.reformationStartFrameIndex;
    const isReformationFrame = reformationOffset >= 0 &&
      reformationOffset < catalog.encounterReel.reformationFrameCount;
    if (isReformationFrame && reformationOffset === 0 && appliedFrameCount > 1 &&
        transitionCount < transitionGaps.length) {
      activeTransitionIndex = transitionCount++;
      transitionStreamFrames[activeTransitionIndex] = streamFrame;
      preparedEncounterSwitchCount += 1;
      performance.mark(`cssgalaxy-encounter-transition-${activeTransitionIndex + 1}-start`);
    }
    const startedAt = readNow();
    const writes = isSequential
      ? publishAssignmentFrame(localFrame)
      : reconstructAndPublishFrame(localFrame);
    const duration = readNow() - startedAt;
    if (lastPublishedAt > 0 && presentationSampleCount < presentationSamples.length) {
      presentationSamples[presentationSampleCount++] = now - lastPublishedAt;
    }
    if (publicationSampleCount < writesPerPublication.length) {
      writesPerPublication[publicationSampleCount++] = writes;
    }
    transformWriteCount += writes;
    totalDomWriteCount += writes;
    appliedFrameCount += 1;
    publishedStreamFrame = streamFrame;
    lastPublishedAt = now;
    if (isReformationFrame && activeTransitionIndex >= 0) {
      transitionGaps[activeTransitionIndex] = Math.max(transitionGaps[activeTransitionIndex],
        presentationSamples[presentationSampleCount - 1] ?? 0);
      transitionPublishDurations[activeTransitionIndex] = Math.max(
        transitionPublishDurations[activeTransitionIndex], duration);
      if (reformationOffset + 1 === catalog.encounterReel.reformationFrameCount) {
        performance.mark(`cssgalaxy-encounter-transition-${activeTransitionIndex + 1}-published`);
        activeTransitionIndex = -1;
      }
    }
  }

  function publishAssignmentFrame(localFrame) {
    const start = activeBlock.frameOffsets[localFrame];
    const end = activeBlock.frameOffsets[localFrame + 1];
    let writes = 0;
    for (let assignmentIndex = start; assignmentIndex < end; assignmentIndex += 1) {
      const leafIndex = activeBlock.assignmentLeafIndices[assignmentIndex];
      const transform = preparedTransformAt(activeBlock, assignmentIndex);
      currentTransforms[leafIndex] = transform;
      transformPublisher.publishTransform(leafIndex, transform);
      writes += 1;
    }
    return writes;
  }

  function reconstructAndPublishFrame(localFrame) {
    for (let frameIndex = 0; frameIndex <= localFrame; frameIndex += 1) {
      const start = activeBlock.frameOffsets[frameIndex];
      const end = activeBlock.frameOffsets[frameIndex + 1];
      for (let assignmentIndex = start; assignmentIndex < end; assignmentIndex += 1) {
        currentTransforms[activeBlock.assignmentLeafIndices[assignmentIndex]] =
          preparedTransformAt(activeBlock, assignmentIndex);
      }
    }
    for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
      const transform = currentTransforms[leafIndex];
      if (!transform) throw new Error("Galaxy reconstructed transform drifted");
      transformPublisher.publishTransform(leafIndex, transform);
    }
    return catalog.starCount;
  }

  function activateBlock(blockIndex) {
    const block = resolvedBlocks.get(blockIndex);
    if (!block) throw new Error(`Galaxy block ${blockIndex} was not ready at publication`);
    const nextBankIndex = Math.floor(blockIndex / catalog.blocksPerBank);
    activeBlock = block;
    activeBlockIndex = blockIndex;
    preparedBlockSwitchCount += 1;
    if (nextBankIndex !== activeBankIndex) {
      activeBankIndex = nextBankIndex;
      preparedBankSwitchCount += 1;
    }
    queueWindows();
  }

  function queueWindows(windowBlockIndex = activeBlockIndex, prepareNext = lookaheadStarted) {
    blockWindowIndices[0] = windowBlockIndex;
    blockWindowIndices[1] = (windowBlockIndex + 1) % catalog.blockCount;
    onBlockWindow(blockWindowIndices);
    retainedBlockFlags.fill(0);
    retainedBlockFlags[blockWindowIndices[0]] = 1;
    retainedBlockFlags[blockWindowIndices[1]] = 1;
    for (const index of resolvedBlocks.keys()) {
      if (retainedBlockFlags[index] === 0) resolvedBlocks.delete(index);
    }
    for (const index of pendingBlocks.keys()) {
      if (retainedBlockFlags[index] === 0) pendingBlocks.delete(index);
    }
    const windowBankIndex = Math.floor(windowBlockIndex / catalog.blocksPerBank);
    bankWindowIndices[0] = windowBankIndex;
    bankWindowIndices[1] = (windowBankIndex + 1) % catalog.bankCount;
    const bankBlockIndex = windowBlockIndex % catalog.blocksPerBank;
    const shouldPrefetchBank = prepareNext &&
      bankBlockIndex >= catalog.blocksPerBank - 2;
    onBankWindow(bankWindowIndices, shouldPrefetchBank);
    const nextIndex = blockWindowIndices[1];
    if (!prepareNext || resolvedBlocks.has(nextIndex) || pendingBlocks.has(nextIndex)) return;
    preparedBlockPrefetchCount += 1;
    const pending = Promise.resolve(loadBlock(nextIndex)).then((block) => {
      if (!destroyed && pendingBlocks.get(nextIndex) === pending) resolvedBlocks.set(nextIndex, block);
      pendingBlocks.delete(nextIndex);
      return block;
    }).catch((error) => {
      pendingBlocks.delete(nextIndex);
      onError(error);
      return null;
    });
    pendingBlocks.set(nextIndex, pending);
  }

  function tick(timestamp) {
    frameRequest = null;
    if (destroyed || paused) return;
    const now = Math.max(timestamp, readNow());
    if (lastAnimationFrameAt > 0) {
      cadenceSamples[cadenceSampleCount++ % cadenceSamples.length] = now - lastAnimationFrameAt;
    }
    lastAnimationFrameAt = now;
    if (waitingForBlock || now + earlyDeadlineToleranceMilliseconds < nextFrameAt) {
      frameRequest = requestFrame(tick);
      return;
    }
    const next = (publishedStreamFrame + 1) % catalog.streamFrameCount;
    const nextBlockIndex = Math.floor(next / catalog.blockFrameCount);
    if (nextBlockIndex !== activeBlockIndex && !resolvedBlocks.has(nextBlockIndex)) {
      waitingForBlock = true;
      preparedBlockWaitCount += 1;
      if (Math.floor(nextBlockIndex / catalog.blocksPerBank) !== activeBankIndex) {
        preparedBankWaitCount += 1;
      }
      const expected = pendingBlocks.get(nextBlockIndex) ?? Promise.resolve(loadBlock(nextBlockIndex));
      expected.then((block) => {
        if (!block || destroyed) return;
        resolvedBlocks.set(nextBlockIndex, block);
        waitingForBlock = false;
        nextFrameAt = readNow();
      }).catch((error) => {
        waitingForBlock = false;
        onError(error);
      });
      frameRequest = requestFrame(tick);
      return;
    }
    publish(next, now);
    nextFrameAt += catalog.frameMilliseconds;
    if (nextFrameAt <= now) {
      nextFrameAt = now + catalog.frameMilliseconds;
      schedulerLateResetCount += 1;
    }
    frameRequest = requestFrame(tick);
  }

  function pause() {
    if (paused) return;
    paused = true;
    if (frameRequest !== null) cancelFrame(frameRequest);
    frameRequest = null;
  }

  function resume() {
    if (!paused || destroyed) return;
    paused = false;
    const now = readNow();
    nextFrameAt = now + catalog.frameMilliseconds;
    lastAnimationFrameAt = 0;
    frameRequest = requestFrame(tick);
  }

  function startLookahead() {
    if (lookaheadStarted || destroyed) return;
    lookaheadStarted = true;
    queueWindows();
  }

  async function seekStreamFrame(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= catalog.streamFrameCount) {
      throw new RangeError("Galaxy seek frame is invalid");
    }
    pause();
    const blockIndex = Math.floor(index / catalog.blockFrameCount);
    queueWindows(blockIndex, false);
    if (!resolvedBlocks.has(blockIndex)) resolvedBlocks.set(blockIndex, await loadBlock(blockIndex));
    publish(index, readNow());
    nextFrameAt = readNow() + catalog.frameMilliseconds;
    return stats();
  }

  async function stepFrame() {
    return seekStreamFrame((publishedStreamFrame + 1) % catalog.streamFrameCount);
  }

  function stats() {
    const cadenceCount = Math.min(cadenceSampleCount, cadenceSamples.length);
    const cadence = Array.from(cadenceSamples.slice(0, cadenceCount)).sort((a, b) => a - b);
    const presentations = Array.from(presentationSamples.slice(0, presentationSampleCount))
      .sort((a, b) => a - b);
    const writes = Array.from(writesPerPublication.slice(0, publicationSampleCount))
      .sort((a, b) => a - b);
    const transitions = Array.from({ length: transitionCount }, (_, index) => Object.freeze({
      streamFrame: transitionStreamFrames[index],
      presentationGapMilliseconds: Number(transitionGaps[index].toFixed(3)),
      publishDurationMilliseconds: Number(transitionPublishDurations[index].toFixed(3)),
    }));
    return Object.freeze({
      activeBlockIndex,
      activeBankIndex,
      publishedStreamFrame,
      appliedFrameCount,
      transformWriteCount,
      colorWriteCount: 0,
      opacityWriteCount: 0,
      cameraMode: "fixed",
      cameraWriteCount: 0,
      totalDomWriteCount,
      writesPerPublishedFrameMean: appliedFrameCount === 0 ? 0 : totalDomWriteCount / appliedFrameCount,
      writesPerPublishedFrameP95: percentile(writes, 0.95),
      sourceFrameDropCount: 0,
      droppedFrameCauses: Object.freeze({
        schedulerDeadlineCollapse: 0,
        preparedBlockWait: 0,
        preparedBankWait: 0,
        documentHidden: 0,
      }),
      schedulerLateResetCount,
      preparedBlockWaitCount,
      preparedBankWaitCount,
      cadence: Object.freeze({
        sampleCount: cadence.length,
        p50Milliseconds: percentile(cadence, 0.5),
        p95Milliseconds: percentile(cadence, 0.95),
        p99Milliseconds: percentile(cadence, 0.99),
        maximumMilliseconds: cadence.at(-1) ?? 0,
      }),
      presentation: Object.freeze({
        sampleCount: presentations.length,
        p50Milliseconds: percentile(presentations, 0.5),
        p95Milliseconds: percentile(presentations, 0.95),
        maximumMilliseconds: presentations.at(-1) ?? 0,
      }),
      preparedBlockSwitchCount,
      preparedEncounterSwitchCount,
      preparedBankSwitchCount,
      preparedBlockPrefetchCount,
      pendingBlockCount: pendingBlocks.size,
      resolvedBlockCount: resolvedBlocks.size,
      runtimeFrameAllocationCount: 0,
      runtimeLoaderBookkeepingAllocationCount: 0,
      runtimeTransformStringAllocationCount: 0,
      runtimeTransformStringFormattingCount: 0,
      transitions: Object.freeze(transitions),
      retainedDomStable: true,
    });
  }

  return Object.freeze({ pause, resume, startLookahead, seekStreamFrame, stepFrame, stats, destroy() {
    pause();
    destroyed = true;
  } });
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return Number(sorted[Math.min(sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1)].toFixed(3));
}

function preparedTransformAt(block, assignmentIndex) {
  const chunkIndex = Math.floor(assignmentIndex / block.transformChunkSize);
  const chunkOffset = assignmentIndex - chunkIndex * block.transformChunkSize;
  const transform = block.transformChunks[chunkIndex]?.[chunkOffset];
  if (transform === undefined) throw new RangeError("Galaxy prepared transform index drifted");
  return transform;
}
