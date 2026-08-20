// SPDX-License-Identifier: GPL-2.0-or-later
export function resolveFlocksPerspective(viewportHeight, fieldOfViewDegrees = 50) {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
      !Number.isFinite(fieldOfViewDegrees) || fieldOfViewDegrees <= 0 || fieldOfViewDegrees >= 180) {
    throw new RangeError("Flocks perspective inputs are invalid");
  }
  return Number((viewportHeight / (2 * Math.tan(fieldOfViewDegrees * Math.PI / 360))).toFixed(4));
}

export const CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES = 5;

export function createFlocksPreparedPlayer({
  shapeElements,
  catalog,
  initialBlock,
  initialLookaheadBlocks = [],
  loadBlock,
  onBlockWindow = () => undefined,
  onError = () => undefined,
  assertStableDom = () => undefined,
  setPerspective = () => undefined,
  readNow = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
}) {
  validateBinding(shapeElements, catalog, initialBlock, initialLookaheadBlocks, loadBlock);
  let activeBlock = initialBlock;
  let activeBlockIndex = initialBlock.index;
  let playback = initialBlock.playback;
  let frameIndex = 0;
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let nextFrameAt = 0;
  const pending = new Map(initialLookaheadBlocks.map((block) => [block.index, {
    block,
    promise: Promise.resolve(block),
    error: null,
  }]));
  const previousColors = new Array(catalog.bugCount).fill(null);
  const sourceIndexByRoot = Array.from({ length: catalog.bugCount }, (_, index) => index);
  let applyCount = 0;
  let shapeTransformWrites = 0;
  let rootColorWrites = 0;
  let schedulerFrameCallbackCount = 0;
  let schedulerLateResetCount = 0;
  let blockSwitchCount = 0;
  let blockWaitCount = 0;
  let terminalWrapCount = 0;
  let terminalPermutationCompositionCount = 0;
  let prefetchCount = initialLookaheadBlocks.length;
  let debugAbsoluteSeekCount = 0;
  let debugStepCount = 0;

  publishFrame(0, true);
  queueLookahead();

  function publishFrame(nextFrameIndex, forceColors = false) {
    const offset = nextFrameIndex * catalog.bugCount;
    for (let bugIndex = 0; bugIndex < catalog.bugCount; bugIndex += 1) {
      const element = shapeElements[bugIndex];
      const sourceIndex = sourceIndexByRoot[bugIndex];
      const transform = playback.transforms[offset + sourceIndex];
      if (element.style.transform !== transform) {
        element.style.transform = transform;
        shapeTransformWrites += 1;
      }
      if (forceColors || (nextFrameIndex + bugIndex) % CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES === 0) {
        const color = playback.colors[offset + sourceIndex];
        if (forceColors || previousColors[bugIndex] !== color) {
          element.style.color = color;
          previousColors[bugIndex] = color;
          rootColorWrites += 1;
        }
      }
    }
    frameIndex = nextFrameIndex;
    applyCount += 1;
  }

  function lookaheadIndices() {
    return [1, 2].map((offset) => (activeBlockIndex + offset) % catalog.blockCount);
  }

  function queueLookahead() {
    const indices = lookaheadIndices();
    const keep = new Set(indices);
    for (const index of pending.keys()) if (!keep.has(index)) pending.delete(index);
    onBlockWindow([activeBlockIndex, ...indices]);
    for (const index of indices) {
      if (pending.has(index)) continue;
      const record = { block: null, promise: null, error: null };
      prefetchCount += 1;
      record.promise = Promise.resolve(loadBlock(index)).then((block) => {
        if (destroyed || pending.get(index) !== record) return null;
        validateBlock(block, catalog);
        record.block = block;
        return block;
      }).catch((error) => {
        if (destroyed || pending.get(index) !== record) return null;
        record.error = error;
        onError(error);
        return null;
      });
      pending.set(index, record);
    }
  }

  async function activateNextBlock() {
    const index = (activeBlockIndex + 1) % catalog.blockCount;
    const record = pending.get(index);
    if (!record) throw new Error(`Prepared Flocks lookahead block ${index} is unavailable`);
    if (record.block === null) {
      blockWaitCount += 1;
      await record.promise;
    }
    if (!record.block) throw record.error ?? new Error(`Prepared Flocks lookahead block ${index} failed`);
    const previousIndex = activeBlockIndex;
    activeBlock = record.block;
    activeBlockIndex = index;
    playback = activeBlock.playback;
    pending.delete(index);
    blockSwitchCount += 1;
    if (previousIndex === catalog.blockCount - 1 && index === 0) {
      terminalWrapCount += 1;
      const correspondence = catalog.terminalSeam?.correspondence;
      if (Array.isArray(correspondence)) {
        for (let rootIndex = 0; rootIndex < sourceIndexByRoot.length; rootIndex += 1) {
          sourceIndexByRoot[rootIndex] = correspondence[sourceIndexByRoot[rootIndex]];
        }
        terminalPermutationCompositionCount += 1;
      }
    }
    publishFrame(0);
    queueLookahead();
  }

  function schedule() {
    if (paused || destroyed || frameRequest !== null) return;
    frameRequest = requestFrame(wake);
  }

  async function wake(timestamp) {
    frameRequest = null;
    if (paused || destroyed) return;
    schedulerFrameCallbackCount += 1;
    const now = Math.max(Number(timestamp) || 0, readNow());
    if (now + 0.75 < nextFrameAt) {
      schedule();
      return;
    }
    try {
      if (frameIndex + 1 >= playback.frameCount) await activateNextBlock();
      else publishFrame(frameIndex + 1);
      nextFrameAt += playback.frameMilliseconds;
      if (nextFrameAt <= now) {
        nextFrameAt = now + playback.frameMilliseconds;
        schedulerLateResetCount += 1;
      }
    } catch (error) {
      paused = true;
      onError(error);
      return;
    }
    schedule();
  }

  function pause() {
    if (paused || destroyed) return stats();
    paused = true;
    if (frameRequest !== null) cancelFrame(frameRequest);
    frameRequest = null;
    return stats();
  }

  function resume() {
    if (!paused || destroyed) return stats();
    paused = false;
    nextFrameAt = readNow() + playback.frameMilliseconds;
    schedule();
    return stats();
  }

  function seekFrame(nextFrameIndex) {
    if (!Number.isSafeInteger(nextFrameIndex) || nextFrameIndex < 0 || nextFrameIndex >= playback.frameCount) {
      throw new RangeError("Prepared Flocks frame is out of range");
    }
    publishFrame(nextFrameIndex, true);
    return stats();
  }

  async function seekStreamFrame(nextStreamFrameIndex) {
    if (!paused) throw new Error("Prepared Flocks absolute seek requires paused playback");
    if (!Number.isSafeInteger(nextStreamFrameIndex) || nextStreamFrameIndex < 0 ||
        nextStreamFrameIndex >= catalog.streamFrameCount) {
      throw new RangeError("Prepared Flocks stream frame is out of range");
    }
    const nextBlockIndex = Math.floor(nextStreamFrameIndex / catalog.blockFrameCount);
    const nextFrameIndex = nextStreamFrameIndex % catalog.blockFrameCount;
    pending.clear();
    onBlockWindow([
      nextBlockIndex,
      (nextBlockIndex + 1) % catalog.blockCount,
      (nextBlockIndex + 2) % catalog.blockCount,
    ]);
    const nextBlock = nextBlockIndex === activeBlockIndex ? activeBlock : await loadBlock(nextBlockIndex);
    validateBlock(nextBlock, catalog);
    activeBlock = nextBlock;
    activeBlockIndex = nextBlockIndex;
    playback = nextBlock.playback;
    for (let rootIndex = 0; rootIndex < sourceIndexByRoot.length; rootIndex += 1) {
      sourceIndexByRoot[rootIndex] = rootIndex;
      previousColors[rootIndex] = null;
    }
    debugAbsoluteSeekCount += 1;
    publishFrame(nextFrameIndex, true);
    queueLookahead();
    return stats();
  }

  async function stepFrame() {
    if (!paused) throw new Error("Prepared Flocks debug step requires paused playback");
    if (frameIndex + 1 >= playback.frameCount) await activateNextBlock();
    else publishFrame(frameIndex + 1);
    debugStepCount += 1;
    return stats();
  }

  function resize(viewportHeight = globalThis.innerHeight) {
    const perspective = resolveFlocksPerspective(viewportHeight, 50);
    setPerspective(perspective);
    return perspective;
  }

  function stats() {
    assertStableDom();
    return Object.freeze({
      paused,
      frameIndex,
      streamFrameIndex: activeBlock.startFrameIndex + frameIndex,
      streamFrameCount: catalog.streamFrameCount,
      activeBlockIndex,
      applyCount,
      shapeTransformWrites,
      rootColorWrites,
      colorPublicationIntervalFrames: CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES,
      colorPublicationRateHz: 60 / CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES,
      colorPublicationPhaseCount: CSSFLOCKS_COLOR_PUBLICATION_INTERVAL_FRAMES,
      colorPublicationPolicy: "source-frame-plus-retained-root-index-round-robin",
      schedulerFrameCallbackCount,
      schedulerLateResetCount,
      blockSwitchCount,
      blockWaitCount,
      terminalWrapCount,
      terminalPermutationCompositionCount,
      prefetchCount,
      debugAbsoluteSeekCount,
      debugStepCount,
      pendingBlockIndices: Object.freeze(lookaheadIndices()),
      runtimeGeometryConstructionCount: 0,
      runtimeFrameMatrixFormattingCount: 0,
      runtimeFrameColorFormattingCount: 0,
      runtimeClassSwapCount: 0,
      runtimeDomGrowth: false,
      retainedModelWrapperCount: 0,
      retainedDomStable: true,
    });
  }

  return Object.freeze({
    pause,
    resume,
    seekFrame,
    seekStreamFrame,
    stepFrame,
    resize,
    stats,
    destroy() {
      destroyed = true;
      paused = true;
      if (frameRequest !== null) cancelFrame(frameRequest);
      frameRequest = null;
    },
  });
}

function validateBinding(shapeElements, catalog, initialBlock, initialLookaheadBlocks, loadBlock) {
  if (!Array.isArray(shapeElements) || shapeElements.length !== catalog?.bugCount ||
      shapeElements.some((element) => !element?.style) || typeof loadBlock !== "function" ||
      !Array.isArray(initialLookaheadBlocks) || initialLookaheadBlocks.length > 2 ||
      !Number.isSafeInteger(initialBlock?.index) || initialBlock.index < 0 || initialBlock.index >= catalog.blockCount) {
    throw new Error("Prepared Flocks player binding drifted");
  }
  validateBlock(initialBlock, catalog);
  for (const block of initialLookaheadBlocks) validateBlock(block, catalog);
}

function validateBlock(block, catalog) {
  if (block?.schema !== "cssflocks-prepared-stream-block@1" ||
      !Number.isSafeInteger(block.index) || block.index < 0 || block.index >= catalog.blockCount ||
      block.startFrameIndex !== block.index * catalog.blockFrameCount ||
      block.playback?.bugCount !== catalog.bugCount ||
      block.playback.frameCount !== catalog.blockFrameCount ||
      block.playback.transforms?.length !== catalog.blockFrameCount * catalog.bugCount ||
      block.playback.colors?.length !== catalog.blockFrameCount * catalog.bugCount) {
    throw new Error(`Prepared Flocks block ${block?.index ?? "unknown"} binding drifted`);
  }
}
